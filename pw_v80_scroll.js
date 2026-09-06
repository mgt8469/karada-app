const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const today = new Date().toISOString().slice(0, 10);
  const seed = {
    v7Tip: 1,
    soreness: [{ id: 's1', date: today, parts: ['背中'], muscles: ['lat'], note: '下部に集中してて上部が薄い', level: '普通', suggestion: '## フォームの意識点\n- **肘を体側に**引き寄せる軌道を意識\n- 引き切りで**肩甲骨を下制**したまま1秒キープ' }]
  };
  await page.addInitScript((seedData) => { window.localStorage.setItem('karada_v1', JSON.stringify(seedData)); }, seed);
  await page.goto('http://localhost:8792/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.evaluate(() => { openDetail('からだ', 'kbody', '筋肉痛'); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { document.getElementById('detailSheet').scrollTop = 900; });
  await page.waitForTimeout(200);
  await page.screenshot({ path: '/tmp/v80_sore_history.png' });
  await browser.close();
})();
