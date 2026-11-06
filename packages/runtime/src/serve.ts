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
export function lanAddresses(host: string, env: Record<string, string | undefined> = process.env): string[] {
  // Inside a container, its own addresses are not the computer's: say so instead of printing a wrong one.
  if (env.ISRAEL_TV_IN_CONTAINER) return ["<this computer's address>"];
  if (host !== '0.0.0.0' && host !== '::') return [host];
  const all: { name: string; address: string }[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const a of list ?? [])
      if (a.family === 'IPv4' && !a.internal) all.push({ name, address: a.address });
  }
  return homeAddresses(all);
}

/** Adapters that are not the home network: WSL/Hyper-V, Docker, VMs, VPNs, link-local. */
const VIRTUAL =
  /^(vethernet|docker|br-|veth|virbr|vmnet|vboxnet|utun|tun|tap|wg|tailscale|zt|llw|awdl|bridge|anpi|ham)/i;
const PRIVATE = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** The addresses other devices at home can reach: virtual adapters dropped, private home ranges first. */
export function homeAddresses(all: { name: string; address: string }[]): string[] {
  const real = all.filter((a) => !VIRTUAL.test(a.name) && !a.address.startsWith('169.254.'));
  const pick = (real.length ? real : all).map((a) => a.address);
  const ordered = [...pick.filter((a) => PRIVATE.test(a)), ...pick.filter((a) => !PRIVATE.test(a))];
  return ordered.length ? ordered : ['127.0.0.1'];
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
