const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push('console.error: ' + msg.text()); });

  const today = new Date().toISOString().slice(0, 10);
  const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const seed = {
    meals: [
      { id: 'm1', date: today, ts: Date.now() - 3600000, type: '朝', memo: '複数枚テスト', level: '普通', photoIds: ['p1', 'p2', 'p3'] },
      { id: 'm2', date: today, ts: Date.now() - 7200000, type: '昼', memo: '旧データ（単数写真）', level: '普通', photoId: 'p1' }
    ]
  };
  await page.addInitScript((seedData) => {
    window.localStorage.setItem('karada_v1', JSON.stringify(seedData));
  }, seed);

  await page.goto('http://localhost:8792/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(300);

  // IndexedDBに写真データを仕込む（imgPutを直接呼ぶ）
  await page.evaluate(async (png) => {
    await imgPut({ id: 'p1', kind: 'meal', date: '2026-09-06', dataUrl: png, note: '' });
    await imgPut({ id: 'p2', kind: 'meal', date: '2026-09-06', dataUrl: png, note: '' });
    await imgPut({ id: 'p3', kind: 'meal', date: '2026-09-06', dataUrl: png, note: '' });
  }, TINY_PNG);
  await page.waitForTimeout(200);

  // 1) 新規食事シート：写真未選択時の見た目
  await page.evaluate(() => { openNewMeal(); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/v81_newmeal_empty.png' });

  // 2) 新規食事シート：2枚選択後のサムネ行＋追加タイル
  await page.evaluate((png) => {
    _nm.dataUrls.push(png); _nm.dataUrls.push(png); renderNewMeal();
  }, TINY_PNG);
  await page.waitForTimeout(200);
  await page.screenshot({ path: '/tmp/v81_newmeal_photos.png' });
  await page.evaluate(() => { closeNewMeal(); });

  // 3) 食事編集シート（renderMeal）：既存3枚＋追加タイル＋✕削除ボタン
  await page.evaluate(() => {
    window._mealEdit = 'm1';
    document.getElementById('mealSheet').classList.add('on');
    renderMeal();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/v81_editmeal_multi.png' });
  await page.evaluate(() => { document.getElementById('mealSheet').classList.remove('on'); });

  // 4) カレンダー：日を選ぶと出る一覧で複数枚メールの横並びサムネ表示
  // このアプリは内側のスクロールコンテナで画面が構成されているため、fullPageではなく
  // 対象要素をscrollIntoViewしてからビューポート内で撮影する
  await page.evaluate(() => { openDetail('カレンダー'); });
  await page.waitForTimeout(300);
  await page.evaluate((ds) => { calPick(ds); }, today);
  await page.waitForTimeout(500);
  await page.evaluate(() => { document.getElementById('calDay').scrollIntoView({ block: 'start' }); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: '/tmp/v81_calendar_multi.png' });

  console.log('コンソールエラー件数:', consoleErrors.length);
  if (consoleErrors.length) console.log(consoleErrors.slice(0, 15));

  await browser.close();
})();
