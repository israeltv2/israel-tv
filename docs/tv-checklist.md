# TV checklist

What to check on the TV/phone after installing. `<addon>` is your addon's manifest URL (local:
`http://<host>:7700/manifest.json`; Cloudflare: `https://<worker>.<subdomain>.workers.dev/manifest.json`),
`<resolver>` is `http://<home host>:7701/manifest.json`.

## Install

- [ ] Add `<addon>` in the app (Nuvio: Settings → Addons → Add addon; Stremio: Addons → search box → paste).
- [ ] Add `<resolver>` the same way, on a device at home.
- [ ] Home screen / Discover shows the rows **קשת 12**, **רשת 13**, **שידור חי** (and **כאן 11**, **כאן
      חינוכית: ילדים ונוער** once the Kan crawl has found episodes).

## Catalogs and metadata

- [ ] Rows list newest-airing shows first; scrolling a row loads more (pages of 100).
- [ ] Search finds a show typed without final letters or quotes (e.g. `מאסטר שפ`, `צהל`).
- [ ] A show opens with posters, description and its seasons. Named seasons (e.g. "VIP 5") appear as
  season numbers from 101 up, with the season name at the start of each episode title.
- [ ] A daily show (e.g. the evening news) lists recent dates as episodes, newest at the end of the season.

## Playback

- [ ] **Mako** episode (e.g. ארץ נהדרת, latest season): the stream "Israel TV · Mako" from the resolver
  plays, and seeking works.
- [ ] **Reshet** episode: plays directly inside Israel. Outside Israel, the "דרך ישראל · via Israel" stream from the
  resolver plays (needs the geo proxy configured).
- [ ] **Kan** episode (after the crawl has filled some): "ישראל בלבד" plays inside Israel; outside, the
  "דרך ישראל · via Israel" stream plays.
- [ ] **Live:** כאן 11, רשת 13, עכשיו 14, i24, ערוץ הכנסת play from the addon; קשת 12 and ערוץ 24 play
  through the resolver.
- [ ] Watch half an episode, stop, reopen: the app offers to resume at the same point (ids are stable).

## From another catalog

- [ ] Open a matched show from Cinemeta (e.g. ארץ נהדרת / _Eretz Nehederet_) and pick a regular season:
  Israel TV streams are offered there too.

## Failures look like failures

- [ ] `/status` on the addon shows each source's health and the last runs.
- [ ] If a source's run fails, its row starts with a "⚠ …" item explaining it (nothing silently disappears).

## Fresh episodes

- [ ] The evening after a new episode airs, it appears within the airing-check window (15 minutes in the
  evening, hourly otherwise) without any action.
- [ ] For an immediate re-read of one show: `curl -X POST http://<host>:7702/refresh/<series-id>` from the
  home network (the id is in the show's URL in the app, e.g. `iltv_mako_12`).
