import { expect, test } from 'vitest';
import { html, join, raw } from '../src/html.ts';

test('values are escaped, in text and in attributes', () => {
  const name = '"><script>alert(1)</script>';
  expect(String(html`<a title="${name}">${name}</a>`)).toBe(
    '<a title="&#34;&#62;&#60;script&#62;alert(1)&#60;/script&#62;">&#34;&#62;&#60;script&#62;alert(1)&#60;/script&#62;</a>',
  );
});

test('markup made with html is put in as it is, once; lists are joined; nothing for null, undefined, booleans', () => {
  const item = (s: string) => html`<li>${s}</li>`;
  expect(String(html`<ul>${['a&b', 'c'].map(item)}</ul>`)).toBe('<ul><li>a&#38;b</li><li>c</li></ul>');
  expect(String(html`${null}${undefined}${false}${true}${0}`)).toBe('0');
  expect(String(html`${join(['x', html`<b>y</b>`], ', ')}`)).toBe('x, <b>y</b>');
});

test('raw is for our own markup only (styles, scripts, structured data)', () => {
  expect(String(html`<style>${raw('a>b{c:d}')}</style>`)).toBe('<style>a>b{c:d}</style>');
});
