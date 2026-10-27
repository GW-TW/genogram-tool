/* 家系圖工具 — icons.js
 * 介面圖示：照 Lucide 的畫法自己描的線條圖（24×24、線寬 2、圓端圓角、只用 currentColor）。
 * 為什麼不是 emoji 或 ✓ ✚ ↶ 這類符號：設計規範「不要用 emoji／Unicode 符號當圖示」。
 * 為什麼不連 Lucide 的檔案：本工具不得連網路（CSP 擋），所以內嵌。
 * 新增圖示：寫一條 24×24 的路徑，名稱用 Lucide 的名字，方便日後對照。
 */
(function (GT) {
  'use strict';

  const P = {
    // 檔案與編輯
    'file-plus': 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Zm0 0v5h5M12 11v6M9 14h6',
    'folder-open': 'M6 14l1.5-3.5A2 2 0 0 1 9.3 9H21l-2.6 7.6A2 2 0 0 1 16.5 18H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4l2 3h5a2 2 0 0 1 2 2v1',
    save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
    'save-as': 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8l4 4M7 3v5h6M12 21v-5M9.5 18.5 12 16l2.5 2.5',
    copy: 'M9 9h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2zM5 15H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1',
    download: 'M12 3v12M7 10l5 5 5-5M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4',
    'undo-2': 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
    'redo-2': 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
    'trash-2': 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6',
    // 人物與關係
    'user-plus': 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM19 8v6M22 11h-6',
    users: 'M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9.5 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
    heart: 'M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z',
    link: 'M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8',
    'git-merge': 'M6 21V9M6 6.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5ZM18 15.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5ZM6 9a9 9 0 0 0 9 4',
    // 標註與生態圖
    'scan-line': 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10',
    type: 'M4 7V4h16v3M9 20h6M12 4v16',
    'share-2': 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
    // 檢視
    'zoom-in': 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3M11 8v6M8 11h6',
    'zoom-out': 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3M8 11h6',
    maximize: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
    'sliders-horizontal': 'M21 4H9M15 12H3M21 20H11M7 4v0M7 2v4M19 10v4M7 18v4',
    // 說明與主題
    'book-open': 'M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3Z',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
    monitor: 'M20 3H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1ZM8 21h8M12 17v4',
    // 狀態與提示
    'alert-triangle': 'M10.3 3.8 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01',
    'check-circle': 'M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14.1l-3-3',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 16v-4M12 8h.01',
    x: 'M18 6 6 18M6 6l12 12',
    'lock-keyhole': 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM12 14v3M5 21h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2ZM7 10V7a5 5 0 0 1 10 0v3',
    plus: 'M5 12h14M12 5v14',
    'chevron-down': 'm6 9 6 6 6-6',
    'chevron-up': 'm18 15-6-6-6 6',
    'panel-right': 'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2ZM15 3v18',
  };

  // 回傳一段 <svg>；name 不存在時回傳空字串（不要讓介面出現破圖）
  function icon(name, size) {
    const d = Object.prototype.hasOwnProperty.call(P, name) ? P[name] : '';
    if (!d) return '';
    const s = size || 20;
    return `<svg class="ico" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
           `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">` +
           `<path d="${d}"/></svg>`;
  }

  GT.icons = { icon, names: Object.keys(P) };
})(globalThis.GT = globalThis.GT || {});
