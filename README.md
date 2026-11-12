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
└── screenshots/
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

- **server** runs `tsx watch src/index.ts`. That starts the Express API and restarts it when files in `server/src/` change. The API listens on port **8787**.
- **client** runs `vite`. That starts the UI dev server on port **5173** and reloads the page when UI files change. Requests to `/api` on port 5173 are proxied to `http://localhost:8787`, so the page and the API talk to each other while you use the UI URL.

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
[server] NerdGram1337 API listening on http://localhost:8787
[server] Data directory: /home/you/Projects/NerdGram1337/diagrams
```

Open the UI in a browser:

- UI: [http://localhost:5173](http://localhost:5173)

The dashboard should list the sample diagrams. The API is also up:

- API: [http://localhost:8787](http://localhost:8787)
- Health check: [http://localhost:8787/api/health](http://localhost:8787/api/health)

The health check returns JSON with `"ok": true` and the `dataDir` the server is using. Day to day, use the UI URL. The Vite server forwards API calls for you.

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
NerdGram1337 API listening on http://localhost:8787
Data directory: /home/you/Projects/NerdGram1337/diagrams
```

`npm start` does not watch your files. After you change code, press Ctrl+C, run `npm run build` again, then `npm start`.

`npm start` before a successful `npm run build` fails because `server/dist/index.js` does not exist yet:

```text
Error: Cannot find module '.../server/dist/index.js'
```

Run `npm run build` from the project root, then `npm start` again.

The server reads `PORT` if you set it. In production, `PORT=8790 npm start` (Command Prompt: `set PORT=8790` then `npm start`; PowerShell: `$env:PORT = "8790"`) serves the UI and the API on that port. During `npm run dev`, leave the API on 8787: the Vite proxy is configured to forward `/api` to `http://localhost:8787`.

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

Favorites metadata is stored in `diagrams/.meta/favorites.json` (or `<your data dir>/.meta/favorites.json` when `NERDGRAM_DATA_DIR` is set). The `.meta` folder is created when the app reads favorites. `favorites.json` is written when you favorite or unfavorite a diagram. Local syntax-reference annotations are stored in `diagrams/.meta/syntax-overrides.json`. The in-app folder tree hides `.meta`.

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

## Troubleshooting

### Port already in use

If the API port is taken, the server exits and prints:

```text
Error: listen EADDRINUSE: address already in use :::8787
```

A previous `npm run dev` or `npm start` is usually still running in another terminal. Switch to that terminal and press Ctrl+C, then start the app again. Do not run `npm run dev` and `npm start` at the same time. They both listen on 8787.

If Vite's port is taken, it does not exit. It prints:

```text
Port 5173 is in use, trying another one...
  ➜  Local:   http://localhost:5174/
```

Open the URL in that line. The API still has to be on port 8787, because the dev proxy forwards `/api` there.

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
- Create / rename / delete folders and diagrams
- Favorite diagrams, stored in `.meta/favorites.json` inside the data folder
- Paste-only Mermaid create flow (`/new`)
- Split code + live preview editor with autosave
- Theme switcher for previews (dark, default, neutral, forest, base)
- Export to SVG, PNG, JPG, and PDF (PDF is built client-side from the live SVG so the current theme is preserved)
- Offline Mermaid syntax reference library with sync from mermaid.js.org

## Project layout

```
client/       React + Vite UI (dev server on port 5173)
server/       Express filesystem API (port 8787)
diagrams/     Default local workspace (*.mmd files)
reference/    Offline Mermaid syntax dictionary (manifest + pages)
screenshots/  UI captures checked into the repo
package.json  Root scripts: install:all, dev, build, start
```

## License

MIT © Ryan Thomas Huff
