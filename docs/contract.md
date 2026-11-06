# The catalog ↔ resolver contract (version 1)

A **catalog** (the public addon, or the local server) and a **resolver** (the addon that does the play-time
work at home) are separate parts, often run by different people: a resolver can point at any Israel TV
catalog (`resolver.catalogUrl`). This page is the whole agreement between them. The code that defines it is
[`packages/core/src/contract.ts`](../packages/core/src/contract.ts); contract tests run on both sides
(`packages/render/test`, `apps/resolver/test`).

## What the catalog publishes for resolvers

| File                             | Content                                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolver-contract.json`         | `{ "version": 1, "seasonPlay": "play/{series}/{season}.json", "extIds": "ext-ids.json" }`                                                            |
| `play/<series id>/<season>.json` | Per episode number: what a resolver needs to play it (below). Only episodes that need a resolver's help, or that a resolver might relay, are listed. |
| `ext-ids.json`                   | `tt…` / `tmdb:…` → `{ "id": "<series id>", "seasons": [ … ] }`: shows opened from other catalogs, for the seasons whose numbering matches.           |

One episode in a play file:

```json
{
  "mako": { "vcmid": "…", "channelId": "…", "galleryChannelId": "…" },
  "direct": "https://…/a.m3u8",
  "israelOnly": true
}
```

- `mako` — Mako's ids for its playlist service.
- `direct` — the episode's direct stream (Reshet, Kan).
- `israelOnly` — present when the stream is known to be refused outside Israel.

Anything else (titles, artwork, numbering) is the catalog's business and is not part of the contract.

## What the resolver does with it

| Episode has             | The resolver offers                                                                                                                                 | The catalog offers                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `mako`                  | One "Mako" stream: on each play, a fresh ticket and the master playlist fetched with the player's User-Agent (video then goes player ↔ Mako's CDN). | nothing (Mako needs the resolver) |
| `direct`, playable here | nothing (it checks the direct stream from its own network, cached for 6 hours per show)                                                             | the direct stream                 |
| `direct`, refused here  | One "דרך ישראל · via Israel" stream relayed through its geo proxy (only with a proxy configured)                                                    | the direct stream ("ישראל בלבד")  |

So at most one stream per addon for any episode, and the only time a viewer sees two is the last row — abroad,
the catalog's direct stream (which will not play there) next to the resolver's relay. That pair is
deliberate: the catalog is public and stateless and cannot know where a viewer is; its stream is labelled
Israel-only, and the resolver's is labelled "via Israel".

## Versions

The resolver reads `resolver-contract.json` (again every hour). If it is missing (a catalog made by an older
Israel TV) or its `version` is not the one the resolver understands, the resolver offers nothing from that
catalog and says so — in its log, and at start (`catalog check: …`) — instead of guessing. Files that do not
fit the contract are treated as absent and logged.

Change the contract only together with `RESOLVER_CONTRACT_VERSION`: add fields freely within a version only if
an older resolver can ignore them safely; anything else is a new version.
