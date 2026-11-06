# Israel TV

**Keshet 12, Reshet 13, Kan and live Israeli channels in Stremio and Nuvio.** Free, no account, nothing to sign up
for.

![status: beta](https://img.shields.io/badge/status-beta-orange) ![license: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)

![Keshet 12 shows in Stremio](docs/images/stremio-keshet12.jpg)

## Install

Copy this link — it is the whole install:

```
https://israel-tv.israeltv2.workers.dev/manifest.json
```

- **Stremio:** [Install in Stremio](https://web.stremio.com/#/addons?addon=https%3A%2F%2Fisrael-tv.israeltv2.workers.dev%2Fmanifest.json)
  (opens Stremio's website; signed in, it appears in all your Stremio apps) — or in the app open _Addons_, paste the
  link into the search box and choose _Install_.
- **Nuvio:** _Settings → Addons → Add addon_, paste the link.

Tip for TVs: install it on your phone or computer, signed in to the same Stremio account — it then appears on the TV
too.

You will see new rows: **קשת 12**, **רשת 13**, **כאן 11**, **כאן חינוכית: ילדים ונוער** and **שידור חי** (live).

- **In Israel**, the link alone plays everything except Keshet 12.
- **Abroad**, the link alone gives you all the shows and the live channels 13, 14 and i24; episodes need the home
  helper with an Israeli connection.
- **Keshet 12** shows have no play option until you add the [home helper](#want-keshet-12-mako).

## What you get

Shows in Hebrew, newest episode first, with search and show pages. Your watch progress stays put: episodes keep
their numbers for good.

| Channel                                                    | What     | In Israel                | Outside Israel                                                   |
| ---------------------------------------------------------- | -------- | ------------------------ | ---------------------------------------------------------------- |
| Reshet 13                                                  | Episodes | ✅ plays                 | 🏠 needs the home helper with an Israeli connection              |
| Kan 11, Kan Kids & Teens                                   | Episodes | ✅ plays                 | 🏠 needs the home helper with an Israeli connection              |
| Keshet 12 (Mako)                                           | Episodes | 🏠 needs the home helper | 🏠 needs the home helper                                         |
| Live: 13, 14, i24 (4 languages), Knesset, ynet, Calcala 10 | Live     | ✅ plays                 | ✅ plays                                                         |
| Live: Kan 11, Kan Educational, Makan 33                    | Live     | ✅ plays                 | often only from Israel; 🏠 the helper with an Israeli connection |
| Live: Keshet 12, 24, Eretz Nehederet, Savri Maranan        | Live     | 🏠 needs the home helper | 🏠 needs the home helper                                         |

Some titles **only play from Israel** — that is the broadcaster's choice, not the app's.

## Want Keshet 12 (Mako)?

Keshet 12 only lets a video play when your own home internet asks for it. So Keshet 12 needs a small **home helper**:
a little program on a computer that stays on at home (a desktop PC or Mac, a storage box or a Raspberry Pi), which you
add to your app as a second link. It then plays at home; on a phone outside the house it needs extra technical setup.
Setting it up takes about 15 minutes:
**[Set up the home helper](docs/setup/home-helper.md)**. You can also ask an AI assistant to do it for you:
[a guide written for assistants](docs/setup/for-agents.md).

## Watching from abroad?

Everything in the catalog shows up anywhere, and live channels like 13, 14 and i24 play anywhere. Keshet 12 plays with
the home helper on your home network, wherever in the world your home is. Episodes from Reshet and Kan only play from an Israeli internet connection: the home
helper can fetch them for you through a VPN or proxy service with an Israeli location (a paid service you may already
have). Those episodes then show a source called **דרך ישראל · via Israel** next to the one marked **ישראל בלבד**
(Israel only) — pick "via Israel". See
[Watching from abroad](docs/setup/home-helper.md#watching-from-abroad). You only need this if you live outside
Israel.

## Questions

- **A new episode is not there yet.** New episodes usually appear within an hour or two of going online. Apps keep
  the rows for a while — pull down to refresh, or restart the app.
- **A row starts with ⚠.** That channel's site has not been read for a while; what you see is the last good list.
- **Something does not play.** Check the [status page](https://israel-tv.israeltv2.workers.dev/status), then
  [report it](https://github.com/israeltv2/israel-tv/issues/new?template=broken-source.yml) with the show and episode.
- **Search finds nothing.** Search in Hebrew, as the channel writes the title.
- **Does it work with my other addons?** Yes. It adds its own rows and shows (ids starting `iltv_`). When you open an
  Israeli series from another catalog (Cinemeta, TMDB), it adds its streams only if that show was matched to it and the
  seasons are numbered the same; otherwise it adds nothing. It never touches movies.
- **Is it maintained?** It is in beta and runs every day. When a channel's site changes, its row shows ⚠ until the
  reading is fixed; reports help.

## How it works

```
 the broadcasters' sites ──▶  reader  ──▶  catalog (the link you installed)  ◀──  your app
                                                                                     │
                                         home helper (Keshet 12, from abroad)  ◀─────┘
```

- **The reader** visits the broadcasters' public sites slowly and keeps every show and episode under a permanent
  number.
- **The catalog** is what your app talks to: the rows, show pages, search, and links to the broadcasters' own
  video.
- **The home helper** does the little that has to happen on your own internet: Keshet 12's pass, and fetching
  Israel-only video through an Israeli connection.

The video always comes from the broadcasters themselves. More: [How Israel TV works](docs/architecture.md).

## Run your own copy

Anyone can run the whole thing — at home, or on a free Cloudflare account to share with family and friends. Start
at [Choose your setup](docs/setup/README.md).

## Contributing

Bug reports, fixes for a channel whose site changed, and new channels are welcome: see
[CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

## Privacy

No accounts and no tracking. The public link counts plays anonymously (a device is counted by a code that changes
every day and cannot be turned back into an address). Israel TV hosts no video: it points your app at the
broadcasters' free public services. [Details](docs/privacy.md).

## License

[AGPL-3.0](LICENSE), © 2026 Israel TV contributors. If you run a modified copy as a service for others, publish
your changes too. Respect the broadcasters' terms where you live.
