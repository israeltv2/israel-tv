// Live channels. Streams marked `direct` play as-is anywhere they are not geo-blocked; `mako` channels
// need a fresh Mako ticket per play (private resolver); `geo` channels may be blocked outside Israel and
// get an extra relayed stream from the resolver when a geo proxy is configured.
// Checked 2026-11-06: every direct URL below answered master/variant/segment = 200/200/206 from outside Israel.

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

export const LIVE_CHANNELS: readonly LiveChannel[] = [
  {
    id: 'iltv_live_kan11',
    name: 'כאן 11',
    description: 'שידור חי של כאן 11',
    direct: [
      { title: 'כאן 11', url: redge('kancdn-live/live/kan11') },
      { title: 'כאן 11 · כתוביות', url: redge('kancdn-live/live/kan11_subs') },
    ],
    geo: true,
  },
  {
    id: 'iltv_live_keshet12',
    name: 'קשת 12',
    description: 'שידור חי של קשת 12 (דרך הרזולבר הביתי)',
    direct: [],
    mako: [
      { title: 'קשת 12', path: '/stream/hls/live/2033791/k12/index.m3u8' },
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
    ],
  },
  {
    id: 'iltv_live_ch14',
    name: 'עכשיו 14',
    description: 'שידור חי של ערוץ 14',
    direct: [
      {
        title: 'עכשיו 14',
        url: 'https://r.il.cdn-redge.media/livehls/oil/ch14/live/ch14/live.livx/playlist.m3u8?dvr=21600000&bitrate=5692000&audioId=1&videoId=0',
      },
      {
        title: 'עכשיו 14 · גיבוי',
        url: 'https://ch14channel14.encoders.immergo.tv/app/2/streamPlaylist.m3u8',
      },
    ],
  },
  {
    id: 'iltv_live_ch24',
    name: 'ערוץ 24',
    description: 'שידור חי של ערוץ 24 (דרך הרזולבר הביתי)',
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
    direct: [{ title: 'כאן חינוכית', url: redge('kancdn-live/live/kan_edu') }],
    geo: true,
  },
  {
    id: 'iltv_live_makan33',
    name: 'מכאן 33',
    description: 'שידור חי של מכאן 33',
    direct: [{ title: 'מכאן 33', url: redge('kancdn-live/live/makan') }],
    geo: true,
  },
  {
    id: 'iltv_live_knesset',
    name: 'ערוץ הכנסת',
    description: 'שידור חי של ערוץ הכנסת',
    direct: [
      { title: 'ערוץ הכנסת', url: 'https://kneset.gostreaming.tv/p2-kneset/_definst_/myStream/index.m3u8' },
      {
        title: 'ערוץ הכנסת · נגיש',
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
    direct: [{ title: 'ynet', url: 'https://ynet-live-01.ynet-pic1.yit.co.il/ynet/live_720.m3u8' }],
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
    description: 'ערוץ ארץ נהדרת 24/7 (דרך הרזולבר הביתי)',
    direct: [],
    mako: [{ title: 'ארץ נהדרת', path: '/evrideo/hls/live/20001278/erets/index.m3u8' }],
  },
  {
    id: 'iltv_live_savri',
    name: 'ערוץ סברי מרנן',
    description: 'ערוץ סברי מרנן 24/7 (דרך הרזולבר הביתי)',
    direct: [],
    mako: [{ title: 'סברי מרנן', path: '/evrideo/hls/live/20001278/savri/index.m3u8' }],
  },
];
