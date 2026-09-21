/* core.js 測試：資料模型、日期與年齡、標籤、欄位、編輯指令、復原、正規化、錯誤咽喉 */

const person = (d, over) => { const id = GT.addPerson(d, { gender: 'M', x: 0, y: 0 }); Object.assign(d.persons[id], over || {}); return id; };

T.test('新文件：格式與預設欄位', () => {
  const d = GT.newDoc(new Date(2026, 8, 15));
  T.eq(d.format, 'genogram-tool');
  T.eq(d.version, 3, '存檔格式版本（v3＝加了生態圖）');
  T.eq([d.systems, d.ties].map(x => Object.keys(x).length), [0, 0], '新文件沒有資源與生態連結');
  T.eq(d.settings.view, 'both', '預設顯示模式＝家系圖＋生態圖');
  T.eq(d.meta.assessDate, '2026-09-15', '評估日期預設＝建立當天');
  T.eq(d.settings.fields.map(f => f.label), ['職業', '經濟', '教育程度', '健康狀況', '備註']);
  T.eq(d.settings.fields.filter(f => f.show).map(f => f.key), ['occupation', 'economy'], '預設顯示職業與經濟');
});

T.test('日期解析：西元、民國、各種分隔', () => {
  T.eq(GT.parseDate('1965'), { y: 1965, m: null, d: null });
  T.eq(GT.parseDate('1965-03'), { y: 1965, m: 3, d: null });
  T.eq(GT.parseDate('1965-03-08'), { y: 1965, m: 3, d: 8 });
  T.eq(GT.parseDate('1965/3/8'), { y: 1965, m: 3, d: 8 });
  T.eq(GT.parseDate('1965.3.8'), { y: 1965, m: 3, d: 8 });
  T.eq(GT.parseDate('民國54年3月8日'), { y: 1965, m: 3, d: 8 });
  T.eq(GT.parseDate('民54'), { y: 1965, m: null, d: null });
  T.eq(GT.parseDate('54/3/8'), { y: 1965, m: 3, d: 8 }, '三位數以下年份視為民國');
  T.eq(GT.parseDate(''), null);
  T.eq(GT.parseDate('不知道'), null);
  T.eq(GT.parseDate('1965-13-01'), null, '月份超出範圍');
  T.eq(GT.formatDate({ y: 1965, m: 3, d: 8 }), '1965-03-08');
  T.eq(GT.formatDate({ y: 1965, m: 3, d: null }), '1965-03');
});

T.test('年齡：以評估日期計算，不是今天（回歸守衛）', () => {
  const d = GT.newDoc();
  const id = person(d, { birth: '1980-06-15' });
  d.meta.assessDate = '2026-06-14';
  T.eq(GT.ageOf(d, d.persons[id]).value, 45, '生日前一天');
  d.meta.assessDate = '2026-06-15';
  T.eq(GT.ageOf(d, d.persons[id]).value, 46, '生日當天');
  d.meta.assessDate = '2020-01-01';
  T.eq(GT.ageOf(d, d.persons[id]).value, 39, '舊檔的評估日期 → 年齡停在當時，不隨今天變老');
  T.eq(GT.ageOf(d, d.persons[id]).source, 'birth');
});

T.test('年齡：手填、只有年份、已歿、未知', () => {
  const d = GT.newDoc();
  d.meta.assessDate = '2026-01-01';
  const a = person(d, { age: '45' });
  T.eq(GT.ageOf(d, d.persons[a]), { value: 45, source: 'manual' });
  const b = person(d, { birth: '1980' });
  const rb = GT.ageOf(d, d.persons[b]);
  T.eq(rb.value, 46); T.ok(rb.approx, '只有年份 → 標記可能差一歲');
  const c = person(d, { deceased: true, deathAge: '70', birth: '1900' });
  T.eq(GT.ageOf(d, d.persons[c]).value, 70, '手填的過世年齡優先');
  const e = person(d, { deceased: true, birth: '1940-05-01', death: '2010-04-30' });
  T.eq(GT.ageOf(d, d.persons[e]).value, 69, '出生到死亡日期');
  const f = person(d, { deceased: true, age: '80' });
  T.eq(GT.ageOf(d, d.persons[f]).value, 80, '已歿但只填了年齡');
  const g = person(d, {});
  T.eq(GT.ageOf(d, d.persons[g]).value, null);
  const h = person(d, { birth: '2030', age: '5' });
  T.eq(GT.ageOf(d, d.persons[h]).value, 5, '出生日期晚於評估日期 → 退回手填年齡');
  const i = person(d, { age: '999' });
  T.eq(GT.ageOf(d, d.persons[i]).value, null, '不合理的年齡不顯示');
});

T.test('換行：依字寬估算', () => {
  T.eq(GT.wrapText('王大明', 8), ['王大明']);
  const w = GT.wrapText('abcdefghijklmnopqrstuvwxyz', 8);
  T.ok(w.length >= 2, '英文長字串會換行');
  T.ok(w.every(l => GT.textEm(l) <= 8), '每行不超過寬度');
  T.eq(GT.wrapText('第一行\n第二行', 8), ['第一行', '第二行']);
  T.eq(GT.wrapText('一二三四五六七八九十', 8), ['一二三四五六七八', '九十']);
});

T.test('圖上標籤：顯示勾選的欄位、跳過空白', () => {
  const d = GT.newDoc();
  const id = person(d, { name: '王大明', attrs: { occupation: '工人', economy: '低收入戶', education: '國中', health: '  ' } });
  const lines = GT.labelLines(d, d.persons[id]);
  T.eq(lines.map(l => l.text), ['王大明', '工人', '低收入戶'], '教育程度未勾選不顯示、空白不顯示');
  T.eq(lines[0].kind, 'name');
  d.settings.labelMode = 'labelled';
  T.eq(GT.labelLines(d, d.persons[id]).map(l => l.text), ['王大明', '職業：工人', '經濟：低收入戶']);
  d.settings.fields.find(f => f.key === 'education').show = true;
  T.ok(GT.labelLines(d, d.persons[id]).some(l => l.text === '教育程度：國中'), '勾選後立即出現');
});

T.test('圖上標籤：生卒年', () => {
  const d = GT.newDoc();
  d.settings.showYears = true;
  const a = person(d, { birth: '1950-01-01' });
  T.ok(GT.labelLines(d, d.persons[a]).some(l => l.text === '1950–'), '在世：出生年–');
  const b = person(d, { birth: '1950', deceased: true, death: '2019-03' });
  T.ok(GT.labelLines(d, d.persons[b]).some(l => l.text === '1950–2019'), '已歿：出生年–死亡年');
});

T.test('欄位提示：預設值 ∪ 本檔用過的值（模式 9）', () => {
  const d = GT.newDoc();
  person(d, { attrs: { economy: '身障補助' } });
  person(d, { attrs: { economy: '身障補助' } });
  const s = GT.suggestionsFor(d, 'economy');
  T.ok(s.includes('低收入戶') && s.includes('身障補助'), '兩種來源都在');
  T.eq(s.filter(x => x === '身障補助').length, 1, '去重');
});

T.test('欄位管理：新增、改名不動資料、刪除、排序', () => {
  const d = GT.newDoc();
  const key = GT.addField(d, '宗教');
  T.ok(key && d.settings.fields.some(f => f.key === key && f.show), '新增的欄位預設顯示');
  T.eq(GT.addField(d, '宗教'), null, '同名不能重複');
  T.eq(GT.addField(d, '   '), null, '空白不行');
  const id = person(d, { attrs: { [key]: '佛教' } });
  T.ok(GT.renameField(d, key, '信仰'), '改名成功');
  T.eq(d.persons[id].attrs[key], '佛教', '改名後資料還在（key 不變）');
  T.eq(GT.renameField(d, key, '職業'), false, '不能改成已存在的名稱');
  T.eq(GT.fieldUsage(d, key), 1);
  T.ok(GT.moveField(d, key, -1), '可以上移');
  T.eq(GT.moveField(d, d.settings.fields[0].key, -1), false, '第一個不能再上移');
  T.ok(GT.removeField(d, key), '刪除');
  T.eq(d.persons[id].attrs[key], undefined, '刪除欄位連同資料');
  const k2 = GT.addField(d, '居住地');
  T.ok(k2 !== key, '新欄位不會重用舊 key');
});

T.test('新增伴侶：異性、同一列、右邊', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  const r = GT.addPartner(d, a);
  const b = d.persons[r.personId];
  T.eq(b.gender, 'F');
  T.eq(b.y, d.persons[a].y);
  T.ok(b.x > d.persons[a].x, '在右邊');
  T.eq(d.unions[r.unionId].partners, [a, r.personId]);
  const u = GT.addPerson(d, { gender: 'U', x: 500, y: 0 });
  T.eq(d.persons[GT.addPartner(d, u).personId].gender, 'U');
  // 回歸：第二段伴侶原本也放右邊，兩條伴侶線疊在一起，看起來像三個人共同生子女
  const second = GT.addPartner(d, a);
  T.ok(d.persons[second.personId].x < d.persons[a].x, '右邊已有伴侶 → 第二位放左邊');
  const third = GT.addPartner(d, a);
  T.ok(d.persons[third.personId], '兩邊都有人時仍可新增（放到空位）');
});

T.test('新增伴侶：旁邊被手足佔住就放另一側（回歸）', () => {
  const d = GT.newDoc();
  const c = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  const par = GT.addParents(d, c);
  const sis = GT.addSibling(d, c, 'F').personId;
  T.ok(d.persons[sis].x > d.persons[c].x, '妹妹在右邊');
  const r = GT.addPartner(d, c);
  T.ok(d.persons[r.personId].x < d.persons[c].x, '太太放左邊，伴侶線不會從妹妹底下穿過');
  T.ok(par.unionId, '父母存在');
});

T.test('新增子女：在下一代、依序往右', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  const { unionId } = GT.addPartner(d, a);
  const c1 = GT.addChild(d, unionId, 'M');
  const c2 = GT.addChild(d, unionId, 'F');
  T.eq(d.persons[c1].y, GT.GAP_Y);
  T.ok(d.persons[c2].x > d.persons[c1].x, '第二個孩子在右邊');
  T.eq(d.unions[unionId].children, [{ id: c1, link: 'bio' }, { id: c2, link: 'bio' }]);
});

T.test('對人加子女：單親、多段關係要先選', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'F', x: 0, y: 0 });
  const r = GT.addChildToPerson(d, a, 'M');
  T.eq(d.unions[r.unionId].partners, [a], '沒有伴侶 → 單親家庭');
  GT.addPartner(d, a);
  const b = GT.addPerson(d, { gender: 'M', x: -300, y: 0 });
  GT.linkPartners(d, a, b);
  T.ok(GT.addChildToPerson(d, a, 'F').needUnion, '多段關係 → 要使用者先選伴侶線');
});

T.test('新增父母與手足', () => {
  const d = GT.newDoc();
  const c = GT.addPerson(d, { gender: 'F', x: 0, y: 0 });
  T.ok(GT.addSibling(d, c, 'M').needParents, '沒有父母時不能直接加手足');
  const r = GT.addParents(d, c);
  T.eq(d.persons[r.fatherId].gender, 'M');
  T.eq(d.persons[r.motherId].gender, 'F');
  T.eq(d.persons[r.fatherId].y, -GT.GAP_Y, '父母在上一代');
  T.eq(d.unions[r.unionId].children.map(x => x.id), [c]);
  T.ok(GT.addParents(d, c).exists, '不能重複加父母');
  const s = GT.addSibling(d, c, 'M');
  T.eq(s.unionId, r.unionId, '手足掛在同一對父母下');
});

T.test('設為子女、連結伴侶', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  const b = GT.addPerson(d, { gender: 'F', x: 200, y: 0 });
  const u1 = GT.linkPartners(d, a, b);
  T.eq(GT.linkPartners(d, b, a), u1, '同一對不重複建立');
  T.eq(GT.linkPartners(d, a, a), null, '不能跟自己連');
  const k = GT.addPerson(d, { gender: 'M', x: 100, y: 200 });
  T.ok(GT.attachChild(d, u1, k), '設為子女');
  T.eq(GT.parentUnionOf(d, k).id, u1);
  T.eq(GT.attachChild(d, u1, a), false, '伴侶本人不能設為自己關係的子女');
  const c = GT.addPerson(d, { gender: 'F', x: 600, y: 0 });
  const u2 = GT.linkPartners(d, a, c);
  GT.attachChild(d, u2, k);
  T.eq(d.unions[u1].children.length, 0, '換到新關係後從舊關係移除');
  T.eq(d.unions[u2].children.map(x => x.id), [k]);
});

T.test('刪除：連鎖清理關係、情感線、生活圈', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  const { personId: b, unionId: u } = GT.addPartner(d, a);
  const c = GT.addChild(d, u, 'F');
  const r = GT.addRelation(d, a, c, 'Discord');
  const h = GT.addHousehold(d, [a, b, c]);
  GT.deleteItems(d, [a]);
  T.ok(d.unions[u], '刪掉一位伴侶，還有子女 → 關係保留成單親');
  T.eq(d.unions[u].partners, [b]);
  T.eq(d.relations[r], undefined, '情感線跟著刪');
  T.eq(d.households[h].members, [b, c], '生活圈移除該成員');
  GT.deleteItems(d, [b]);
  T.eq(d.unions[u], undefined, '沒有伴侶 → 關係刪除');
  T.ok(d.persons[c], '子女本人保留');
  GT.deleteItems(d, [c]);
  T.eq(d.households[h], undefined, '沒有成員 → 生活圈刪除');
  const x = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  const y = GT.addPartner(d, x);
  GT.deleteItems(d, [y.personId]);
  T.eq(d.unions[y.unionId], undefined, '只剩一人且沒有子女 → 關係刪除');
});

T.test('復原／重做', () => {
  const h = new GT.History(3);
  const d = GT.newDoc();
  h.push(d);
  const id = GT.addPerson(d, { gender: 'F' });
  const back = h.undo(d);
  T.eq(Object.keys(back.persons).length, 0, '復原到新增前');
  const fwd = h.redo(back);
  T.ok(fwd.persons[id], '重做回來');
  h.push(fwd); h.push(fwd); h.push(fwd); h.push(fwd);
  T.eq(h.undoStack.length, 3, '上限 3 步');
  T.eq(h.canRedo, false, '新動作會清掉重做');
});

T.test('正規化：拒絕非本工具檔案', async () => {
  await T.throws(() => GT.normalizeDoc(null), GT.FormatError, 'null');
  await T.throws(() => GT.normalizeDoc({ format: 'other' }), GT.FormatError, '別的格式');
  await T.throws(() => GT.normalizeDoc({ format: 'genogram-tool', version: 99 }), GT.FormatError, '未來版本');
});

T.test('正規化：清掉壞資料、不丟未知欄位、防原型污染', () => {
  const raw = JSON.parse(`{
    "format":"genogram-tool","version":1,"meta":{"title":"t","assessDate":"2026-01-01"},
    "settings":{"fields":[{"key":"occupation","label":"職業","show":true}],"labelMode":"weird"},
    "persons":{
      "p1":{"id":"p1","gender":"X","x":"12","y":null,"name":"${'長'.repeat(80)}","attrs":{"occupation":"工","宗教":"道教","__proto__":{"polluted":1}}},
      "p2":{"id":"p2","gender":"F","x":100,"y":0},
      "bad id!":{"id":"bad id!","gender":"M"}
    },
    "unions":{
      "u1":{"id":"u1","partners":["p1","p2","p2","ghost"],"children":[{"id":"p1"},{"id":"ghost"}],"type":"??","end":"??"},
      "u2":{"id":"u2","partners":["ghost"]}
    },
    "relations":{"r1":{"id":"r1","a":"p1","b":"ghost","type":"close"},"r2":{"id":"r2","a":"p1","b":"p2","type":"??"}},
    "households":{"h1":{"id":"h1","members":["ghost"]}},
    "labels":{"t1":{"id":"t1","x":1,"y":2,"text":"說明"}},
    "seq":1
  }`);
  const { doc, warnings } = GT.normalizeDoc(raw);
  T.eq(Object.keys(doc.persons).sort(), ['p1', 'p2'], '不合法 id 略過');
  T.eq(doc.persons.p1.gender, 'U', '不認得的性別 → 未知性別');
  T.eq(doc.persons.p1.x, 12); T.eq(doc.persons.p1.y, 0);
  T.eq(doc.persons.p1.name.length, 60, '姓名截斷 60 字');
  T.eq(doc.persons.p1.attrs['宗教'], '道教', '欄位表沒有的資料不丟');
  T.ok(doc.settings.fields.some(f => f.key === '宗教' && !f.show), '自動補進欄位表、預設不顯示');
  T.eq(({}).polluted, undefined, '沒有原型污染');
  T.eq(doc.unions.u1.partners, ['p1', 'p2'], '伴侶去重、去掉不存在的人');
  T.eq(doc.unions.u1.children, [], '伴侶不能同時是子女、不存在的子女去掉');
  T.eq(doc.unions.u1.type, 'Marriage', 'v1 不認得的類型 → 結婚'); T.eq(doc.unions.u1.twins, [], 'v1 檔沒有雙胞胎資料');
  T.eq(doc.unions.u2, undefined, '沒有有效伴侶的關係略過');
  T.eq(doc.relations.r1, undefined, '端點不存在的情感線略過');
  T.eq(doc.relations.r2.type, 'Other');
  T.eq(doc.households.h1, undefined);
  T.eq(doc.settings.labelMode, 'value');
  T.ok(warnings.length >= 4, '有回報略過的筆數');
  const nid = GT.addPerson(doc, { gender: 'M' });
  T.ok(!['p1', 'p2', 'u1', 'r2', 't1'].includes(nid), '流水號不會撞到既有 id');
});

T.test('正規化：id 用 __proto__／constructor 會被拒絕，集合原型不被換掉（回歸：驗收 #1）', () => {
  const bad = ['__proto__', 'constructor', 'prototype'];
  const raw = { format: 'genogram-tool', version: 1, persons: {}, unions: {}, relations: {}, households: {}, labels: {} };
  bad.forEach((id, i) => { raw.persons['k' + i] = { id, gender: 'M', x: i * 100, y: 0, name: '壞' + i }; });
  raw.persons.ok = { id: 'p1', gender: 'F', x: 0, y: 0, name: '好' };
  raw.unions.u = { id: '__proto__', partners: ['p1'], children: [] };
  raw.labels.t = { id: 'constructor', x: 0, y: 0, text: 'x' };
  const { doc, warnings } = GT.normalizeDoc(JSON.parse(JSON.stringify(raw)));
  T.eq(Object.keys(doc.persons), ['p1'], '只留合法 id');
  T.eq(Object.getPrototypeOf(doc.persons), Object.prototype, 'persons 的原型沒被換掉');
  T.eq(Object.keys(doc.unions).length + Object.keys(doc.labels).length, 0, '關係與文字的壞 id 也擋下');
  T.ok(warnings.length >= 5, '有回報略過');
});

T.test('已歿但只知出生日期：不顯示年齡（不拿評估日期去猜）', () => {
  // 設計決定：已歿者符號中的數字＝過世時年齡。只知出生日期時若用評估日期計算，
  // 1950 年生、1990 年過世的人會被畫成 76 歲——那是錯的。介面會提示補死亡日期或過世年齡。
  const d = GT.newDoc();
  d.meta.assessDate = '2026-01-01';
  const id = person(d, { birth: '1950-01-01' });
  T.eq(GT.ageOf(d, d.persons[id]).value, 76, '在世：依評估日期計算');
  d.persons[id].deceased = true;
  T.eq(GT.ageOf(d, d.persons[id]).value, null, '已歿且沒有死亡資訊：不顯示');
  d.persons[id].death = '1990-06-01';
  T.eq(GT.ageOf(d, d.persons[id]).value, 40, '補上死亡日期就顯示過世時年齡');
});

T.test('存檔再開：內容一致', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  d.persons[a].name = '王大明'; d.persons[a].attrs.economy = '低收入戶'; d.persons[a].index = true;
  const { personId: b, unionId: u } = GT.addPartner(d, a);
  d.unions[u].type = 'Divorce';
  const c = GT.addChild(d, u, 'F');
  const c2 = GT.addChild(d, u, 'M');
  d.unions[u].children[0].link = 'adopted';
  GT.setTwins(d, u, [c, c2], 'Identical');
  Object.assign(d.persons[c], { life: '', culture: 'immigration', illness: 'recovery', substance: 'suspected', conditions: ['Cancer', 'Alcoholism'] });
  d.persons[b].gender = 'P';
  GT.addRelation(d, a, c, 'AbuseSexual');
  GT.addRelation(d, b, c, 'Caretaker');
  GT.addHousehold(d, [b, c], '同住');
  GT.addLabel(d, 10, 10, '備註');
  GT.addField(d, '宗教');
  const back = GT.normalizeDoc(JSON.parse(GT.serialize(d))).doc;
  for (const k of ['persons', 'unions', 'relations', 'households', 'labels', 'settings', 'meta'])
    T.eq(back[k], d[k], `${k} 往返一致`);
  T.eq(back.seq, d.seq);
});

T.test('錯誤咽喉：只給狀態＋下一步＋代碼', () => {
  const secret = new Error('secret C:\\Users\\x\\app.js line 3 undefined');
  const r = GT.fail('SAVE', secret);
  T.ok(/^SAVE-[0-9A-F]{4}$/.test(r.ref), '代碼格式');
  T.ok(r.message.includes(r.ref), '訊息附代碼');
  T.ok(!r.message.includes('secret') && !T.TECH.test(r.message), '訊息不含技術細節');
  T.ok(GT.log[GT.log.length - 1].detail.includes('secret'), '細節只進記錄');
  T.ok(GT.fail('沒有這個碼', null).ref.startsWith('UNEXPECTED-'), '未知代碼 → UNEXPECTED');
  for (const [k, m] of Object.entries(GT.MESSAGES)) T.ok(!T.TECH.test(m), `文案 ${k} 不含技術字眼`);
});

/* ── v2（2026-09-18）：照 GenoPro 符號表補齊類型、人物標示、雙胞胎 ── */

T.test('類型表：參考圖 20 種家庭關係、36 種情感關係，分類齊全', () => {
  T.eq(GT.FAMILY_TYPES.filter(t => t.sheet !== false).length, 20, '參考圖家庭關係 20 種');
  T.eq(GT.EMOTION_TYPES.filter(t => t.sheet !== false && t.key !== 'Caretaker').length, 36, '參考圖情感關係 36 種');
  T.ok(GT.FAMILY_TYPES.every(t => GT.FAMILY_CATS.some(c => c.key === t.cat)), '每種家庭關係都有分類');
  T.ok(GT.EMOTION_TYPES.every(t => GT.EMOTION_CATS.some(c => c.key === t.cat)), '每種情感關係都有分類');
  T.ok(GT.EMOTION_TYPES.filter(t => t.dir).every(t => ['abuse', 'control', 'other'].includes(t.cat)), '有方向的只在虐待／控制與關注／一般');
  T.eq(new Set(GT.FAMILY_TYPES.map(t => t.label)).size, GT.FAMILY_TYPES.length, '家庭關係名稱不重複');
  T.eq(new Set(GT.EMOTION_TYPES.map(t => t.label)).size, GT.EMOTION_TYPES.length, '情感關係名稱不重複');
  T.eq(GT.CONDITIONS.length, 15, '參考圖右欄 15 種成癮／疾病顏色');
});

T.test('舊檔（v1）自動轉換成 GenoPro 代碼', () => {
  const raw = { format: 'genogram-tool', version: 1,
    persons: { a: { id: 'p1', gender: 'M' }, b: { id: 'p2', gender: 'F' }, c: { id: 'p3', gender: 'F' }, d: { id: 'p4', gender: 'M' } },
    unions: {
      u1: { id: 'u1', partners: ['p1', 'p2'], type: 'married', end: 'divorced', children: [] },
      u2: { id: 'u2', partners: ['p1', 'p3'], type: 'cohabit', end: 'separated', children: [] },
      u3: { id: 'u3', partners: ['p2', 'p4'], type: 'married', end: '', gp: 'Widowed', children: [] },
      u4: { id: 'u4', partners: ['p3', 'p4'], type: 'affair', end: '', children: [] },
    },
    relations: {
      r1: { id: 'r1', a: 'p1', b: 'p2', type: 'plain' },
      r2: { id: 'r2', a: 'p1', b: 'p3', type: 'closeConflict' },
      r3: { id: 'r3', a: 'p2', b: 'p3', type: 'deteriorating', note: '最近' },
      r4: { id: 'r4', a: 'p1', b: 'p4', type: 'abuse', gp: 'AbuseSexual' },
    } };
  const { doc } = GT.normalizeDoc(raw);
  T.eq(doc.version, 3, '舊檔轉成目前版本');
  T.eq(['u1', 'u2', 'u3', 'u4'].map(k => doc.unions[k].type), ['Divorce', 'CohabitationAndSeparation', 'Widowed', 'CasualRelationship'],
       '類型＋狀態兩欄 → 單一代碼；有 GenoPro 原值就用原值');
  T.eq(doc.unions.u1.end, undefined, '舊的「狀態」欄位不再保留');
  T.eq(['r1', 'r2', 'r4'].map(k => doc.relations[k].type), ['Harmony', 'HostileClose', 'AbuseSexual']);
  T.eq([doc.relations.r3.type, doc.relations.r3.note], ['Discord', '原類型：關係惡化；最近'], '關係惡化（參考圖沒有）→ 不和／衝突，原類型寫進備註');
  T.eq(doc.persons.p1.conditions, [], 'v1 人物補上 v2 新欄位的預設值');
});

T.test('v2 人物欄位：不認得的值回到預設、疾病清單去重', () => {
  const raw = { format: 'genogram-tool', version: 2, persons: {
    a: { id: 'p1', gender: 'P', life: 'pregnancy', culture: 'multiple', illness: 'recovery', substance: 'suspected',
         conditions: ['Cancer', 'Cancer', 'Alcoholism', 'Bogus', '__proto__'] },
    b: { id: 'p2', gender: 'X', life: 'zombie', culture: 1, illness: 'x', substance: null, conditions: 'Cancer' } } };
  const { doc } = GT.normalizeDoc(raw);
  const a = doc.persons.p1, b = doc.persons.p2;
  T.eq([a.gender, a.life, a.culture, a.illness, a.substance], ['P', 'pregnancy', 'multiple', 'recovery', 'suspected']);
  T.eq(a.conditions, ['Cancer', 'Alcoholism'], '去重、丟掉不認得的');
  T.eq([b.gender, b.life, b.culture, b.illness, b.substance, b.conditions], ['U', '', '', '', '', []], '亂填的值全部回到預設');
});

T.test('雙胞胎：同一對父母的子女、一人只在一組、少於兩人自動拿掉', () => {
  const d = GT.newDoc();
  const c = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  const { unionId: u } = GT.addParents(d, c);
  const s1 = GT.addSibling(d, c, 'F').personId, s2 = GT.addSibling(d, c, 'M').personId;
  const other = GT.addPerson(d, { gender: 'F', x: 900, y: 0 });
  T.eq(GT.commonParentUnion(d, [c, s1]).id, u, '同一對父母');
  T.eq(GT.commonParentUnion(d, [c, other]), null, '不同父母 → 不能設雙胞胎');
  T.ok(GT.setTwins(d, u, [c, s1], 'Identical'), '設為同卵雙胞胎');
  T.eq(GT.setTwins(d, u, [c], 'Fraternal'), false, '一個人不成組');
  GT.setTwins(d, u, [s1, s2], 'Fraternal');
  T.eq(d.unions[u].twins, [{ ids: [s1, s2], kind: 'Fraternal' }], '同一人改到新組；舊組只剩一人 → 自動拿掉');
  T.eq(GT.twinGroupOf(d, s2).group.kind, 'Fraternal');
  T.ok(GT.clearTwin(d, s1), '取消雙胞胎');
  T.eq(d.unions[u].twins, [], '剩一人 → 整組拿掉');
  GT.setTwins(d, u, [c, s1, s2], 'Unknown');
  GT.deleteItems(d, [s2]);
  T.eq(d.unions[u].twins[0].ids, [c, s1], '刪掉一人，其他人留在組裡');
  const u2 = GT.linkPartners(d, GT.addPerson(d, { gender: 'M', x: 500, y: -160 }), GT.addPerson(d, { gender: 'F', x: 600, y: -160 }));
  GT.attachChild(d, u2, s1);
  T.eq(d.unions[u].twins, [], '換到別的父母底下 → 雙胞胎組解散');
});

T.test('正規化：雙胞胎資料驗證', () => {
  const raw = { format: 'genogram-tool', version: 2,
    persons: { a: { id: 'p1', gender: 'M' }, b: { id: 'p2', gender: 'F' }, c: { id: 'p3', gender: 'M' }, d: { id: 'p4', gender: 'F' }, e: { id: 'p5', gender: 'M' } },
    unions: { u: { id: 'u1', partners: ['p1', 'p2'], type: 'Marriage', children: [{ id: 'p3' }, { id: 'p4' }, { id: 'p5' }],
      twins: [{ ids: ['p3', 'p4'], kind: 'Identical' }, { ids: ['p4', 'p5'], kind: 'Weird' }, { ids: ['p1', 'p3'] }, 'junk'] } } };
  const { doc } = GT.normalizeDoc(raw);
  T.eq(doc.unions.u1.twins, [{ ids: ['p3', 'p4'], kind: 'Identical' }], '重複的人、不是子女的人、不足兩人的組都丟掉');
});

/* ── v3（2026-09-20）：生態圖 ── */

T.test('生態圖：資源與連結（新增、端點檢查、移動、刪除連動）', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 }), b = GT.addPerson(d, { gender: 'F', x: 100, y: 0 });
  const h = GT.addHousehold(d, [a, b], '同住');
  const s1 = GT.addSystem(d, { name: '學校', x: 300, y: 0 }), s2 = GT.addSystem(d, { x: 300, y: 200 });
  T.eq(d.systems[s2].name, '', '沒給名稱就留空，畫的時候才顯示「資源」（存檔讀回才不會變內容）');
  const t1 = GT.addTie(d, s1, a, { strength: 'strong', stress: true, dir: 'a2b', note: '導師每週回報' });
  T.eq([d.ties[t1].strength, d.ties[t1].stress, d.ties[t1].dir, d.ties[t1].note],
       ['strong', true, 'a2b', '導師每週回報'], '強度、壓力、流向、線上文字都存起來');
  const t2 = GT.addTie(d, s1, h);
  T.ok(t2, '可以連到生活圈（＝整個家庭）');
  T.eq([d.ties[t2].strength, d.ties[t2].stress, d.ties[t2].dir], ['normal', false, ''], '沒指定就是普通、無壓力、無箭頭');
  const t3 = GT.addTie(d, s2, b, { strength: '亂寫', dir: '亂寫' });
  T.eq([d.ties[t3].strength, d.ties[t3].dir], ['normal', ''], '不認得的值回到預設');
  T.eq(GT.addTie(d, s1, s1), null, '不能連自己');
  T.eq(GT.addTie(d, s1, 'nope'), null, '端點不存在就不建立');
  T.eq(GT.tieBetween(d, a, s1).id, t1, '查得到兩者之間的線（不分先後順序）');
  GT.moveItems(d, [s1], 12, 23); GT.snapItems(d, [s1]);
  T.eq([d.systems[s1].x, d.systems[s1].y], [310, 20], '資源可以拖曳移動並吸附格線');
  GT.deleteItems(d, [s1]);
  T.eq(Object.keys(d.ties), [t3], '刪掉資源，連在它身上的線一起刪');
  GT.deleteItems(d, [b]);
  T.eq(Object.keys(d.ties).length, 0, '刪掉人，連到他的線也一起刪');
  T.eq(Object.keys(d.systems), [s2], '刪人不影響其他資源');
});

T.test('生態圖：存檔讀回；外部檔的壞資料擋在門口（v3）', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  const s = GT.addSystem(d, { name: '家防中心', x: 200, y: 0 });
  const t = GT.addTie(d, s, a, { strength: 'weak', dir: 'b2a', note: '通報 2025-03' });
  d.settings.view = 'ecomap';
  const back = GT.normalizeDoc(JSON.parse(GT.serialize(d))).doc;
  T.eq(back.systems[s], d.systems[s], '資源原樣讀回');
  T.eq(back.ties[t], d.ties[t], '連結原樣讀回');
  T.eq(back.settings.view, 'ecomap', '顯示模式跟著存檔');
  const raw = { format: 'genogram-tool', version: 3,
    persons: { p1: { id: 'p1', gender: 'M', x: 0, y: 0 } },
    systems: { s1: { id: 's1', name: '學校', x: 9e9, y: 0 }, bad: { id: '__proto__', name: 'x' } },
    ties: { e1: { id: 'e1', a: 'p1', b: 'nope' }, e2: { id: 'e2', a: 's1', b: 'p1', strength: 'strong' },
            e3: { id: 'e3', a: 'p1', b: 'p1' } } };
  const { doc, warnings } = GT.normalizeDoc(raw);
  T.eq(Object.keys(doc.systems), ['s1'], 'id 不合法的資源擋掉（含 __proto__）');
  T.ok(doc.systems.s1.x <= 1e6, '座標夾在合理範圍');
  T.eq(Object.keys(doc.ties), ['e2'], '端點不存在、或兩端相同的線都擋掉');
  T.eq(warnings.filter(w => w === 'tie').length, 2, '擋掉的線列進警告');
  T.ok(warnings.includes('system'), '擋掉的資源列進警告');
  const v2 = GT.normalizeDoc({ format: 'genogram-tool', version: 2, persons: {} }).doc;
  T.eq([Object.keys(v2.systems).length, Object.keys(v2.ties).length, v2.settings.view], [0, 0, 'both'], '舊檔沒有生態圖 → 空的，顯示模式用預設');
});

T.test('回歸：刪掉生活圈，掛在它身上的生態連結一起刪（審查 2026-09-20 指出的測試缺口）', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  const h = GT.addHousehold(d, [a], '同住');
  const s = GT.addSystem(d, { name: '社福中心', x: 200, y: 0 });
  const t1 = GT.addTie(d, s, h, {}), t2 = GT.addTie(d, s, a, {});
  GT.deleteItems(d, [h]);
  T.eq(Object.keys(d.ties), [t2], '連到生活圈的線刪掉，連到人的線留著');
  T.ok(!d.households[h], '生活圈本身刪掉');
  T.ok(d.persons[a] && d.systems[s], '人與資源都留著');
  GT.deleteItems(d, [t2]);
  T.eq(Object.keys(d.ties).length, 0, '也可以只刪一條線');
});

T.test('回歸：外部檔的 id 在整份文件裡必須唯一（審查 2026-09-20）', () => {
  const raw = { format: 'genogram-tool', version: 3,
    persons: { x1: { id: 'x1', gender: 'M', x: 0, y: 0 } },
    systems: { x1: { id: 'x1', name: '假資源', x: 100, y: 0 }, s2: { id: 's2', name: '學校', x: 200, y: 0 } },
    households: { x1b: { id: 'x1', members: ['x1'] } },
    ties: { e1: { id: 'e1', a: 's2', b: 'x1' } } };
  const { doc, warnings } = GT.normalizeDoc(raw);
  T.eq(Object.keys(doc.systems), ['s2'], '跟人撞 id 的資源擋掉');
  T.eq(Object.keys(doc.households).length, 0, '跟人撞 id 的生活圈也擋掉');
  T.ok(warnings.includes('system') && warnings.includes('household'), '擋掉的都列進警告');
  T.eq(doc.ties.e1.b, 'x1', '剩下的連結指向那個人，不會有兩個東西搶同一個 id');
  T.eq(GT.normalizeDoc({ format: 'genogram-tool', version: 3, systems: { a: { id: 'a', name: '' } } }).doc.systems.a.name,
       '', '讀檔也保持空名稱（跟面板清空的結果一致）');
});
