// v8.0 スモークテスト：③筋肉痛ログの精密化 ＋ ④種目ごとの「狙う筋」
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('index.html', 'utf8');

function mockIndexedDB(win) {
  const store = {};
  win.indexedDB = {
    open: () => {
      const req = {};
      setTimeout(() => {
        const db = {
          transaction: () => ({ objectStore: () => ({
            put: (val) => { store[val.id] = val; const r = {}; setTimeout(() => r.onsuccess && r.onsuccess(), 0); return r; },
            get: (id) => { const r = {}; setTimeout(() => { r.result = store[id]; r.onsuccess && r.onsuccess(); }, 0); return r; },
            getAll: () => { const r = {}; setTimeout(() => { r.result = Object.values(store); r.onsuccess && r.onsuccess(); }, 0); return r; },
            delete: () => { const r = {}; setTimeout(() => r.onsuccess && r.onsuccess(), 0); return r; }
          }) }),
          objectStoreNames: { contains: () => true }, createObjectStore: () => ({})
        };
        req.result = db;
        req.onupgradeneeded && req.onupgradeneeded({ target: req });
        req.onsuccess && req.onsuccess({ target: req });
      }, 0);
      return req;
    }
  };
}

async function boot(seed) {
  // 重要：inline <script> はパース中に同期実行されるので、localStorageの下ごしらえは
  // beforeParse（パース開始前）でやらないと起動時の render() に間に合わない
  const dom = new JSDOM(html, {
    url: 'https://example.org/', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = () => null;
      window.fetch = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '' });
      mockIndexedDB(window);
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

  console.log('\n=== 2) 壊れたデータでの起動 ===');
  { const { errors } = await boot('{not valid json'); allOk &= ok('エラー無し', errors.length === 0); }

  console.log('\n=== 3) v7.9以前の旧データ（soreness/plan itemsにtarget/muscles/noteが無い）との互換性 ===');
  {
    const oldData = {
      soreness: [{ id: 's1', date: '2026-08-01', parts: ['背中'], level: '普通' }], // muscles/note無し
      plan: { date: (new Date()).toISOString().slice(0,10), items: [{ id: 'i1', name: 'ラットプルダウン', memo: '', noWeight: false, sets: [{ kg: 40, reps: 8, done: true }] }], startTs: null, endTs: null } // target無し
    };
    const { win, errors } = await boot(JSON.stringify(oldData));
    allOk &= ok('エラー無し（旧データ起動）', errors.length === 0);
    // ensurePlan後にtargetが''で正規化されているか
    const normalized = win.eval('(function(){ensurePlan();return D.plan.items[0].target;})()');
    allOk &= ok('旧plan itemにtargetが正規化される（""）', normalized === '');
    // vSore()やvKarada()がエラーなく呼べるか（soreness.muscles/noteが無くてもクラッシュしない）
    let soreHtml = '';
    try { soreHtml = win.eval('vSore()'); } catch (e) { console.log('vSore() 例外:', e.message); }
    allOk &= ok('vSore()が例外なく実行できる（旧soreness互換）', !!soreHtml);
    allOk &= ok('旧soreness履歴が表示される', soreHtml.indexOf('背中') >= 0);
  }

  console.log('\n=== 4) 筋肉痛：部位タップ→筋の候補が出る／保存にmuscles・noteが乗る ===');
  {
    const { win, errors } = await boot(null);
    allOk &= ok('エラー無し', errors.length === 0);
    // 筋肉痛の記録カードをDOMに描画（#soreDateなどの実要素をsaveSore()が参照するため）
    win.eval(`document.body.insertAdjacentHTML('beforeend', vSore())`);
    win.eval(`soreTap('背中')`);
    const cands = win.eval(`REGION2MUS['背中']`);
    allOk &= ok('背中のMUS候補が5件', Array.isArray(cands) && cands.length === 5);
    const rowHtml = win.eval(`soreMuscleRow()`);
    allOk &= ok('筋選択の行に広背筋が含まれる', rowHtml.indexOf('広背筋') >= 0);
    win.eval(`toggleSoreMuscle('lat')`);
    const sel = win.eval(`window._soreMuscles`);
    allOk &= ok('筋を選択できる', Array.isArray(sel) && sel.indexOf('lat') >= 0);
    win.eval(`window._soreNote='下部に集中してて上部が薄い'`);
    win.document.getElementById('soreDate') && (win.document.getElementById('soreDate').value = '2026-08-30');
    win.eval(`saveSore()`);
    const saved = win.eval(`D.soreness[D.soreness.length-1]`);
    allOk &= ok('保存されたsorenessにmusclesが乗る', saved && Array.isArray(saved.muscles) && saved.muscles.indexOf('lat') >= 0);
    allOk &= ok('保存されたsorenessにnoteが乗る', saved && saved.note === '下部に集中してて上部が薄い');
    allOk &= ok('保存後に選択状態がリセットされる', (win.eval('window._soreMuscles')||[]).length === 0 && win.eval('window._soreNote') === '');
    // 部位を外すとその部位専用の筋選択も消える（背中を外して二の腕だけ選んだ場合）
    win.eval(`window._soreParts=['背中'];window._soreMuscles=['lat'];soreTap('背中')`); // 背中を外す
    const selAfter = win.eval('window._soreMuscles');
    allOk &= ok('部位を外すと対応する筋選択が消える', Array.isArray(selAfter) && selAfter.length === 0);
  }

  console.log('\n=== 5) 筋肉痛のみ部位だけ（筋は選ばない）でも保存できる（ジムで疲れてる時の使い方） ===');
  {
    const { win } = await boot(null);
    win.eval(`document.body.insertAdjacentHTML('beforeend', vSore())`);
    win.eval(`window._soreParts=['太もも前'];window._soreMuscles=[];window._soreNote=''`);
    win.eval(`saveSore()`);
    const saved = win.eval(`D.soreness[D.soreness.length-1]`);
    allOk &= ok('部位のみで保存できる', saved && saved.parts.indexOf('太もも前') >= 0 && saved.muscles.length === 0);
  }

  console.log('\n=== 6) 次回の改善案（AI提案）：APIキー無しならアラートで止まりエラーにならない ===');
  {
    const { win, errors } = await boot(null);
    win.eval(`document.body.insertAdjacentHTML('beforeend', vSore())`);
    win.eval(`window._soreParts=['背中'];saveSore()`);
    const id = win.eval(`D.soreness[D.soreness.length-1].id`);
    let alertMsg = '';
    win.alert = (m) => { alertMsg = m; };
    win.openSettings = () => {}; // スタブ
    await win.eval(`suggestSoreFix('${id}')`);
    await new Promise(r => setTimeout(r, 50));
    allOk &= ok('APIキー無しでアラートを出して止まる', /APIキー/.test(alertMsg));
    allOk &= ok('例外が外に漏れない', errors.length === 0);
  }

  console.log('\n=== 7) 種目カード：狙う筋のチップが出る／トグルできる ===');
  {
    const { win, errors } = await boot(null);
    win.eval(`ensurePlan();D.plan.items.push(newItem('ラットプルダウン'));save();`);
    const id = win.eval(`D.plan.items[0].id`);
    const cardHtml = win.eval(`exCard(D.plan.items[0],0)`);
    allOk &= ok('狙う筋UIに広背筋が候補として出る', cardHtml.indexOf('広背筋') >= 0);
    win.eval(`setItemTarget('${id}','lat')`);
    const t = win.eval(`D.plan.items[0].target`);
    allOk &= ok('targetがセットされる', t === 'lat');
    // 実際のUIはonclick="setItemTarget(id, x.target===k?'':k)"という形で「同じチップ再クリック→解除」を
    // レンダー時に組み立てている。ここではその式をそのまま再現して検証する
    win.eval(`setItemTarget('${id}', D.plan.items[0].target==='lat'?'':'lat')`);
    const t2 = win.eval(`D.plan.items[0].target`);
    allOk &= ok('同じチップをもう一度押すと解除される', t2 === '');
    allOk &= ok('エラー無し', errors.length === 0);
  }

  console.log('\n=== 8) 未収録の種目名では狙う筋UIが出ない（findExがnull） ===');
  {
    const { win } = await boot(null);
    win.eval(`ensurePlan();D.plan.items.push(newItem('謎のオリジナル種目'));save();`);
    const cardHtml = win.eval(`exCard(D.plan.items[0],0)`);
    allOk &= ok('未収録種目では🎯行が出ない', cardHtml.indexOf('🎯') < 0);
  }

  console.log('\n=== 9) コーチsystemプロンプトに今日の狙いが反映される ===');
  {
    const { win } = await boot(null);
    win.eval(`ensurePlan();const it=newItem('ラットプルダウン');it.target='lat';D.plan.items.push(it);save();`);
    const sys = win.eval(`aiSystem('ラットプルダウン')`);
    allOk &= ok('systemプロンプトに「広背筋」の狙いが載る', sys.indexOf('広背筋') >= 0 && sys.indexOf('今日の狙い') >= 0);
    const sysNoFocus = win.eval(`aiSystem('')`);
    allOk &= ok('フォーカス無しでは今日の狙い行が付かない', sysNoFocus.indexOf('今日の狙い') < 0);
  }

  console.log('\n=== 10) 解剖ページに今日の狙いが反映される ===');
  {
    const { win, errors } = await boot(null);
    win.eval(`ensurePlan();const it=newItem('ラットプルダウン');it.target='lat';D.plan.items.push(it);save();`);
    win.eval(`openAnat('ラットプルダウン')`);
    await new Promise(r => setTimeout(r, 50));
    const sheetHtml = win.document.getElementById('anatSheet').innerHTML;
    allOk &= ok('解剖ページに「今日はここを狙う」バナーが出る', sheetHtml.indexOf('今日はここを狙う') >= 0);
    allOk &= ok('解剖ページの広背筋カードに🎯バッジが付く', sheetHtml.indexOf('🎯 今日の狙い') >= 0);
    allOk &= ok('エラー無し', errors.length === 0);
  }

  console.log('\n=== 11) 既存の食事写真ピッカー（前回の修正）が壊れていないか回帰確認 ===');
  {
    const { win } = await boot(null);
    win.eval(`openNewMeal()`);
    const inputs = [...win.document.querySelectorAll('input[type=file]')];
    allOk &= ok('食事写真inputにcapture属性が無い（前回修正の回帰確認）', inputs.length > 0 && !inputs[0].hasAttribute('capture'));
  }

  console.log('\n=== 結果 ===');
  console.log(allOk ? '✅ 全項目パス' : '❌ 一部失敗あり');
  process.exit(allOk ? 0 : 1);
})();
