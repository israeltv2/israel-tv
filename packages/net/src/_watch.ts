// Temporary: poll Mako's morning-news page until an episode newer than 05.11.26 appears.
import { createFetcher } from './fetcher.ts';

const f = createFetcher({ delayMs: 1500 });
for (let i = 0; i < 30; i++) {
  const d = (await f.json('https://www.mako.co.il/mako-vod-keshet/morning_news?platform=responsive')) as {
    menu: { vods: { componentLayout: string; extraInfo?: string; title: string; itemVcmId: string }[] }[];
  };
  const v = d.menu[0]?.vods.find((x) => x.componentLayout === 'vod');
  console.log(new Date().toISOString(), v?.extraInfo, v?.title);
  if (v && v.extraInfo !== '05.11.26') {
    console.log('NEW', v.itemVcmId);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 10 * 60_000));
}
process.exit(1);
