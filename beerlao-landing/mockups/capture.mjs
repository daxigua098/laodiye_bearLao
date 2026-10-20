import { Browser } from 'file:///C:/Users/Administrator/.codex/skills/design-taste-frontend/scripts/lib/cdp.mjs';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve('beerlao-landing/mockups');
mkdirSync(resolve(root, 'screens'), { recursive: true });
const browser = await Browser.launch({ width: 1440, height: 900 });
const page = await browser.newPage({ width: 1440, height: 900 });
try {
  for (const name of ['v1','v2','v3','v4','v5']) {
    await page.goto(pathToFileURL(resolve(root, `${name}.html`)).href, { settleMs: 1800 });
    await page.screenshot({ path: resolve(root, 'screens', `${name}.jpg`), format: 'jpeg', quality: 90 });
  }
} finally {
  await page.close();
  await browser.close();
}
