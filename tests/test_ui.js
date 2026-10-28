/* 家系圖工具 — 介面層守衛（2026-10-28 改版）
 * 圖示：設計規範「不要用 emoji／Unicode 符號當圖示」，介面圖示一律是內嵌的線條 SVG。
 */

T.test('圖示：每個都是 24×24 的線條 SVG，用 currentColor，不含外部資源', () => {
  const names = GT.icons.names;
  T.ok(names.length >= 20, `圖示數量夠用（目前 ${names.length} 個）`);
  for (const n of names) {
    const svg = GT.icons.icon(n);
    T.ok(svg.startsWith('<svg') && svg.includes('viewBox="0 0 24 24"'), `${n}：24×24 的 SVG`);
    T.ok(svg.includes('stroke="currentColor"') && svg.includes('fill="none"'), `${n}：線條、跟著文字顏色`);
    T.ok(!/https?:|<image|url\(/.test(svg), `${n}：沒有外部資源`);
    T.ok(/^[\s\w.,\-M-Za-z]+$/.test(svg.match(/ d="([^"]+)"/)[1]), `${n}：路徑只有座標與指令`);
  }
  T.eq(GT.icons.icon('沒有這個圖示'), '', '不存在的圖示回傳空字串，不會變成破圖');
  T.ok(GT.icons.icon('plus', 16).includes('width="16"'), '可以指定尺寸');
});

T.test('圖示：沒有用 emoji 或符號當圖示（設計規範的「不要」）', () => {
  const all = GT.icons.names.map(n => GT.icons.icon(n)).join('');
  // 常見被拿來當圖示的符號與 emoji 區段
  const bad = /[←-⇿①-⓿■-➿⬀-⯿️]|[\uD83C-\uDBFF][\uDC00-\uDFFF]/;
  T.ok(!bad.test(all), '圖示裡沒有箭頭、方塊、星號這類符號或 emoji');
});

T.test('介面選項不用符號當圖示：流向用線條圖示、選項文字裡沒有箭頭（審查 2026-10-28 L7）', () => {
  for (const t of GT.TIE_DIRS) {
    if (t.icon) T.ok(GT.icons.names.includes(t.icon), `流向「${t.label}」的圖示存在`);
    else T.ok(t.short && !/[←-⇿]/.test(t.short), `流向「${t.label}」用文字`);
  }
  T.eq(GT.TIE_DIRS.filter(t => t.icon).length, 3, '單向兩種、雙向一種用圖示');
  const texts = [GT.TIE_DIRS, GT.TIE_STRENGTHS, GT.GENDERS, GT.LIFE_STATES, GT.CULTURES, GT.ILLNESS, GT.SUBSTANCE, GT.VIEW_MODES]
    .flat().map(t => (t.short || '') + t.label);
  T.ok(texts.every(s => !/[←-⇿✓✔✗●▾▸]/.test(s)), '分段按鈕、單選項的文字都沒有符號');
});

T.test('圖示尺寸：呼叫端給什麼都只會是 8～64 的整數（審查 2026-10-28 L9）', () => {
  T.ok(GT.icons.icon('plus', 'abc').includes('width="20"'), '不是數字：用預設 20');
  T.ok(GT.icons.icon('plus', 1000).includes('width="64"'), '太大：64');
  T.ok(GT.icons.icon('plus', 1).includes('width="8"'), '太小：8');
  T.ok(GT.icons.icon('plus', '"><b>').includes('width="20"') && !GT.icons.icon('plus', '"><b>').includes('<b>'), '塞標籤進來也不會變成屬性');
});
