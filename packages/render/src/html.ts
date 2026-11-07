// The pages' markup: a tagged template that escapes every value put into it, unless the value is markup made the
// same way (a component's output) or deliberately marked raw (styles, scripts, structured data). Scraped titles and
// descriptions can therefore never become markup by accident, and there is no esc() to forget.
// Plain functions and template literals, so the sources run as they are in Node (no JSX, no build step).

/** Markup that is safe to put into a page as it is. */
export class Html {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString(): string {
    return this.value;
  }
}

/** What can go into `html`: markup, text (escaped), numbers, lists of these; null, undefined and booleans add nothing. */
export type Child = Html | string | number | boolean | null | undefined | readonly Child[];

/** Text escaped for HTML text and attribute values (quotes too). */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function put(v: Child): string {
  if (v === null || v === undefined || typeof v === 'boolean') return '';
  if (v instanceof Html) return v.value;
  if (Array.isArray(v)) return v.map(put).join('');
  return esc(String(v));
}

export function html(strings: TemplateStringsArray, ...values: Child[]): Html {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) out += put(values[i]) + (strings[i + 1] ?? '');
  return new Html(out);
}

/** Markup from a trusted source (our own styles, scripts, JSON-LD), put in as it is. */
export const raw = (s: string) => new Html(s);
