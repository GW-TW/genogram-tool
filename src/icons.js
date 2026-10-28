/* 家系圖工具 — icons.js
 * 介面圖示：照 Lucide 的畫法自己描的線條圖（24×24、線寬 2、圓端圓角、只用 currentColor）。
 * 為什麼不是 emoji 或 ✓ ✚ ↶ 這類符號：設計規範「不要用 emoji／Unicode 符號當圖示」。
 * 為什麼不連 Lucide 的檔案：本工具不得連網路（CSP 擋），所以內嵌。
 * 新增圖示：寫一條 24×24 的路徑，名稱用 Lucide 的名字，方便日後對照。
 */
(function (GT) {
  'use strict';

  // 只放介面真的有用到的（審查 2026-10-28：沒用到的圖示也會打包進單一檔案）
  const P = {
    // 編輯
    'undo-2': 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
    'redo-2': 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
    'trash-2': 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6',
    plus: 'M5 12h14M12 5v14',
    'rotate-ccw': 'M3 12a9 9 0 1 0 9-9 9.8 9.8 0 0 0-6.7 2.7L3 8M3 3v5h5',
    // 方向（生態連結、情感關係的流向）
    'arrow-right': 'M5 12h14M12 5l7 7-7 7',
    'arrow-left': 'M19 12H5M12 19l-7-7 7-7',
    'move-horizontal': 'M18 8l4 4-4 4M2 12h20M6 8l-4 4 4 4',
    // 檢視
    'zoom-in': 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3M11 8v6M8 11h6',
    'zoom-out': 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3M8 11h6',
    'chevron-down': 'm6 9 6 6 6-6',
    'chevron-up': 'm18 15-6-6-6 6',
    // 配色
    sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
    monitor: 'M20 3H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1ZM8 21h8M12 17v4',
    // 狀態與提示
    'alert-triangle': 'M10.3 3.8 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01',
    'check-circle': 'M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14.1l-3-3',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 16v-4M12 8h.01',
    x: 'M18 6 6 18M6 6l12 12',
    'lock-keyhole': 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM12 14v3M5 21h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2ZM7 10V7a5 5 0 0 1 10 0v3',
  };

  // 回傳一段 <svg>；name 不存在時回傳空字串（不要讓介面出現破圖）
  function icon(name, size) {
    const d = Object.prototype.hasOwnProperty.call(P, name) ? P[name] : '';
    if (!d) return '';
    const s = Math.max(8, Math.min(64, Math.round(Number(size)) || 20));   // 呼叫端給什麼都只會是 8～64 的整數
    return `<svg class="ico" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
           `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">` +
           `<path d="${d}"/></svg>`;
  }

  GT.icons = { icon, names: Object.keys(P) };
})(globalThis.GT = globalThis.GT || {});
