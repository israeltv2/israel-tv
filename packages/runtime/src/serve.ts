// Serving and running: listening on a port with a clear message when it is taken, the addresses others on the
// network can use, and waiting for a stop signal. Shared by every role's entry point.
import { networkInterfaces } from 'node:os';
import { serve } from '@hono/node-server';

/** Listen, or fail with a message that names the port and the option that sets it. */
export function listen(
  fetch: (req: Request, ...rest: never[]) => Response | Promise<Response>,
  host: string,
  port: number,
  option: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: fetch as never, hostname: host, port }, () => resolve());
    server.on('error', (err: NodeJS.ErrnoException) => {
      reject(
        new Error(
          err.code === 'EADDRINUSE'
            ? `port ${port} is already in use (${option}). Is israel-tv already running?`
            : `cannot listen on ${host}:${port} (${option}): ${err.message}`,
        ),
      );
    });
  });
}

/** Addresses other devices on the network can use to reach this machine. */
export function lanAddresses(host: string): string[] {
  if (host !== '0.0.0.0' && host !== '::') return [host];
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out.length ? out : ['127.0.0.1'];
}

/** Resolves on Ctrl-C or a service manager's stop. */
export function stopSignal(log: (line: string) => void): Promise<void> {
  return new Promise((resolve) => {
    const stop = (sig: string) => {
      log(`stopped (${sig})`);
      resolve();
    };
    process.once('SIGINT', () => stop('SIGINT'));
    process.once('SIGTERM', () => stop('SIGTERM'));
  });
}
