/* layout.js 測試：自動排版（使用者 2026-10-28：要不要用由使用者決定；用了要排得合理、可以復原） */

// 同一列（同一個 y）裡左到右的人
const rowOfY = (d, y) => Object.values(d.persons).filter(p => p.y === y).sort((a, b) => a.x - b.x).map(p => p.id);
const rowsOf = (d) => [...new Set(Object.values(d.persons).map(p => p.y))].sort((a, b) => a - b);
// 同一列相鄰兩人的「符號＋標籤」不重疊
function noOverlap(d) {
  for (const y of rowsOf(d)) {
    const ids = rowOfY(d, y);
    for (let i = 1; i < ids.length; i++) {
      const A = GT.render.personBox(d, d.persons[ids[i - 1]]), B = GT.render.personBox(d, d.persons[ids[i]]);
      if (B.x1 - A.x2 < 10) return false;
    }
  }
  return true;
}
const coordsOnly = (d) => JSON.stringify(d, (k, v) => (k === 'x' || k === 'y') ? undefined : v);
const shuffle = (d, seed) => {   // 把人亂擺（固定種子，結果可以重現）
  let s = seed;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (const p of Object.values(d.persons)) { p.x = Math.round(rnd() * 800 - 400); p.y = Math.round(rnd() * 600 - 300); }
};

// 三代：父系祖父母、母系祖父母、父母＋姑姑、服務使用者＋手足
function threeGen() {
  const d = GT.newDoc();
  const P = (g, name) => { const id = GT.addPerson(d, { gender: g, x: 0, y: 0 }); d.persons[id].name = name; return id; };
  const gf = P('M', '祖父'), gm = P('F', '祖母'), mgf = P('M', '外祖父'), mgm = P('F', '外祖母');
  const fa = P('M', '父親'), mo = P('F', '母親'), aunt = P('F', '姑姑');
  const me = P('M', '服務使用者'), sis = P('F', '妹妹');
  const ug = GT.linkPartners(d, gf, gm), um = GT.linkPartners(d, mgf, mgm), up = GT.linkPartners(d, fa, mo);
  d.unions[ug].children.push({ id: aunt, link: 'bio' }, { id: fa, link: 'bio' });
  d.unions[um].children.push({ id: mo, link: 'bio' });
  d.unions[up].children.push({ id: me, link: 'bio' }, { id: sis, link: 'bio' });
  // 原本的大概位置：父系在左、母系在右（排版要尊重這個左右）
  const at = (id, x, y) => { d.persons[id].x = x; d.persons[id].y = y; };
  at(gf, -300, 0); at(gm, -200, 0); at(mgf, 200, 0); at(mgm, 300, 0);
  at(aunt, -380, 170); at(fa, -90, 150); at(mo, 120, 140);
  at(me, -20, 330); at(sis, 70, 310);
  return { d, gf, gm, mgf, mgm, fa, mo, aunt, me, sis, ug, um, up };
}
const midX = (d, ids) => { const xs = ids.map(id => d.persons[id].x); return (Math.min(...xs) + Math.max(...xs)) / 2; };

T.test('自動排版：同一代同一列、伴侶相鄰、靠向自己的原生家庭、不重疊', () => {
  const t = threeGen(), d = t.d;
  const rel0 = coordsOnly(d);
  T.eq(GT.layout.autoLayout(d), 9, '回傳排了幾個人');
  T.eq(coordsOnly(d), rel0, '只改座標，關係資料一點都不動');
  const ys = rowsOf(d);
  T.eq(ys.length, 3, '三代＝三列');
  T.eq(new Set([t.gf, t.gm, t.mgf, t.mgm].map(id => d.persons[id].y)).size, 1, '祖父母輩在同一列');
  T.ok(d.persons[t.gf].y < d.persons[t.fa].y && d.persons[t.fa].y < d.persons[t.me].y, '世代由上而下');
  T.ok(d.persons[t.fa].y - d.persons[t.gf].y >= GT.GAP_Y, '世代之間至少一個世代的高度');
  const row1 = rowOfY(d, d.persons[t.fa].y);
  T.eq(Math.abs(row1.indexOf(t.fa) - row1.indexOf(t.mo)), 1, '父母相鄰（中間沒有別人）');
  T.ok(d.persons[t.fa].x < d.persons[t.mo].x, '父親靠父系（左）、母親靠母系（右）');
  T.ok(d.persons[t.aunt].x < d.persons[t.fa].x, '姑姑在父親的外側，不夾在父母中間');
  T.ok(noOverlap(d), '同一列的人和標籤不重疊');
  T.ok(Object.values(d.persons).every(p => p.x % GT.GRID === 0 && p.y % GT.GRID === 0), '座標吸附格線');
});

T.test('自動排版：子女置中在父母下方', () => {
  const t = threeGen(), d = t.d;
  GT.layout.autoLayout(d);
  const near = (a, b, tol, msg) => T.ok(Math.abs(a - b) <= tol, `${msg}（差 ${Math.round(Math.abs(a - b))}px）`);
  near(midX(d, [t.me, t.sis]), midX(d, [t.fa, t.mo]), 30, '服務使用者與妹妹置中在父母下方');
  near(midX(d, [t.mgf, t.mgm]), d.persons[t.mo].x, 60, '外祖父母在母親上方');
});

T.test('自動排版：多段婚姻排成「前任—本人—現任」，各自的子女在各自那段下面', () => {
  const d = GT.newDoc();
  const me = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  const ex = GT.addPerson(d, { gender: 'F', x: 300, y: 0 }), cur = GT.addPerson(d, { gender: 'F', x: 380, y: 0 });   // 兩任都擠在右邊
  const u1 = GT.linkPartners(d, me, ex, 'Divorce'), u2 = GT.linkPartners(d, me, cur, 'Marriage');
  const k1 = GT.addChild(d, u1, 'M'), k2 = GT.addChild(d, u2, 'F'), k3 = GT.addChild(d, u2, 'M');
  shuffle(d, 7);
  d.persons[me].y = -400;                                      // 本人最上面（世代從他算起）
  GT.layout.autoLayout(d);
  const row = rowOfY(d, d.persons[me].y);
  T.eq(row.length, 3, '本人與兩任伴侶同一列');
  T.eq(row[1], me, '本人在中間');
  const exLeft = d.persons[ex].x < d.persons[me].x;
  T.ok(exLeft !== (d.persons[cur].x < d.persons[me].x), '兩任伴侶分在兩邊，伴侶線不會一條疊一條');
  const kidRow = rowOfY(d, d.persons[k1].y);
  T.eq(kidRow.length, 3, '三個子女同一列');
  T.ok(exLeft ? d.persons[k1].x < d.persons[k2].x : d.persons[k1].x > d.persons[k2].x, '前一段的子女在前任那一側');
  T.ok(Math.abs(kidRow.indexOf(k2) - kidRow.indexOf(k3)) === 1, '同一段的手足相鄰');
  T.ok(noOverlap(d), '不重疊');
});

T.test('自動排版：亂擺之後也排得回來；排第二次不會亂跳', () => {
  const t = threeGen(), d = t.d;
  shuffle(d, 42);
  GT.layout.autoLayout(d);
  T.eq(rowsOf(d).length, 3, '亂擺之後照樣分成三代');
  T.ok(noOverlap(d), '不重疊');
  const row1 = rowOfY(d, d.persons[t.fa].y);
  T.eq(Math.abs(row1.indexOf(t.fa) - row1.indexOf(t.mo)), 1, '父母相鄰');
  const once = JSON.stringify(d.persons);
  GT.layout.autoLayout(d);
  T.eq(JSON.stringify(d.persons), once, '排好的圖再按一次自動排版，位置不變');
});

T.test('自動排版：不相連的人分開擺；資源與文字說明跟著整張圖走', () => {
  const t = threeGen(), d = t.d;
  const loner = GT.addPerson(d, { gender: 'F', x: 900, y: 150 });             // 沒有任何家庭關係的人（例：重要他人）
  const s = GT.addSystem(d, { name: '學校', x: 0, y: -400 });                   // 在整張圖上方
  const lab = GT.addLabel(d, 1200, 330, '備註');
  GT.layout.autoLayout(d);
  T.ok(noOverlap(d), '不重疊');
  const fam = Object.values(d.persons).filter(p => p.id !== loner);
  T.ok(d.persons[loner].x > Math.max(...fam.map(p => p.x)), '照原本的左右：獨立的人擺在家族右邊');
  T.eq(d.persons[loner].y, d.persons[t.fa].y, '獨立的人留在原本那一代的高度');
  const top = Math.min(...Object.values(d.persons).map(p => GT.render.personBox(d, p).y1));
  T.ok(d.systems[s].y < top, '原本在圖上方的資源，排完還在圖上方');
  const right = Math.max(...Object.values(d.persons).map(p => GT.render.personBox(d, p).x2));
  T.ok(d.labels[lab].x > right, '原本在圖右邊的文字說明，排完還在圖右邊');
});

T.test('自動排版：怪結構不當機（跨世代伴侶、自己的子女當伴侶、空文件、只有一人）', () => {
  T.eq(GT.layout.autoLayout(GT.newDoc()), 0, '空文件：不動');
  const one = GT.newDoc();
  const solo = GT.addPerson(one, { x: 120, y: 460 });
  T.eq(GT.layout.autoLayout(one), 0, '只有一人：不動');
  T.eq([one.persons[solo].x, one.persons[solo].y], [120, 460], '只有一人：位置不變');
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 }), b = GT.addPerson(d, { gender: 'F', x: 100, y: 0 });
  const u = GT.linkPartners(d, a, b);
  const c = GT.addChild(d, u, 'F');
  const grand = GT.addChild(d, u, 'M');
  const u2 = GT.linkPartners(d, a, c);                       // 跟自己的子女是伴侶（資料錯誤，但不能讓程式壞掉）
  d.unions[u2].children.push({ id: grand, link: 'bio' });   // 同一個孩子掛在兩段關係下
  GT.layout.autoLayout(d);
  T.ok(Object.values(d.persons).every(p => Number.isFinite(p.x) && Number.isFinite(p.y)), '座標都是正常數字');
  T.ok(noOverlap(d), '照樣不重疊');
});

T.test('自動排版：名字很長、標籤很多行時拉開距離（不重疊）', () => {
  const t = threeGen(), d = t.d;
  d.persons[t.fa].name = '非常非常非常長的名字甲乙丙丁戊己庚辛';
  d.persons[t.mo].attrs = { occupation: '社會福利機構個案管理員', economy: '中低收入戶（每月補助）' };
  d.persons[t.aunt].name = 'Elizabeth Alexandra';
  GT.layout.autoLayout(d);
  T.ok(noOverlap(d), '寬標籤也不重疊');
  const fa = GT.render.personBox(d, d.persons[t.fa]), me = GT.render.personBox(d, d.persons[t.me]);
  T.ok(me.y1 - fa.y2 >= 20, '上下兩代的標籤不重疊');
});

T.test('保序最小移動（PAV）', () => {
  T.eq(GT.layout.pav([1, 2, 3], [1, 1, 1]), [1, 2, 3], '本來就有順序：不動');
  T.eq(GT.layout.pav([3, 1, 2], [1, 1, 1]), [2, 2, 2], '全部擠在一起：取平均');
  T.eq(GT.layout.pav([0, 4, 2], [1, 1, 3]), [0, 2.5, 2.5], '權重大的移動少');
});

T.test('回歸：前任的父母在左邊時，前任要排在本人左邊（原本只看錨點大小、沒比相對位置，排反了）', () => {
  const d = GT.newDoc();
  const P = (g, x, y) => GT.addPerson(d, { gender: g, x, y });
  const gf = P('M', 300, 0), gm = P('F', 400, 0);                      // 本人的父母（右）
  const xf = P('M', -300, 0), xm = P('F', -200, 0);                     // 前任的父母（左）
  const me = P('M', 300, 160), sis = P('F', 450, 160), ex = P('F', 400, 160), cur = P('F', 200, 160);
  const ug = GT.linkPartners(d, gf, gm), ux = GT.linkPartners(d, xf, xm);
  d.unions[ug].children.push({ id: me, link: 'bio' }, { id: sis, link: 'bio' });
  d.unions[ux].children.push({ id: ex, link: 'bio' });
  GT.linkPartners(d, me, ex, 'Divorce'); GT.linkPartners(d, me, cur, 'Marriage');
  GT.layout.autoLayout(d);
  const x = (id) => d.persons[id].x;
  T.ok(x(ex) < x(me) && x(me) < x(cur), '前任（娘家在左）—本人—現任');
  T.ok(x(xf) < x(gf), '前任的父母在本人父母的左邊');
  const row = rowOfY(d, d.persons[me].y);
  T.ok(row.indexOf(sis) - row.indexOf(me) <= 2, '妹妹緊跟在本人這一組旁邊，不被推到遠處');
  T.ok(noOverlap(d), '不重疊');
});

// ── 回歸（使用者 2026-10-28 附圖）：自動排版不可以改變手足的左右順序（出生序）──
// 每段關係的子女，排版前後由左到右的順序一樣
const kidOrder = (d) => Object.values(d.unions).map(u => u.children.map(c => c.id).filter(id => d.persons[id])
  .sort((a, b) => d.persons[a].x - d.persons[b].x || 0).join(','));
// 使用者第三張圖（手排、正確）：祖父母→服務使用者、B 女兒＋夫、C 兒子＋妻、D 兒子＋妻、E 已歿→孫輩→曾孫
function userFamily(dKids) {
  const d = GT.newDoc(), k = 1.25, N = {};
  const P = (key, g, x, y) => { const id = GT.addPerson(d, { gender: g, x: x * k, y: y * k }); N[key] = id; return id; };
  const U = (a, b, kids) => { const u = GT.linkPartners(d, a, b); d.unions[u].children = kids.map(id => ({ id, link: 'bio' })); return u; };
  const gf = P('祖父', 'M', 313, 43), gm = P('祖母', 'F', 407, 43);
  const A = P('A', 'F', 33, 178), B = P('B', 'F', 115, 178), Bh = P('B夫', 'M', 182, 178), C = P('C', 'M', 287, 178), Cw = P('C妻', 'F', 355, 178);
  const D = P('D', 'M', 572, 178), Dw = P('D妻', 'F', 645, 178), E = P('E', 'M', 707, 178);
  U(gf, gm, [A, B, C, D, E]); U(B, Bh, []);
  const C1 = P('C1', 'M', 220, 262), C1w = P('C1妻', 'F', 293, 262), C2 = P('C2', 'M', 361, 262);
  U(C, Cw, [C1, C2]); U(C1, C1w, [P('C1子', 'M', 258, 350)]);
  dKids(d, P, U, D, Dw);
  return { d, N };
}

T.test('回歸：自動排版不改變手足的出生序（使用者 2026-10-28 第三、四張圖：B 與 C、D1 與 D2 被對調）', () => {
  const { d, N } = userFamily((d, P, U, D, Dw) => {
    const D1 = P('D1', 'M', 430, 262), D1w = P('D1妻', 'F', 503, 262), D2 = P('D2', 'F', 570, 262), D2h = P('D2夫', 'M', 645, 262);
    U(D, Dw, [D1, D2, P('D3', 'M', 712, 262), P('D4', 'M', 773, 262)]); U(D2, D2h, []); U(D1, D1w, [P('D1子', 'M', 466, 350)]);
  });
  const before = kidOrder(d);
  GT.layout.autoLayout(d);
  T.eq(kidOrder(d), before, '每一段關係的子女，左右順序都跟排版前一樣');
  const x = (k) => d.persons[N[k]].x;
  T.ok(x('A') < x('B') && x('B') < x('C') && x('C') < x('D') && x('D') < x('E'), '服務使用者、B、C、D、E 照出生序');
  T.ok(x('D1') < x('D2') && x('D2') < x('D3'), 'D 家的孩子照出生序');
  T.ok(x('B') < x('B夫') && x('B夫') < x('C'), '配偶緊貼本人（B 夫在 B 與 C 之間）');
  T.ok(noOverlap(d), '不重疊');
});

T.test('回歸：對次女按「＋伴侶」再自動排版，長女一家不會跟次女對調（使用者 2026-10-28 第五、六張圖：看起來像小孩跑去隔壁）', () => {
  let ids;
  const { d, N } = userFamily((d, P, U, D, Dw) => {
    const d1 = P('長女', 'F', 470, 262), d2 = P('次女', 'F', 530, 262), s1 = P('長子', 'M', 590, 262), s2 = P('次子', 'M', 650, 262), h1 = P('長女夫', 'M', 700, 262);
    U(D, Dw, [d1, d2, s1, s2]);
    const kid = P('長女的孩子', 'M', 585, 350); U(d1, h1, [kid]);
    ids = { d1, d2, s1, s2, h1, kid };
  });
  const np = GT.addPartner(d, ids.d2).personId;
  GT.layout.autoLayout(d);
  const x = (id) => d.persons[id].x;
  T.ok(x(ids.d1) < x(ids.d2) && x(ids.d2) < x(ids.s1) && x(ids.s1) < x(ids.s2), '長女、次女、長子、次子照出生序');
  T.ok(Math.abs(x(ids.d1) - x(ids.h1)) <= GT.GAP_X * 1.2 && Math.abs(x(ids.d2) - x(np)) <= GT.GAP_X * 1.2, '兩個女兒都跟自己的伴侶相鄰');
  T.ok(Math.min(x(ids.d1), x(ids.h1)) <= x(ids.kid) && x(ids.kid) <= Math.max(x(ids.d1), x(ids.h1)), '長女的孩子畫在長女與長女夫中間的正下方');
  T.ok(x(ids.kid) < x(ids.d2), '孩子不會跑到次女那一家底下');
  T.eq(GT.parentUnionOf(d, ids.kid).partners.slice().sort(), [ids.d1, ids.h1].sort(), '資料沒變：孩子仍是長女與長女夫的');
});

T.test('自動排版：隨機 30 個家族，每段關係的子女出生序排版前後都一樣', () => {
  let seed = 1028, bad = 0, total = 0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let n = 0; n < 30; n++) {
    const d = GT.newDoc();
    const add = (g, y) => GT.addPerson(d, { gender: g, x: 0, y });
    let unions = [GT.linkPartners(d, add('M', 0), add('F', 0))];
    for (let gen = 1; gen <= 3; gen++) {
      const next = [];
      for (const uid of unions) {
        const kids = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => add(rnd() < 0.5 ? 'M' : 'F', gen * 160));
        d.unions[uid].children = kids.map(id => ({ id, link: 'bio' }));
        for (const k of kids) if (rnd() < 0.5) next.push(GT.addPartner(d, k).unionId);
      }
      unions = next;
    }
    for (const p of Object.values(d.persons)) p.x = Math.round(rnd() * 2000);   // 亂擺：出生序＝亂擺後的左右
    const before = kidOrder(d);
    GT.layout.autoLayout(d);
    total++;
    if (JSON.stringify(kidOrder(d)) !== JSON.stringify(before) || !noOverlap(d)) bad++;
  }
  T.eq(bad, 0, `${total} 個家族都保持出生序、不重疊`);
});
