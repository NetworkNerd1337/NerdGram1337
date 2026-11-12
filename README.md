# NerdGram1337

Local-first Mermaid diagramming app by **NetworkNerd1337**.

Paste Mermaid markdown, preview it live with [mermaid.js](https://mermaid.js.org/), manage diagrams as real files and folders on disk, and export **SVG**, **PNG**, or **JPG**. No accounts, no cloud sync, no AI generation, no paywalls.

## Requirements

- Node.js 20+
- npm 10+

## Quick start

```bash
npm run install:all
npm run dev
```

Then open:

- UI: [http://localhost:5173](http://localhost:5173)
- API: [http://localhost:8787](http://localhost:8787)

Production build:

```bash
npm run build
npm start
```

Production serves the built client from the Express server on port `8787`.

## Local file storage

Diagrams live under the `diagrams/` directory next to the app (real folders + `*.mmd` files).

Override the data root:

```bash
NERDGRAM_DATA_DIR=/absolute/path/to/your/folder npm run dev --prefix server
```

Favorites metadata is stored in `diagrams/.meta/favorites.json`.

## Features

- Dashboard with folder tree, search, grid/list views
- Create / rename / delete folders and diagrams
- Paste-only Mermaid create flow (`/new`)
- Split code + live preview editor with autosave
- Theme switcher for previews
- Export to SVG, PNG, and JPG

## Project layout

```
client/     React + Vite UI
server/     Express filesystem API
diagrams/   Default local workspace
```

## License

MIT © Ryan Thomas Huff
