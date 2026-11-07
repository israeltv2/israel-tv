// The pages' styles (styles/*.css) and browser scripts (client/*.js), read from their files when the site is rendered
// and inlined into each page (one request per page, nothing to build). Only the renderer runs this, in Node.
import { readFileSync } from 'node:fs';

const cache = new Map<string, string>();
const read = (path: string) => {
  let text = cache.get(path);
  if (text === undefined) {
    text = readFileSync(new URL(path, import.meta.url), 'utf8');
    cache.set(path, text);
  }
  return text;
};

/** A stylesheet, compacted: comments and the formatting's whitespace removed (the rules as written). */
export const style = (name: string) =>
  read(`./styles/${name}`)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,>])\s*/g, '$1')
    .replace(/:\s+/g, ':')
    .replace(/;}/g, '}')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();

/** A browser script, without whole-line comments, indentation and blank lines. */
export const script = (name: string) =>
  read(`./client/${name}`)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'))
    .join('\n');
