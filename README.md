# House Electrical

A browser tool for documenting a home's electrical circuits on a two-floor plan: walls and rooms,
outlets/switches/lights with standard plan symbols, panels and breakers, which breaker feeds what (and whether
you've verified it), which switch controls what, and printable plans, circuit tables, panel schedules and
breaker labels.

**Open it:** https://scmcclure01.github.io/house-electrical/ in **Chrome or Edge** (it needs the File System
Access API to save your file in place; Firefox and Safari can't).

Your house is one `.json` file you keep wherever you like (e.g. a Google Drive folder). Nothing is uploaded
anywhere — the app runs entirely in your browser. Try **File → Load sample house** to explore.

## Workflow
1. **Draw** (Plan view): exterior walls (W) and interior walls (I) with typed tape-measure lengths, rooms and
   areas (A), stairs (T), doors/windows/openings (D/N/O). Use **Ghost** to line up the second floor.
2. **Place devices**: outlets (R), 240V (2), hardwired (H), switches (S), lights (L), cable (C), ethernet (E).
   Each gets a permanent number like R103 (type · floor · sequence).
3. **Set up panels** (Panels view): panel details, then click **+** in a slot to add each breaker.
4. **Map circuits**: pick a breaker → *Assign devices on the plan* (or press B), switch that breaker off, and
   click everything that went dead. Devices take the circuit's color; codes become M7-R103.
   **Show → Unassigned** finds what's left.
5. **Link switches** (K): click a switch, then the lights/outlets it controls; Shift-click a second switch for a 3-way.
6. **Print** (Print view): floor plans with legend (Letter or 11×17), circuit table, panel door schedules and
   breaker number labels → *Print / Save as PDF*. Run *Renumber all devices* first if you want numbers
   to run room by room.

Save often with ⌘S. Undo/redo with ⌘Z / ⇧⌘Z.

**Quick start guide** with every keyboard shortcut: [docs/quick-start.html](https://scmcclure01.github.io/house-electrical/docs/quick-start.html)
(open it and print / Save as PDF; 4 Letter pages, the last is a one-page shortcut card).

## Develop
```bash
python3 serve.py
```
Open http://localhost:8000 (app), http://localhost:8000/tests/ (tests), or
http://localhost:8000/#sample-print to open the sample straight into a view (`#sample`, `#sample-panels`,
`#sample-print`). After cloning, enable the build-stamp hook once: `git config core.hooksPath .githooks`.
See `CLAUDE.md` for the data model and conventions.
