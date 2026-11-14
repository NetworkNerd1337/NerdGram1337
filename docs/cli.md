# nerdgram command

`nerdgram` is the command-line client for NerdGram1337. The npm package name is `nerdgram1337`. The command it installs is `nerdgram`. The app README section [Command-line tool](../README.md#command-line-tool) is the full description. This page is the install and the commands you run against a server that is already up.

## Install

Node.js 20 or newer, and npm 10 or newer.

```bash
npm install -g nerdgram1337
```

```bash
npx nerdgram1337 --help
```

`npm install -g` puts `nerdgram` on your `PATH`. `npx` runs the command without a global install. The package is public.

The install downloads Mermaid and Puppeteer's chrome-headless-shell. Offline `lint` and `render` use them. Commands that only call the API do not launch the shell.

## Use

`NERDGRAM_URL` defaults to `http://127.0.0.1:8787`. `NERDGRAM_TOKEN` is an automation token from Settings. `--url` and `--token` override those. `--json` prints one JSON object. The process exits `1` when the command fails.

```bash
export NERDGRAM_URL=http://127.0.0.1:8787
export NERDGRAM_TOKEN=ng_your_token

nerdgram list
nerdgram search Atlanta
nerdgram get Welcome.mmd -o Welcome.mmd
nerdgram put Notes.mmd ./Notes.mmd
nerdgram export Examples -o ./exported
nerdgram lint Welcome.mmd
nerdgram repair-links
nerdgram repair-links --apply
nerdgram generate --path Campus.mmd --data docs/samples/campus-links.csv
nerdgram refresh Campus.mmd
nerdgram render Welcome.mmd -o Welcome.svg
```

`render` and `lint` of a `.mmd` file on disk do not need a server. `--server` sends `render` to the API instead. Every other command needs the server and a token.

Keep the server on loopback. A token does not make it safe to publish port 8787.
