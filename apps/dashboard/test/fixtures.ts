// A believable week for the dashboard's screenshots and design checks: every admin API answer, typed by the
// contract (and checked against its schemas in fixtures.test.ts). Times are fixed around NOW; posters are
// generated tiles served by the screenshot script (no broadcaster artwork in the repo).
import type { Responses } from '@israel-tv/admin-contract';

export const NOW = Date.parse('2026-11-07T09:30:00Z');
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const ago = (minutes: number) => iso(NOW - minutes * 60_000);
/** Israel days (the fixture's time zone), oldest first. */
const days = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    new Date(NOW + 2 * 3_600_000 - (n - 1 - i) * DAY).toISOString().slice(0, 10),
  );
/** A steady, slightly noisy series (no randomness: the same every run). */
const wave = (n: number, base: number, amp: number, phase = 0) =>
  Array.from({ length: n }, (_, i) =>
    Math.max(0, Math.round(base + amp * Math.sin(i / 2.3 + phase) + ((i * 7) % 5) - 2)),
  );

const month = days(30);
const homePlays = wave(30, 9, 5);
const homeUnique = wave(30, 3, 1.5, 1);
const homeFail = wave(30, 0.6, 1.2, 2);
const publicPlays = wave(30, 46, 18, 0.5);
const poster = (n: number) => `https://img.example/poster-${n}.svg`;

const shows = [
  { showId: 'iltv_mako_15', title: 'גלית ואילנית', source: 'mako', plays: 14, poster: poster(1) },
  { showId: 'iltv_reshet_150', title: 'חדשות היום', source: 'reshet', plays: 11, poster: poster(2) },
  { showId: 'iltv_mako_3', title: 'מאסטר שף', source: 'mako', plays: 9, poster: poster(3) },
  { showId: 'iltv_kan_17', title: 'שעת נעילה', source: 'kan', plays: 7, poster: poster(4) },
  { showId: 'iltv_live_kan11', title: 'כאן 11', source: 'live', plays: 6 },
  { showId: 'iltv_reshet_41', title: 'הכוכב הבא', source: 'reshet', plays: 4, poster: poster(5) },
  { showId: 'iltv_mako_220', title: 'עובדה', source: 'mako', plays: 3, poster: poster(6) },
  { showId: 'iltv_kan_52', title: 'הבורר', source: 'kan', plays: 2, poster: poster(7) },
];

const canaryHistory = (fails: number[], unavailable: number[] = []) =>
  Array.from({ length: 14 }, (_, i) => ({
    at: iso(NOW - (13 - i) * DAY - 6 * 3_600_000),
    outcome: fails.includes(i) ? 'error' : 'ok',
    ...(fails.includes(i) ? { step: 'segment', statuses: '200/200/403' } : { statuses: '200/200/206' }),
    unavailable: unavailable.includes(i) ? 1 : 0,
  }));

const runs = (source: string) =>
  Array.from({ length: 8 }, (_, i) => ({
    at: ago(i * 60 + 5),
    kind: i === 6 ? 'full' : i === 7 ? 'retry' : 'airing',
    status: i === 6 ? 'partial' : 'ok',
    showsOk: i === 6 ? 510 : 42 - i,
    showsFailed: i === 6 ? 3 : 0,
    newEpisodes: i === 1 ? 2 : 0,
    seconds: i === 6 ? 1830 : 53,
    ...(i === 6 ? { error: `${source}: 3 shows blocked by bot protection` } : {}),
  }));

const playLines = [
  {
    playId: 'YsQ9dnVVxddN',
    at: ago(12),
    outcome: 'ok',
    source: 'mako',
    showId: 'iltv_mako_15',
    episodeId: 'iltv_mako_15:9:47',
    title: 'גלית ואילנית',
    latencyMs: 840,
    status: 200,
  },
  {
    playId: 'pHS0MSBHvFJw',
    at: ago(48),
    outcome: 'ok',
    source: 'reshet',
    showId: 'iltv_reshet_150',
    episodeId: 'iltv_reshet_150:1:95',
    title: 'חדשות היום',
    latencyMs: 1320,
    status: 200,
  },
  {
    playId: '1vBVjuqTAxOs',
    at: ago(95),
    outcome: 'error',
    source: 'mako',
    showId: 'iltv_mako_15',
    episodeId: 'iltv_mako_15:9:46',
    title: 'גלית ואילנית',
    status: 403,
    reason: 'Mako master HTTP 403',
  },
  {
    playId: 'ZvPkOnWRacs8',
    at: ago(180),
    outcome: 'ok',
    source: 'kan',
    showId: 'iltv_kan_17',
    episodeId: 'iltv_kan_17:1:3',
    title: 'שעת נעילה',
    latencyMs: 1910,
    status: 200,
  },
  {
    playId: 'khNANCVcO0LO',
    at: ago(320),
    outcome: 'ok',
    source: 'live',
    showId: 'iltv_live_kan11',
    title: 'כאן 11',
    latencyMs: 610,
    status: 200,
  },
  {
    playId: 'WFrFQ4V6ucTQ',
    at: ago(800),
    outcome: 'ok',
    source: 'mako',
    showId: 'iltv_mako_3',
    episodeId: 'iltv_mako_3:12:4',
    title: 'מאסטר שף',
    latencyMs: 990,
    status: 200,
  },
];

export const FIXTURES: Responses = {
  session: {
    csrf: 'fixture-csrf',
    revision: '907969a1c0de',
    role: 'host',
    publisher: 'cloudflare',
    publicUrl: 'https://israel-tv.example.workers.dev',
    timeZone: 'Asia/Jerusalem',
  },
  health: {
    state: 'warn',
    checkedAt: ago(1),
    problems: [
      {
        section: 'sources',
        severity: 'warn',
        message: 'kan: last crawl slice backed off (Cloudflare challenge); next slice in 20 min',
      },
      { section: 'failures', severity: 'warn', message: '1 play failed in the last 24 hours' },
    ],
  },
  overview: {
    generatedAt: iso(NOW),
    home: {
      today: { plays: 6, uniqueClients: 2, failures: 0, minutesWatched: 74 },
      d7: { plays: 61, uniqueClients: 3, failures: 4, minutesWatched: 412 },
      d30: { plays: 268, uniqueClients: 3, failures: 15, minutesWatched: 1764 },
      perDay: month.map((day, i) => ({
        day,
        plays: homePlays[i] ?? 0,
        unique: homeUnique[i] ?? 0,
        failures: homeFail[i] ?? 0,
        minutes: (homePlays[i] ?? 0) * 7,
      })),
      topShows: shows.slice(0, 6),
    },
    public: {
      counted: true,
      lastDay: month[28] as string,
      d7: { plays: 318, uniqueClients: 14, failures: 2, minutesWatched: 0 },
      d30: { plays: 1390, uniqueClients: 12, failures: 9, minutesWatched: 0 },
      perDay: month.map((day, i) => ({
        day,
        plays: i === 29 ? 0 : (publicPlays[i] ?? 0),
        unique: i === 29 ? 0 : 12,
        failures: 0,
        minutes: 0,
      })),
      topShows: shows.slice(1, 5),
    },
    failureRate7d: 4 / 65,
    freshness: [
      { source: 'mako', health: 'ok', lastGoodAt: ago(25), cadenceHours: 24, stale: false },
      { source: 'reshet', health: 'ok', lastGoodAt: ago(25), cadenceHours: 24, stale: false },
      { source: 'kan', health: 'warn', lastGoodAt: ago(140), cadenceHours: 6, stale: false },
      { source: 'live', health: 'ok', lastGoodAt: ago(40), cadenceHours: 24, stale: false },
    ],
    lastPublishAt: ago(18),
    quota: { requests: 3293, requestsLimit: 100_000, aeWrites: 95, aeLimit: 100_000 },
  },
  sources: {
    sources: [
      {
        source: 'mako',
        health: 'ok',
        shows: 659,
        episodes: 24298,
        stale: false,
        lastGoodAt: ago(25),
        cadenceHours: 24,
        lastFullRun: ago(360),
        lastAiringRun: ago(25),
        notes: ["3 shows were refused by the site's bot protection in the full run and read on a retry"],
        emptyShows: ['אופירה וברקוביץ', 'חדשות האוכל'],
        blocked: { pending: [], recovered: ['מתן צנגאוקר מדבר', 'זמן תרבות', 'מה הלוז?'], attempts: 1 },
        canary: {
          outcome: 'ok',
          at: ago(210),
          detail: '200/200/206 · iltv_mako_14:2026:36',
          unavailable: ['iltv_mako_15:9:46 (master HTTP 403)'],
        },
        canaryHistory: canaryHistory([], [12]),
        runs: runs('mako'),
      },
      {
        source: 'reshet',
        health: 'ok',
        shows: 225,
        episodes: 12381,
        stale: false,
        lastGoodAt: ago(25),
        cadenceHours: 24,
        lastFullRun: ago(340),
        lastAiringRun: ago(25),
        notes: ['45 shows listed by the site with nothing to watch (not in the catalog)'],
        emptyShows: [
          'The X Factor ישראל',
          'אגדת דשא',
          'אי האהבה - בריטניה',
          'אי האהבה - ספרד',
          'אל תפילו את המיליון',
          'אשתו של גיורא',
          'בני ערובה',
          'הזדמנות אחרונה לאהבה',
          'היפה והחנון',
          'המלונות המדהימים בעולם',
        ],
        canary: { outcome: 'ok', at: ago(210), detail: '200/200/206 · iltv_reshet_150:1:94' },
        canaryHistory: canaryHistory([]),
        runs: runs('reshet').map((r) => ({
          ...r,
          status: 'ok',
          showsFailed: 0,
          kind: r.kind === 'retry' ? 'airing' : r.kind,
        })),
      },
      {
        source: 'kan',
        health: 'warn',
        shows: 91,
        episodes: 2140,
        stale: false,
        lastGoodAt: ago(140),
        cadenceHours: 6,
        notes: ['last crawl slice backed off (Cloudflare challenge); next slice in 20 min'],
        emptyShows: [],
        canary: { outcome: 'ok', at: ago(210), detail: '200/200/206 · iltv_kan_17:1:1' },
        canaryHistory: canaryHistory([0]),
        runs: Array.from({ length: 6 }, (_, i) => ({
          at: ago(i * 20 + 4),
          kind: 'crawl',
          status: i === 0 ? 'partial' : 'ok',
          showsOk: 3,
          showsFailed: i === 0 ? 1 : 0,
          newEpisodes: i === 2 ? 4 : 0,
          seconds: 140,
        })),
      },
      {
        source: 'live',
        health: 'ok',
        shows: 12,
        episodes: 0,
        stale: false,
        lastGoodAt: ago(40),
        cadenceHours: 24,
        lastFullRun: ago(40),
        notes: ['12 channels answering (Mako channels are checked at play time)'],
        emptyShows: [],
        canary: { outcome: 'ok', at: ago(210), detail: '200/206/206 · iltv_live_kan_edu' },
        canaryHistory: canaryHistory([]),
        runs: [],
      },
    ],
    proxy: {
      servers: ['https://p1.example:3128', 'https://p2.example:3128', 'https://p3.example:3128'],
      exits: [
        {
          server: 'https://p1.example:3128',
          ok: 412,
          errors: 1,
          lastOkAt: ago(12),
          lastErrorAt: ago(2900),
          lastError: 'upstream answered HTTP 403',
        },
        { server: 'https://p2.example:3128', ok: 37, errors: 0, lastOkAt: ago(2890) },
        { server: 'https://p3.example:3128', ok: 0, errors: 0 },
      ],
    },
    kan: { pending: 64, shows: 91, showsDone: 74 },
  },
  plays: {
    bySourcePerDay: month.flatMap((day, i) => [
      { day, source: 'mako', plays: Math.round((homePlays[i] ?? 0) * 0.45) },
      { day, source: 'reshet', plays: Math.round((homePlays[i] ?? 0) * 0.3) },
      { day, source: 'kan', plays: Math.round((homePlays[i] ?? 0) * 0.15) },
      { day, source: 'live', plays: Math.round((homePlays[i] ?? 0) * 0.1) },
    ]),
    topShows: shows,
    topEpisodes: [
      { episodeId: 'iltv_mako_15:9:47', title: 'גלית ואילנית', plays: 6, source: 'mako', poster: poster(1) },
      {
        episodeId: 'iltv_reshet_150:1:95',
        title: 'חדשות היום',
        plays: 5,
        source: 'reshet',
        poster: poster(2),
      },
      { episodeId: 'iltv_mako_3:12:4', title: 'מאסטר שף', plays: 4, source: 'mako', poster: poster(3) },
      { episodeId: 'iltv_kan_17:1:3', title: 'שעת נעילה', plays: 3, source: 'kan', poster: poster(4) },
    ],
    firstPlaylistMs: { p50: 910, p95: 2340, n: 57 },
    latencyPerDay: days(14).map((day, i) => ({
      day,
      n: 4 + (i % 4),
      p50: 820 + ((i * 53) % 260),
      p95: 1900 + ((i * 131) % 900),
    })),
    recent: playLines,
  },
  failures: {
    days: days(7),
    recent: playLines.filter((p) => p.outcome === 'error'),
    groups: [
      {
        source: 'mako',
        stage: 'play',
        status: 403,
        reason: 'Mako master HTTP 403',
        n: 3,
        last: ago(95),
        lastPlayId: '1vBVjuqTAxOs',
        perDay: [0, 0, 0, 0, 0, 3, 0],
        blame: 'episode',
      },
      {
        source: 'kan',
        stage: 'relay',
        status: 403,
        reason: 'upstream HTTP 403',
        n: 1,
        last: ago(2900),
        lastPlayId: 'Ze-cNkLTX6bK',
        perDay: [0, 0, 0, 0, 1, 0, 0],
        blame: 'source',
      },
    ],
  },
  trace: {
    playId: '1vBVjuqTAxOs',
    title: 'גלית ואילנית',
    events: [
      {
        ts: ago(95.1),
        kind: 'stream_request',
        component: 'resolver',
        outcome: 'ok',
        source: 'mako',
        showId: 'iltv_mako_15',
        episodeId: 'iltv_mako_15:9:46',
        status: 200,
        latencyMs: 6,
        detail: { offered: '1 streams' },
      },
      {
        ts: ago(95.08),
        kind: 'ticket_fetch',
        component: 'mako-auth',
        outcome: 'ok',
        source: 'mako',
        showId: 'iltv_mako_15',
        episodeId: 'iltv_mako_15:9:46',
        status: 200,
        latencyMs: 293,
      },
      {
        ts: ago(95.07),
        kind: 'ticket_fetch',
        component: 'mako-auth',
        outcome: 'ok',
        source: 'mako',
        showId: 'iltv_mako_15',
        episodeId: 'iltv_mako_15:9:46',
        status: 200,
        latencyMs: 147,
      },
      {
        ts: ago(95.066),
        kind: 'failure',
        component: 'mako-auth',
        outcome: 'error',
        source: 'mako',
        showId: 'iltv_mako_15',
        episodeId: 'iltv_mako_15:9:46',
        status: 403,
        latencyMs: 1058,
        detail: {
          stage: 'play',
          answered: 403,
          upstream: 'playlist 200, cdn AKAMAI, ticket 200, master 403, cdn AWS, ticket 200, master 403',
          reason: 'Mako master HTTP 403',
          blame: 'episode',
        },
      },
    ],
  },
  live: {
    at: iso(NOW),
    sessions: [
      {
        kind: 'play',
        playId: 'YsQ9dnVVxddN',
        since: ago(12),
        source: 'mako',
        showId: 'iltv_mako_15',
        episodeId: 'iltv_mako_15:9:47',
        title: 'גלית ואילנית',
        segments: 0,
        bytes: 0,
      },
      {
        kind: 'relay',
        playId: 'ZvPkOnWRacs8',
        since: ago(31),
        source: 'kan',
        showId: 'iltv_kan_17',
        episodeId: 'iltv_kan_17:1:3',
        title: 'שעת נעילה',
        segments: 312,
        bytes: 418_000_000,
      },
    ],
  },
  deploys: {
    catalog: [
      { source: 'mako', shows: 659, episodes: 24298 },
      { source: 'reshet', shows: 225, episodes: 12381 },
      { source: 'kan', shows: 91, episodes: 2140 },
      { source: 'live', shows: 12, episodes: 0 },
    ],
    lastPublish: { at: ago(18), status: 'ok' },
    publishes: Array.from({ length: 8 }, (_, i) => ({
      at: ago(18 + i * 30),
      status: i === 5 ? 'failed' : 'ok',
      seconds: 30 + (i % 3) * 6,
      ...(i === 5
        ? { detail: 'wrangler deploy: timed out talking to Cloudflare; retried at the next batch' }
        : {}),
    })),
    audit: { at: ago(18), metas: 987, problems: [] },
    failingShows: [
      {
        id: 'iltv_kan_88',
        title: 'קופה ראשית',
        error: 'kept last good data: the show page lists no episodes (layout change?)',
        lastOkAt: ago(3000),
      },
    ],
    cloudflare: {
      dataWorker: 'israel-tv',
      apiWorker: 'israel-tv-api',
      dataVersion: 'b3f1c2d4-7e1a-4c55-9f0e-2a6d8c1e5b77',
      apiVersion: '5a0e9d21-3c4b-4f7a-8e66-91d2c3b4a5f6',
      commands: [
        'pnpm israel-tv versions data',
        'pnpm israel-tv rollback data',
        'pnpm israel-tv versions api',
        'pnpm israel-tv rollback api',
      ],
    },
  },
  system: {
    revision: '907969a1c0de42',
    version: '0.3.0',
    node: 'v24.21.0',
    platform: 'darwin x64',
    uptimeSec: 3 * 86_400 + 4 * 3600 + 1200,
    startedAt: iso(NOW - (3 * 86_400 + 4 * 3600 + 1200) * 1000),
    memoryMB: { process: 212.4, freeSystem: 2100, totalSystem: 16_384 },
    diskFreeMB: 41_300,
    diskTotalMB: 476_000,
    databases: [
      { name: 'catalog', sizeMB: 31.5 },
      { name: 'usage events', sizeMB: 0.6, growthPerDayMB: 0.04 },
    ],
    backup: {
      file: 'israel-tv-2026-11-07.sqlite',
      at: ago(330),
      sizeMB: 30.1,
      check: 'ok: integrity ok, 987 series',
    },
    eventsPerDay: month.map((day, i) => ({ day, n: 60 + ((i * 37) % 90) })),
    quota: {
      day: '2026-11-07',
      at: ago(10),
      requests: 3293,
      byScript: [
        { script: 'israel-tv', requests: 2049 },
        { script: 'israel-tv-api', requests: 1244 },
      ],
      aeWrites: 95,
      limits: { requests: 100_000, aeWrites: 100_000 },
    },
  },
  refresh: { accepted: true, message: 'queued (position 1)' },
  canary: { accepted: true, message: 'the canary started; results appear under Sources in a minute' },
};
