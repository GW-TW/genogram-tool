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
