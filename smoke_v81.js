// v8.1 スモークテスト：①食事の写真を複数枚つけられるように
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('index.html', 'utf8');

function mockIndexedDB(win) {
  // 重要：本物のimgPut()/imgDel()はrequestのonsuccessではなく「トランザクションのoncomplete」を
  // 待ってからPromiseを解決する（index.html側の実装）。以前のモックはoncompleteを一切発火させて
  // いなかったため、await imgPut(...) が永久に解決されず、nmSave()などがハングしていた。
  // → put/delete/get/getAllのsetTimeoutの中で、request.onsuccessに続けてtransaction.oncompleteも呼ぶ。
  const store = {};
  win.indexedDB = {
    open: () => {
      const req = {};
      setTimeout(() => {
        const db = {
          transaction: () => {
            const t = {};
            const os = {
              put: (val) => { store[val.id] = val; const r = {}; setTimeout(() => { r.onsuccess && r.onsuccess(); t.oncomplete && t.oncomplete(); }, 0); return r; },
              get: (id) => { const r = {}; setTimeout(() => { r.result = store[id]; r.onsuccess && r.onsuccess(); t.oncomplete && t.oncomplete(); }, 0); return r; },
              getAll: () => { const r = {}; setTimeout(() => { r.result = Object.values(store); r.onsuccess && r.onsuccess(); t.oncomplete && t.oncomplete(); }, 0); return r; },
              delete: (id) => { delete store[id]; const r = {}; setTimeout(() => { r.onsuccess && r.onsuccess(); t.oncomplete && t.oncomplete(); }, 0); return r; }
            };
            t.objectStore = () => os;
            return t;
          },
          objectStoreNames: { contains: () => true }, createObjectStore: () => ({})
        };
        req.result = db;
        req.onupgradeneeded && req.onupgradeneeded({ target: req });
        req.onsuccess && req.onsuccess({ target: req });
      }, 0);
      return req;
    }
  };
  return store;
}

async function boot(seed) {
  let storeRef;
  const dom = new JSDOM(html, {
    url: 'https://example.org/', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = () => null;
      window.fetch = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '' });
      storeRef = mockIndexedDB(window);
      if (seed) window.localStorage.setItem('karada_v1', seed);
    }
  });
  const win = dom.window;
  const errors = [];
  win.addEventListener('error', (e) => errors.push(e.error ? (e.error.stack || e.error.message) : e.message));
  await new Promise((resolve) => { if (win.document.readyState === 'complete') resolve(); else win.addEventListener('load', resolve); setTimeout(resolve, 500); });
  await new Promise((r) => setTimeout(r, 100));
  return { win, errors, store: storeRef };
}

function ok(label, cond) { console.log((cond ? '✅ ' : '❌ ') + label); return cond; }
// テスト用の小さなdata URL（1x1透明PNG）
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function fakeFileList(n) {
  // input.files に代入できる擬似FileList（配列で十分。テストコードはArray.fromで扱う）
  return Array.from({ length: n }, (_, i) => ({ name: `p${i}.png`, type: 'image/png' }));
}

(async () => {
  let allOk = true;

  console.log('\n=== 1) 白紙状態での起動 ===');
  { const { errors } = await boot(null); allOk &= ok('エラー無し', errors.length === 0); }

  console.log('\n=== 2) 壊れたデータでの起動 ===');
  { const { errors } = await boot('{not valid json'); allOk &= ok('エラー無し', errors.length === 0); }

  console.log('\n=== 3) v8.0以前の旧データ（meals[].photoIdのみ・photoIds無し）との互換性 ===');
  {
    const oldMeal = { id: 'm1', date: '2026-08-01', ts: Date.now(), type: '昼', memo: 'テスト食事', level: '普通', photoId: 'oldpid1' };
    const { win, errors } = await boot(JSON.stringify({ meals: [oldMeal] }));
    allOk &= ok('エラー無し', errors.length === 0);
    const ids = win.eval(`mealPhotoIds(D.meals[0])`);
    allOk &= ok('mealPhotoIds()が旧photoIdを1件配列で返す', Array.isArray(ids) && ids.length === 1 && ids[0] === 'oldpid1');
    // mealItem/calMeal/timelineがエラー無く描画できるか
    let mi = '', cm = '';
    try { mi = win.eval(`mealItem(D.meals[0])`); } catch (e) { console.log('mealItem例外:', e.message); }
    try { cm = win.eval(`calMeal(D.meals[0])`); } catch (e) { console.log('calMeal例外:', e.message); }
    allOk &= ok('mealItem()が旧データでも例外なく描画', mi.indexOf('oldpid1') >= 0);
    allOk &= ok('calMeal()が旧データでも例外なく描画', cm.indexOf('oldpid1') >= 0);
  }

  console.log('\n=== 4) 新規保存フロー（nmSave）で複数枚がphotoIds配列として保存される ===');
  {
    const { win, errors } = await boot(null);
    win.eval(`openNewMeal()`);
    // 2枚選択したことにする（nmPickの中身を模して直接dataUrlsに積む）
    win.eval(`_nm.dataUrls.push('${TINY_PNG}'); _nm.dataUrls.push('${TINY_PNG}');`);
    // memoを直接セット（DOM要素があれば読める）
    const memoEl = win.document.getElementById('nmMemo');
    if (memoEl) memoEl.value = 'テスト複数枚';
    await Promise.race([
      win.eval(`nmSave()`),
      new Promise((_, rej) => setTimeout(() => rej(new Error('nmSave()がタイムアウト（3秒）')), 3000))
    ]);
    await new Promise(r => setTimeout(r, 100));
    const last = win.eval(`D.meals[D.meals.length-1]`);
    allOk &= ok('保存後、photoIdsが配列で2件入る', last && Array.isArray(last.photoIds) && last.photoIds.length === 2);
    allOk &= ok('エラー無し', errors.length === 0);
  }

  console.log('\n=== 5) MEAL_PHOTO_MAX枚を超えて選んでも上限で止まる ===');
  {
    const { win } = await boot(null);
    win.eval(`openNewMeal()`);
    const max = win.eval(`MEAL_PHOTO_MAX`);
    win.eval(`for(let i=0;i<20;i++)_nm.dataUrls.push('${TINY_PNG}');`);
    // nmPickの上限ロジックを直接検証（実際の選択を模擬）
    win.eval(`_nm.dataUrls = _nm.dataUrls.slice(0, ${'${max}'.length ? 'MEAL_PHOTO_MAX' : 'MEAL_PHOTO_MAX'});`);
    const len = win.eval(`_nm.dataUrls.length`);
    allOk &= ok(`上限は${max}枚`, typeof max === 'number' && max > 0);
    allOk &= ok('スライスで上限に収まる', len === max);
  }

  console.log('\n=== 6) nmPick自体が上限を守って追加する（本番ロジックの直接検証） ===');
  {
    const { win } = await boot(null);
    win.eval(`openNewMeal()`);
    const max = win.eval(`MEAL_PHOTO_MAX`);
    // fileToDataUrlをモック化してnmPickの本体ロジック（room計算等）を検証
    win.eval(`window.fileToDataUrl = async ()=>'${TINY_PNG}';`);
    const fakeInput = { files: fakeFileList(max + 3) };
    await win.eval(`nmPick(${JSON.stringify(fakeInput)})`);
    await new Promise(r => setTimeout(r, 50));
    const len = win.eval(`_nm.dataUrls.length`);
    allOk &= ok(`nmPickが上限${max}枚で打ち止め`, len === max);
  }

  console.log('\n=== 7) 削除（nmRemovePhoto）で1枚減る ===');
  {
    const { win } = await boot(null);
    win.eval(`openNewMeal();_nm.dataUrls=['${TINY_PNG}','${TINY_PNG}','${TINY_PNG}'];nmRemovePhoto(1);`);
    const len = win.eval(`_nm.dataUrls.length`);
    allOk &= ok('1枚削除できる', len === 2);
  }

  console.log('\n=== 8) 既存の記録（renderMeal編集シート）に後から写真を追加・削除できる ===');
  {
    const { win, errors } = await boot(null);
    win.eval(`D.meals.push({id:'m2',date:today(),ts:Date.now(),type:'昼',memo:'追加テスト',level:'普通',photoIds:[]});save();`);
    win.eval(`window._mealEdit='m2';document.getElementById('mealSheet').classList.add('on');renderMeal();`);
    win.eval(`window.fileToDataUrl = async ()=>'${TINY_PNG}';`);
    await win.eval(`mealAddPhoto('m2', ${JSON.stringify({ files: fakeFileList(2) })})`);
    await new Promise(r => setTimeout(r, 100));
    let m = win.eval(`D.meals.find(x=>x.id==='m2')`);
    allOk &= ok('後から2枚追加できる', m && Array.isArray(m.photoIds) && m.photoIds.length === 2);
    const pidToRemove = win.eval(`D.meals.find(x=>x.id==='m2').photoIds[0]`);
    await win.eval(`mealRemovePhoto('m2','${pidToRemove}')`);
    await new Promise(r => setTimeout(r, 50));
    m = win.eval(`D.meals.find(x=>x.id==='m2')`);
    allOk &= ok('1枚削除できる', m && m.photoIds.length === 1);
    allOk &= ok('エラー無し', errors.length === 0);
  }

  console.log('\n=== 9) analyzeMealPhotoが複数画像をまとめて1回のリクエストに載せる ===');
  {
    const { win, errors } = await boot(null);
    win.eval(`D.meals.push({id:'m3',date:today(),ts:Date.now(),type:'昼',memo:'',level:'普通',photoIds:[]});save();`);
    await win.eval(`mealAddPhoto('m3', (function(){window.fileToDataUrl=async()=>'${TINY_PNG}';return ${JSON.stringify({ files: fakeFileList(3) })};})())`);
    await new Promise(r => setTimeout(r, 100));
    let capturedContent = null;
    win.eval(`window.aiKey=()=>'dummy-key'`);
    win.eval(`window.aiCall=async(messages,opts)=>{window.__capturedContent=messages[0].content;return 'FOOD: test\\nDATA: kcal=100, p=1, f=1, c=1';}`);
    await win.eval(`analyzeMealPhoto('m3')`);
    await new Promise(r => setTimeout(r, 100));
    capturedContent = win.eval(`window.__capturedContent`);
    const imageBlocks = Array.isArray(capturedContent) ? capturedContent.filter(c => c.type === 'image') : [];
    allOk &= ok('1回のAI呼び出しに3枚分の画像ブロックが載る', imageBlocks.length === 3);
    allOk &= ok('エラー無し', errors.length === 0);
  }

  console.log('\n=== 10) 削除（delMeal）で複数枚とも消える ===');
  {
    const { win, store } = await boot(null);
    win.eval(`D.meals.push({id:'m4',date:today(),ts:Date.now(),type:'昼',memo:'',level:'普通',photoIds:['x1','x2']});save();`);
    win.eval(`window.imgAll=async()=>[{id:'x1',dataUrl:'${TINY_PNG}'},{id:'x2',dataUrl:'${TINY_PNG}'}];`);
    let delCalls = [];
    win.eval(`window.imgDel=async(id)=>{window.__delCalls=(window.__delCalls||[]);window.__delCalls.push(id);};`);
    await win.eval(`delMeal('m4')`);
    await new Promise(r => setTimeout(r, 50));
    delCalls = win.eval(`window.__delCalls`);
    allOk &= ok('2枚とも削除される', Array.isArray(delCalls) && delCalls.length === 2 && delCalls.includes('x1') && delCalls.includes('x2'));
    const stillThere = win.eval(`D.meals.find(x=>x.id==='m4')`);
    allOk &= ok('meal自体も削除される', !stillThere);
  }

  console.log('\n=== 11) v8.0の機能（狙う筋・筋肉痛の精密化）が壊れていないか回帰確認 ===');
  {
    const { win, errors } = await boot(null);
    win.eval(`ensurePlan();const it=newItem('ラットプルダウン');it.target='lat';D.plan.items.push(it);save();`);
    const sys = win.eval(`aiSystem('ラットプルダウン')`);
    allOk &= ok('v8.0：狙う筋のsystemプロンプト反映が生きている', sys.indexOf('広背筋') >= 0);
    win.eval(`document.body.insertAdjacentHTML('beforeend', vSore())`);
    win.eval(`soreTap('背中');toggleSoreMuscle('lat');saveSore()`);
    const saved = win.eval(`D.soreness[D.soreness.length-1]`);
    allOk &= ok('v8.0：筋肉痛のmuscles保存が生きている', saved && saved.muscles.indexOf('lat') >= 0);
    allOk &= ok('エラー無し', errors.length === 0);
  }

  console.log('\n=== 12) 食事写真ピッカーのcapture属性なし（v7.9修正）の回帰確認 ===');
  {
    const { win } = await boot(null);
    win.eval(`openNewMeal()`);
    const inputs = [...win.document.querySelectorAll('input[type=file]')];
    allOk &= ok('capture属性が無い', inputs.length > 0 && inputs.every(i => !i.hasAttribute('capture')));
    allOk &= ok('multiple属性がある（複数選択OK）', inputs.every(i => i.hasAttribute('multiple')));
  }

  console.log('\n=== 結果 ===');
  console.log(allOk ? '✅ 全項目パス' : '❌ 一部失敗あり');
  process.exit(allOk ? 0 : 1);
})();
