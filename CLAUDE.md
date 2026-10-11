# House Electrical — project guide

Browser tool for documenting a home's electrical circuits on a two-floor plan. Single user, desk use, no backend.
Hosted on GitHub Pages; the house data is one JSON file (kept in Google Drive) opened and saved in place
with the File System Access API (Chrome/Edge only).

## Run & test
- `python3 -m http.server 8000` from the repo root, then http://localhost:8000 (ES modules and the
  File System Access API don't work from `file://`). `.claude/launch.json` has the same server for preview.
- Unit tests: http://localhost:8000/tests/ — in-browser assertions, no framework. Add a `test(...)` there
  for any new pure logic (geometry, slot math, migration, validation).
- File → **Load sample house** loads `samples/sample-house.json` without linking a file handle.
  Keep the sample valid (the tests check it) and extend it whenever a phase adds features.

## Stack & conventions
- Plain HTML/CSS/JS, native ES modules, **no build step, no npm**. Avoid libraries unless they save real effort;
  if one is added, vendor it under `lib/` with a pinned version (no CDN dependency at runtime).
- Rendering is SVG. Print output = dedicated print layouts + Chrome "Save as PDF" (`css/print.css`, `@page`).
- **All lengths are whole inches** in the model. Display with `formatLength`, parse user input with `parseLength`
  (`js/units.js`). Snap grid is `settings.gridIn` (6").
- Both floors share one coordinate origin (x right, y down, inches).
- **Every document mutation goes through `store.commit(label, mutator)`** — that's what makes undo/redo, the
  dirty flag and re-rendering work. Never mutate `getDoc()` outside a commit. UI-only state (current floor,
  selection, view mode, display options) lives in `js/ui/viewstate.js` and is never saved.
- Ids: `id(prefix)` from `model.js`. Prefixes: `w_` wall, `o_` opening, `a_` area, `d_` device, `b_` breaker,
  `g_` switch group. Floors are `F1`, `F2`; panels `p_main`, `p_sub`.
- Derived data (room a device is in, device counts per circuit) is computed, never stored.
- Code style: 2-space indent, single quotes, semicolons, small modules, comments only where intent isn't obvious.

## Layout
```
index.html          app shell          css/app.css, css/print.css
js/main.js          boot, file commands, top bar, shortcuts
js/model.js         SCHEMA_VERSION, newHouse, migrate, validate, slot math, id()
js/store.js         doc state, commit/undo/redo, dirty flag, subscribe
js/fileio.js        open / save in place / save as / reopen last (handle in IndexedDB)
js/units.js         ft-in parse/format
js/ui/viewstate.js  UI-only state       js/ui/inspector.js  properties panel
js/render/, js/tools/, js/print/        (added in later phases)
samples/sample-house.json   tests/index.html
```

## Data model (schemaVersion 1)
Top level: `schemaVersion, meta{name, modified, notes}, settings{gridIn, defaultWallIn{exterior, interior}},
floors[], walls[], openings[], areas[], devices[], panels[], breakers[], switchGroups[]`.

- **floor** `{id, name, order}`
- **wall** `{id, floorId, kind: exterior|interior, a{x,y}, b{x,y}, thicknessIn}`
- **opening** `{id, wallId, kind: door|window|opening, offsetIn (from wall end a), widthIn, hinge: a|b, swing: left|right}`
- **area** `{id, floorId, name, kind: room|garage|attic|exterior|stair, points[{x,y}], stairDir?: up|down}`
- **device** `{id, floorId, type, x, y, rot, label, notes, breakerId|null, verified}` plus per-type fields:
  outlet `gfci, afci`; cable/ethernet `port`; switch `switchKind: single|3way`; light `lightKind: ceiling|wall|recessed|fan`.
  Types: `outlet, receptacle240, hardwired, switch, light, cable, ethernet`.
- **panel** `{id, name, spaces, location, notes, fedFromBreakerId|null}` — main (~30 spaces) and one subpanel
  fed from a 2-pole breaker in the main.
- **breaker** `{id, panelId, position, poles: 1|2, amps, label, notes, color}`. A breaker *is* a circuit.
- **switchGroup** `{id, switchIds[], loadIds[]}` — 1 switch = single-pole, 2 switches = 3-way pair.
  Loads may be any device type (lights, half-hot outlets, fans…). A switch is in at most one group.

Rules (`validate()`):
- Slots: odd on the left, even on the right, numbered top to bottom; row = ceil(n/2). A 2-pole breaker at n
  occupies n and n+2. Must fit `1..spaces`, no overlaps.
- A device is on at most one breaker. No 4-way switches, no tandem breakers.
- Deletes cascade: wall → its openings; breaker → unassign its devices; device → remove from switch groups.
- **Schema changes**: bump `SCHEMA_VERSION`, add a `MIGRATIONS[oldVersion]` step in `model.js`, add a test.
  Files newer than the app open read-only.

## Development phases
0. Scaffold, file I/O, undo/redo ✅
1. Walls, areas (rooms/garage/attic/exterior/stair), openings, pan/zoom, select/move/delete
2. Devices with standard plan symbols
3. Panels view, breakers, circuit assignment, colors, verified styling, unassigned view
4. Switch → load links, 3-way
5. Print: floor sheets with legend (Letter/11×17), circuit table, panel door schedules, breaker labels

After each phase: update this file and the sample, give the user a browser test script, commit and push.

## Repo
Local clone lives at `~/Projects/house-electrical` (outside Google Drive on purpose — Drive sync breaks git).
The user's real house file is separate, in Google Drive.
