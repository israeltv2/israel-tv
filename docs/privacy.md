# Privacy

**Short version:** no accounts, no tracking, no addresses kept. Israel TV hosts no video.

## The public link

The public catalog counts stream requests so problems can be found: per day, how many plays per show and how many
different devices. A device is counted by a code made from its address, the date and a secret; the code changes every day,
cannot be turned back into an address and cannot follow a device from one day to the next. The address itself is never
stored. Opening a show page is not counted; loading a row is counted only as a number of requests. Counting runs on
the project's Cloudflare account (Workers Analytics Engine keeps the counts; Workers Logs keeps debugging lines a few
days, with the same daily code, never the address).

## The home helper and your own copy

Your own copy keeps the same kind of record in your own database on your own computer: what the home helper was asked
for and played, what failed and why, and how many devices used it per day, with the same daily code instead of
addresses. 30 days in detail, a year as daily totals. Nobody else can see it; you can, on your admin page (`/usage`).
If you share your copy with friends, tell them this.

## Video

Israel TV points your app at the broadcasters' free public services; the video comes from them. The only exception is
an episode that only plays from Israel when you watch abroad: then your own home helper fetches it through the proxy you
chose.
