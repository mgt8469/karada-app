const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push('console.error: ' + msg.text()); });

  const today = new Date().toISOString().slice(0, 10);
  const seed = {
    plan: {
      date: today,
      items: [
        { id: 'i1', name: 'ラットプルダウン', part: '', memo: '', noWeight: false, dur: '', done: false, doneTs: null, collapsed: false, target: 'lat', sets: [{ kg: 40, reps: 8, done: false }] }
      ],
      startTs: Date.now() - 30000, endTs: null, restOn: true, restSec: 90, paused: false, accum: 0, segStart: Date.now() - 30000, hideUndone: true, review: ''
    }
  };
  await page.addInitScript((seedData) => {
    window.localStorage.setItem('karada_v1', JSON.stringify(seedData));
  }, seed);

  await page.goto('http://localhost:8792/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);

  // 休憩タイマーを開始
  await page.evaluate(() => { startRest(90); });
  await page.waitForTimeout(300);

  // 1) トレ画面：下に休憩タイマーの固定バーが見える
  await page.screenshot({ path: '/tmp/v82_rest_bar_train.png' });

  // 2) 解剖図（フルスクリーンのsheet）を開いても、休憩タイマーが隠れず前面に見える
  await page.evaluate(() => { openAnat('ラットプルダウン'); });
  await page.waitForTimeout(500);
  await page.evaluate(() => { a3set('mode', 'svg'); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: '/tmp/v82_rest_bar_over_anat.png' });
  await page.evaluate(() => { closeAnat(); });

  // 3) タイマーのシート（ストップウォッチ画面）を開いても、休憩タイマーが隠れず前面に見える
  await page.evaluate(() => { openTimer(); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/v82_rest_bar_over_timer_sheet.png' });
  await page.evaluate(() => { closeTimer(); });

  console.log('コンソールエラー件数:', consoleErrors.length);
  if (consoleErrors.length) console.log(consoleErrors.slice(0, 15));

  await browser.close();
})();
