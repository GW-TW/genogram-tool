/* 家系圖工具 — 測試框架
 *
 * 測試公約（本專案版）：
 * 1. 日期用相對值／固定值：年齡相關測試一律明確指定 assessDate，不依賴「今天」。
 * 2. 測試建立的資料不外洩：每組測試用自己的 GT.newDoc()，不共用狀態；改到 GT 全域設定的要還原。
 * 3. 選對象動態找：用函式回傳的 id，不硬編 'p1' 之類的位置。
 * 4. 失敗的第一個動作是定位污染源：期望值合理、實際值像別組的資料 → 往前找；不准直接改期望值。
 * 5. 斷言數要穩定可解釋：非同步一律 await；測試本身拋錯算失敗，不靜默略過。
 * 6. 輸出節流：只印失敗行＋總結行（tools/test.py 會再過濾一次）。
 */
const T = { tests: [], pass: 0, fail: 0, failures: [], cur: '' };
T.test = (name, fn) => T.tests.push({ name, fn });
const show = (v) => { try { return JSON.stringify(v); } catch (e) { return String(v); } };
// 比對用：物件鍵排序後再序列化（鍵的順序不同不算不一樣；陣列順序仍然要一致）
const stable = (v) => JSON.stringify(v, (k, val) => (val && typeof val === 'object' && !Array.isArray(val))
  ? Object.keys(val).sort().reduce((o, key) => { o[key] = val[key]; return o; }, {}) : val);
T.eq = (actual, expected, msg) => {
  if (stable(actual) === stable(expected)) T.pass++;
  else { T.fail++; T.failures.push(`${T.cur}：${msg || ''} 期望 ${show(expected)}，實得 ${show(actual)}`); }
};
T.ok = (v, msg) => {
  if (v) T.pass++;
  else { T.fail++; T.failures.push(`${T.cur}：${msg || '應為真'}`); }
};
T.throws = async (fn, cls, msg) => {
  try { await fn(); T.fail++; T.failures.push(`${T.cur}：${msg || ''} 應該拋出例外但沒有`); }
  catch (e) {
    if (!cls || e instanceof cls) T.pass++;
    else { T.fail++; T.failures.push(`${T.cur}：${msg || ''} 例外類別不對（${e && e.constructor && e.constructor.name}）`); }
  }
};
// 使用者看得到的文字不得含技術細節（鐵律 11 的測試守衛）
T.TECH = /(Error|Exception|undefined|NaN|stack|\.js\b|\.py\b|[A-Za-z]:\\|https?:|<\/?[a-z]+[^>]*>|at \w+ \()/;
T.run = async () => {
  GT.quietLog = true;   // 測試會故意觸發錯誤，不要洗主控台
  for (const t of T.tests) {
    T.cur = t.name;
    try { await t.fn(); }
    catch (e) { T.fail++; T.failures.push(`${t.name}：測試本身拋錯 ${e && (e.stack || e)}`); }
  }
  const out = document.getElementById('out');
  out.textContent = T.failures.map(f => '❌ ' + f).join('\n') + (T.failures.length ? '\n' : '') +
    `測試結果：${T.pass} 通過，${T.fail} 失敗（${T.tests.length} 組）`;
  document.body.dataset.done = '1';
};
