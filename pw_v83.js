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
        { id: 'i1', name: 'プランク', part: '', memo: '', noWeight: false, timeMode: false, dur: '', done: false, doneTs: null, collapsed: false, target: '', sets: [{ kg: '', reps: '', done: false }] }
      ],
      startTs: Date.now() - 5000, endTs: null, restOn: true, restSec: 60, paused: false, accum: 0, segStart: Date.now() - 5000, hideUndone: true, review: ''
    }
  };
  await page.addInitScript((seedData) => {
    window.localStorage.setItem('karada_v1', JSON.stringify(seedData));
  }, seed);

  await page.goto('http://localhost:8792/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);

  // 1) 修正前：プランクがデフォルトの「kg×回」表示になっている様子（ビフォー確認用）
  await page.screenshot({ path: '/tmp/v83_before_kgrep.png' });

  // 2) 「秒×セットにする」ボタンを押す
  const id = await page.evaluate(() => D.plan.items[0].id);
  await page.evaluate((id) => { toggleTimeMode(id); }, id);
  await page.waitForTimeout(200);
  await page.screenshot({ path: '/tmp/v83_after_timemode.png' });

  // 3) セットを追加して秒数を入力・1セット完了にする
  await page.evaluate((id) => {
    setAdd(id); setAdd(id);
    setField(id, 0, 'sec', 40);
    setField(id, 1, 'sec', 35);
    setField(id, 2, 'sec', 30);
    setDone(id, 0);
  }, id);
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/v83_three_sets_filled.png' });

  console.log('コンソールエラー件数:', consoleErrors.length);
  if (consoleErrors.length) console.log(consoleErrors.slice(0, 15));

  await browser.close();
})();
