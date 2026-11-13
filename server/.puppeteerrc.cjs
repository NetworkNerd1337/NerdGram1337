/**
 * Download chrome-headless-shell only. Full Chrome is a second ~380 MB
 * browser, and rendering launches the shell (`headless: "shell"`).
 * Firefox is already skipped by Puppeteer's defaults.
 *
 * The cache directory stays Puppeteer's default (or `PUPPETEER_CACHE_DIR`).
 * The image sets that variable to `/opt/puppeteer` before `npm ci`.
 */
module.exports = {
  chrome: { skipDownload: true },
  "chrome-headless-shell": { skipDownload: false },
};
