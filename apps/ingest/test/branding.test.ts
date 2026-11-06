import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brandImage, createResolverApp } from '@israel-tv/resolver';
import { expect, test } from 'vitest';
import { localAddonApp } from '../src/local-server.ts';

test('bundled branding images exist, and an operator folder overrides them', () => {
  expect(brandImage(undefined, 'logo')?.type).toBe('image/png');
  expect(brandImage(undefined, 'background')?.type).toBe('image/jpeg');
  const dir = mkdtempSync(join(tmpdir(), 'brand-'));
  writeFileSync(join(dir, 'logo.png'), 'mine');
  expect(Buffer.from(brandImage(dir, 'logo')?.body ?? []).toString()).toBe('mine');
});

test('the local server serves images and fills the origin into JSON', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'site-'));
  mkdirSync(join(dir, 'logos'));
  writeFileSync(join(dir, 'logos', 'iltv_live_kan11.png'), 'png');
  writeFileSync(join(dir, 'logo.png'), 'png');
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ logo: '{{israel-tv-origin}}/logo.png' }));
  const app = localAddonApp(dir);
  const img = await app.request('http://home:7700/logos/iltv_live_kan11.png');
  expect(img.status).toBe(200);
  expect(img.headers.get('content-type')).toBe('image/png');
  expect((await app.request('http://home:7700/logo.png')).status).toBe(200);
  expect((await app.request('http://home:7700/logos/..%2Fmanifest.json')).status).toBe(404);
  expect(
    ((await (await app.request('http://home:7700/manifest.json')).json()) as { logo: string }).logo,
  ).toBe('http://home:7700/logo.png');
});

test("the resolver's manifest names its own logo and background", async () => {
  const img = { body: new Uint8Array([1]), type: 'image/png' };
  const app = createResolverApp({
    episode: () => undefined,
    fetch: async () => new Response(''),
    branding: { logo: img, background: img },
  });
  const m = (await (await app.request('http://home:7701/manifest.json')).json()) as {
    logo: string;
    background: string;
  };
  expect(m.logo).toBe('http://home:7701/logo.png');
  expect(m.background).toBe('http://home:7701/background.jpg');
  expect((await app.request('http://home:7701/logo.png')).status).toBe(200);
});

test('every live channel has a logo tile, and its meta points at our copy', async () => {
  const { LIVE_CHANNELS } = await import('@israel-tv/core');
  const { channelLogo } = await import('@israel-tv/resolver');
  const { liveRender } = await import('../src/live.ts');
  for (const c of LIVE_CHANNELS) expect(channelLogo(c.id), c.id).toBeDefined();
  const live = liveRender(new Set(['iltv_live_kan11']));
  expect(live.find((c) => c.id === 'iltv_live_kan11')?.logo).toBe(
    '{{israel-tv-origin}}/logos/iltv_live_kan11.png',
  );
  expect(channelLogo('../x')).toBeUndefined();
});
