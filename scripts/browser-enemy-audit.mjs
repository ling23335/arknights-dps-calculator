import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const baseUrl = process.env.ARK_BASE_URL ?? 'http://127.0.0.1:4173';
const outputDir = new URL('../output/playwright/', import.meta.url);
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(error.message));

const profileHp = async () => {
  const text = await page.locator('#stronghold-enemy-profile').innerText();
  const match = text.match(/单体生命\s*([\d,]+)/);
  if (!match) throw new Error(`Missing enemy HP in profile: ${text}`);
  return Number(match[1].replaceAll(',', ''));
};

const assertEqual = (actual, expected, label) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
};

await page.goto(`${baseUrl}/?audit=enemy-modes`, {
  waitUntil: 'networkidle',
});
await page.waitForSelector('#stronghold-mode option', { state: 'attached' });
assertEqual(await page.locator('#stronghold-mode').inputValue(), 'mode_multi_abyss', 'default mode');
assertEqual(await page.locator('#stronghold-round').inputValue(), '14', 'default round');
assertEqual(await profileHp(), 3940000, 'ultimate boss_1 hp');

await page.locator('#stronghold-mode').selectOption('mode_multi_funny');
await page.waitForTimeout(100);
assertEqual(await profileHp(), 283680, 'standard boss_1 hp');
const unavailableCount = await page
  .locator('.covenant-card.mode-unavailable')
  .count();
assertEqual(unavailableCount, 8, 'standard unavailable bonds');

await page.locator('#stronghold-enemy-effect').selectOption('aceffect_enemy_2_2');
await page.waitForTimeout(100);
assertEqual(await profileHp(), 368784, 'standard boss_1 hp with +30% effect');
const killStats = await page.locator('#kill-target-stats').innerText();
if (!killStats.includes('1,475,136')) {
  throw new Error(`Kill calculator did not apply resolved boss HP: ${killStats}`);
}

await page.locator('#stronghold-mode').selectOption('mode_multi_abyss');
await page.locator('#stronghold-round').selectOption('15');
await page.waitForTimeout(100);
const waveSummary = await page.locator('#stronghold-wave-summary').innerText();
if (!waveSummary.includes('11,539,500')) {
  throw new Error(`Round 15 wave summary is missing max HP: ${waveSummary}`);
}

await page.locator('#stronghold-enemy-search').fill('妖怪');
await page.locator('#stronghold-enemy').selectOption('enemy_1005_yokai');
await page.waitForTimeout(100);
const regularHp = await profileHp();
if (!(regularHp > 0)) throw new Error('Regular enemy did not resolve to positive HP');
const regularProfileText = await page
  .locator('#stronghold-enemy-profile')
  .innerText();
const regularDefense = Number(
  regularProfileText
    .match(/防御（物理端）\s*([\d,]+)/)?.[1]
    ?.replaceAll(',', ''),
);
if (!(regularDefense > 0)) {
  throw new Error(`Regular enemy defense did not resolve: ${regularProfileText}`);
}

await page.locator('#reset').click();
await page
  .locator('[data-slot="0"] [data-field="operatorName"]')
  .selectOption('艾雅法拉');
await page.waitForTimeout(150);
const parseDps = async () => {
  const text = await page
    .locator('[data-slot="0"] [data-role="cycle"]')
    .innerText();
  return Number(text.replaceAll(',', '').replace(/[^\d.]/g, ''));
};
const ultimateDps = await parseDps();
await page.locator('#stronghold-mode').selectOption('mode_multi_funny');
await page.waitForTimeout(150);
const standardDps = await parseDps();
if (!(ultimateDps > 0 && standardDps > 0 && ultimateDps !== standardDps)) {
  throw new Error(
    `Difficulty switch did not change DPS: ultimate=${ultimateDps}, standard=${standardDps}`,
  );
}

await page.locator('#reset').click();
await page.locator('#stronghold-mode').selectOption('mode_multi_abyss');
await page.locator('#stronghold-round').selectOption('15');
await page.locator('#stronghold-enemy-search').fill('妖怪');
await page.locator('#stronghold-enemy').selectOption('enemy_1005_yokai');
await page.waitForTimeout(100);

await page.screenshot({
  path: fileURLToPath(new URL('enemy-modes-desktop.png', outputDir)),
  fullPage: true,
});

await page.setViewportSize({ width: 390, height: 1000 });
await page.locator('#enemy-section').scrollIntoViewIfNeeded();
await page.screenshot({
  path: fileURLToPath(new URL('enemy-modes-mobile.png', outputDir)),
  fullPage: false,
});

await browser.close();
if (errors.length) {
  throw new Error(`Browser console errors:\n${errors.join('\n')}`);
}

console.log(
  JSON.stringify(
    {
      defaultBossHp: 3940000,
      standardBossHp: 283680,
      standardBossWithEffectHp: 368784,
      unavailableBondsInStandard: unavailableCount,
      regularHp,
      regularDefense,
      ultimateDps,
      standardDps,
      consoleErrors: errors.length,
    },
    null,
    2,
  ),
);
