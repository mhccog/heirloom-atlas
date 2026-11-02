# The Heirloom Atlas

*I connect people who don't know they need each other.*

A mobile-first web app for walk-in networking in heirloom-trade towns ("businesses whose worth is handed down rather than scaled up").

Live: https://mhccog.github.io/heirloom-atlas/

- **People**: an interactive web of 45 businesses in 7 towns, coloured by trade, sized by connection potential, linked by suggested introductions. List layout for phones.
- **Person card**: who to ask for (a role; a name only where the source gives one), a light "how to approach" guess, an opener, their need (a guess), who they could meet, status pipeline, notes, visit dates, .ics reminder.
- **Introductions**: rule-based suggestions from needs and offers, mark made / not now, add your own.
- **Visits**: per-town walking order, events, retiring-founder watchlist, register signals, prep, and a Today mode for the street.
- **Where**: MapLibre map on OpenFreeMap tiles, with a globe toggle. Approximate pins are marked.

Everything you record stays in your browser (localStorage). Export a JSON backup or a CSV from "Your data". Nothing is sent anywhere.

Data: `data/raw.json` (research as of 2 Nov 2026) → `npm run data` → `docs/assets/data.json`.
Libraries: force-graph (MIT), MapLibre GL JS (BSD-3), Fraunces and Inter (OFL). Map © OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors.
