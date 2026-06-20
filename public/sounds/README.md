# Impact sounds

Drop short impact recordings here and they're picked up automatically on the
first click (no rebuild needed in dev — just reload the tab).

## What to add

| File (any of these extensions) | Used for |
| --- | --- |
| `brick-1` … `brick-5` (`.ogg`, `.wav`, or `.mp3`) | the blocks — concrete/stone/wood impacts |
| `metal-1` … `metal-3` | the fired ball — metal clank/clunk |

Each numbered slot tries `.ogg`, then `.wav`, then `.mp3`. You don't need all
slots — more variants just means less repetition. If no `brick-*` files are
found, the app falls back to the (synthetic) procedural sound and logs a warning.

Keep clips **short and dry** (a single hit, ~50–300 ms, minimal room/reverb) —
the engine adds its own pitch/volume variation per hit, and a long tail muddies
big collapses.

## Where to get CC0 sounds

- **Kenney – Impact Sounds** (kenney.nl) — CC0, made for games, `.ogg`.
- **freesound.org** — filter by CC0; search e.g. "concrete impact", "stone hit",
  "wood block knock", "metal clank".

Mind the licence: CC0 needs no attribution; other Creative Commons variants may.
