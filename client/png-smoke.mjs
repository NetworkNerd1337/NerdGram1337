import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
const outDir = '/tmp/nerdgram-exports';
const browser = await chromium.launch({ headless: true, executablePath: '/usr/local/bin/google-chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
await page.goto('http://localhost:5173/edit/Welcome.mmd', { waitUntil: 'networkidle' });
await page.waitForSelector('.preview-stage svg', { timeout: 15000 });
await page.waitForTimeout(500);
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.getByLabel('Export format').selectOption('png'),
]);
const target = path.join(outDir, await download.suggestedFilename());
await download.saveAs(target);
console.log('png', target, fs.statSync(target).size);
await browser.close();
console.log('PNG ok');
