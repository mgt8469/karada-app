// v8.3 スモークテスト：プランクなど「秒×セット」で記録できる種目モードの追加
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('index.html', 'utf8');

async function boot(seed) {
  const dom = new JSDOM(html, {
    url: 'https://example.org/', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = () => null;
      window.fetch = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '' });
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

  console.log('\n=== 3) 旧データ（timeModeフィールドが無いプラン項目）との互換性 ===');
  {
    const oldData = { plan: { date: (new Date()).toISOString().slice(0, 10), items: [{ id: 'i1', name: 'プランク', memo: '', noWeight: false, sets: [{ kg: '', reps: '', done: false }] }], startTs: null, endTs: null } };
    const { win, errors } = await boot(JSON.stringify(oldData));
    allOk &= ok('エラー無し（旧データ起動）', errors.length === 0);
    const tm = win.eval(`(function(){ensurePlan();return D.plan.items[0].timeMode;})()`);
    allOk &= ok('旧plan itemにtimeModeが正規化される（false）', tm === false);
  }

  console.log('\n=== 4) 秒×セットモードに切り替えると、セットがkg/repsではなくsec形式になる ===');
  {
    const { win, errors } = await boot(null);
    win.eval(`ensurePlan();D.plan.items.push(newItem('プランク'));save();`);
    const id = win.eval(`D.plan.items[0].id`);
    win.eval(`toggleTimeMode('${id}')`);
    const it = win.eval(`D.plan.items[0]`);
    allOk &= ok('timeModeがtrueになる', it.timeMode === true);
    allOk &= ok('noWeightはfalseのまま（排他）', it.noWeight === false);
    allOk &= ok('setsが sec フィールドを持つ形になる', Object.prototype.hasOwnProperty.call(it.sets[0], 'sec'));
    allOk &= ok('kgフィールドは無い（重量UIに戻らない）', !Object.prototype.hasOwnProperty.call(it.sets[0], 'kg'));
    allOk &= ok('エラー無し', errors.length === 0);
  }

  console.log('\n=== 5) カード表示（exCard）に「秒」入力と「セット追加/削除」が出る（kg/回ではない） ===');
  {
    const { win, errors } = await boot(null);
    win.eval(`ensurePlan();D.plan.items.push(newItem('プランク'));save();`);
    const id = win.eval(`D.plan.items[0].id`);
    win.eval(`toggleTimeMode('${id}')`);
    const cardHtml = win.eval(`exCard(D.plan.items[0],0)`);
    allOk &= ok('「秒」の単位表示がある', cardHtml.indexOf('>秒<') >= 0);
    allOk &= ok('「kg」の単位表示は無い', cardHtml.indexOf('>kg<') < 0);
    allOk &= ok('「セット追加」ボタンがある', cardHtml.indexOf('セット追加') >= 0);
    allOk &= ok('エラー無し', errors.length === 0);
  }

  console.log('\n=== 6) セット追加・秒数入力・完了チェックができる（複数セット管理） ===');
  {
    const { win, errors } = await boot(null);
    win.eval(`ensurePlan();D.plan.items.push(newItem('プランク'));save();`);
    const id = win.eval(`D.plan.items[0].id`);
    win.eval(`toggleTimeMode('${id}')`);
    win.eval(`setAdd('${id}')`); win.eval(`setAdd('${id}')`); // 3セットに
    let it = win.eval(`D.plan.items[0]`);
    allOk &= ok('セット追加で3セットになる', it.sets.length === 3);
    win.eval(`setField('${id}',0,'sec','40')`);
    win.eval(`setField('${id}',1,'sec','35')`);
    win.eval(`setField('${id}',2,'sec','30')`);
    win.eval(`setDone('${id}',0)`);
    it = win.eval(`D.plan.items[0]`);
    allOk &= ok('1セット目の秒数が保存される', it.sets[0].sec === 40);
    allOk &= ok('完了チェックできる', it.sets[0].done === true);
    allOk &= ok('休憩タイマーが動き出す（プランクのセット間にも休憩が使える）', win.eval('window._restLeft') > 0);
    win.eval(`setDel('${id}')`);
    it = win.eval(`D.plan.items[0]`);
    allOk &= ok('セット削除で2セットに戻る', it.sets.length === 2);
    allOk &= ok('エラー無し', errors.length === 0);
  }

  console.log('\n=== 7) トレ終了（sessEnd）で履歴に「◯◯秒」として保存される ===');
  {
    const { win, errors } = await boot(null);
    win.eval(`ensurePlan();sessStart();D.plan.items.push(newItem('プランク'));save();`);
    const id = win.eval(`D.plan.items[0].id`);
    win.eval(`toggleTimeMode('${id}')`);
    win.eval(`setField('${id}',0,'sec','45')`);
    win.eval(`setDone('${id}',0)`);
    win.eval(`sessEnd()`);
    const w = win.eval(`D.workouts[D.workouts.length-1]`);
    allOk &= ok('履歴に保存される', !!w && w.name === 'プランク');
    allOk &= ok('セットが「45秒」の形で保存される', w && w.sets[0] && w.sets[0].dur === '45秒');
    allOk &= ok('エラー無し', errors.length === 0);
  }

  console.log('\n=== 8) 総評テキスト（sessSummaryText）がkg/回ではなく秒で出る ===');
  {
    const { win, errors } = await boot(null);
    win.eval(`ensurePlan();sessStart();D.plan.items.push(newItem('プランク'));save();`);
    const id = win.eval(`D.plan.items[0].id`);
    win.eval(`toggleTimeMode('${id}')`);
    win.eval(`setField('${id}',0,'sec','40');setDone('${id}',0)`);
    const summary = win.eval(`sessSummaryText()`);
    allOk &= ok('総評に「秒」が含まれる', summary.indexOf('秒') >= 0);
    allOk &= ok('総評に不正な「-kg」表記が出ない', summary.indexOf('-kg') < 0);
    allOk &= ok('エラー無し', errors.length === 0);
  }

  console.log('\n=== 9) 重量なしモードと秒×セットモードは同時にオンにならない（排他） ===');
  {
    const { win } = await boot(null);
    win.eval(`ensurePlan();D.plan.items.push(newItem('ストレッチ'));save();`);
    const id = win.eval(`D.plan.items[0].id`);
    win.eval(`toggleNoWeight('${id}')`);
    let it = win.eval(`D.plan.items[0]`);
    allOk &= ok('重量なしON', it.noWeight === true);
    win.eval(`toggleTimeMode('${id}')`);
    it = win.eval(`D.plan.items[0]`);
    allOk &= ok('秒×セットにすると重量なしは自動でOFFになる', it.noWeight === false && it.timeMode === true);
  }

  console.log('\n=== 10) v8.0〜v8.2回帰：狙う筋・複数枚写真・休憩タイマーが生きている ===');
  {
    const { win, errors } = await boot(null);
    win.eval(`ensurePlan();const it=newItem('ラットプルダウン');it.target='lat';D.plan.items.push(it);save();`);
    const sys = win.eval(`aiSystem('ラットプルダウン')`);
    allOk &= ok('v8.0：狙う筋のsystemプロンプト反映が生きている', sys.indexOf('広背筋') >= 0);
    allOk &= ok('v8.1：MEAL_PHOTO_MAXが生きている', win.eval('MEAL_PHOTO_MAX') === 6);
    allOk &= ok('v8.2：restTickが生きている', typeof win.eval('restTick') === 'function' || win.eval("typeof restTick") === 'function');
    allOk &= ok('エラー無し', errors.length === 0);
  }

  console.log('\n=== 結果 ===');
  console.log(allOk ? '✅ 全項目パス' : '❌ 一部失敗あり');
  process.exit(allOk ? 0 : 1);
})();
