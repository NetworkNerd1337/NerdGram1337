# NerdGram1337

Local-first Mermaid diagramming app by **NetworkNerd1337**.

Paste Mermaid markdown, preview it live with [mermaid.js](https://mermaid.js.org/), manage diagrams as real files and folders on disk, and export **SVG**, **PNG**, **JPG**, or **PDF**. No accounts, no cloud sync, no AI generation, no paywalls.

The app is two programs on your computer. The **client** is a React app that shows the dashboard, the paste page, and the split editor. The **server** is an Express API that reads and writes `.mmd` files in a folder on disk. In development they run side by side. A production build serves the built client and the API from one process.

You already get three sample diagrams: `Welcome.mmd`, `NetworkMap.mmd`, and `Examples/Sequence.mmd`. Anything you create is another file in that same folder, so you can open the files in an editor, copy the folder, or back it up like any other directory.

## Install and run

Do these steps in order the first time. Every `npm` command below is run from the project root: the folder that contains the top-level `package.json`, next to `client/` and `server/`.

### 1. Check prerequisites

You need **Node.js 20 or newer** and **npm 10 or newer**. npm is the tool that installs the app's dependencies and runs the scripts in `package.json`. It ships with the Node.js installer.

Open a terminal and run:

```bash
node -v
npm -v
```

A usable result looks like `v20.x.x` or `v22.x.x` for Node, and `10.x.x` or newer for npm. The first number is the major version. `v18` and anything below 20 is too old for this repo. npm `9` and below is too old.

If the shell says `node` or `npm` cannot be found, or the version is too old, install Node.js 20 or newer from [https://nodejs.org/](https://nodejs.org/). The Windows and macOS installers on that site include npm. On Linux, install a Node.js 20+ build from the same site (or another current source). A Linux distribution package can be an older Node, so check `node -v` after installing. Close the terminal, open a new one, and run the two version commands again so the new install is on your `PATH`.

**Git** is only required if you use `git clone` in the next step. Check it with:

```bash
git --version
```

If that fails and you want to clone, install Git from [https://git-scm.com/downloads](https://git-scm.com/downloads). Downloading the ZIP does not need Git.

On macOS the built-in app is **Terminal**. On Windows use **PowerShell** or **Command Prompt**. On Linux use your distribution's terminal. The terminal built into an editor works too, as long as `node -v` succeeds there.

### 2. Get the code

Put the project in a normal folder you can find again. A `Projects` directory in your home folder is a good spot.

**macOS or Linux**

```bash
mkdir -p "$HOME/Projects"
cd "$HOME/Projects"
```

**Windows Command Prompt**

```bat
mkdir %USERPROFILE%\Projects
cd %USERPROFILE%\Projects
```

**Windows PowerShell**

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\Projects"
Set-Location "$env:USERPROFILE\Projects"
```

That path is:

- macOS: `/Users/you/Projects`
- Linux: `/home/you/Projects`
- Windows: `C:\Users\you\Projects`

Replace `you` with your user name. `$HOME`, `%USERPROFILE%`, and `$env:USERPROFILE` already expand to your home folder, so those commands work as written.

#### Option A: `git clone`

From the `Projects` folder:

```bash
git clone https://github.com/NetworkNerd1337/NerdGram1337.git
```

Git creates a folder named `NerdGram1337` and downloads the repository into it.

#### Option B: download the ZIP

Open [https://github.com/NetworkNerd1337/NerdGram1337](https://github.com/NetworkNerd1337/NerdGram1337), click **Code**, then **Download ZIP**. The same archive is at:

[https://github.com/NetworkNerd1337/NerdGram1337/archive/refs/heads/main.zip](https://github.com/NetworkNerd1337/NerdGram1337/archive/refs/heads/main.zip)

Move the zip into your `Projects` folder and extract it. GitHub names the extracted folder `NerdGram1337-main`. The files inside match the git clone. The only difference is the folder name, and the ZIP copy has no `.git` directory.

#### What the folder looks like

After either option, the project folder contains:

```
NerdGram1337/                  (or NerdGram1337-main/ from the ZIP)
├── package.json               scripts: install:all, dev, build, start
├── package-lock.json
├── README.md
├── LICENSE
├── client/                    React + Vite UI
│   ├── package.json
│   ├── index.html
│   └── src/
├── server/                    Express filesystem API
│   ├── package.json
│   └── src/
├── diagrams/                  default place diagrams are stored
│   ├── Welcome.mmd
│   ├── NetworkMap.mmd
│   └── Examples/
│       └── Sequence.mmd
├── screenshots/
└── .github/workflows/         CI (install, lint, build, test)
```

`npm install` later adds a `node_modules/` folder in the root, in `client/`, and in `server/`. Those are downloaded dependencies. Leave them in place and do not edit them.

### 3. Open a terminal in the project root

npm does not search your computer for the app. It reads the `package.json` in the **current folder** (the directory the terminal is in). If that file is missing, npm stops with `Could not read package.json`.

Change into the project root:

**macOS or Linux, git clone**

```bash
cd "$HOME/Projects/NerdGram1337"
```

**macOS or Linux, ZIP**

```bash
cd "$HOME/Projects/NerdGram1337-main"
```

**Windows Command Prompt, git clone**

```bat
cd %USERPROFILE%\Projects\NerdGram1337
```

**Windows Command Prompt, ZIP**

```bat
cd %USERPROFILE%\Projects\NerdGram1337-main
```

**Windows PowerShell** uses `Set-Location` with the same path, for example:

```powershell
Set-Location "$env:USERPROFILE\Projects\NerdGram1337"
```

Confirm you are in the right place. You should see `package.json`, `client`, `server`, and `diagrams`.

**macOS or Linux**

```bash
pwd
ls
```

**Windows Command Prompt**

```bat
cd
dir
```

The root `package.json` is the map. Its scripts call the matching scripts in `client/package.json` and `server/package.json` with `--prefix client` and `--prefix server`. `--prefix` tells npm which folder's `package.json` to use. That is how a command typed in the root folder finds the UI files under `client/` and the API files under `server/`.

### 4. Install dependencies

From the project root:

```bash
npm run install:all
```

That script is:

```bash
npm install && npm install --prefix client && npm install --prefix server
```

It does three installs, in order:

1. **Root.** Installs `concurrently`, which the dev script uses to run the UI and the API at the same time. Packages go in `node_modules/` next to the root `package.json`.
2. **Client.** Installs React, Vite, mermaid.js, and the rest of the UI into `client/node_modules/`.
3. **Server.** Installs Express and the server toolchain into `server/node_modules/`.

You will see three install reports, each ending with a line like `added N packages` and `found 0 vulnerabilities`. The first run downloads those packages, so it can take a minute. When it finishes, the terminal prompt comes back. This command does not start the app.

Run `install:all` again only after you update the code, delete a `node_modules` folder, or see an error that a package cannot be found.

### 5. Start the app

From the same project root, with dependencies already installed:

```bash
npm run dev
```

That script is:

```bash
concurrently -n server,client -c blue,magenta "npm run dev --prefix server" "npm run dev --prefix client"
```

`concurrently` starts both of these and prefixes their logs with `server` and `client`:

- **server** runs `tsx watch src/index.ts`. That starts the Express API and restarts it when files in `server/src/` change. By default the API listens on **127.0.0.1 port 8787** and, when IPv6 loopback is available, **::1 port 8787**. It does not listen on the LAN.
- **client** runs `vite` bound to **localhost** on port **5173** and reloads the page when UI files change. Requests to `/api` on port 5173 are proxied to `http://127.0.0.1:8787`, so the page and the API talk to each other while you use the UI URL.

Leave this terminal open. A successful start looks like this (the Vite version and the timing will vary, and the data-directory path will be yours):

```text
> nerdgram1337@1.0.0 dev
> concurrently -n server,client -c blue,magenta "npm run dev --prefix server" "npm run dev --prefix client"

[server] > nerdgram1337-server@1.0.0 dev
[server] > tsx watch src/index.ts
[client] > nerdgram1337-client@1.0.0 dev
[client] > vite

[client]   VITE v8.x  ready
[client]   ➜  Local:   http://localhost:5173/
[server] NerdGram1337 API listening on http://127.0.0.1:8787
[server] NerdGram1337 API listening on http://[::1]:8787
[server] Data directory: /home/you/Projects/NerdGram1337/diagrams
```

Open the UI in a browser:

- UI: [http://localhost:5173](http://localhost:5173)

Vite listens on `localhost` only, not on the LAN. That name is a single loopback address, so use the Local URL from the log. If `http://127.0.0.1:5173` does not connect, stay on `http://localhost:5173`.

The dashboard should list the sample diagrams. The API is also up:

- API: [http://localhost:8787](http://localhost:8787)
- Health check: [http://localhost:8787/api/health](http://localhost:8787/api/health)

The health check returns JSON with `"ok": true` and the `dataDir` the server is using. Those `localhost` URLs work because the default bind includes `::1` as well as `127.0.0.1`. If the log says it could not listen on `::1`, open [http://127.0.0.1:8787/api/health](http://127.0.0.1:8787/api/health) instead. Day to day, use the UI URL. The Vite server forwards API calls for you.

### 6. Stop the app, and start it again later

Go to the terminal where `npm run dev` is running and press **Ctrl+C**. Both processes stop. You will see lines like:

```text
[client] npm run dev --prefix client exited with code SIGINT
[server] npm run dev --prefix server exited with code SIGINT
```

The prompt comes back, and [http://localhost:5173](http://localhost:5173) will no longer load. Closing that terminal stops the app too.

To start it again later, open a terminal, `cd` into the same project root, and run:

```bash
npm run dev
```

You do not need `npm run install:all` again unless you updated the code or removed `node_modules`.

### 7. Production mode

Development (`npm run dev`) is the usual way to run NerdGram1337 on your own machine. Production mode builds static files and serves the UI and the API from one process on port **8787**.

Stop the dev server first if it is still running. Both modes want port 8787.

From the project root:

```bash
npm run build
npm start
```

`npm run build` runs the client build, then the server build:

- Client: `tsc -b && vite build`, which writes the site to `client/dist/`.
- Server: `tsc`, which writes the API to `server/dist/`.

The build command ends when both compiles finish and the prompt returns. It does not start the server.

`npm start` runs `node dist/index.js` in the `server` folder. When `client/dist` exists, Express serves those files and sends other non-API routes to `client/dist/index.html`. The API stays on the same port.

Open:

- [http://localhost:8787](http://localhost:8787)

There is no Vite server in this mode, so [http://localhost:5173](http://localhost:5173) will not respond. The startup log is:

```text
NerdGram1337 API listening on http://127.0.0.1:8787
NerdGram1337 API listening on http://[::1]:8787
Data directory: /home/you/Projects/NerdGram1337/diagrams
```

`npm start` does not watch your files. After you change code, press Ctrl+C, run `npm run build` again, then `npm start`.

`npm start` before a successful `npm run build` fails because `server/dist/index.js` does not exist yet:

```text
Error: Cannot find module '.../server/dist/index.js'
```

Run `npm run build` from the project root, then `npm start` again.

The server reads `PORT` if you set it. In production, `PORT=8790 npm start` (Command Prompt: `set PORT=8790` then `npm start`; PowerShell: `$env:PORT = "8790"`) serves the UI and the API on that port. During `npm run dev`, leave the API on 8787: the Vite proxy is configured to forward `/api` to `http://127.0.0.1:8787`.

`HOST` chooses the bind address. Leave it unset for normal use. That default listens on `127.0.0.1` and `::1` only. Setting `HOST` replaces that pair with the single address you give it:

- `HOST=127.0.0.1` listens on IPv4 loopback only. If `http://localhost:8787` does not open, use `http://127.0.0.1:8787`.
- `HOST=::1` listens on IPv6 loopback only.
- `HOST=0.0.0.0`, `HOST=::`, or any other non-loopback address listens beyond this machine. Startup prints a loud warning. There is still no authentication, and that setup is unsupported on a shared host, LAN, or NAS. The only intended use is inside a container, with the host publishing `127.0.0.1:8787:8787` rather than `0.0.0.0:8787`.

macOS or Linux: `HOST=127.0.0.1 npm start`. Windows Command Prompt: `set HOST=127.0.0.1` then `npm start`. PowerShell: `$env:HOST = "127.0.0.1"`. The same variable applies to `npm run dev`. Development mode (the `tsx` dev script) also allows the Vite origin on port 5173. `npm start` runs the compiled server and does not. Set `NODE_ENV=production` or `NODE_ENV=development` only if you need to override that.

## Where diagrams are stored

By default, diagrams live in the `diagrams/` directory inside the project (real folders and `*.mmd` files). The server creates that directory on startup if it is missing, and it prints the absolute path as `Data directory:` in the log.

The copy you cloned or unzipped already includes:

- `diagrams/Welcome.mmd`
- `diagrams/NetworkMap.mmd`
- `diagrams/Examples/Sequence.mmd`

On a typical machine that default folder is:

- macOS: `/Users/you/Projects/NerdGram1337/diagrams`
- Linux: `/home/you/Projects/NerdGram1337/diagrams`
- Windows: `C:\Users\you\Projects\NerdGram1337\diagrams`

Use `NerdGram1337-main` instead of `NerdGram1337` if you installed from the ZIP.

To store diagrams somewhere else, set **`NERDGRAM_DATA_DIR`** to an absolute path before you start the server. The server resolves that value and uses it instead of `diagrams/`. A custom folder starts empty. Copy the sample `.mmd` files into it if you want them there. The log line `Data directory:` should show the path you set.

**macOS or Linux** (this terminal session, then start as usual):

```bash
export NERDGRAM_DATA_DIR="$HOME/Documents/nerdgram-diagrams"
npm run dev
```

A concrete path looks like `/Users/you/Documents/nerdgram-diagrams` on macOS or `/home/you/Documents/nerdgram-diagrams` on Linux. One command, without exporting, is:

```bash
NERDGRAM_DATA_DIR="$HOME/Documents/nerdgram-diagrams" npm run dev
```

**Windows Command Prompt:**

```bat
set NERDGRAM_DATA_DIR=C:\Users\you\Documents\nerdgram-diagrams
npm run dev
```

**Windows PowerShell:**

```powershell
$env:NERDGRAM_DATA_DIR = "C:\Users\you\Documents\nerdgram-diagrams"
npm run dev
```

Use the same variable with `npm start` when you run production mode. Set it in the terminal first, then start the server, so that process inherits it.

Favorites metadata is stored in `diagrams/.meta/favorites.json` (or `<your data dir>/.meta/favorites.json` when `NERDGRAM_DATA_DIR` is set). `favorites.json` is written when you favorite or unfavorite a diagram. Local syntax-reference annotations are stored in `diagrams/.meta/syntax-overrides.json`. Trash, revision history, and editor locks live in that same `.meta` folder. The in-app folder tree hides `.meta`, and the `.mmd` files themselves stay plain text. See [Trash, version history, and editing locks](#trash-version-history-and-editing-locks).

## Titles, themes, and notes

A diagram can start with [Mermaid's YAML front matter](https://mermaid.js.org/config/configuration.html). The title, theme, look, and layout are stored in the `.mmd` file, so they stay with it when you duplicate, import, or copy the folder.

```yaml
---
title: Network overview
config:
  theme: forest
  look: handDrawn
  layout: elk
nerdgram:
  description: Edge path into the lab
  tags:
    - network
  notes: |
    Draft for the lab write-up.
---
flowchart LR
  Internet --> Firewall
```

In the editor, **Diagram info** edits the title, description, notes, and tags, and sets the theme, look, and layout. The preview toolbar has the same theme, look, and layout controls. Those controls write this header and update the preview. The preview, dashboard thumbnails, and SVG, PNG, JPG, and PDF export use the theme in the file. If the file does not set one, they use dark.

The dashboard shows the title when the file has one, and the file name otherwise. A description is shown under the title. Tags are chips; click a chip, or use the tag row, to filter the dashboard. Search also matches this text. A file name match is listed before a title, tag, description, note, or label match. See Search below.

`%%` at the start of a line is a Mermaid comment. In the code pane, Ctrl+/ (Cmd+/ on a Mac) comments or uncomments the selected lines.

Description, notes, and tags live under `nerdgram:` because Mermaid has no field for them. Mermaid still reads `title` and `config` from the same header. A diagram with no front matter previews the same way as before.

An older `%%{init: ...}%%` line still renders. The editor can move that config into the front matter. If the header is not valid YAML, the editor shows the error and leaves the file text alone.

## Thumbnails, find, and commands

Dashboard cards keep a thumbnail of each diagram. The first time a card is on screen, the app draws it. After that, the picture is saved under `.meta/thumbs` in the data folder and reused until the diagram changes. Scrolling a large folder only draws the cards you are about to see. A diagram that cannot be drawn shows “Preview unavailable” and the rest of the grid stays up.

In the editor, Ctrl+F (Cmd+F on a Mac) opens find and replace. The panel can match case, whole words, or a regular expression, and it can replace one match or all of them. Ctrl+G finds the next match. Go to line is Ctrl+Alt+G (Cmd+Alt+G on a Mac), so Ctrl+L / Cmd+L still focuses the address bar. These shortcuts apply while the code pane is focused.

Ctrl+K (Cmd+K on a Mac) opens the command palette. It lists the actions already in the app: new diagram, paste, folder, import, search, open, rename, move, duplicate, trash, restore, diagram info, history, theme, export, present, find, and go to line. If the browser address bar takes that shortcut, use the **Commands** button. Ctrl+/ (Cmd+/ on a Mac) still comments the selected lines.

## Presentation

**Present** shows the diagram on its own, using the theme, look, and layout stored in the file. The title is the front-matter title when the file has one, and the file name otherwise. The control bar can hide the title.

In the editor, use **Present** on the preview toolbar, press **F5**, or press **Ctrl+Shift+Enter** (**Cmd+Shift+Enter** on a Mac). The same **Present diagram** command is in the command palette. **F5** is also the browser reload key. NerdGram uses it for presentation only when a diagram is open and the cursor is not in a form field (search, rename, diagram info, go to line, or the command palette). It does work from the code pane. On the dashboard, the new-diagram page, and the reference, F5 still reloads the page. Pan and zoom keys do not run while you are typing in the editor; they run only during presentation.

**Esc** or **Exit** leaves presentation and returns to the editor or the dashboard. If the browser is showing its own fullscreen and blocks the first Esc, press Esc again or use **Exit**.

On the dashboard, **Present** on a card or a list row opens that diagram without opening the editor. The address looks like `/present/Welcome.mmd`. Presentation does not save the file and does not take the editor lock.

The bar hides after a short pause. Move the pointer, or press Tab, to bring it back. It has zoom in, zoom out, the zoom percent, rotate left, rotate right, fit, title, full screen, and exit.

- The mouse wheel and a trackpad pinch zoom toward the pointer. **+** and **-** zoom toward the last pointer position, or the center of the screen.
- Zoom from the keys and buttons stays between 10% and 800% of the diagram's own size. **Fit** can go outside that range so the whole diagram is visible.
- Drag, a trackpad two-finger scroll, **W A S D**, and **Shift+arrow** pan in any direction.
- Plain arrow keys pan only after you have zoomed in or panned away from the fitted view. At the fitted view they do nothing, so a later slideshow can use them for the next diagram.
- **R** rotates 90° clockwise. **Shift+R** rotates the other way. **Alt+drag** rotates by any angle.
- **0** or **F**, or **Fit**, clears zoom, pan, and rotation and fits the diagram. A quarter turn uses the rotated size, so a tall diagram turned sideways fills a landscape screen.
- If fullscreen is unavailable, the diagram still fills the window. **Full screen** tries again after a click.
- A bad header or a diagram that cannot be drawn shows the error. The last good picture stays up when a later refresh fails.

Animated fades are skipped when the system asks for reduced motion.

## Search

The sidebar search box matches file names and paths, titles, tags, descriptions, notes, and the visible text in a diagram: node and edge labels, subgraph titles, sequence messages, and similar labels. It does not match a diagram only because the file says `flowchart` or `sequenceDiagram`. Results show the matching text. Opening a result jumps to that line in the editor. The command palette (Ctrl+K or Cmd+K) uses the same search. **Names only**, under the search box, limits the dashboard to file names and paths. Diagrams in the trash are not included.

## Trash, version history, and editing locks

Delete on the dashboard moves a diagram or a folder into the trash. It does not erase the files. Open **Trash** in the sidebar to restore an item or delete it permanently. **Empty trash** removes everything in the trash for good.

Restore puts the item back at its original path. If something is already there, the app asks you to restore a copy (`Name (restored).mmd`, or `Name (restored 2)` and so on) or to replace the current item. Replacing moves that current item to the trash first, so it is not erased either.

A folder is one trash entry. Restore puts the whole folder back, including every file that was inside it.

Favorites come off the sidebar while an item is in the trash and go back when you restore it. If you restore to a different path, the favorite follows that path.

Every save that changes a diagram keeps the previous contents as a revision. In the editor, **History** lists those revisions, shows the old text, and can restore one. Restoring writes the text you are replacing into history first, so you can undo a restore. The last **20** revisions are kept for each diagram. Older ones are dropped. There is no age limit, so a diagram you have not opened in a long time still has its recent history.

Rename and move carry that history with the diagram. Trash does too. Permanently deleting an item deletes its history.

The file you edit stays a plain `.mmd` file. Revisions, trash, and locks are under the data directory:

- `.meta/trash/items/<id>/` — one soft-deleted file or folder, plus the favorites and revisions that belonged to it
- `.meta/versions/p_<encoded-path>/` — the previous contents of one diagram
- `.meta/locks/p_<encoded-path>.json` — the editor lock for one path

Autosave still waits 500 ms after you stop typing, and Auto-Update still refreshes the preview. Each save sends the modification time and a content hash from the last time this editor loaded or saved the file. If the bytes on disk are different, autosave stops. You can reload the disk copy, overwrite the disk with your copy, or keep your copy without saving. Overwrite stores the disk copy as a revision first. Creating a diagram does not need a baseline. Saving over a file that already exists does: a second write with no baseline is refused, so a new diagram will not silently replace one that is already there.

Opening a diagram takes a lock for that browser tab. Another tab, or a second NerdGram process pointed at the same data directory with a different `PORT`, can open the diagram read-only and is told that it is already open. The editor sends a heartbeat every **15 seconds**. If the heartbeat is missing for **90 seconds**, or the server process that held the lock has exited, the next editor can take the lock. Closing the tab releases it. These locks are not accounts and they do not stop you from editing the `.mmd` file in another program. That case is the conflict prompt above.

You cannot rename, move, or trash a diagram (or a folder that contains it) while an editor still holds its lock. Close the editor first. The open editor keeps its path; another view cannot move that file out from under it.

## Move, duplicate, and import

**Move to…** is on every diagram and folder, next to Rename and Delete. It opens a folder list, including the workspace root. Arrow keys move through that list, and the same action is available by dragging the item onto a folder in the dashboard or the sidebar tree. The Dashboard item at the top of the sidebar is the workspace root. Trash is not a drop target.

A move that would land in the item's current folder, or put a folder inside itself or one of its subfolders, is refused. Dragging onto a diagram does nothing. If the destination already has that name, the drag is refused and nothing is overwritten. Move to… offers **Move as Name (copy)** (then **Name (copy 2)**, and so on) so you can keep both. Favorites and revision history follow the file or folder to the new path.

A locked diagram, or a folder that contains one, cannot be moved. The dashboard says to close the editor first.

**Duplicate** copies a diagram or a whole folder. The first copy is `Name (copy).mmd` (or `Name (copy)` for a folder), then `Name (copy 2)`, and it never overwrites an existing item. The copy is not favorited, it does not share the source's editor lock, and it starts with no revision history. Later saves build history for the copy only. Hidden files, including anything under `.meta`, are not copied.

**Import** copies text you already have on disk into the folder you are viewing, or into a folder you pick in the import dialog. Use **Import** to choose files, or drop `.mmd`, `.md`, and `.txt` files onto the dashboard or a folder. `.md` and `.txt` are stored as `.mmd`. Other file types are rejected. Each file can be up to 512 KB, with at most 25 files and 3 MB of text in one import. A dropped folder is not imported as a tree; pick the files themselves.

If a name is already in that folder, choose **Skip**, **Rename** (`Name 2.mmd`, then `Name 3.mmd`), or **Replace**. Nothing is overwritten unless you choose Replace. Replace keeps the previous text as a revision. A diagram that is open in an editor is not replaced. If Mermaid cannot parse a file, the dialog warns you and still lets you import it so you can fix it in the editor. The imported file is a normal diagram in the data directory, not a link back to the original path.

## Offline Mermaid syntax reference library

NerdGram1337 ships a local mirror of the Mermaid diagram syntax docs so you can look up syntax with no internet connection.

### Open it

In the sidebar, use **Open Syntax Reference Library**, or the same link in the editor top bar. That opens `/reference`: a searchable table of contents and the full offline pages.

### What is stored where

- Bundled mirror: `reference/manifest.json` and `reference/pages/*.md` (checked into the repo so offline works before any sync).
- Local annotations: `diagrams/.meta/syntax-overrides.json` (or under your `NERDGRAM_DATA_DIR`). These notes are per page and are never wiped by sync.

### Sync from mermaid.js.org

While online, click **Sync Syntax Reference** on the reference page (or run the CLI below). The server fetches [the Mermaid syntax reference](https://mermaid.js.org/intro/syntax-reference.html) and the linked `/syntax/*.html` diagram pages, rebuilds the mirror in a staging folder, then atomically replaces `reference/`.

- **Full replace:** a successful sync replaces the entire page set and updates `lastSyncedAt` in the manifest.
- **Failed sync:** if download or replace fails, the existing `reference/` copy is left untouched and the UI shows the error.
- **Annotations survive:** overrides in `.meta/syntax-overrides.json` are not part of the replace and remain after sync.

From the project root:

```bash
npm run sync:reference --prefix server
```

Mirrored content is from the Mermaid documentation (MIT License). Each page keeps attribution and a link back to its upstream source on [mermaid.js.org](https://mermaid.js.org/).

## Update to a newer version

Stop the app with Ctrl+C before updating.

**If you cloned with git**, from the project root:

```bash
git pull
npm run install:all
```

Then `npm run dev`, or `npm run build` and `npm start`. `git pull` updates tracked files. Diagrams you created under `diagrams/` stay put, because the repo ignores those extra files. The three sample diagrams are tracked. If you edited `Welcome.mmd`, `NetworkMap.mmd`, or `Examples/Sequence.mmd`, git may stop and ask you to handle those local edits before the pull can finish.

**If you used the ZIP**, download a fresh ZIP from the link in step 2 and extract it to a new folder. `cd` into that folder and run `npm run install:all` again. The ZIP does not include `node_modules`. If your diagrams are still in the old project's `diagrams/` folder, copy that folder into the new project. If you set `NERDGRAM_DATA_DIR`, point the new copy at the same path and leave the files where they are.

## Security model

NerdGram1337 is a local, single-user personal tool. It has no accounts and no authentication, by design. Diagrams are plain `.mmd` files, and your operating-system account and file permissions are the access control. Do not run it as a shared service, on a NAS, or on a host other people can reach. That use is unsupported.

The API binds loopback only unless you set `HOST` (see production mode above). Do not forward port 8787 or 5173 to the network.

Two browser checks sit in front of that bind:

- Every request must use a loopback `Host` header (`localhost`, `127.0.0.1`, or `[::1]`, including the API port). Any other `Host` is rejected with **403**. That blocks a public DNS name that points back at your machine. `NERDGRAM_ALLOWED_HOSTS` is an optional comma-separated list of extra hostnames. Adding one does not make shared-server use supported.
- `POST`, `PUT`, `PATCH`, and `DELETE` must come from the same origin as the API (`http://127.0.0.1:8787`, `http://localhost:8787`, or `http://[::1]:8787`). In development, `http://localhost:5173`, `http://127.0.0.1:5173`, and `http://[::1]:5173` are allowed too. A page on another website is rejected with **403**. Those requests also need `Content-Type: application/json` (a plain HTML form cannot set that, and gets **415**). `curl` on the same machine does not send an `Origin` and is allowed. Production does not enable cross-origin browser access, because the UI and the API are the same port. Development CORS allows only the origins listed above.

`NERDGRAM_CORS_ORIGINS` is an optional comma-separated list of extra origins, for example when Vite falls over to port 5174 (see troubleshooting). It is not a wildcard.

Paths stay inside the data directory. The server rejects null bytes, hidden paths such as `.meta`, and any path that escapes that directory. Diagram writes must be `.mmd` files. Editor locks only keep two windows from writing the same diagram. They are not authentication.

## Troubleshooting

### Port already in use

If the API port is taken, the server exits and prints:

```text
Error: listen EADDRINUSE: address already in use 127.0.0.1:8787
```

A previous `npm run dev` or `npm start` is usually still running in another terminal. Switch to that terminal and press Ctrl+C, then start the app again. Do not run `npm run dev` and `npm start` at the same time. They both listen on 127.0.0.1 port 8787.

If Vite's port is taken, it does not exit. It prints:

```text
Port 5173 is in use, trying another one...
  ➜  Local:   http://localhost:5174/
```

Open the URL in that line. The API still has to be on port 8787, because the dev proxy forwards `/api` to `http://127.0.0.1:8787`. Saving a diagram from that fallback port also needs the new origin on the allow-list. From the project root, stop the app, then start it again with `NERDGRAM_CORS_ORIGINS` set to the origin Vite printed (macOS or Linux: `NERDGRAM_CORS_ORIGINS=http://localhost:5174 npm run dev`; Command Prompt: `set NERDGRAM_CORS_ORIGINS=http://localhost:5174`; PowerShell: `$env:NERDGRAM_CORS_ORIGINS = "http://localhost:5174"`). Add `http://127.0.0.1:5174` as well, separated by a comma, if you open the UI that way. Do not set a wildcard.

### Wrong Node.js version

Run `node -v` in the same terminal you use for `npm run dev`. It needs to be 20 or newer, and `npm -v` needs to be 10 or newer. If the commands are not found, or the numbers are too low, install Node.js 20+ from [https://nodejs.org/](https://nodejs.org/), then open a **new** terminal and check again. An old terminal can keep using the previous install.

### `npm` cannot find `package.json`

```text
npm error enoent Could not read package.json
```

The terminal is not in the project root. `cd` into the folder from step 3. `ls` or `dir` should show `package.json`, `client`, and `server` before you run npm.

### `npm start` cannot find `server/dist/index.js`

The production build has not been created. From the project root run `npm run build`, wait until it finishes, then run `npm start`.

### The page opens, but diagrams do not load

`npm run dev` has to keep both the `server` and `client` processes running. If you started only the client, the page has no API. Stop it, `cd` to the project root, and run `npm run dev`. Then check [http://localhost:8787/api/health](http://localhost:8787/api/health). `"ok": true` means the API is up, and `dataDir` shows which folder it is reading.

## Features

- Dashboard with folder tree, search, grid/list views
- Create / rename / delete folders and diagrams. Delete moves them to trash
- Move diagrams and folders with Move to… or by dragging them onto a folder, including the workspace root
- Duplicate a diagram or folder as Name (copy), without overwriting or sharing its lock and history
- Import .mmd, .md, and .txt files from a file picker or by dropping them on a folder. Name clashes ask before anything is replaced
- Trash, with restore, replace-or-copy when the old path is taken, and permanent purge
- Per-diagram version history (the last 20 previous saves) that follows rename and move
- Conflict check on autosave, so a file that changed on disk is not overwritten without a choice
- One writable editor per diagram. A second tab opens read-only until the lock is released or goes stale
- Favorite diagrams, stored in `.meta/favorites.json` inside the data folder. A favorite returns when you restore the diagram from trash
- Paste-only Mermaid create flow (`/new`)
- Split code + live preview editor with autosave (500 ms) and Auto-Update preview
- Mermaid syntax highlighting, autocomplete (diagram types, keywords, arrows, snippets, existing node IDs), bracket matching, and inline parse-error diagnostics in the code pane
- Per-diagram title, description, notes, and tags in Mermaid front matter, with theme, look, and layout written into the file. The dashboard shows the title and can filter by tag. Ctrl+/ or Cmd+/ toggles a `%%` comment
- Cached dashboard thumbnails, editor find and replace, go to line (Ctrl+Alt+G or Cmd+Alt+G), and a command palette (Ctrl+K or Cmd+K)
- Fullscreen presentation with zoom, pan, and rotate (F5, or Ctrl+Shift+Enter / Cmd+Shift+Enter). From the dashboard, Present opens the diagram without the editor
- Export to SVG, PNG, JPG, and PDF (PDF is built client-side from the live SVG so the current theme is preserved)
- Offline Mermaid syntax reference library with sync from mermaid.js.org

## Project layout

```
client/       React + Vite UI (dev server on localhost port 5173)
server/       Express filesystem API (loopback port 8787)
diagrams/     Default local workspace (*.mmd files)
reference/    Offline Mermaid syntax dictionary (manifest + pages)
screenshots/  UI captures checked into the repo
.github/      GitHub Actions CI (install, lint, build, test)
package.json  Root scripts: install:all, dev, build, start, test
```

## License

MIT © Ryan Thomas Huff
