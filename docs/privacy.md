# Privacy

**Short version:** no accounts, no tracking, no addresses kept. Israel TV hosts no video.

## The public link

The public catalog counts stream requests so problems can be found: per day, how many plays per show and how many
different devices. A device is counted by a code made from its address, the date and a secret; the code changes every day,
cannot be turned back into an address and cannot follow a device from one day to the next. The address itself is never
stored. Opening a show page is not counted; loading a row is counted only as a number of requests. Counting runs on
the project's Cloudflare account (Workers Analytics Engine keeps the counts; Workers Logs keeps debugging lines a few
days, with the same daily code, never the address).

## The website

The website has no analytics, no cookies and no third-party scripts; its fonts are served from the site itself. Pages
are plain files: opening one is not counted. The library pages show the shows' posters and pictures from the
broadcasters' own image servers (as the apps do), so your browser asks those servers for them, as it would on the
broadcasters' sites. Search runs in your browser on a list of titles; what you type is not sent anywhere. The theme
you choose is remembered in your browser only.

## The home helper

The home helper keeps a short record on your own computer of what it was asked for, what failed and why, with the
same daily code instead of addresses (30 days in detail). Nobody else can see it; `docker logs israel-tv-helper` (or
`pnpm resolver events`) shows it.

## Your own copy

A full copy of Israel TV keeps the same kind of record in its own database on your computer — plays, failures, and
how many devices used it per day — 30 days in detail and a year as daily totals, which you see on its admin page
(`pnpm israel-tv admin-url` prints the link). If you share your copy with friends, tell them this.

## Video

Israel TV points your app at the broadcasters' free public services; the video comes from them. The only exception is
an episode that only plays from Israel when you watch abroad: then your own home helper fetches it through the proxy you
chose.
