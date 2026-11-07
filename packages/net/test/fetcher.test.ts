import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { BlockedError, createFetcher, type Transport } from '../src/fetcher.ts';

// Radware's block page as Mako serves it (a 302 to validate.perfdrive.com, then this page with HTTP 200), recorded
// 2026-11-07; the requester's address in it is replaced by a documentation address.
const RADWARE = readFileSync(new URL('./fixtures/radware-block-page.html', import.meta.url), 'utf8');
const PERFDRIVE = 'https://validate.perfdrive.com/?ssa=x&ssc=https%3A%2F%2Fwww.mako.co.il%2Fshow';
const URL_ = 'https://www.mako.co.il/mako-vod-keshet/show?platform=responsive';

/** Answers in order: 'block' is Radware's page, anything else is a JSON body. */
function replay(answers: string[]): Transport & { calls: number } {
  const t = Object.assign(
    async ({ url }: { url: string }) => {
      const a = answers[t.calls++] ?? answers.at(-1) ?? '';
      return a === 'block' ? { status: 200, body: RADWARE, url: PERFDRIVE } : { status: 200, body: a, url };
    },
    { calls: 0 },
  );
  return t;
}

test("a Radware page is retried after a pause with jitter, and the retry's data is read", async () => {
  const waits: number[] = [];
  const transport = replay(['block', '{"ok":1}']);
  const f = createFetcher({ delayMs: 0, transport, sleep: async (ms) => waits.push(ms) });
  expect(await f.json(URL_)).toEqual({ ok: 1 });
  expect(transport.calls).toBe(2);
  expect(waits).toHaveLength(1);
  expect(waits[0]).toBeGreaterThanOrEqual(3750);
  expect(waits[0]).toBeLessThanOrEqual(6250);
  expect(f.blocks).toEqual({ pages: 1, cleared: 1, refused: 0 });
  expect(f.requests).toBe(2);
});

test('still Radware after every retry: a labelled BlockedError, counted as refused', async () => {
  const transport = replay(['block']);
  const f = createFetcher({ delayMs: 0, transport, blockBackoffMs: [0, 0], sleep: async () => {} });
  const err = await f.json(URL_).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(BlockedError);
  expect((err as Error).message).toBe('blocked by www.mako.co.il (HTTP 200): page matches /radware/i');
  expect(transport.calls).toBe(3);
  expect(f.blocks).toEqual({ pages: 3, cleared: 0, refused: 1 });
});

test('a redirect to the bot-check host is a block even without a marker in the page', async () => {
  const transport: Transport = async () => ({ status: 200, body: '<html></html>', url: PERFDRIVE });
  const f = createFetcher({ delayMs: 0, transport, blockBackoffMs: [] });
  await expect(f.json(URL_)).rejects.toThrow('sent to validate.perfdrive.com');
});

test('a page that is not JSON and not a bot check is not retried', async () => {
  const transport = replay(['<html>maintenance</html>']);
  const f = createFetcher({ delayMs: 0, transport, sleep: async () => {} });
  await expect(f.json(URL_)).rejects.toThrow(/expected JSON/);
  expect(transport.calls).toBe(1);
  expect(f.blocks).toEqual({ pages: 0, cleared: 0, refused: 0 });
});
