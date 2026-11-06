# TV checklist

What to check on the TV/phone after installing. `<addon>` is your addon's base URL (local:
`http://<host>:7700`; Cloudflare: `https://<worker>.<subdomain>.workers.dev`): install `<addon>/manifest.json`.
`<resolver>` is `http://<home host>:7701`.

## Install

- [ ] Add `<addon>/manifest.json` in the app (Nuvio: Settings → Addons → Add addon; Stremio: Addons → search box → paste).
- [ ] Add `<resolver>/manifest.json` the same way, on a device at home.
- [ ] Home screen / Discover shows the rows **קשת 12**, **רשת 13**, **כאן 11**, **כאן חינוכית: ילדים ונוער**
  (a "⏳ still loading" item until the Kan crawl has found its first show) and **שידור חי**.
- [ ] Both addons show their logo in the app's addon list; live channel tiles show the channel logos.
- [ ] Rows look stale? Nuvio caches catalog rows for hours: pull to refresh, or reopen the app later. The order
  of rows between addons (this addon's rows vs. others) is set in Nuvio's settings (home screen / catalog
  order), not by the addon.

- [ ] Away from home (phone on mobile data): add the link `pnpm israel-tv remote-url` (resolver-only: `pnpm resolver remote-url`) prints (the "Israel TV · Mako (away
  from home)" addon) and play a Mako episode and קשת 12 live. Remove it again from devices you don't own.

## Catalogs and metadata

- [ ] Rows list newest-airing shows first; scrolling a row loads more (pages of 100).
- [ ] Search finds a show typed without final letters or quotes (e.g. `מאסטר שפ`, `צהל`).
- [ ] A show opens with posters, description and its seasons. Named seasons (e.g. "VIP 5") appear as
  season numbers from 101 up, with the season name at the start of each episode title.
- [ ] A daily show (e.g. the evening news) lists recent dates as episodes, newest at the end of the season.

## Playback

- [ ] **Mako** episode (e.g. ארץ נהדרת, latest season): the stream "Israel TV · Mako" from the resolver
  plays, and seeking works.
- [ ] **Reshet** episode: plays directly inside Israel (one stream, from the addon; the resolver adds none at
  home). Outside Israel, the "דרך ישראל · via Israel" stream from the resolver plays (needs the geo proxy
  configured). If a start feels slow, look up the play on the admin page `/usage` (time to the first playlist).
- [ ] **Kan** episode (after the crawl has filled some): "ישראל בלבד" plays inside Israel; outside, the
  "דרך ישראל · via Israel" stream plays.
- [ ] **Live:** כאן 11, רשת 13, עכשיו 14, i24, ערוץ הכנסת play from the addon; קשת 12 and ערוץ 24 play
  through the resolver.
- [ ] Watch half an episode, stop, reopen: the app offers to resume at the same point (ids are stable).

## From another catalog

- [ ] Open a matched show from Cinemeta (e.g. ארץ נהדרת / _Eretz Nehederet_) and pick a regular season:
  Israel TV streams are offered there too.

- [ ] **Kan covers:** Kan 11 and Kids/Teens tiles show their pictures (served from the addon itself).

## Usage dashboard (host or local-only)

- [ ] On a laptop at home, open the link `pnpm israel-tv admin-url` prints: the page shows "This home (resolver)" with
  the plays just made, "Playing now" while something plays, and the playback canary as pass for each source.
- [ ] The same address from a guest device without the link answers "not found".

## Failures look like failures

- [ ] `/status` on the addon shows each source's health and the last runs.
- [ ] If a source's run fails, its row starts with a "⚠ …" item explaining it (nothing silently disappears).

## Fresh episodes

- [ ] The evening after a new episode airs, it appears within the airing-check window (15 minutes in the
  evening, hourly otherwise) without any action.
- [ ] For an immediate re-read of one show: `curl -X POST -H "Authorization: Bearer <admin token>" http://<host>:7702/refresh/<series-id>` from the
  home network. The series id (e.g. `iltv_mako_12`) is in the row's search results:
  `curl -s '<addon>/catalog/series/iltv_keshet12/search=<word>.json'` (one word of the title, or `%20` for spaces) → `metas[].id` (rows:
  `iltv_keshet12`, `iltv_reshet13`, `iltv_kan11`, `iltv_kankids`).
