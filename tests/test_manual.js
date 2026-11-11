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
  // 加號按鈕改成圖示＋文字（審查 2026-10-28：不用全形「＋」當圖示），按鈕名稱是「伴侶」
  for (const w of ['「伴侶」', '評估日期', '管理欄位', '狀態', '雙胞胎', '情感關係', '線旁說明', '生活圈',
                   '生態圖', '拉生態連結', '拖曳', '復原', '儲存', '複製圖片', '匯出 SVG', '不連網路',
                   '自動排版', '移出', '加入', '回到自動位置', '配色', '再試一次', '處理中', '只能住在一個生活圈',
                   'CRPD', 'GW-TW', '僅限公益用途', '不開放商業使用', '出生序']) {
    T.ok(all.includes(w), `有寫到「${w}」`);
  }
  T.ok(!/\.gno/i.test(all), '不再提 GenoPro 檔（使用者 2026-09-21：之後不匯入也不產生 .gno）');
  T.ok(all.includes('個案編號_家系生態圖_建立日期'), '寫到預設檔名的規則（使用者 2026-09-21）');
  const legend = Object.values(GT.manual.LEGEND_DESC).join(''), oldTerms = ['案' + '主', '服務' + '對象'];
  T.ok(oldTerms.every(x => !all.includes(x) && !legend.includes(x)), '用詞統一為「服務使用者」，不用舊用詞（使用者 2026-10-28）');
  T.ok(all.includes('服務使用者'), '使用說明有寫到「服務使用者」');
  T.ok(!/「＋|● 未儲存|按上方「複製圖片」/.test(all), '沒有改版前的按鈕寫法（加號按鈕、圓點未儲存、上方的複製圖片）');
  T.ok(!/[←-⇿]/.test(all), '散文不用箭頭符號');
  const about = GT.manual.MANUAL.find(c => c.key === 'about');
  T.ok(!!about && about.body.includes('身心障礙者權利公約') && about.body.includes('github.com/GW-TW/genogram-tool/issues'), '「關於這個工具」寫了 CRPD 精神與聯絡方式（使用者 2026-10-28）');
  T.eq(GT.manual.ABOUT.crpd, '身心障礙者平等享有人權、自由與尊嚴，尊重自主、不歧視、全面參與、機會均等', 'CRPD 宣言跟使用者其他系統的「開發者資訊」同一句（使用者 2026-10-28）');
  T.ok(GT.manual.render(about.body).includes(GT.manual.ABOUT.crpd) && GT.manual.render(about.body).includes('系統名稱'), '使用說明的「關於這個工具」有作者資訊與宣言');
  T.ok(!/被照顧的人|個案檔/.test(all + Object.values(GT.manual.LEGEND_DESC).join('')), 'CRPD 精神的用語：「接受照顧的人」、「服務使用者的資料」');
});

T.test('使用說明：0.9.0 的新功能都有寫到（2026-11-11）', () => {
  const all = GT.manual.MANUAL.map(c => c.title + c.body).join('\n');
  for (const w of ['移動畫面', '兩指', '收起', '版本更新紀錄', '「手足」「父母」「伴侶」', '男女女', '跟誰的子女',
                   '選取之後的常用動作', '排成一列', '點「其他人」裡的名字', '開新圖', '放棄變更', '刪除欄位與內容',
                   '附圖例', '貼進 Word 之後怎麼改', '轉換為圖形', '組成群組', '四個步驟', '說明欄', '從範本開始', '三代同堂',
                   '只整理一家', '整理子孫', '其他人都不動', '產生文字敘述', '案父、案母', '關係對象', '寫出姓名', '複製這段文字']) {
    T.ok(all.includes(w), `有寫到「${w}」`);
  }
  T.ok(!all.includes('按上方「新增」') && !/上方\*\*：新增、/.test(all), '上方的「新增」已經改叫「開新圖」，說明沒有留舊名稱');
});

T.test('使用說明：第一章是四步的建議畫法（2026-11-11）', () => {
  const first = GT.manual.MANUAL[0], html = GT.manual.render(first.body);
  T.eq(first.key, 'quick', '打開說明先看到建議畫法');
  T.eq((html.match(/<ol>([\s\S]*?)<\/ol>/) || ['', ''])[1].split('<li>').length - 1, 4, '剛好四個步驟');
  T.ok(first.body.length < 900, '第一章要短，一眼看完');
});

T.test('版本更新紀錄：由新到舊、格式完整、寫給使用的人看（設計規範 2026-10-29）', () => {
  const C = GT.manual.CHANGELOG;
  T.ok(Array.isArray(C) && C.length >= 10, '每一版都有一筆');
  T.ok(C.every(c => /^\d+\.\d+\.\d+$/.test(c.v) && /^\d{4}-\d{2}-\d{2}$/.test(c.date) && Array.isArray(c.items) && c.items.length > 0), '每筆都有版本號、日期、至少一個項目');
  T.eq(new Set(C.map(c => c.v)).size, C.length, '版本號不重複');
  const num = (v) => v.split('.').map(Number).reduce((a, n) => a * 1000 + n, 0);
  T.ok(C.every((c, i) => i === 0 || num(C[i - 1].v) > num(c.v)), '版本由新到舊');
  T.ok(C.every((c, i) => i === 0 || C[i - 1].date >= c.date), '日期由新到舊');
  const items = C.flatMap(c => c.items);
  T.ok(items.every(s => s.length >= 8 && s.length <= 120), '每個項目是一兩句話');
  T.ok(items.filter(s => /^(新增|修正|調整)：/.test(s)).length >= items.length - 1, '用「新增：」「修正：」「調整：」開頭（第一版那一筆除外）');
  T.ok(items.every(s => !T.TECH.test(s) && !/[a-z]+\.(js|css|html)|function|householdParts|autoLayout/i.test(s)), '不寫檔名、函式名稱、技術細節');
  T.ok(items.filter(s => s.startsWith('修正：')).every(s => /現在|改/.test(s)), '修正類有寫原本怎樣、現在怎樣');
  T.ok(['案' + '主', '服務' + '對象'].every(x => !items.join('').includes(x)), '不用舊用詞');
});

T.test('使用說明：Markdown 轉換正確，內容一律跳脫', () => {
  const h = GT.manual.render('## 標題\n- 甲\n- 乙\n\n1. 一\n2. 二\n> 注意\n**粗體** 按 [[Ctrl]]\n<img src=x onerror=alert(1)>');
  T.ok(h.includes('<h3>標題</h3>'), '## → 小標題（h3：對話框標題是 h2，審查 2026-10-28 不跳級）');
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

T.test('回歸：圖例的疾病別、成癮類別那幾列也有說明（審查 2026-09-21）', () => {
  const D = GT.manual.LEGEND_DESC;
  T.ok(D['cond:medical'] && D['cond:addiction'], '疾病別與成癮類別都有說明');
  T.ok(GT.CONDITIONS.every(c => D['cond:' + c.kind]), '每一種疾病別、成癮類別都對得到說明');
});
