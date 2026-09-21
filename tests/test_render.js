/* render.js 測試：符號、線型、匯出、跳脫、外框 */

function sampleDoc() {
  const d = GT.newDoc();
  d.meta.assessDate = '2026-01-01';
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  Object.assign(d.persons[a], { name: '王大明', age: '45', index: true, attrs: { occupation: '工人', economy: '低收入戶' } });
  const { personId: b, unionId: u } = GT.addPartner(d, a);
  d.persons[b].deceased = true; d.persons[b].deathAge = '60';
  d.unions[u].type = 'Divorce';
  const c = GT.addChild(d, u, 'U');
  d.unions[u].children[0].link = 'adopted';
  const e = GT.addPerson(d, { gender: 'F', x: 400, y: 0 });
  const u2 = GT.linkPartners(d, a, e, 'Cohabitation');
  const r = GT.addRelation(d, a, c, 'Abuse');
  const h = GT.addHousehold(d, [b, c], '同住');
  const t = GT.addLabel(d, 0, 300, '主要照顧者');
  return { d, a, b, c, e, u, u2, r, h, t };
}
const groupOf = (svg, id) => {
  const i = svg.indexOf(`data-id="${id}"`);
  return i < 0 ? '' : svg.slice(i, svg.indexOf('</g>', i));
};
const count = (s, sub) => s.split(sub).length - 1;

T.test('空白文件', () => {
  const d = GT.newDoc();
  T.eq(GT.render.renderWorld(d, {}), '');
  T.eq(GT.render.bbox(d), { x: 0, y: 0, w: 400, h: 300 });
});

T.test('人物符號：男女、未知性別、案主粗框灰底、已歿打叉、年齡', () => {
  const { d, a, b, c } = sampleDoc();
  const svg = GT.render.renderWorld(d, {});
  const ga = groupOf(svg, a), gb = groupOf(svg, b), gc = groupOf(svg, c);
  T.ok(ga.includes(`fill="${GT.render.INDEX_FILL}"`) && /stroke-width="3.6"/.test(ga), '案主＝框線加粗＋灰底（使用者指定，2026-09-17）');
  T.eq((groupOf(svg, Object.keys(d.persons).find(k => d.persons[k].gender === 'F' && !d.persons[k].deceased)).match(/<circle [^>]*stroke="[^"]+" stroke-width="2"/g) || []).length, 1, '非案主：一般粗細的單框');
  T.ok(ga.includes('>45<'), '年齡在符號中');
  T.ok(gb.includes('<circle'), '女＝圓形');
  T.ok(/<path d="M-[\d.]+,-[\d.]+L/.test(gb), '已歿＝打叉');
  T.ok(gb.includes('>60<'), '已歿顯示過世年齡');
  T.ok(gc.includes('>?</text>'), '未知性別＝「?」（參考圖；菱形改給寵物）');
  T.ok(ga.includes('王大明') && ga.includes('工人') && ga.includes('低收入戶'), '姓名與勾選欄位顯示在圖上');
});

T.test('伴侶與親子線型', () => {
  const { d, u, u2 } = sampleDoc();
  const svg = GT.render.renderWorld(d, {});
  const g1 = groupOf(svg, u), g2 = groupOf(svg, u2);
  const slashes = (g) => { const m = g.match(/class="slash" d="([^"]*)"/); return m ? (m[1].match(/M/g) || []).length : 0; };
  T.eq(slashes(g1), 2, '離婚＝兩條斜線');
  T.ok(g1.includes('stroke-dasharray="6 4"'), '收養＝虛線');
  T.ok(g2.includes('stroke-dasharray="2 3"') && g2.includes('class="house"'), '同居＝藍色點線＋小房子（參考圖）');
  T.eq(slashes(g2), 0, '持續中沒有斜線');
  d.unions[u].type = 'Separation';
  T.eq(slashes(groupOf(GT.render.renderWorld(d, {}), u)), 1, '分居＝一條斜線');
});

T.test('情感關係線：每種都畫得出來、虐待有箭頭', () => {
  const { d, r } = sampleDoc();
  T.ok(groupOf(GT.render.renderWorld(d, {}), r).includes('Z" fill='), '虐待有箭頭');
  for (const t of GT.EMOTION_TYPES) {
    d.relations[r].type = t.key;
    const g = groupOf(GT.render.renderWorld(d, {}), r);
    T.ok(g.includes('<path') && !g.includes('NaN'), `${t.label} 畫得出來`);
  }
});

T.test('彩色／黑白切換', () => {
  const { d, r } = sampleDoc();
  d.relations[r].type = 'Discord';
  T.ok(groupOf(GT.render.renderWorld(d, {}), r).includes(GT.render.G.RED), '彩色：衝突用紅色');
  d.settings.colorRelations = false;
  const g = groupOf(GT.render.renderWorld(d, {}), r);
  T.ok(!g.includes(GT.render.G.RED) && g.includes(GT.render.C.INK), '黑白：一律深色');
});

T.test('跳脫：姓名裡的 HTML 不會變成標籤（XSS 守衛）', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M' });
  d.persons[a].name = '<img src=x onerror=alert(1)>';
  d.persons[a].attrs.occupation = '"><script>';
  GT.addLabel(d, 0, 0, '</text><script>x</script>');
  const sys = GT.addSystem(d, { name: '<img src=y onerror=alert(2)>', x: 300, y: 0 });
  GT.addTie(d, sys, a, { note: '</text><script>window.x=1</script>' });
  const svg = GT.render.renderWorld(d, {});
  T.ok(!svg.includes('<img') && !svg.includes('<script'), '沒有未跳脫的標籤');
  T.ok(svg.includes('&lt;img'), '有跳脫');
  T.ok(!GT.render.exportSVG(d).includes('<script'), '匯出的 SVG 也沒有未跳脫的標籤');
  d.settings.view = 'ecomap';
  T.ok(!GT.render.renderWorld(d, {}).includes('<script'), '生態圖模式也沒有未跳脫的標籤');
  d.settings.view = 'both';
});

T.test('畫面模式 vs 匯出模式', () => {
  const { d, a } = sampleDoc();
  const screen = GT.render.renderWorld(d, { selection: new Set([a]) });
  T.ok(screen.includes('class="hit"') && screen.includes('class="sel"'), '畫面有點選範圍與選取框');
  const out = GT.render.exportSVG(d);
  T.ok(out.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), '匯出是獨立 SVG');
  T.ok(!out.includes('class="hit"') && !out.includes('class="sel"'), '匯出不含介面用的東西');
  T.ok(out.includes('fill="#FFFFFF"'), '白底');
  T.ok(!out.includes('NaN') && !screen.includes('NaN'), '沒有 NaN');
  const doc2 = new DOMParser().parseFromString(out, 'image/svg+xml');
  T.eq(doc2.getElementsByTagName('parsererror').length, 0, '匯出的 SVG 是合法 XML');
});

T.test('外框涵蓋所有內容', () => {
  const { d } = sampleDoc();
  const b = GT.render.bbox(d);
  T.ok(Object.values(d.persons).every(p => p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h), '每個人都在框內');
  const lab = Object.values(d.labels)[0];
  T.ok(lab.y <= b.y + b.h, '文字說明在框內');
});

T.test('標籤格式跟著設定走', () => {
  const { d, a } = sampleDoc();
  T.ok(groupOf(GT.render.renderWorld(d, {}), a).includes('>工人<'));
  d.settings.labelMode = 'labelled';
  T.ok(groupOf(GT.render.renderWorld(d, {}), a).includes('>職業：工人<'));
  d.settings.fields.find(f => f.key === 'occupation').show = false;
  T.ok(!groupOf(GT.render.renderWorld(d, {}), a).includes('工人'), '取消勾選就不顯示');
});

T.test('伴侶線在標籤文字下方，不橫切「工人」「低收入戶」（回歸）', () => {
  const { d, a, u } = sampleDoc();
  const g = GT.render.unionGeometry(d, d.unions[u]);
  const p = d.persons[a], lb = GT.render.labelBox(d, p);
  T.ok(lb.lines.length >= 3, '案主有 3 行標籤');
  T.ok(g.yLine >= p.y + GT.render.HALF + 5 + lb.h, '伴侶線低於標籤底部');
  T.ok(g.ySib > g.yLine, '手足線在伴侶線下方');
  const top = Math.min(...d.unions[u].children.map(c => d.persons[c.id].y)) - GT.render.HALF;
  T.ok(g.ySib < top, '子女線往下接到子女頭頂');
  T.ok(groupOf(GT.render.renderWorld(d, {}), a).includes('paint-order="stroke"'), '標籤有白底描邊');
});

T.test('多段關係的橫線不重疊（回歸）', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  const b = GT.addPerson(d, { gender: 'F', x: 100, y: 0 });
  const c = GT.addPerson(d, { gender: 'F', x: 200, y: 0 });
  const u1 = GT.linkPartners(d, a, b), u2 = GT.linkPartners(d, a, c);
  const y1 = GT.render.unionGeometry(d, d.unions[u1]).yLine, y2 = GT.render.unionGeometry(d, d.unions[u2]).yLine;
  T.ok(y2 > y1, '同一側兩段關係：後建立的往下錯開');
  d.persons[c].x = -100;   // 改放另一側 → 橫線範圍不重疊 → 不必錯開
  T.eq(GT.render.unionGeometry(d, d.unions[u2]).yLine, y1, '分在兩側時同一高度');
});

T.test('標籤整塊白底，線不會從字縫露出來（回歸）', () => {
  const { d, a, c } = sampleDoc();
  const svg = GT.render.renderWorld(d, {});
  T.ok(/fill="#FFFFFF" fill-opacity="0.92"/.test(groupOf(svg, a)), '有標籤的人有白底');
  T.ok(!/fill-opacity="0.92"/.test(groupOf(svg, c)), '沒有標籤的人不畫白底');
});

T.test('子女被拖到很靠近父母：線不往上折（回歸）', () => {
  const { d, u } = sampleDoc();
  for (const c of d.unions[u].children) d.persons[c.id].y = 70;   // 故意拖得很近
  const g = GT.render.unionGeometry(d, d.unions[u]);
  const top = 70 - GT.render.HALF;
  T.ok(g.yLine <= top, '伴侶線縮到子女上方');
  T.ok(g.ySib >= g.yLine && g.ySib <= top, '手足線夾在中間');
});

T.test('生活圈不會把不同住的人圈進去（回歸）', () => {
  const d = GT.newDoc();
  const P = (x, y, g) => GT.addPerson(d, { gender: g || 'M', x, y });
  // 情境：案主與同居人在第一列，右邊的妹妹不同住；第二列兩個孩子同住
  const fang = P(-100, 0, 'F'), dad = P(0, 0), aunt = P(100, 0, 'F'), kid1 = P(-50, 160), kid2 = P(60, 160);
  const h = GT.addHousehold(d, [fang, dad, kid1, kid2]);
  T.eq(GT.render.householdIntruders(d, d.households[h]), [], '右邊的妹妹沒被圈進去');
  const parts = GT.render.householdParts(d, d.households[h]);
  T.ok(parts.every(r => !(d.persons[aunt].x > r.x1 && d.persons[aunt].x < r.x2 && d.persons[aunt].y > r.y1 && d.persons[aunt].y < r.y2)), '每一塊都不含妹妹');
  T.eq(parts.length, 3, '兩列＋一條連接帶');
  // 同一列中間夾著非成員 → 斷開、從下方繞過（U 形）
  const d2 = GT.newDoc();
  const a = GT.addPerson(d2, { gender: 'M', x: 0, y: 0 }), b = GT.addPerson(d2, { gender: 'F', x: 100, y: 0 }), c = GT.addPerson(d2, { gender: 'M', x: 200, y: 0 });
  d2.persons[b].name = '不同住的人';
  const h2 = GT.addHousehold(d2, [a, c]);
  T.eq(GT.render.householdIntruders(d2, d2.households[h2]), [], '中間的人不在圈內');
  const p2 = GT.render.householdParts(d2, d2.households[h2]);
  const bBottom = GT.render.personBox(d2, d2.persons[b]).y2;
  T.ok(p2.some(r => r.x1 < 100 && r.x2 > 100 && r.y1 >= bBottom), '連接帶從中間那個人的標籤下方繞過');
  const svg = GT.render.renderWorld(d2, {});
  T.ok(svg.includes(`<mask id="hm-${h2}"`) && svg.includes(`mask="url(#hm-${h2})"`), '用 mask 只描聯集外圈');
});

T.test('生活圈：無法避開時，面板要能列出被圈到的人', () => {
  const d = GT.newDoc();
  const g = GT.addPerson(d, { gender: 'F', x: 0, y: 0 }), mid = GT.addPerson(d, { gender: 'M', x: 0, y: 160 }), k = GT.addPerson(d, { gender: 'M', x: 0, y: 320 });
  const h = GT.addHousehold(d, [g, k]);   // 隔代同住，中間那代正好在同一直線上
  T.eq(GT.render.householdIntruders(d, d.households[h]), [mid], '列出夾在中間的人');
});

const trackPts = (svg, id) => [...groupOf(svg, id).matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(m => ({ x: +m[1], y: +m[2] }));

T.test('情感關係線不穿過中間的人（回歸）', () => {
  // 曾經：直線穿過中間的人，中斷記號被那人的符號蓋住，讀起來變成跟那個人有關係
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  const m = GT.addPerson(d, { gender: 'F', x: 130, y: 0 });
  const b = GT.addPerson(d, { gender: 'F', x: 280, y: 0 });
  const r = GT.addRelation(d, a, b, 'Cutoff');
  const pts = trackPts(GT.render.renderWorld(d, {}), r);
  T.ok(pts.length > 10, '畫出了軌跡');
  T.ok(pts.every(p => !(Math.abs(p.x - d.persons[m].x) < 24 && Math.abs(p.y - d.persons[m].y) < 24)), '沒有任何一點落在中間那人的符號裡');
  T.ok(pts.some(p => p.y < -20), '往上彎繞過去');
  d.persons[m].y = 200;   // 中間的人移開 → 回到直線
  T.ok(trackPts(GT.render.renderWorld(d, {}), r).every(p => Math.abs(p.y) <= 9), '沒有障礙時是直線（只剩中斷記號的短槓）');
});

T.test('情感關係線從「符號＋標籤」外緣起算（回歸）', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  Object.assign(d.persons[a], { name: '王大明', attrs: { occupation: '臨時工', economy: '低收入戶' } });
  const b = GT.addPerson(d, { gender: 'M', x: 0, y: 320 });
  const r = GT.addRelation(d, a, b, 'Discord');
  const ys = trackPts(GT.render.renderWorld(d, {}), r).map(p => p.y);
  T.ok(Math.min(...ys) >= GT.render.HALF + GT.render.labelBox(d, d.persons[a]).h, '往下的線從標籤下方才開始，不穿過自己的名字');
  T.ok(Math.max(...ys) <= 320 - GT.render.HALF, '停在對方符號外');
});

T.test('圖例樣本', () => {
  for (const t of GT.EMOTION_TYPES) T.ok(!GT.render.sampleSVG('relation', t.key).includes('NaN'), `情感 ${t.key}`);
  for (const t of GT.FAMILY_TYPES) T.ok(GT.render.sampleSVG('union', t.key).includes('<path'), `伴侶 ${t.key}`);
  for (const t of GT.CHILD_LINKS) T.ok(GT.render.sampleSVG('child', t.key).includes('<path'), `親子 ${t.key}`);
  T.ok(GT.render.sampleSVG('child', 'pet').includes(GT.render.G.BLUE), '寵物＝藍色虛線');
});

/* ── v2（2026-09-18）：照 GenoPro 符號表的畫法 ── */

T.test('家庭關係 26 種：斜線數、同居記號、雙線、顏色照參考圖', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 }), b = GT.addPerson(d, { gender: 'F', x: 200, y: 0 });
  const u = GT.linkPartners(d, a, b);
  const g = (type) => { d.unions[u].type = type; return groupOf(GT.render.renderWorld(d, {}), u); };
  const slashN = (s) => { const m = s.match(/class="slash" d="([^"]*)"/); return m ? (m[1].match(/M/g) || []).length : 0; };
  const expect = { Marriage: 0, Separation: 1, SeparationLegal: 1, Divorce: 2, Nullity: 3, EngagementAndSeparation: 1,
                   LegalCohabitationAndLegalSeparation: 2, CohabitationAndSeparation: 1, CasualRelationshipAndSeparation: 1 };
  for (const [type, n] of Object.entries(expect)) T.eq(slashN(g(type)), n, `${type} 斜線 ${n} 條`);
  const houses = GT.FAMILY_TYPES.filter(t => g(t.key).includes('class="house"')).map(t => t.key).sort();
  T.eq(houses, ['Cohabitation', 'CohabitationAndSeparation', 'EngagementAndCohabitation', 'LegalCohabitation',
                'LegalCohabitationAndLegalSeparation', 'LegalCohabitationAndSeparation', 'NonSentimentalCohabitation',
                'NonSentimentalCohabitationAndSeparation'], '有同居的才畫小房子');
  const hLines = (s) => (s.match(/d="M[-0-9.]+,[-0-9.]+H[-0-9.]+"/g) || []).length;
  T.eq(hLines(g('CommittedRelationship')), 2, '長期承諾關係＝雙線');
  T.eq(hLines(g('Marriage')), 1, '結婚＝單線');
  T.ok(g('Divorce').includes(GT.render.G.MAROON), '分開／離婚類＝暗紅');
  T.ok(g('Engagement').includes(GT.render.G.BLUE), '婚約／同居類＝藍');
  T.ok(g('LoveAffair').includes(GT.render.G.PINK), '戀愛＝粉紅');
  d.settings.colorRelations = false;
  T.ok(!g('Divorce').includes(GT.render.G.MAROON), '黑白模式不用顏色');
  for (const t of GT.FAMILY_TYPES) T.ok(!g(t.key).includes('NaN'), `${t.key} 沒有 NaN`);
});

T.test('人物符號：寵物、懷孕、流產、墮胎、移民、多元文化（參考圖）', () => {
  const d = GT.newDoc();
  const mk = (over) => { const id = GT.addPerson(d, { gender: 'M', x: Object.keys(d.persons).length * 150, y: 0 }); Object.assign(d.persons[id], over); return id; };
  const pet = mk({ gender: 'P' }), preg = mk({ gender: 'U', life: 'pregnancy' }), mis = mk({ gender: 'U', life: 'miscarriage' }),
        abo = mk({ gender: 'U', life: 'abortion' }), imm = mk({ culture: 'immigration' }), mul = mk({ culture: 'multiple' });
  const svg = GT.render.renderWorld(d, {});
  T.ok(groupOf(svg, pet).includes('<polygon'), '寵物＝菱形');
  T.ok(groupOf(svg, preg).includes('<polygon points="0,-15 14,13 -14,13"'), '懷孕＝三角形');
  T.ok(groupOf(svg, mis).includes('<circle r="5.5" fill='), '流產＝小黑點');
  T.ok(groupOf(svg, abo).includes('<path d="M-6,-6L6,6M6,-6L-6,6"'), '墮胎＝小叉');
  const curves = (s) => (s.match(/C/g) || []).length;
  T.ok(curves(groupOf(svg, imm)) > 0, '移民有波浪線');
  T.eq(curves(groupOf(svg, mul)), 2 * curves(groupOf(svg, imm)), '多元文化的波浪線是移民的兩倍');
  T.ok(GT.render.personBox(d, d.persons[imm]).y1 < GT.render.personBox(d, d.persons[mk({})]).y1, '有波浪線的人，外框往上多留空間');
});

T.test('成癮與疾病：左半＝疾病、下半＝濫用、灰＝疑似、復原中留白、疾病色、成癮框色', () => {
  const d = GT.newDoc();
  const mk = (over, gender) => { const id = GT.addPerson(d, { gender: gender || 'M', x: Object.keys(d.persons).length * 150, y: 0 }); Object.assign(d.persons[id], over); return id; };
  const ill = mk({ illness: 'active' }), sub = mk({ substance: 'active' }), sus = mk({ substance: 'suspected' }),
        both = mk({ illness: 'active', substance: 'active' }), rec = mk({ illness: 'recovery' }),
        med = mk({ illness: 'active', conditions: ['Cancer', 'Diabetes'] }), add = mk({ conditions: ['Alcoholism', 'Gambling'] }),
        circ = mk({ illness: 'active', substance: 'recovery' }, 'F');
  const svg = GT.render.renderWorld(d, {}), black = GT.render.G.BLACK;
  T.ok(groupOf(svg, ill).includes(`<path d="M-20,-20H0V20H-20Z" fill="${black}"`), '疾病＝左半塗黑');
  T.ok(groupOf(svg, sub).includes(`<path d="M-20,0H20V20H-20Z" fill="${black}"`), '濫用＝下半塗黑');
  T.ok(groupOf(svg, sus).includes(`fill="${GT.render.SUSPECT_FILL}"`), '疑似＝下半灰');
  T.ok(GT.render.SUSPECT_FILL !== GT.render.INDEX_FILL, '疑似的灰跟案主的灰不同');
  const gb = groupOf(svg, both);
  T.ok(gb.includes('M-20,-20H0V20H-20Z') && gb.includes('M-20,0H20V20H-20Z'), '兩者都有＝左半＋下半（3/4）');
  T.ok(groupOf(svg, rec).includes('<rect x="-15" y="-15" width="10" height="30" fill="#FFFFFF"'), '復原中＝塗色區中間留白');
  const gm = groupOf(svg, med);
  T.ok(gm.includes('clip-path=') && gm.includes('#D81B90') && gm.includes('#6A1B9A'), '疾病別顏色（癌症、糖尿病）填在左上格');
  const ga = groupOf(svg, add);
  T.ok(ga.includes('stroke="#1E40D8"') && ga.includes('stroke="#E0107A"'), '成癮別＝外框顏色（酗酒、賭博）');
  const gc = groupOf(svg, circ);
  T.ok(gc.includes('A20,20') && gc.includes('<circle cx='), '圓形也畫得出來（半圓＋復原留白）');
  d.settings.colorRelations = false;
  T.ok(!groupOf(GT.render.renderWorld(d, {}), med).includes('#D81B90'), '黑白模式疾病色改深色');
});

T.test('雙胞胎：從同一點分岔，同卵加橫槓、不確定加「?」（參考圖）', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  const { unionId: u } = GT.addPartner(d, a);
  const k1 = GT.addChild(d, u, 'M'), k2 = GT.addChild(d, u, 'F'), k3 = GT.addChild(d, u, 'M');
  GT.setTwins(d, u, [k1, k2], 'Fraternal');
  const g = groupOf(GT.render.renderWorld(d, {}), u);
  const apex = (d.persons[k1].x + d.persons[k2].x) / 2;
  T.ok(g.includes(`M${apex},`), '雙胞胎從兩人中間的同一點出發');
  T.ok(!g.includes('class="twin-bar"'), '異卵沒有橫槓');
  T.ok(g.includes(`M${d.persons[k3].x},`), '非雙胞胎的孩子照常垂直連線');
  d.unions[u].twins[0].kind = 'Identical';
  T.ok(groupOf(GT.render.renderWorld(d, {}), u).includes('class="twin-bar"'), '同卵有橫槓');
  d.unions[u].twins[0].kind = 'Unknown';
  T.ok(groupOf(GT.render.renderWorld(d, {}), u).includes('>?</text>'), '不確定加「?」');
});

T.test('情感關係 38 種：彩色模式下畫法都不一樣；有方向的才有箭頭', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 }), b = GT.addPerson(d, { gender: 'F', x: 240, y: 0 });
  const r = GT.addRelation(d, a, b, 'Plain');
  const seen = new Map();
  for (const t of GT.EMOTION_TYPES) {
    d.relations[r].type = t.key;
    const g = groupOf(GT.render.renderWorld(d, { forExport: true }), r);
    T.ok(!seen.has(g), seen.has(g) ? `${t.label} 跟 ${seen.get(g)} 畫得一模一樣` : `${t.label} 獨一無二`);
    seen.set(g, t.label);
    T.eq(g.includes('class="arrow"'), !!t.dir, `${t.label}：${t.dir ? '有' : '沒有'}箭頭`);
  }
});

T.test('回歸：和諧相處要跟一般分得出來——彩色用淺綠、黑白用灰（使用者 2026-09-18）', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 }), b = GT.addPerson(d, { gender: 'F', x: 240, y: 0 });
  const r = GT.addRelation(d, a, b, 'Plain');
  const g = (type, color) => { d.settings.colorRelations = color; d.relations[r].type = type; return groupOf(GT.render.renderWorld(d, { forExport: true }), r); };
  const luma = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); };
  T.ok(g('Harmony', true).includes(GT.render.G.LIGHT_GREEN), '彩色：和諧相處用淺綠');
  T.ok(luma(GT.render.G.LIGHT_GREEN) >= 120, '淺綠印成灰階時明顯比黑線淡');
  T.ok(g('Harmony', false).includes(GT.render.BW_GRAY.Harmony), '黑白：和諧相處畫灰色');
  T.ok(g('Harmony', false) !== g('Plain', false), '黑白：和諧相處跟一般不一樣');
  const seen = new Map();
  for (const t of GT.EMOTION_TYPES) {
    const s = g(t.key, false);
    T.ok(!seen.has(s), seen.has(s) ? `黑白：${t.label} 跟 ${seen.get(s)} 畫得一模一樣` : `黑白：${t.label} 獨一無二`);
    seen.set(s, t.label);
  }
});

/* ── 第 6 步（2026-09-18）：拖曳圈選、屬性面板小預覽、雙胞胎圖例 ── */

T.test('拖曳圈選：框住人的中心點就選到；兩端都框到的線、成員全框到的生活圈一起選', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 }), b = GT.addPerson(d, { gender: 'F', x: 200, y: 0 }), c = GT.addPerson(d, { gender: 'M', x: 600, y: 0 });
  const u = GT.linkPartners(d, a, b), r1 = GT.addRelation(d, a, b, 'Plain'), r2 = GT.addRelation(d, b, c, 'Plain');
  const h = GT.addHousehold(d, [a, b], ''), t = GT.addLabel(d, 60, 150, '備註');
  const got = (x1, y1, x2, y2) => GT.render.itemsInRect(d, { x1, y1, x2, y2 }).sort();
  T.eq(got(-50, -50, 250, 50), [a, b, u, r1, h].sort(), '框住兩人 → 兩人＋伴侶線＋情感線＋生活圈');
  T.ok(!got(-50, -50, 250, 50).includes(r2), '另一端沒框到的線不選');
  T.eq(got(250, 50, -50, -50), got(-50, -50, 250, 50), '反方向拉框，結果一樣');
  T.eq(got(-50, -50, 10, 10), [a], '中心點在框內就算選到');
  T.eq(got(15, -50, 150, 50), [], '只框到半個人（中心點在框外）不算');
  T.eq(got(50, 120, 200, 200), [t], '文字說明看整塊的中心');
  T.eq(got(1000, 1000, 1100, 1100), [], '空白處什麼都不選');
});

T.test('回歸：生活圈內部看不見的接縫不算點到外框（實測在接縫附近拖曳圈選，結果選到生活圈）', () => {
  const d = GT.newDoc();
  const p = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  const r = GT.addPartner(d, p);
  const k1 = GT.addChild(d, r.unionId, 'F'), k2 = GT.addChild(d, r.unionId, 'M'), k3 = GT.addChild(d, r.unionId, 'M');
  const hid = GT.addHousehold(d, [p, k1, k2, k3], ''), h = d.households[hid];
  const parts = GT.render.householdParts(d, h);
  T.ok(parts.length >= 2, '測試前提：這個生活圈由兩塊以上的矩形拼成');
  let seam = null;                    // 接縫：某塊矩形的下緣落在另一塊矩形裡面
  for (const A of parts) for (const B of parts) {
    if (A === B || !(A.y2 > B.y1 + 4 && A.y2 < B.y2 - 4)) continue;
    const x1 = Math.max(A.x1, B.x1) + 8, x2 = Math.min(A.x2, B.x2) - 8;
    if (x2 > x1) seam = { x: (x1 + x2) / 2, y: A.y2 };
  }
  T.ok(seam, '測試前提：找得到接縫');
  if (seam) T.ok(GT.render.householdInterior(d, h, seam.x, seam.y), '接縫上的點＝圈的內部，不算點到外框');
  const left = parts.reduce((m, q) => (q.x1 < m.x1 ? q : m)), my = (left.y1 + left.y2) / 2;
  T.ok(!GT.render.householdInterior(d, h, left.x1, my), '真正的外框上：照樣點得到');
  T.ok(!GT.render.householdInterior(d, h, left.x1 + 2, my), '外框往內 2px：照樣點得到');
  T.ok(!GT.render.householdInterior(d, h, left.x1 - 5, my), '圈外不是內部');
});

T.test('屬性面板小預覽：只畫符號（含狀態），不畫標籤；id 不跟畫布撞', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'F', x: 0, y: 0 });
  Object.assign(d.persons[a], { name: '王小美', illness: 'active', conditions: ['Cancer'], culture: 'immigration', attrs: { occupation: '工人' } });
  const s = GT.render.symbolSVG(d, d.persons[a], 34);
  T.ok(s.startsWith('<svg') && s.includes('width="34"') && !s.includes('NaN'), '是一張 34px 的小圖');
  T.ok(!s.includes('王小美') && !s.includes('工人'), '不畫姓名與欄位');
  T.ok(s.includes('#D81B90'), '疾病色（癌症）在');
  T.ok(s.includes('stroke-width="6" stroke-linecap="round"'), '移民波浪線在');
  T.ok(s.includes(`hq-pv-${a}`) && !s.includes(`"hq-${a}"`), 'clipPath 的 id 加前綴，不會跟畫布上同一人撞 id');
});

T.test('圖例：三種雙胞胎畫法都不一樣', () => {
  const tw = GT.TWIN_KINDS.map(k => GT.render.sampleSVG('twins', k.key, true));
  T.eq(new Set(tw).size, 3, '異卵、同卵、不確定各不相同');
  T.ok(tw.every(x => x.startsWith('<svg') && !x.includes('NaN')), '都畫得出來、沒有 NaN');
  T.ok(tw[1].includes('class="twin-bar"') && tw[2].includes('>?</text>'), '同卵有橫槓、不確定有「?」');
});

/* ── v3（2026-09-20）：生態圖 ── */

T.test('生態圖畫法：資源圓、強弱、壓力、流向、線上文字', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  const s = GT.addSystem(d, { name: '○○國小', x: 400, y: 0 });
  const t = GT.addTie(d, s, a, { note: '導師每週回報' });
  const g = (id) => groupOf(GT.render.renderWorld(d, {}), id);
  T.ok(g(s).includes('<circle') && g(s).includes('○○國小'), '資源畫成圓、名稱寫在圓裡');
  T.ok(GT.render.systemRadius({ name: '很長的資源名稱要換行' }) > GT.render.systemRadius({ name: '學校' }), '名稱長，圓跟著變大');
  T.ok(g(t).includes('導師每週回報'), '線上寫的事畫在線上');
  const lines = (x) => (x.match(/<path d="M[-0-9.]+,[-0-9.]+L/g) || []).length;
  d.ties[t].strength = 'normal';
  const one = lines(g(t));
  d.ties[t].strength = 'strong';
  T.eq(lines(g(t)), one + 1, '強＝雙線（比普通多一條）');
  d.ties[t].strength = 'weak';
  T.ok(g(t).includes('stroke-dasharray'), '弱＝虛線');
  d.ties[t].strength = 'normal'; d.ties[t].stress = true;
  T.ok(g(t).includes(GT.render.G.RED), '有壓力＝紅色（黑白模式下靠鋸齒分辨）');
  d.settings.colorRelations = false;
  T.ok(!g(t).includes(GT.render.G.RED), '黑白模式不用紅色');
  d.settings.colorRelations = true;
  d.ties[t].stress = false;
  T.ok(!g(t).includes('class="arrow"'), '沒設流向就沒有箭頭');
  d.ties[t].dir = 'a2b';
  T.eq((g(t).match(/class="arrow"/g) || []).length, 1, '單向＝一個箭頭');
  d.ties[t].dir = 'both';
  T.eq((g(t).match(/class="arrow"/g) || []).length, 2, '雙向＝兩個箭頭');
  T.ok(!g(t).includes('NaN'), '沒有 NaN');
});

T.test('生態圖：三種顯示模式', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  const s = GT.addSystem(d, { name: '學校', x: 400, y: 0 });
  GT.addTie(d, s, a, {});
  const svg = () => GT.render.renderWorld(d, {});
  d.settings.view = 'genogram';
  T.ok(svg().includes('data-kind="person"') && !svg().includes('data-kind="system"'), '只看家系圖：不畫資源與連結');
  T.ok(!svg().includes('data-kind="tie"'), '只看家系圖：連結也不畫');
  d.settings.view = 'both';
  T.ok(svg().includes('data-kind="person"') && svg().includes('data-kind="system"'), '家系圖＋生態圖：兩邊都畫');
  d.settings.view = 'ecomap';
  T.ok(!svg().includes('data-kind="person"') && svg().includes('class="famnode"'), '生態圖：家系圖收成一個「家庭」圓');
  T.ok(svg().includes('data-kind="system"') && svg().includes('data-kind="tie"'), '生態圖：資源與連結照畫');
  const b = GT.render.bbox(d);
  T.ok(b.w > 0 && b.h > 0 && Number.isFinite(b.x), '生態圖模式的外框算得出來（匯出用）');
  T.eq(GT.render.itemsInRect(d, { x1: -600, y1: -600, x2: 600, y2: 600 }).includes(a), false, '生態圖模式下框選不會選到收起來的人');
  d.settings.view = 'both';
  T.ok(GT.render.itemsInRect(d, { x1: -600, y1: -600, x2: 600, y2: 600 }).includes(s), '框選選得到資源');
});

T.test('回歸：連到整個家庭的線要停在生活圈的界線上，不能停在空中', () => {
  const d = GT.newDoc();
  const p = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  const r = GT.addPartner(d, p);
  const k1 = GT.addChild(d, r.unionId, 'F'), k2 = GT.addChild(d, r.unionId, 'M');
  const hid = GT.addHousehold(d, [p, k1, k2], '同住'), h = d.households[hid];
  const parts = GT.render.householdParts(d, h);
  T.ok(parts.length >= 2, '測試前提：生活圈由兩塊以上矩形拼成（中間只有窄窄的連接段）');
  const box = { x1: Math.min(...parts.map(q => q.x1)), y1: Math.min(...parts.map(q => q.y1)),
                x2: Math.max(...parts.map(q => q.x2)), y2: Math.max(...parts.map(q => q.y2)) };
  const s = GT.addSystem(d, { name: '學校', x: box.x2 + 250, y: (box.y1 + box.y2) / 2 });   // 對準兩列中間（只有連接段）
  GT.addTie(d, s, hid, {});
  const A = GT.render.tieAnchor(d, hid, 'both'), B = GT.render.tieAnchor(d, s, 'both');
  const e = GT.render.edgePoint(A, B.x, B.y);
  const onShape = parts.some(q => e.x >= q.x1 - 3 && e.x <= q.x2 + 3 && e.y >= q.y1 - 3 && e.y <= q.y2 + 3);
  T.ok(onShape, '端點落在生活圈的實際形狀上');
  T.ok(e.x < box.x2 - 1, '不是停在整體外框的右緣（那裡是空的）');
  const pa = GT.render.tieAnchor(d, p, 'both');
  T.eq(pa.kind, 'rect', '連到人：端點用人的符號');
  T.eq(GT.render.tieAnchor(d, hid, 'ecomap').kind, 'circle', '生態圖模式下，生活圈收成家庭圓');
});

T.test('回歸：匯出範圍要含生態連結與線上文字（審查 2026-09-20：原本會把字裁掉）', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  const sys = GT.addSystem(d, { name: '家防中心', x: 160, y: 0 });
  const t = GT.addTie(d, sys, a, { note: '通報 2025-03、保護令、每週訪視一次，這是一條很長的備註' });
  const g = GT.render.tieGeometry(d, d.ties[t], 'both');
  const b = GT.render.bbox(d);
  T.ok(g.note, '這條線有線上文字');
  T.ok(g.note.x1 < b.x + 1 || g.note.x1 >= b.x, '前提：文字框比兩端還寬（會超出人與資源的範圍）');
  T.ok(b.x <= g.note.x1 + 0.5 && b.x + b.w >= g.note.x2 - 0.5, '圖的範圍左右包得住線上文字');
  T.ok(b.y <= g.note.y1 + 0.5 && b.y + b.h >= g.note.y2 - 0.5, '圖的範圍上下包得住線上文字');
  const m = GT.render.exportSVG(d).match(/viewBox="([-0-9.]+) ([-0-9.]+) ([0-9.]+) ([0-9.]+)"/);
  T.ok(m && +m[1] <= g.note.x1 && +m[1] + +m[3] >= g.note.x2, '匯出的 SVG 也包得住（不會裁掉字）');
  d.settings.view = 'ecomap';
  const b2 = GT.render.bbox(d), g2 = GT.render.tieGeometry(d, d.ties[t], 'ecomap');
  T.ok(b2.x <= g2.note.x1 + 0.5 && b2.x + b2.w >= g2.note.x2 - 0.5, '生態圖模式也包得住');
  d.settings.view = 'both';
});

T.test('回歸：框選要選得到連到人、連到生活圈的生態連結（審查 2026-09-20）', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 }), b = GT.addPerson(d, { gender: 'F', x: 80, y: 0 });
  const h = GT.addHousehold(d, [a, b], '同住');
  const s1 = GT.addSystem(d, { name: '學校', x: 260, y: 0 }), s2 = GT.addSystem(d, { name: '醫院', x: 260, y: 140 });
  const toPerson = GT.addTie(d, s1, a, {}), toHouse = GT.addTie(d, s1, h, {}), toSys = GT.addTie(d, s1, s2, {});
  const all = () => GT.render.itemsInRect(d, { x1: -300, y1: -300, x2: 500, y2: 500 });
  T.ok(all().includes(toPerson), '家系圖＋生態圖：連到人的線選得到');
  T.ok(all().includes(toHouse), '家系圖＋生態圖：連到整個家庭的線選得到');
  T.ok(all().includes(toSys), '家系圖＋生態圖：資源之間的線選得到');
  d.settings.view = 'ecomap';
  T.ok(all().includes(toPerson) && all().includes(toHouse), '生態圖模式：連到家庭圓的線也選得到');
  T.eq(GT.render.itemsInRect(d, { x1: 200, y1: -60, x2: 320, y2: 60 }).includes(toPerson), false,
       '生態圖模式：只框到資源、沒框到家庭圓 → 不選那條線');
  d.settings.view = 'genogram';
  T.eq(all().filter(id => d.ties[id]).length, 0, '只看家系圖：連結不在選取範圍內');
  d.settings.view = 'both';
});

T.test('資源名稱留空時，圖上顯示「資源」', () => {
  const d = GT.newDoc();
  const s = GT.addSystem(d, { x: 0, y: 0 });
  T.eq(d.systems[s].name, '', '資料裡存空字串');
  T.ok(groupOf(GT.render.renderWorld(d, {}), s).includes('資源'), '畫的時候顯示「資源」');
});

/* ── 線旁說明（2026-09-21）── */

T.test('線旁說明：特殊線條自動標名稱，基本線條不標；使用者寫的說明一律顯示（使用者 2026-09-21）', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 }), b = GT.addPerson(d, { gender: 'F', x: 200, y: 0 });
  const u = GT.linkPartners(d, a, b);
  const r = GT.addRelation(d, a, b, 'Harmony');
  const labels = () => GT.render.lineLabels(d).map(L => L.text);
  T.eq(labels(), [], '基本線條（結婚、和諧相處）沒寫說明就不標');
  d.unions[u].type = 'SeparationLegal';
  T.eq(labels(), ['合法分居'], '特殊的伴侶線自動標名稱');
  d.relations[r].type = 'AbusePhysical';
  T.ok(labels().includes('身體虐待'), '特殊的情感關係也自動標名稱');
  d.unions[u].type = 'Marriage'; d.unions[u].note = '1990 結婚';
  T.ok(labels().includes('1990 結婚'), '基本線條寫了說明也會顯示');
  d.unions[u].type = 'Nullity';
  T.ok(labels().includes('婚姻無效：1990 結婚'), '特殊線條＋說明＝「名稱：說明」');
  const svg = GT.render.renderWorld(d, {});
  T.ok(svg.includes('婚姻無效：1990 結婚'), '畫在圖上');
  T.ok(svg.includes(`class="linelabel" data-id="${u}" data-kind="union"`), '點字等於點那條伴侶線');
  T.ok(svg.indexOf('class="linelabel"') > svg.lastIndexOf('data-kind="person"'), '畫在人物之上，不會被標籤蓋住');
  d.unions[u].note = '<img src=x onerror=alert(1)>';
  T.ok(!GT.render.renderWorld(d, {}).includes('<img'), '線旁說明有跳脫（XSS 守衛）');
  d.settings.lineLabels = false;
  T.eq(labels(), [], '顯示設定關掉就全部不標');
  T.ok(!GT.render.renderWorld(d, {}).includes('class="linelabel"'), '關掉後圖上沒有線旁說明');
  d.settings.lineLabels = true;
  d.settings.view = 'ecomap';
  T.ok(!GT.render.renderWorld(d, {}).includes('class="linelabel"'), '生態圖模式（家庭收成一個圓）不畫家系圖的線旁說明');
  d.settings.view = 'both';
});

T.test('回歸：線旁說明要包進匯出範圍（依 2026-09-20 教訓：新增看得見的元素要同步更新圖的範圍）', () => {
  const d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 }), b = GT.addPerson(d, { gender: 'F', x: 100, y: 0 });
  const u = GT.linkPartners(d, a, b, 'LegalCohabitationAndLegalSeparation');
  d.unions[u].note = '2010 同居、2018 分開，目前各自住，孩子由母親照顧';
  const L = GT.render.lineLabels(d)[0], box = GT.render.lineLabelBox(L), bb = GT.render.bbox(d);
  T.ok(box.x2 - box.x1 > 200, '前提：這段說明比兩個人還寬');
  T.ok(bb.x <= box.x1 && bb.x + bb.w >= box.x2 && bb.y + bb.h >= box.y2, '圖的範圍包得住線旁說明（匯出不會裁掉）');
});
