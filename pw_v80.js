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
    v7Tip: 1,
    plan: {
      date: today,
      items: [
        { id: 'i1', name: 'ラットプルダウン', part: '', memo: '', noWeight: false, dur: '', done: false, doneTs: null, collapsed: false, target: 'lat', sets: [{ kg: 40, reps: 8, done: true }] },
        { id: 'i2', name: 'ベンチプレス', part: '', memo: '', noWeight: false, dur: '', done: false, doneTs: null, collapsed: false, target: '', sets: [{ kg: 50, reps: 8, done: false }] }
      ],
      startTs: Date.now() - 60000, endTs: null, restOn: true, restSec: 60, paused: false, accum: 0, segStart: Date.now() - 60000, hideUndone: true, review: ''
    },
    soreness: [
      { id: 's1', date: today, parts: ['背中'], muscles: ['lat'], note: '下部に集中してて上部が薄い', level: '普通' }
    ]
  };
  await page.addInitScript((seedData) => {
    window.localStorage.setItem('karada_v1', JSON.stringify(seedData));
  }, seed);

  await page.goto('http://localhost:8792/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);

  // 1) 盤面＝トレ画面（狙う筋チップ・🎯バッジ）
  await page.screenshot({ path: '/tmp/v80_train.png' });

  // 2) 筋肉痛ページ（からだ→筋肉痛）
  await page.evaluate(() => { openDetail('からだ', 'kbody', '筋肉痛'); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/v80_sore.png' });

  // 3) 解剖ページ（🎯今日の狙いバナー）
  await page.evaluate(() => { closeDetail(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { openAnat('ラットプルダウン'); });
  await page.waitForTimeout(500);
  // 3Dモデルは外部通信が必要なので模式図に切り替えて見た目を確認
  await page.evaluate(() => { a3set('mode', 'svg'); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: '/tmp/v80_anat.png', fullPage: true });

  console.log('コンソールエラー件数:', consoleErrors.length);
  if (consoleErrors.length) console.log(consoleErrors.slice(0, 15));

  await browser.close();
})();
