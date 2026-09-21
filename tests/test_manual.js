/* 家系圖工具 — 內建使用說明與圖例說明的守衛（BASE 模式 16 §6）
 * 防「改了功能忘了手冊」「手冊是空殼」「新增線條沒寫說明」。
 */

T.test('使用說明：章節完整、內容不是空殼', () => {
  const M = GT.manual.MANUAL;
  T.ok(M.length >= 8, '至少 8 章');
  T.ok(M.every(c => c.key && c.title && c.body && c.body.trim().length > 80), '每一章都有代碼、標題與實際內容');
  T.eq(new Set(M.map(c => c.key)).size, M.length, '章節代碼不重複');
  T.ok(M.map(c => c.body).join('').length > 3000, '全文超過 3000 字');
});

T.test('使用說明：關鍵功能都有寫到（功能改名時這裡會紅）', () => {
  const all = GT.manual.MANUAL.map(c => c.title + c.body).join('\n');
  for (const w of ['＋伴侶', '評估日期', '管理欄位', '狀態', '雙胞胎', '情感關係', '線旁說明', '生活圈',
                   '生態圖', '拉生態連結', '拖曳', '復原', '儲存', '複製圖片', '匯出 SVG', '不連網路']) {
    T.ok(all.includes(w), `有寫到「${w}」`);
  }
  T.ok(!/\.gno/i.test(all), '不再提 GenoPro 檔（使用者 2026-09-21：之後不匯入也不產生 .gno）');
});

T.test('使用說明：Markdown 轉換正確，內容一律跳脫', () => {
  const h = GT.manual.render('## 標題\n- 甲\n- 乙\n\n1. 一\n2. 二\n> 注意\n**粗體** 按 [[Ctrl]]\n<img src=x onerror=alert(1)>');
  T.ok(h.includes('<h4>標題</h4>'), '## → 小標題');
  T.ok(h.includes('<ul><li>甲</li><li>乙</li></ul>'), '- → 項目清單');
  T.ok(h.includes('<ol><li>一</li><li>二</li></ol>'), '1. → 編號清單');
  T.ok(h.includes('<div class="tip">注意</div>'), '> → 提示框');
  T.ok(h.includes('<b>粗體</b>') && h.includes('<kbd>Ctrl</kbd>'), '粗體與按鍵');
  T.ok(!h.includes('<img') && h.includes('&lt;img'), '內容裡的 HTML 會被跳脫，不會變成標籤');
  T.ok(GT.manual.MANUAL.every(c => !GT.manual.render(c.body).includes('<script')), '每一章轉出來都沒有 script');
});

T.test('圖例說明：選單裡的每一種線條、每一種符號都有說明', () => {
  const D = GT.manual.LEGEND_DESC, missing = [];
  for (const t of GT.FAMILY_TYPES.filter(t => t.sheet !== false)) if (!D[t.key]) missing.push('家庭：' + t.label);
  for (const t of GT.EMOTION_TYPES.filter(t => t.sheet !== false)) if (!D[t.key]) missing.push('情感：' + t.label);
  for (const t of GT.TWIN_KINDS) if (!D[t.key]) missing.push('雙胞胎：' + t.label);
  for (const t of GT.CHILD_LINKS) if (!D['child:' + t.key]) missing.push('親子：' + t.label);
  for (const k of ['sym:M', 'sym:F', 'sym:U', 'sym:P', 'sym:index', 'sym:deceased', 'life:pregnancy', 'life:miscarriage',
                   'life:abortion', 'culture:immigration', 'culture:multiple', 'health:illness', 'health:substance',
                   'health:suspected', 'health:both', 'health:illrec', 'health:subrec', 'health:bothrec', 'health:ill-subrec',
                   'health:illrec-sub', 'child:pet', 'eco:system', 'eco:normal', 'eco:strong', 'eco:weak', 'eco:stress',
                   'eco:dir', 'eco:both']) if (!D[k]) missing.push(k);
  T.eq(missing, [], '沒有漏掉說明');
  T.ok(Object.values(D).every(v => typeof v === 'string' && v.length >= 3 && v.length <= 60), '每條說明都是一句話（3～60 字）');
  T.ok(GT.EMOTION_TYPES.filter(t => t.dir).every(t => D[t.key].includes('箭頭')), '有方向的線，說明都有講箭頭指向誰');
});
