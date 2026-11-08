import { expect, test } from 'vitest';
import { cleanShow, dropRepeatedVideos, type ScrapedShow } from '../src/model.ts';

const ep = (key: string, title: string, durationSec?: number, description?: string) => ({
  key,
  title,
  streams: [],
  ...(durationSec ? { durationSec } : {}),
  ...(description ? { description } : {}),
});
const show = (episodes: ScrapedShow['seasons'][number]['episodes']): ScrapedShow => ({
  source: 'reshet',
  key: '/all-shows/the-big-brother/',
  title: 'האח הגדול',
  catalog: 'iltv_reshet13',
  seasons: [{ key: 's3', title: 'עונה 3', episodes }],
});

test('a video listed twice in a season (same title, length and text) is kept once (האח הגדול)', () => {
  const s = show([
    ep('1_a', 'שי ושניר נפרדים', 5414, 'שי ושניר...'),
    ep('1_b', 'אירוע הכניסה', 5200),
    ep('1_h1wlrs10', 'שי ושניר נפרדים', 5414, 'שי ושניר...'),
  ]);
  expect(dropRepeatedVideos(s).seasons[0]?.episodes.map((e) => e.key)).toEqual(['1_a', '1_b']);
  expect(cleanShow(s).seasons[0]?.episodes).toHaveLength(2);
});

test('the same title with another length is another episode (a re-edit, a rerun of a guest), and stays', () => {
  const s = show([
    ep('a', 'דנית גרינברג', 1439, 'x'),
    ep('b', 'דנית גרינברג', 1620, 'x'),
    ep('c', 'פרק 14'),
    ep('d', 'פרק 14'),
  ]);
  expect(dropRepeatedVideos(s)).toBe(s);
});
