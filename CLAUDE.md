# House Electrical — project guide

Browser tool for documenting a home's electrical circuits on a two-floor plan. Single user, desk use, no backend.
Hosted on GitHub Pages; the house data is one JSON file (kept in Google Drive) opened and saved in place
with the File System Access API (Chrome/Edge only).

## Run & test
- `python3 serve.py` from the repo root, then http://localhost:8000 (ES modules and the File System Access
  API don't work from `file://`). It disables caching — with plain `http.server` Chrome keeps stale ES modules.
  `.claude/launch.json` runs the same server for preview.
- **Cache busting**: GitHub Pages lets browsers cache files ~10 min, which once served new JS with old CSS.
  A pre-commit hook (`.githooks/pre-commit` → `stamp_build.py`) rewrites the `BUILD` block in `index.html`
  on every commit: versioned CSS links plus an import map adding `?v=<build>` to every module under `js/`
  (found automatically). Enable it in a fresh clone with `git config core.hooksPath .githooks`.
  Don't edit the BUILD block by hand; the running build id shows at the bottom right of the app.
- Browser automation note: the test harness's "type" action doesn't fire keydown events; send key presses
  (e.g. `key "1 2 ' 6 Return"`) to exercise the wall tool's typed lengths.
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
- Drags use `store.beginGesture / updateGesture / endGesture` so a whole drag is one undo step.
- Tools are plain objects (see header of `js/tools/index.js`); the renderer calls `tool.overlay(h)` for
  previews. Full SVG re-render on every change is intentional (small documents, simple code).
- Shared wall corners: moving a wall end also moves other wall ends at the same point (same floor).
- Opening `offsetIn` is measured from wall end `a`; the UI marks that end with an "A".
- Keyboard shortcuts: V select · W/I ext/int wall · A area · T stair · D/N/O door/window/opening ·
  R outlet · 2 240V · H hardwired · S switch · L light · C cable · E ethernet · B assign circuit ·
  F fit · Esc · Delete.
- Device symbols scale up when zoomed out (min ~15px) and text tags hide below 1.6 px/inch.
- Layout: row 1 = dark app bar (File, file name, Plan|Panels|Print, undo/redo); row 2 = per-view toolbar
  (`.toolbar` with `.tb-group` / `.tb-label` / `.seg` segmented buttons). Tool options dock across the top of
  the canvas. Nothing else floats over the drawing except the toast. Keep new controls in these places.
- Code style: 2-space indent, single quotes, semicolons, small modules, comments only where intent isn't obvious.

## Layout
```
index.html          app shell          css/app.css, css/print.css
js/main.js          boot, file commands, top bar, shortcuts
js/model.js         SCHEMA_VERSION, newHouse, migrate, validate, slot math, id()
js/store.js         doc state, commit/undo/redo, dirty flag, subscribe
js/fileio.js        open / save in place / save as / reopen last (handle in IndexedDB)
js/units.js         ft-in parse/format
js/geometry.js      points, snapping, projection, polygon area / label point
js/ui/viewstate.js  UI-only state (floor, selection, tool, display toggles)
js/ui/inspector.js  properties panel     js/ui/toolrail.js  tool buttons, tool options, zoom controls
js/ui/status.js     status bar + toast (status() for hints, notify() for events; errors always toast)
js/ui/panels.js     Panels view: panel diagrams + breaker/panel editor
js/ui/plantoolbar.js second toolbar row: Floor · Show (Circuits/Unassigned) · Labels · key · Dimensions/zoom;
                    also toggles the Panels/Print toolbar rows (panels.js fills #panels-toolbar)
js/render/plan.js   SVG plan renderer + camera (viewBox pan/zoom), openingGeom(), deviceMarkup()
js/render/symbols.js  electrical symbols (local frame, radius R=6"), deviceTags(); reused for rail icons/legend
js/tools/index.js   tool registry, pointer/wheel/keyboard routing, Delete/Esc/F shortcuts
js/tools/snap.js    corner → Shift 45° → grid snapping
js/tools/select.js, wall.js, area.js, opening.js, device.js, assign.js   individual tools
                    (device.js exports devicePlacement(): wall-face snapping / room-centre snapping)
js/print/           (Phase 5)
samples/sample-house.json   tests/index.html
```

## Data model (schemaVersion 2)
Top level: `schemaVersion, meta{name, modified, notes}, settings{gridIn, defaultWallIn{exterior, interior}},
floors[], walls[], openings[], areas[], devices[], panels[], breakers[], switchGroups[]`.

- **floor** `{id, name, order}`
- **wall** `{id, floorId, kind: exterior|interior, a{x,y}, b{x,y}, thicknessIn}`
- **opening** `{id, wallId, kind: door|window|opening, offsetIn (from wall end a), widthIn, hinge: a|b, swing: left|right}`
- **area** `{id, floorId, name, kind: room|garage|attic|exterior|stair, points[{x,y}], stairDir?: up|down}`
- **device** `{id, floorId, type, num, x, y, rot, wallId|null, label, notes, breakerId|null, verified}` plus per-type fields:
  outlet `gfci, afci`; cable/ethernet `port`; switch `switchKind: single|3way`; light `lightKind: ceiling|wall|recessed|fan`.
  Types: `outlet, receptacle240, hardwired, switch, light, cable, ethernet`. Always run `normalizeDevice()` after
  creating a device or changing its type. Wall devices: `wallId` set, `(x,y)` = point on the wall face, `rot` =
  degrees of the direction they face (away from the wall); the symbol is drawn one radius out from (x,y).
  Free devices (ceiling lights, or anything not near a wall): `wallId` null, `(x,y)` = symbol centre.
  Low-voltage drops (cable/ethernet) never get a breaker.
- **Device numbers**: `num` is permanent = type letter + floor order digit + 2-digit sequence (R103).
  Letters: R outlet · V 240V · E hardwired · S switch · L light/fan · TV cable · D data. The full code shown
  everywhere is `deviceCode()` = breaker code + num (M7-R103; breaker code = panel code + first slot), or just
  num when unassigned. New devices get `nextDeviceNum()`; changing type assigns a new num; numbers must be
  unique (validate + inspector check); "Renumber all devices…" (house inspector) runs `renumberDevices()`.
- **panel** `{id, name, code, spaces, location, notes, brand, model, mainAmps|null, busAmps|null, fedFromBreakerId|null}`.
  Any number of panels; `fedFromBreakerId` null = main (utility-fed), else a 2-pole breaker in another panel
  (loops prevented in the UI via `isDownstream()` in panels.js). `code` = 1–3 chars, unique (M, S, S2…).
- **breaker** `{id, panelId, position, poles: 1|2, amps, label, notes, color, type: standard|gfci|afci|dual, model}`.
  A breaker *is* a circuit.
  Helpers in model.js: `slotProblem()` (fit/overlap check — use before any position/poles change),
  `breakerName()` ("Main 3/5"), `breakerTitle()`, `assignableBreakers()` (excludes subpanel feeders),
  `circuitStats()` (devices/verified/byType/rooms per breaker), `unassignedDevices()`, `nextColor()`.
- **switchGroup** `{id, switchIds[], loadIds[]}` — 1 switch = single-pole, 2 switches = 3-way pair.
  Loads may be any device type (lights, half-hot outlets, fans…). A switch is in at most one group.

Rules (`validate()`):
- Slots: odd on the left, even on the right, numbered top to bottom; row = ceil(n/2). A 2-pole breaker at n
  occupies n and n+2. Must fit `1..spaces`, no overlaps.
- A device is on at most one breaker. No 4-way switches, no tandem breakers.
- `verified` = assignment confirmed by testing. Changing a device's breaker resets `verified` to false
  (except the Assign tool with "Mark verified" on, which sets it true). Subpanel feeders can't have devices.
- Plan display: assigned devices take their breaker color; unverified = dashed outline + white fill;
  low-voltage = slate gray. `view.display`/`focusBreakerId`/Assign tool dim the others (see `emphasis()` in plan.js).
- Deletes cascade: wall → its openings; breaker → unassign its devices; device → remove from switch groups.
- **Schema changes**: bump `SCHEMA_VERSION`, add a `MIGRATIONS[oldVersion]` step in `model.js`, add a test.
  Files newer than the app open read-only.

## Development phases
0. Scaffold, file I/O, undo/redo ✅
1. Walls, areas (rooms/garage/attic/exterior/stair), openings, pan/zoom, select/move/delete ✅
2. Devices with standard plan symbols ✅
3. Panels view, breakers, circuit assignment, colors, verified styling, unassigned view ✅
4. Switch → load links, 3-way
5. Print: floor sheets with legend (Letter/11×17), circuit table, panel door schedules, breaker labels

After each phase: update this file and the sample, give the user a browser test script, commit and push.

## Repo
GitHub: https://github.com/scmcclure01/house-electrical (public, `main` branch).
Live site (GitHub Pages, deploys from `main` root ~1 min after push): https://scmcclure01.github.io/house-electrical/
`gh` is installed at `/usr/local/bin/gh` and authenticated.
Local clone lives at `~/Projects/house-electrical` (outside Google Drive on purpose — Drive sync breaks git).
The user's real house file is separate, in Google Drive:
`~/Library/CloudStorage/GoogleDrive-scmcclure01@gmail.com/My Drive/Claude/Personal/House Sketch and Electrical Panel/my-house.json`
