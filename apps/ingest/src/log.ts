// Logging for the daemon: stdout, or a file that is trimmed (newest half kept) when it grows past a cap.
// Trimming rewrites the file in place, so an external process appending to it (e.g. a service manager
// pointed at the same file) keeps working.
import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';

export function createLogger(file: string | undefined, maxMB: number): (line: string) => void {
  const stamp = () => `${new Date().toISOString().replace('T', ' ').slice(0, 19)}Z`;
  if (!file) return (line) => console.log(`${stamp()} ${line}`);
  const max = maxMB * 1024 * 1024;
  let writes = 0;
  return (line) => {
    appendFileSync(file, `${stamp()} ${line}\n`);
    if (++writes % 200 !== 0) return;
    try {
      if (statSync(file).size > max) {
        const buf = readFileSync(file);
        const keep = buf.subarray(buf.length - Math.floor(max / 2));
        const nl = keep.indexOf(10);
        writeFileSync(file, keep.subarray(nl + 1));
      }
    } catch {}
  };
}
