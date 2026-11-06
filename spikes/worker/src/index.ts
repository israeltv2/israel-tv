import { Hono } from 'hono';
import { normalize } from '../../src/hebrew.ts';
import names from './names.json' with { type: 'json' };

const index = (names as [string, string][]).map(([id, name]) => ({ id, name, key: normalize(name) }));
const app = new Hono();

app.get('/search', (c) => {
  const q = normalize(c.req.query('q') ?? '');
  const t0 = performance.now();
  const hits = q ? index.filter((e) => e.key.includes(q)).slice(0, 100) : [];
  return c.json({
    count: hits.length,
    hits: hits.map(({ id, name }) => ({ id, name })),
    ms: performance.now() - t0,
  });
});

export default app;
