# The TOME interface, as a prototype

A second Next app that renders TOME's **real screens** against invented data
and exports them as static files, so the interface can be shown without a
database, an agent, or anything to sign in to.

Nothing here is a mock-up: `app/` imports the same components the application
renders, from `../src`. What is replaced is the server.

## How it works

`mock/api.ts` puts a function in front of `fetch` before the first screen
mounts. Every `/api/**` request is answered from `mock/data.ts` and
`mock/notifications.ts` in the shape the real route returns, inside the same
`{ data }` envelope. Anything the fixtures do not cover is answered empty, so
a screen with no data shows its own empty state rather than an error.

Writes are accepted and kept in memory for the visit: following a space,
editing a page, creating a folder and marking a notification read all behave
as they do in the application, and all of it is gone on reload.

The fixtures are one small invented organisation — a goal, two areas, five
projects under them, and six subjects on the function axis — with every name
made up and every address on `example.com`. The notification rows, the
digests on each Home and the follow tree are all derived
from one list of events, so the counts agree with the rows.

## Running it

```sh
cd ui
npx next build prototype      # writes prototype/out
npx serve prototype/out       # or any static server
```

To check the screens actually render — the build only proves the files exist:

```sh
cd ui
node prototype/check.mjs      # opens each screen, screenshots it, reports console errors
```

Screenshots land in `prototype/shots/`.

## What is and is not here

Every TOME screen is exported: the catalogue read both ways, the workspace
overview and digest, each space's Home, wiki, pages, related content,
sources, glossary, meetings, notes, issues, ingest, insights, templates and
settings, plus the notification settings and the function categories.

The rest of the platform — chat, skills, the admin surfaces — is not, and the
navigation's links to it land on a page saying so.

## Deployment

`.github/workflows/tome-prototype-pages.yml` builds this on a push and
publishes `prototype/out` to GitHub Pages. `PROTOTYPE_BASE_PATH` tells the
export the subdirectory it will be served from; leave it unset to serve from
a root.
