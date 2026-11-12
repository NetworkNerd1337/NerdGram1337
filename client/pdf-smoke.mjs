import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const outDir = '/tmp/nerdgram-exports';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: '/usr/local/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));

await page.goto('http://localhost:5173/edit/Welcome.mmd', { waitUntil: 'networkidle' });
await page.waitForSelector('.preview-stage svg', { timeout: 15000 });
await page.waitForTimeout(800);

// Confirm PDF option exists
const options = await page.locator('select[aria-label="Export format"] option').allTextContents();
console.log('export options:', options);
if (!options.some((o) => o.trim() === 'PDF')) throw new Error('PDF option missing');

const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.getByLabel('Export format').selectOption('pdf'),
]);

const target = path.join(outDir, await download.suggestedFilename());
await download.saveAs(target);
const stat = fs.statSync(target);
const head = fs.readFileSync(target).subarray(0, 5).toString('utf8');
console.log({ file: target, bytes: stat.size, magic: head });
if (!target.endsWith('.pdf')) throw new Error('wrong filename');
if (head !== '%PDF-') throw new Error('not a PDF');
if (stat.size < 200) throw new Error('PDF too small');

// PNG still works
const [pngDownload] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.getByLabel('Export format').selectOption('png'),
]);
const pngPath = path.join(outDir, await pngDownload.suggestedFilename());
await pngDownload.saveAs(pngPath);
console.log('png ok', fs.statSync(pngPath).size);

await browser.close();
console.log('PDF_EXPORT_SMOKE ok');
