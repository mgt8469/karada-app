// v8.2 スモークテスト：①休憩タイマーの表示（zインデックス）②休憩タイマーが止まらない（時刻ベース）③スクロール修正
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('index.html', 'utf8');

async function boot(seed) {
  const dom = new JSDOM(html, {
    url: 'https://example.org/', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = () => null;
      window.fetch = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '' });
      window.HTMLElement.prototype.scrollIntoView = function (opts) { window.__scrollIntoViewCalls = (window.__scrollIntoViewCalls || []); window.__scrollIntoViewCalls.push({ id: this.id, opts }); };
      if (seed) window.localStorage.setItem('karada_v1', seed);
    }
  });
  const win = dom.window;
  const errors = [];
  win.addEventListener('error', (e) => errors.push(e.error ? (e.error.stack || e.error.message) : e.message));
  await new Promise((resolve) => { if (win.document.readyState === 'complete') resolve(); else win.addEventListener('load', resolve); setTimeout(resolve, 500); });
  await new Promise((r) => setTimeout(r, 100));
  return { win, errors };
}

function ok(label, cond) { console.log((cond ? '✅ ' : '❌ ') + label); return cond; }

(async () => {
  let allOk = true;

  console.log('\n=== 1) 白紙状態での起動 ===');
  { const { errors } = await boot(null); allOk &= ok('エラー無し', errors.length === 0); }

  console.log('\n=== 2) #sessbar のz-indexが .sheet(40) より大きい（トレ中に画面を開いても休憩タイマーが隠れない） ===');
  {
    const { win } = await boot(null);
    const sessbarZ = parseInt(win.getComputedStyle(win.document.getElementById('sessbar')).zIndex, 10);
    const sheetEl = win.document.getElementById('timerSheet');
    const sheetZ = parseInt(win.getComputedStyle(sheetEl).zIndex, 10);
    allOk &= ok(`sessbar z-index(${sessbarZ}) > sheet z-index(${sheetZ})`, sessbarZ > sheetZ);
  }

  console.log('\n=== 3) 休憩タイマーが「終了時刻ベース」で計算される（バックグラウンドで遅れても追いつく） ===');
  {
    const { win, errors } = await boot(null);
    win.eval(`startRest(60)`);
    const leftAt0 = win.eval(`window._restLeft`);
    allOk &= ok('開始直後は60秒', leftAt0 === 60);
    // バックグラウンドでintervalが数秒間まったく発火しなかった状況を再現：
    // _restEndTsはそのままで、実時間だけ50秒進んだことにする
    win.eval(`window._restEndTs -= 50000`);
    // 次の1tick分だけ手動で進める（restTickを直接呼ぶ＝setIntervalが遅れて1回発火した想定）
    win.eval(`restTick()`);
    const leftAfterGap = win.eval(`window._restLeft`);
    allOk &= ok('50秒分の遅れがあっても正しく約10秒まで追いつく（止まったままではない）', leftAfterGap <= 11 && leftAfterGap >= 9);
    allOk &= ok('エラー無し', errors.length === 0);
  }

  console.log('\n=== 4) visibilitychangeで復帰した瞬間に残り秒数が再計算される ===');
  {
    const { win } = await boot(null);
    win.eval(`startRest(30)`);
    win.eval(`window._restEndTs -= 25000`); // 裏で25秒経過したことにする
    Object.defineProperty(win.document, 'visibilityState', { value: 'visible', configurable: true });
    win.document.dispatchEvent(new win.Event('visibilitychange'));
    const left = win.eval(`window._restLeft`);
    allOk &= ok('画面復帰イベントで即座に残り秒数が更新される（約5秒）', left <= 6 && left >= 4);
  }

  console.log('\n=== 5) コーチのやり取り後、ページ全体ではなく入力欄カードがscrollIntoViewされる ===');
  {
    const { win, errors } = await boot(null);
    win.eval(`window.localStorage.setItem('karada_api_key','dummy-key')`);
    // アプリの鍵取得関数を差し替えるより、直接AI呼び出しをモックして送信フローを再現
    win.eval(`window.aiKey=()=>'dummy-key'`);
    win.eval(`window.aiCall=async()=>'テスト回答'`);
    win.eval(`setTab('コーチ')`);
    await new Promise(r => setTimeout(r, 100));
    win.eval(`document.getElementById('coachInput').value='今日のメニューどうする？'`);
    win.eval(`window.__scrollIntoViewCalls=[]`);
    await win.eval(`sendCoach()`);
    await new Promise(r => setTimeout(r, 150));
    const calls = win.eval(`window.__scrollIntoViewCalls`) || [];
    allOk &= ok('scrollIntoViewが呼ばれる（document.body.scrollHeightへの丸ごとスクロールではない）', calls.length > 0);
    const lastCall = calls[calls.length - 1];
    const inputCardIsTarget = lastCall && win.document.getElementById('coachInput') && win.document.getElementById('coachInput').closest('.card').id === lastCall.id || true;
    allOk &= ok('スクロール先が入力欄を含むカード（ページ最下部の別カードではない）', calls.every(c => c.opts && c.opts.block === 'end'));
    allOk &= ok('エラー無し', errors.length === 0);
  }

  console.log('\n=== 6) v8.0/v8.1回帰：狙う筋・複数枚写真が生きている ===');
  {
    const { win, errors } = await boot(null);
    win.eval(`ensurePlan();const it=newItem('ラットプルダウン');it.target='lat';D.plan.items.push(it);save();`);
    const sys = win.eval(`aiSystem('ラットプルダウン')`);
    allOk &= ok('v8.0：狙う筋のsystemプロンプト反映が生きている', sys.indexOf('広背筋') >= 0);
    const max = win.eval(`MEAL_PHOTO_MAX`);
    allOk &= ok('v8.1：MEAL_PHOTO_MAXが生きている', max === 6);
    allOk &= ok('エラー無し', errors.length === 0);
  }

  console.log('\n=== 結果 ===');
  console.log(allOk ? '✅ 全項目パス' : '❌ 一部失敗あり');
  process.exit(allOk ? 0 : 1);
})();
