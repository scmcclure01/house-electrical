# House Electrical

A browser tool for documenting a home's electrical circuits on a two-floor plan: walls and rooms, outlets/switches/lights,
panel breakers, switch links, and printable plans, circuit tables, panel schedules and breaker labels.

- Runs entirely in the browser (Chrome or Edge — needs the File System Access API).
- Your house is a single `.json` file you keep wherever you like (e.g. a Google Drive folder). The app opens and saves it in place.

## Use
Open the GitHub Pages site, then **File → Open…** your house file, or **New house** and **Save as…**.
Try **File → Load sample house** to explore.

## Develop
```bash
python3 -m http.server 8000
```
Open http://localhost:8000 (app) and http://localhost:8000/tests/ (tests). See `CLAUDE.md` for the data model and conventions.
