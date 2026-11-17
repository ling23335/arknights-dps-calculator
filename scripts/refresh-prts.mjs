import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { parseOperatorWikitext } from '../src/prts-parser.js';

const root = resolve(import.meta.dirname, '..');
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
});

try {
  const page = await browser.newPage();
  await page.goto('https://prts.wiki/id/1', { waitUntil: 'domcontentloaded' });

  const titles = await page.evaluate(async () => {
    const params = new URLSearchParams({
      action: 'query',
      list: 'categorymembers',
      cmtitle: 'Category:干员',
      cmlimit: '500',
      format: 'json',
      formatversion: '2',
    });
    const response = await fetch(`/api.php?${params}`);
    if (!response.ok) throw new Error(`PRTS category request failed: ${response.status}`);
    const data = await response.json();
    return data.query.categorymembers.map((item) => item.title);
  });

  const pages = [];
  for (let index = 0; index < titles.length; index += 25) {
    const batch = titles.slice(index, index + 25);
    const batchPages = await page.evaluate(async (pageTitles) => {
      const params = new URLSearchParams({
        action: 'query',
        prop: 'revisions',
        rvprop: 'content',
        rvslots: 'main',
        titles: pageTitles.join('|'),
        format: 'json',
        formatversion: '2',
      });
      const response = await fetch(`/api.php?${params}`);
      if (!response.ok) throw new Error(`PRTS page request failed: ${response.status}`);
      const data = await response.json();
      return data.query.pages.map((item) => ({
        title: item.title,
        wikitext: item.revisions?.[0]?.slots?.main?.content ?? '',
      }));
    }, batch);
    pages.push(...batchPages);
    process.stdout.write(`\r读取 PRTS：${Math.min(index + 25, titles.length)} / ${titles.length}`);
    await new Promise((done) => setTimeout(done, 120));
  }
  process.stdout.write('\n');

  const byId = new Map();
  const skipped = [];
  for (const item of pages) {
    const operator = parseOperatorWikitext(item.wikitext, item.title);
    if (!operator?.name || !operator.profession) {
      skipped.push(item.title);
      continue;
    }
    byId.set(operator.id, operator);
  }

  const operators = [...byId.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'zh-CN'),
  );
  if (operators.length < 400) {
    throw new Error(
      `Only parsed ${operators.length} operators from ${pages.length} pages; refusing to overwrite reference data.`,
    );
  }

  const snapshot = {
    source: 'https://prts.wiki/w/干员一览',
    fetchedAt: new Date().toISOString(),
    operatorCount: operators.length,
    skippedPages: skipped,
    operators,
  };
  const json = JSON.stringify(snapshot);
  await writeFile(resolve(root, 'data/operators.json'), json, 'utf8');
  await writeFile(
    resolve(root, 'data/operators.js'),
    `window.ARK_OPERATOR_SNAPSHOT=${json};\n`,
    'utf8',
  );

  console.log(`已写入 ${operators.length} 名干员，跳过 ${skipped.length} 个特殊页面。`);
} finally {
  await browser.close();
}
