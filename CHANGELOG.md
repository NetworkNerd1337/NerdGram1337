# Changelog

Release notes for GitHub Releases. The `## X.Y.Z` heading must match the root `package.json` version and the `vX.Y.Z` tag.

## 1.0.0

First public version of NerdGram1337.

The Docker image is `ghcr.io/networknerd1337/nerdgram1337:v1.0.0` (and `:latest`), published when this tag is pushed. Until then, build it from the repo. The container listens on `0.0.0.0` inside, and the host publish is `127.0.0.1:8787:8787`. Diagrams stay in the `nerdgram-data` volume.
