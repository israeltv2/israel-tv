import { normalize } from './src/hebrew.ts';
import names from './worker/src/names.json' with { type: 'json' };

let t = performance.now();
const index = (names as [string, string][]).map(([id, name]) => ({ id, name, key: normalize(name) }));
console.log(`build index (${index.length}) ms=${(performance.now() - t).toFixed(2)}`);
for (const q of ['המהדורה', 'מאסטר שף', 'א', 'zzz']) {
  t = performance.now();
  for (let i = 0; i < 1000; i++) index.filter((e) => e.key.includes(normalize(q))).slice(0, 100);
  console.log(`q=${q} per-query ms=${((performance.now() - t) / 1000).toFixed(4)}`);
}
