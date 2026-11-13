# Changelog

Release notes for GitHub Releases. The heading for a release is `## X.Y.Z "Code name" - YYYY-MM-DD`. It has to match the root `package.json` version. `npm run version:check` requires the quoted code name to match the `codenames` map. The notes script also accepts `## X.Y.Z` and `## [X.Y.Z]`, with an optional code name and date. The `vX.Y.Z` tag is the version the update check reads. The GitHub Release title is `vX.Y.Z "Code name"`, from that tag and the map.

## 1.0.5 "Atlas" - 2026-11-13

First release of NerdGram1337. Atlas is the code name for the whole 1.x line. Diagrams are `.mmd` files on this computer. The app is a local, single-user tool: there is no account and no login.

### Highlights

- A dashboard and an editor for Mermaid diagrams, with three sample diagrams the first time a data directory is empty.
- Delete moves a diagram or folder to trash. The last 20 revisions of a file are kept, and an autosave will not overwrite a copy that changed on disk.
- Move, duplicate, and import sit next to that. Search covers names and the text inside a diagram. Presentation is a full-screen, read-only view.
- Optional GitHub sync copies `.mmd` files to a private repository you create with your own OAuth app. An in-app update check reads the public GitHub Releases for this project.
- The same version is in `package.json`, the About line, and the container image `ghcr.io/networknerd1337/nerdgram1337:v1.0.5`.

### Security

The API listens on `127.0.0.1` and `::1` when `HOST` is unset. If IPv6 loopback is unavailable, IPv4 loopback still serves (#15).

- Every request needs an allowed `Host` (`localhost`, `127.0.0.1`, or `::1`, plus any name in `NERDGRAM_ALLOWED_HOSTS`). Anything else is rejected.
- `POST`, `PUT`, `PATCH`, and `DELETE` have to be `Content-Type: application/json`. A browser form cannot set that.
- Those requests also check `Origin` and `Sec-Fetch-Site`. A page on another site is rejected. `curl` on this machine, which sends neither header, is allowed.
- `HOST=0.0.0.0` is for the container. The image sets it so Docker can publish the port, and the publish in `compose.yaml` is `127.0.0.1:8787:8787`. On the host, leave `HOST` unset.
- Server and client tests run in CI.

### Editing & files

Trash is a soft delete. Restore puts the file or folder back. Emptying trash is the permanent delete (#8).

- Each save keeps the previous contents. The last 20 revisions are kept, and you can restore one from the history dialog.
- Autosave sends the hash of the copy it loaded. If the file changed on disk, autosave pauses and asks you to keep yours unsaved, reload from disk, or overwrite with yours.
- An editor tab holds a lock on the open diagram so a second window does not write over it. The lock is not a login.

Move, duplicate, and import (#9):

- Move from the menu or by dragging onto a folder. A drop onto a diagram does nothing. A name that is already in the destination is not overwritten. Move to… can offer `Name (copy)` when you need a free name.
- Duplicate writes `Name (copy).mmd`, then `Name (copy 2).mmd`. The copy is not favorited, does not take the source lock, and starts with no revision history.
- Import reads `.mmd`, `.md`, and `.txt`, up to 512 KB each, 25 files at a time, and 3 MB of text in one request. When a name is taken you choose Skip, Rename, or Replace. Replace goes through the normal save, so a locked file stays put and the previous bytes become a revision.

### Diagrams & metadata

A diagram can start with Mermaid YAML front matter (#16).

- `title`, `config.theme`, `config.look`, and `config.layout` are Mermaid's own fields. Theme, look, and layout are also on the preview toolbar.
- Description, tags, and notes live under `nerdgram:` in that same block, so they stay in the `.mmd` file and Mermaid ignores them.
- Diagram info edits those fields in the editor.
- A legacy `%%{init}%%` or `%%{initialize}%%` directive can be moved into `config`. The directive's keys win where both set the same thing, which is how Mermaid already draws the diagram. Other front matter, including `nerdgram`, stays.

### Navigation & search

The dashboard keeps a thumbnail for each diagram under `.meta/thumbs/` and reuses it while the file is unchanged (#10). The open tab also keeps an in-memory copy.

- Find and replace, and go to line, use the editor search keys. Go to line is Ctrl+Alt+G (Ctrl+Option+G on a Mac). On Windows, AltGr can collide with that chord. See Known limitations.
- Ctrl+K (Cmd+K on a Mac) opens the command palette from the dashboard, the editor, and the other pages. It stays closed during presentation.

Search matches the file name, the path, the title, tags, the description, notes, and the visible labels in the diagram, and ranks a name match ahead of a label buried in the source (#13). The dashboard field and the command palette use the same search. Names only limits it to file and folder names.

### Presentation

Present opens the diagram full screen without saving it and without taking the editor lock (#18).

- Start with F5 or Ctrl+Shift+Enter (Cmd+Shift+Enter on a Mac) while a diagram is open and the cursor is not in a form field. F5 still reloads the page on the dashboard, the new-diagram page, and the reference. The command palette and the Present button on a card do the same thing.
- Esc leaves presentation. Zoom, pan, rotate, and fit are on the bar and on the keyboard. The bar hides until you move the pointer or press Tab.
- The view is read-only.

### Templates

The template gallery ships six starters: flowchart, sequence, network topology, home lab, rack elevation, and firewall policy (#17). Creating a diagram copies the starter into your folder as a normal `.mmd` file. The gallery files live in `templates/`, not in the data directory. Dropping another `.mmd` file in that folder adds it to the gallery. This release does not store templates you save yourself.

### GitHub sync

GitHub sync is optional (#14). NerdGram does not ship a client ID. You register an OAuth app in your own account, enable Device flow, and paste that client ID.

- The token is stored at `<data>/.meta/github-token` with mode `0600`, or taken from `NERDGRAM_GITHUB_TOKEN`. It is not sent to the browser and not written into the git remote URL.
- The git working copy is a hidden `.nerdgram-git` directory inside the data folder. The data directory itself is not a git repository.
- Synced files are the `.mmd` diagrams, plus a short README, `.gitignore`, and `.gitattributes` so the GitHub repository can be read on its own. `.meta`, templates, and the syntax reference stay on this computer.
- NerdGram does not force-push. If GitHub has commits this computer does not, you pull. When both copies changed, you choose Keep local, Keep both, or Use GitHub copy. An open editor is not overwritten.

### Updates & releases

About and the bottom of the sidebar show the running version and its code name, for example `v1.0.5 "Atlas"`. `GET /api/version` and `GET /api/health` return the same version, `codename`, commit when there is one, and how this copy was installed (#19).

- The update check calls the public GitHub Releases API for this repository. It sends no token and no telemetry. It reads the version from the release tag. The release title is not the version.
- When a newer stable release exists, the banner and the release dialog show that release's code name. The name comes from the major number (1 is Atlas, 2 is Meridian). A major that is not in the map is taken from a release title shaped like `vX.Y.Z "Name"`, and only when that title is that one safe phrase.
- On a clean git clone of this repository, on `main` or a detached release tag, Update now fetches the tag and fast-forwards only (`git merge --ff-only` on `main`). A tag that is not a fast-forward is refused. The check's "ahead" state means `package.json` is newer than the latest stable tag. It is not a count of extra commits.
- A Docker install is not changed from inside the container. About shows copyable pull, stop, remove, and run steps that keep the `nerdgram-data` volume and `127.0.0.1:8787:8787`.
- The root `package.json` version is the only version. `npm run version:sync` copies it into the client, the server, the lockfiles, the Dockerfile, and `compose.yaml`, and it copies the code name into the image build arg. Pushing the `vX.Y.Z` tag runs the release workflow and the image workflow.

### Docker

The container image runs the production server as uid 1001, user `nerdgram`, with a read-only root filesystem in Compose (#12).

- `compose.yaml` publishes `127.0.0.1:8787:8787` and mounts the named volume `nerdgram-data` at `/data`.
- An empty `/data` is seeded once from the image's `diagrams/` folder. The samples land at `/data/Welcome.mmd`, `/data/NetworkMap.mmd`, and `/data/Examples/Sequence.mmd`. A data directory that already has anything in it is left alone.
- The image tag matches the package version: `ghcr.io/networknerd1337/nerdgram1337:v1.0.5`. The workflow also pushes `:latest` and `sha-<commit>` when the `v1.0.5` tag is pushed. Pull requests do not push.
- CI builds the image and runs a smoke test: health, a write, uid 1001, and a diagram that is still there after a restart.
- The image records the version and the code name. `org.opencontainers.image.version` is the version, `org.opencontainers.image.codename` is the code name, and `NERDGRAM_CODENAME` is set in the container environment. The running app still reads the code name from `package.json`.

### Docs

The README is the install, security, and release-lifecycle guide (#11). Version numbers, the Atlas and Meridian code names, how to pin a release, and the steps to cut a tag are in Versioning and releases.

### Known limitations

- There is no store of templates you save yourself. The gallery is the files in `templates/`.
- The editor preview has theme, look, layout, and Present. It does not zoom. Zoom, pan, and rotate are in presentation.
- On Windows, AltGr is reported as Ctrl+Alt. On a layout where AltGr+G types a character, Ctrl+Alt+G can type that character instead of opening Go to line. Use Go to line in the command palette.
- The first image on GHCR may still be private if the publish workflow cannot mark the package public. Set that package to Public once in the GitHub package settings.
