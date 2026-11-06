// Logging: pino JSON lines with a `component` field (ingest, resolver, mako-auth, geo-relay, …) and per-line
// fields (playId, showId, episodeId, source, …). With a file configured, lines go to rotated files (pino-roll:
// by size and by day, keeping a fixed number); otherwise to stdout (readable lines on a terminal).
//
// Secrets never reach a line: known secret keys are redacted, and every string in a line (message or field)
// has the values of the configured secrets replaced, so a token inside a URL or an error message is caught too.
import { basename, dirname, extname, join } from 'node:path';
import type { Config } from '@israel-tv/core';
import { pino } from 'pino';

/** A log line: a message plus fields. */
export type Log = (msg: string, fields?: Record<string, unknown>) => void;

export interface Logger {
  /** The `ingest` component's log. */
  log: Log;
  /** A log for another component. */
  for(component: string): Log;
  /** Write everything pending (before exit). */
  flush(): void;
}

const REDACTED = '[redacted]';
/** Field names that hold secrets wherever they appear. */
const SECRET_KEYS = ['token', 'password', 'pass', 'secret', 'authorization', 'cookie', 'apiKey', 'ticket'];

/**
 * Secret values from the environment: every variable the config names as a secret, and anything named like a
 * token, password, key, secret, user or account id.
 */
/** Variables the config names as secrets (whatever they are called), registered when the config is loaded. */
const secretNames = new Set<string>();

export function registerSecretNames(names: Iterable<string>): void {
  for (const n of names) secretNames.add(n);
}

export function secretValues(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(env)
    .filter(
      ([k, v]) =>
        (secretNames.has(k) || /(TOKEN|PASS|SECRET|KEY|USER|ACCOUNT)/i.test(k)) &&
        typeof v === 'string' &&
        v.length >= 6,
    )
    .map(([, v]) => v as string)
    .sort((a, b) => b.length - a.length);
}

/** Replace every secret value inside strings, arrays and plain objects (a few levels deep). */
export function scrub(value: unknown, secrets: readonly string[], depth = 0): unknown {
  if (typeof value === 'string') {
    let s = value;
    for (const secret of secrets) if (s.includes(secret)) s = s.split(secret).join(REDACTED);
    return s;
  }
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return { message: scrub(value.message, secrets, depth + 1), name: value.name };
  if (Array.isArray(value)) return value.map((v) => scrub(v, secrets, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = scrub(v, secrets, depth + 1);
  return out;
}

/** A readable one-line form of a pino JSON line, for a terminal. */
function readable(line: string): string {
  try {
    const {
      time,
      level,
      msg,
      component,
      pid: _p,
      hostname: _h,
      ...rest
    } = JSON.parse(line) as Record<string, unknown>;
    const t = new Date(Number(time)).toISOString().slice(11, 19);
    const lvl = Number(level) >= 50 ? ' ERROR' : Number(level) >= 40 ? ' WARN' : '';
    const fields = Object.entries(rest)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ');
    return `${t}Z${lvl} [${component}] ${msg}${fields ? `  ${fields}` : ''}\n`;
  } catch {
    return line;
  }
}

export function createLogger(config: Config['log'], env: NodeJS.ProcessEnv = process.env): Logger {
  const secrets = secretValues(env);
  const destination = config.file
    ? pino.transport({
        target: 'pino-roll',
        options: {
          file: join(dirname(config.file), basename(config.file, extname(config.file))),
          extension: extname(config.file) || '.log',
          size: `${config.maxMB}m`,
          frequency: 'daily',
          mkdir: true,
          symlink: true,
          limit: { count: config.keep, removeOtherLogFiles: true },
        },
      })
    : process.stdout.isTTY
      ? { write: (line: string) => process.stdout.write(readable(line)) }
      : pino.destination(1);
  const root = pino(
    {
      level: config.level,
      base: null,
      redact: { paths: SECRET_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]), censor: REDACTED },
      hooks: {
        // Every argument (message and fields) is scrubbed of secret values before it is written.
        logMethod(args, method) {
          method.apply(this, args.map((a) => scrub(a, secrets)) as Parameters<typeof method>);
        },
      },
    },
    destination,
  );
  const make = (component: string): Log => {
    const child = root.child({ component });
    return (msg, fields) => (fields ? child.info(fields, msg) : child.info(msg));
  };
  return {
    log: make('ingest'),
    for: make,
    flush: () => root.flush(),
  };
}
