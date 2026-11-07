// Live channels. Streams marked `direct` play as-is anywhere they are not geo-blocked; `mako` channels
// need a fresh Mako ticket per play (private resolver); `geo` channels may be blocked outside Israel and
// get an extra relayed stream from the resolver when a geo proxy is configured.
// Checked 2026-11-06 and again 2026-11-07 (every direct URL below answered master/variant/segment = 200/200/206
// from outside Israel; every Mako path played with a fresh ticket). The daily live check (apps/ingest live.ts)
// plays every one of them again and labels a stream "Israel only" only when it is refused abroad.
// Order within a channel: the broadcaster's main feed first, then captioned, then backups.

export interface LiveLink {
  title: string;
  url: string;
}

export interface LiveChannel {
  /** Public id, `iltv_live_<slug>`; never changes. */
  id: string;
  name: string;
  description: string;
  /** Plays without the resolver. First is preferred. */
  direct: LiveLink[];
  /** Mako live paths on mako-streaming.akamaized.net (or another host) that need a ticket. */
  mako?: { title: string; path: string; host?: string; cdn?: 'AKAMAI' | 'AWS' }[];
  /** True when the channel is sometimes geo-blocked outside Israel (the resolver adds a relay). */
  geo?: boolean;
}

const redge = (path: string) =>
  `https://r.il.cdn-redge.media/livehls/oil/${path}/live.livx/playlist.m3u8?dvr=21600000`;
/** Kan's DASH edition of the same channel (same CDN: a backup for a packager fault, not for a CDN outage). */
const redgeDash = (path: string) =>
  `https://r.il.cdn-redge.media/livedash/oil/${path}/live.livx?dvr=14400000`;
const FREE_KESHET = '/evrideo/hls/live/20001278';

export const LIVE_CHANNELS: readonly LiveChannel[] = [
  {
    id: 'iltv_live_kan11',
    name: 'כאן 11',
    description: 'שידור חי של כאן 11',
    direct: [
      { title: 'כאן 11', url: redge('kancdn-live/live/kan11') },
      { title: 'כאן 11 · כתוביות', url: redge('kancdn-live/live/kan11_subs') },
      { title: 'כאן 11 · גיבוי (DASH)', url: redgeDash('kancdn-live/live/kan11') },
    ],
    geo: true,
  },
  {
    id: 'iltv_live_keshet12',
    name: 'קשת 12',
    description: 'שידור חי של קשת 12 · צריך את העוזר הביתי',
    direct: [],
    mako: [
      { title: 'קשת 12', path: '/stream/hls/live/2033791/k12/index.m3u8' },
      {
        title: 'קשת 12 · כתוביות לכבדי שמיעה',
        path: '/k12cc/index.m3u8?b-in-range=0-1800',
        host: 'https://d2249b6f08tjt0.cloudfront.net',
        cdn: 'AWS',
      },
      { title: 'קשת 12 · גיבוי', path: '/stream/hls/live/2033791/k12dvr/index.m3u8' },
    ],
  },
  {
    id: 'iltv_live_reshet13',
    name: 'רשת 13',
    description: 'שידור חי של רשת 13',
    direct: [
      {
        title: 'רשת 13',
        url: 'https://d18b0e6mopany4.cloudfront.net/out/v1/2f2bc414a3db4698a8e94b89eaf2da2a/index.m3u8',
      },
      {
        title: 'רשת 13 · גיבוי',
        url: 'https://dsk76kvc9kie6.cloudfront.net/media/87f59c77-03f6-4bad-a648-897e095e7360/mainManifest.m3u8',
      },
      {
        title: 'רשת 13 · גיבוי 2 (720p)',
        url: 'https://d2xg1g9o5vns8m.cloudfront.net/out/v1/0855d703f7d5436fae6a9c7ce8ca5075/index.m3u8',
      },
    ],
  },
  {
    id: 'iltv_live_ch14',
    name: 'עכשיו 14',
    description: 'שידור חי של ערוץ 14',
    direct: [
      {
        title: 'עכשיו 14',
        // The bitrate pin selects the 1080p rendition (without it the playlist offers only 960×540).
        url: 'https://r.il.cdn-redge.media/livehls/oil/ch14/live/ch14/live.livx/playlist.m3u8?dvr=21600000&bitrate=5692000&audioId=1&videoId=0',
      },
      // The broadcaster's own second feed (its API's answer, 2026-11-07); the older address refuses https.
      {
        title: 'עכשיו 14 · גיבוי (720p)',
        url: 'https://ch14channel14-cdn.encoders.immergo.tv/2/streamPlaylist.m3u8',
      },
    ],
  },
  {
    id: 'iltv_live_ch24',
    name: 'ערוץ 24',
    description: 'שידור חי של ערוץ 24 · צריך את העוזר הביתי',
    direct: [],
    mako: [
      { title: 'ערוץ 24', path: '/direct/hls/live/2035340/ch24live/index.m3u8' },
      { title: 'ערוץ 24 · גיבוי', path: '/evrideo/hls/live/20001278/ch24live/index.m3u8' },
    ],
  },
  {
    id: 'iltv_live_kanedu',
    name: 'כאן חינוכית',
    description: 'שידור חי של כאן חינוכית',
    direct: [
      { title: 'כאן חינוכית', url: redge('kancdn-live/live/kan_edu') },
      { title: 'כאן חינוכית · גיבוי (DASH)', url: redgeDash('kancdn-live/live/kan_edu') },
    ],
    geo: true,
  },
  {
    id: 'iltv_live_makan33',
    name: 'מכאן 33',
    description: 'שידור חי של מכאן 33',
    direct: [
      { title: 'מכאן 33', url: redge('kancdn-live/live/makan') },
      { title: 'מכאן 33 · גיבוי (DASH)', url: redgeDash('kancdn-live/live/makan') },
    ],
    geo: true,
  },
  {
    id: 'iltv_live_knesset',
    name: 'ערוץ הכנסת',
    description: 'שידור חי של ערוץ הכנסת',
    direct: [
      { title: 'ערוץ הכנסת', url: 'https://kneset.gostreaming.tv/p2-kneset/_definst_/myStream/index.m3u8' },
      // The channel with Hebrew captions burned in (knesset.tv calls it "שידור עם כתוביות").
      {
        title: 'ערוץ הכנסת · כתוביות',
        url: 'https://kneset.gostreaming.tv/p2-Accessibility/_definst_/myStream/index.m3u8',
      },
    ],
  },
  {
    id: 'iltv_live_ch10',
    name: 'כלכלה 10',
    description: 'שידור חי של ערוץ 10',
    direct: [{ title: 'כלכלה 10', url: redge('calcala-live/live/channel10') }],
  },
  {
    id: 'iltv_live_ynet',
    name: 'ynet',
    description: 'שידור חי של ynet',
    direct: [
      { title: 'ynet', url: 'https://ynet-live-01.ynet-pic1.yit.co.il/ynet/live.m3u8' },
      { title: 'ynet · 720p', url: 'https://ynet-live-01.ynet-pic1.yit.co.il/ynet/live_720.m3u8' },
    ],
  },
  {
    id: 'iltv_live_i24he',
    name: 'i24 עברית',
    description: 'i24NEWS בעברית',
    direct: [{ title: 'i24 עברית', url: 'https://i24newshebrew-cdn.encoders.immergo.tv/master.m3u8' }],
  },
  {
    id: 'iltv_live_i24en',
    name: 'i24 English',
    description: 'i24NEWS in English',
    direct: [{ title: 'i24 English', url: 'https://i24newsenglish-cdn.encoders.immergo.tv/master.m3u8' }],
  },
  {
    id: 'iltv_live_i24fr',
    name: 'i24 Français',
    description: 'i24NEWS en français',
    direct: [{ title: 'i24 Français', url: 'https://i24newsfrench-cdn.encoders.immergo.tv/master.m3u8' }],
  },
  {
    id: 'iltv_live_i24ar',
    name: 'i24 العربية',
    description: 'i24NEWS بالعربية',
    direct: [{ title: 'i24 العربية', url: 'https://i24newsarabic-cdn.encoders.immergo.tv/master.m3u8' }],
  },
  {
    id: 'iltv_live_erets',
    name: 'ערוץ ארץ נהדרת',
    description: 'ערוץ ארץ נהדרת 24/7 · צריך את העוזר הביתי',
    direct: [],
    mako: [{ title: 'ארץ נהדרת', path: '/evrideo/hls/live/20001278/erets/index.m3u8' }],
  },
  {
    id: 'iltv_live_savri',
    name: 'ערוץ סברי מרנן',
    description: 'ערוץ סברי מרנן 24/7 · צריך את העוזר הביתי',
    direct: [],
    mako: [{ title: 'סברי מרנן', path: '/evrideo/hls/live/20001278/savri/index.m3u8' }],
  },
  {
    id: 'iltv_live_ch9',
    name: 'ערוץ 9',
    description: 'ערוץ 9 · שידור חי בשפה הרוסית',
    direct: [{ title: 'ערוץ 9', url: 'https://contact.gostreaming.tv/Con-11/index.m3u8' }],
  },
  {
    id: 'iltv_live_r13comedy',
    name: 'ערוץ הקומדיות של 13',
    description: 'ערוץ קומדיות 24/7 של רשת 13',
    direct: [
      {
        title: 'ערוץ הקומדיות',
        url: 'https://d15ds134q59udk.cloudfront.net/out/v1/fbba879221d045598540ee783b140fe2/index.m3u8',
      },
    ],
  },
  {
    id: 'iltv_live_r13nofesh',
    name: 'ערוץ הנופש של 13',
    description: 'ערוץ נופש וטיולים 24/7 של רשת 13',
    direct: [
      {
        title: 'ערוץ הנופש',
        url: 'https://d1yd8hohnldm33.cloudfront.net/out/v1/19dee23c2cc24f689bd4e1288661ee0c/index.m3u8',
      },
    ],
  },
  {
    id: 'iltv_live_r13reality',
    name: 'ערוץ הריאליטי של 13',
    description: 'ערוץ ריאליטי 24/7 של רשת 13',
    direct: [
      {
        title: 'ערוץ הריאליטי',
        url: 'https://d2dffl3588mvfk.cloudfront.net/out/v1/d8e15050ca4148aab0ee387a5e2eb46b/index.m3u8',
      },
    ],
  },
  {
    id: 'iltv_live_k12comedy',
    name: 'ערוץ הקומדיה של קשת',
    description: 'ערוץ קומדיה 24/7 של קשת · צריך את העוזר הביתי',
    direct: [],
    mako: [{ title: 'ערוץ הקומדיה', path: `${FREE_KESHET}/free_comedy/index.m3u8` }],
  },
  {
    id: 'iltv_live_k12drama',
    name: 'ערוץ הדרמה של קשת',
    description: 'ערוץ דרמה 24/7 של קשת · צריך את העוזר הביתי',
    direct: [],
    mako: [{ title: 'ערוץ הדרמה', path: `${FREE_KESHET}/free_drama/index.m3u8` }],
  },
  {
    id: 'iltv_live_k12music',
    name: 'ערוץ המוזיקה של קשת',
    description: 'ערוץ מוזיקה 24/7 של קשת · צריך את העוזר הביתי',
    direct: [],
    mako: [{ title: 'ערוץ המוזיקה', path: `${FREE_KESHET}/free_music/index.m3u8` }],
  },
  {
    id: 'iltv_live_k12food',
    name: 'ערוץ האוכל של קשת',
    description: 'ערוץ אוכל 24/7 של קשת · צריך את העוזר הביתי',
    direct: [],
    mako: [{ title: 'ערוץ האוכל', path: `${FREE_KESHET}/free_food/index.m3u8` }],
  },
];

/** Other names of the live channels (English, as people type them): found by search, never shown. */
export const LIVE_ALIASES: Record<string, string[]> = {
  iltv_live_kan11: ['Kan 11', 'Kan'],
  iltv_live_keshet12: ['Keshet 12', 'Channel 12', 'Mako'],
  iltv_live_reshet13: ['Reshet 13', 'Channel 13'],
  iltv_live_ch14: ['Channel 14', 'Now 14'],
  iltv_live_ch24: ['Channel 24', 'Music 24'],
  iltv_live_kanedu: ['Kan Educational', 'Kan Kids', 'Kan'],
  iltv_live_makan33: ['Makan 33', 'Kan 33'],
  iltv_live_knesset: ['Knesset Channel', 'Knesset'],
  iltv_live_ch10: ['Channel 10'],
  iltv_live_ynet: ['Ynet'],
  iltv_live_i24he: ['i24 News Hebrew', 'i24'],
  iltv_live_i24en: ['i24 News English', 'i24'],
  iltv_live_i24fr: ['i24 News French', 'i24'],
  iltv_live_i24ar: ['i24 News Arabic', 'i24'],
  iltv_live_erets: ['Eretz Nehederet', 'A Wonderful Country'],
  iltv_live_savri: ['Savri Maranan'],
  iltv_live_ch9: ['Channel 9', 'Kanal 9', 'Девятый канал'],
  iltv_live_r13comedy: ['Reshet 13 Comedy', 'Channel 13 Comedy'],
  iltv_live_r13nofesh: ['Reshet 13 Vacation', 'Channel 13 Travel'],
  iltv_live_r13reality: ['Reshet 13 Reality', 'Channel 13 Reality'],
  iltv_live_k12comedy: ['Keshet Comedy', 'Keshet 12 Comedy'],
  iltv_live_k12drama: ['Keshet Drama', 'Keshet 12 Drama'],
  iltv_live_k12music: ['Keshet Music', 'Keshet 12 Music'],
  iltv_live_k12food: ['Keshet Food', 'Keshet 12 Food'],
};
