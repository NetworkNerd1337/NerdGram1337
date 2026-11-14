# nerdgram1337

`nerdgram` is the command-line client for [NerdGram1337](https://github.com/NetworkNerd1337/NerdGram1337), a local app for [Mermaid](https://mermaid.js.org/) diagrams. The npm package name is `nerdgram1337`. The command it installs is `nerdgram`.

List, search, and edit diagrams on a NerdGram server that is already running. `lint` and `render` of a `.mmd` file that is already on disk do not need the server.

## Install

Node.js 20 or newer, and npm 10 or newer.

```bash
npm install -g nerdgram1337
```

```bash
npx nerdgram1337 --help
```

`npm install -g` puts `nerdgram` on your `PATH`. `npx` runs that command without a global install. The package is public.

The install also downloads Mermaid and Puppeteer's chrome-headless-shell. Offline `lint` uses Mermaid's parser. Offline `render` uses that shell, which is the large part of the download. Commands that only call the API do not launch it.

## Use

`NERDGRAM_URL` defaults to `http://127.0.0.1:8787`. `NERDGRAM_TOKEN` is an automation token from Settings in the app. `--url` and `--token` override those. `--json` prints one JSON object. The process exits `1` when the command fails.

```bash
export NERDGRAM_URL=http://127.0.0.1:8787
export NERDGRAM_TOKEN=ng_your_token

nerdgram --help
nerdgram list
nerdgram search Atlanta
nerdgram get Welcome.mmd -o Welcome.mmd
nerdgram put Notes.mmd ./Notes.mmd
nerdgram lint Welcome.mmd
nerdgram render Welcome.mmd -o Welcome.svg
```

`render` of a local `.mmd` file does not need a server. `--server` sends it to the API instead. `lint` of a local file does not need a server either. `lint` exits `1` when a diagnostic is an error.

The app still has to be reachable for every other command. A token does not make it safe to publish port 8787. The server is a single-user app with no login. Keep it on loopback.

The full command list and the release notes are in the [repository README](https://github.com/NetworkNerd1337/NerdGram1337#command-line-tool).

## License

MIT © Ryan Thomas Huff
