/* 家系圖工具 — render.js
 * 純函式：文件 → SVG 字串。畫面顯示與匯出圖片共用同一套，所見即所得。
 * 安全：所有使用者文字一律經 esc() 跳脫後才放進 SVG（畫面用 innerHTML 更新）。
 * 符號與線型依據：GenoPro「Genogram Symbols 基本常用家族圖符號」參考圖（使用者提供，2026-09-17）。
 */
(function (GT) {
  'use strict';

  const C = {                       // 介面配色＝共用設計系統 UI_Design.md
    INK: '#173F52', INK_SOFT: '#5B7688', MUTED: '#8AA2B1', BRAND: '#2E86AB', CYAN: '#38BDF8',
    OK: '#12855A', WARN: '#B26A00', HEART: '#E23A3A', DARK_RED: '#A3161C', WHITE: '#FFFFFF',
  };
  // 家系圖線條配色＝參考圖；「情感關係線用彩色」關掉時一律改成 INK（黑白列印靠線型區分）
  const G = {
    BLACK: '#1F2328', MAROON: '#8B1A1A', BLUE: '#1F4FD1', PINK: '#E0457B', GREEN: '#2E8B3E',
    RED: '#E0201B', ABUSE: '#1D4ED8', PURPLE: '#6A2CA0', LIGHT_GREEN: '#5DBB63',
  };
  // 黑白模式下原本只靠顏色區分的類型改畫灰色（使用者 2026-09-18：和諧相處跟一般在黑白、灰階列印時要分得出來）
  const BW_GRAY = { Harmony: '#9A9A9A' };
  const INDEX_FILL = '#E4E4E4';     // 服務對象（指標人物）灰底——刻意比「疑似濫用」的灰淺很多，兩者同時出現也分得出來
  const SUSPECT_FILL = '#8A8A8A';   // 疑似酒精或藥物濫用（參考圖：下半部灰色）
  const FONT = "'Microsoft JhengHei UI','Microsoft JhengHei','微軟正黑體','Noto Sans TC','PingFang TC',sans-serif";
  const HALF = GT.S / 2;
  const DROP = 22;                  // 伴侶線在符號下方多深
  const NAME_PX = 13, ATTR_PX = 12, LINE_H = 16;

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                              .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const f = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : 0);   // 座標取一位小數，杜絕 NaN
  const tint = (doc, color) => (doc.settings.colorRelations ? color : C.INK);

  // ── 家庭關係線型（GenoPro 26 種；參考圖 20 種）：color 線色、dash 虛線、house 同居記號、slash 斜線數、double 雙線 ──
  const FAMILY_STYLE = {
    Marriage:                                { color: G.BLACK },
    Widowed:                                 { color: G.BLACK },
    Separation:                              { color: G.MAROON, slash: 1 },
    SeparationLegal:                         { color: G.MAROON, slash: 1, bold: true },
    Divorce:                                 { color: G.MAROON, slash: 2 },
    Nullity:                                 { color: G.MAROON, slash: 3 },
    Engagement:                              { color: G.BLUE, dash: '8 4' },
    EngagementAndCohabitation:               { color: G.BLUE, dash: '8 4', house: true },
    EngagementAndSeparation:                 { color: G.BLUE, dash: '8 4', slash: 1 },
    LegalCohabitation:                       { color: G.BLUE, dash: '10 3 2 3', house: true },
    LegalCohabitationAndSeparation:          { color: G.BLUE, dash: '10 3 2 3', house: true, slash: 1 },
    LegalCohabitationAndLegalSeparation:     { color: G.BLUE, dash: '10 3 2 3', house: true, slash: 2 },
    Cohabitation:                            { color: G.BLUE, dash: '2 3', house: true },
    CohabitationAndSeparation:               { color: G.BLUE, dash: '2 3', house: true, slash: 1 },
    NonSentimentalCohabitation:              { color: G.BLUE, dash: '1 5', house: true },
    NonSentimentalCohabitationAndSeparation: { color: G.BLUE, dash: '1 5', house: true, slash: 1 },
    CommittedRelationship:                   { color: G.BLUE, dash: '12 3', double: true },
    CommittedRelationshipAndSeparation:      { color: G.BLUE, dash: '12 3', double: true, slash: 1 },
    CasualRelationship:                      { color: G.BLUE, dash: '2 4' },
    CasualRelationshipAndSeparation:         { color: G.BLUE, dash: '2 4', slash: 1 },
    TemporaryRelation:                       { color: G.BLUE, dash: '1 6' },
    Liaison:                                 { color: G.BLUE, dash: '4 4' },
    LoveAffair:                              { color: G.PINK, dash: '6 4' },
    LoveAffairAndSeparation:                 { color: G.PINK, dash: '6 4', slash: 1 },
    Rape:                                    { color: G.MAROON, dash: '2 3' },
    Other:                                   { color: C.MUTED, dash: '1 4' },
  };
  const CHILD_STYLE = { bio: { dash: '' }, adopted: { dash: '6 4' }, foster: { dash: '2 3', color: G.GREEN } };
  const PET_LINK = { dash: '6 4', color: G.BLUE };   // 參考圖：寵物用藍色虛線

  // ── 符號幾何：各種符號的上下緣（伴侶線、親子線、標籤都依它定位）──
  function symExtent(p) {
    if (p.life === 'miscarriage') return { top: 6, bottom: 6 };
    if (p.life === 'abortion') return { top: 7, bottom: 7 };
    if (p.life === 'pregnancy') return { top: 15, bottom: 13 };
    if (p.gender === 'P') return { top: 22, bottom: 22 };
    return { top: HALF, bottom: HALF };
  }
  const symTop = (p) => p.y - symExtent(p).top;
  const symBottom = (p) => p.y + symExtent(p).bottom;
  const CULTURE_H = 28;              // 移民／多元文化波浪線佔的高度（畫在符號正上方）
  // 年齡寫在符號裡的只有方、圓、菱形；「?」與懷孕／流產／墮胎改寫在標籤
  const ageInside = (p) => !p.life && p.gender !== 'U';

  // ── 人物 ──
  function labelBox(doc, p) {
    const lines = GT.labelLines(doc, p).slice();
    if (!ageInside(p) && !p.life) {
      const a = GT.ageOf(doc, p).value;
      if (a !== null) lines.splice(lines.length && lines[0].kind === 'name' ? 1 : 0, 0, { text: `${a} 歲`, kind: 'attr' });
    }
    const w = Math.max(GT.S, ...lines.map(l => GT.textEm(l.text) * (l.kind === 'name' ? NAME_PX : ATTR_PX)));
    return { lines, w, h: lines.length ? lines.length * LINE_H + 6 : 0 };
  }

  // 形狀外框（M 方、F 圓、P 菱形）；inset＞0 畫在內側（多種成癮時的第二、三道框）
  function outline(gender, inset, attrs) {
    const h = HALF - inset;
    if (gender === 'M') return `<rect x="${-h}" y="${-h}" width="${2 * h}" height="${2 * h}" ${attrs}/>`;
    if (gender === 'F') return `<circle r="${h}" ${attrs}/>`;
    const d = h * 1.12;
    return `<polygon points="0,${f(-d)} ${f(d)},0 0,${f(d)} ${f(-d)},0" ${attrs}/>`;
  }

  // 成癮與疾病的區塊（參考圖左欄）：疾病＝左半、濫用＝下半；疾病別顏色填左上格
  function healthMarkup(doc, p) {
    if (p.gender !== 'M' && p.gender !== 'F') return '';
    const med = (p.conditions || []).map(k => GT.CONDITIONS.find(c => c.key === k)).filter(c => c && c.kind === 'medical');
    if (!p.illness && !p.substance && !med.length) return '';
    const h = HALF, sq = p.gender === 'M', out = [];
    const region = (which) => {       // left / bottom / tl 三種區塊的路徑
      if (sq) return which === 'left' ? `M${-h},${-h}H0V${h}H${-h}Z` : which === 'bottom' ? `M${-h},0H${h}V${h}H${-h}Z` : `M${-h},${-h}H0V0H${-h}Z`;
      return which === 'left' ? `M0,${-h}A${h},${h} 0 0 0 0,${h}Z` : which === 'bottom' ? `M${-h},0A${h},${h} 0 0 0 ${h},0Z` : `M0,0V${-h}A${h},${h} 0 0 0 ${-h},0Z`;
    };
    const ink = doc.settings.colorRelations ? G.BLACK : C.INK;
    if (p.illness) out.push(`<path d="${region('left')}" fill="${ink}"/>`);
    if (p.substance) out.push(`<path d="${region('bottom')}" fill="${p.substance === 'suspected' ? SUSPECT_FILL : ink}"/>`);
    if (med.length) {                 // 疾病別：左上格塗色，多種就分成直條
      const w = h / med.length;
      const clip = `hq-${esc(p.id)}`;
      out.push(`<clipPath id="${clip}"><path d="${region('tl')}"/></clipPath><g clip-path="url(#${clip})">` +
               med.map((c, i) => `<rect x="${f(-h + i * w)}" y="${-h}" width="${f(w + 0.3)}" height="${h}" fill="${tint(doc, c.color)}"/>`).join('') + '</g>');
    }
    // 復原中：塗色區中間留白（參考圖的「空心」效果）；留白不畫到另一軸仍在發作的區塊上
    const illActive = p.illness && p.illness !== 'recovery', subActive = p.substance && p.substance !== 'recovery';
    if (p.illness === 'recovery') {
      out.push(sq ? `<rect x="${-h + 5}" y="${-h + 5}" width="${h - 10}" height="${subActive ? h - 10 : 2 * h - 10}" fill="#FFFFFF"/>`
                  : `<circle cx="${f(-h * 0.45)}" cy="${subActive ? f(-h * 0.4) : 0}" r="${f(h * 0.28)}" fill="#FFFFFF"/>`);
    }
    if (p.substance === 'recovery') {
      out.push(sq ? `<rect x="${illActive ? 5 : -h + 5}" y="5" width="${illActive ? h - 10 : 2 * h - 10}" height="${h - 10}" fill="#FFFFFF"/>`
                  : `<circle cx="${illActive ? f(h * 0.4) : 0}" cy="${f(h * 0.45)}" r="${f(h * 0.28)}" fill="#FFFFFF"/>`);
    }
    return out.join('');
  }

  // 移民／多元文化：符號正上方的波浪線（白底襯著，會把親子線斷開，跟參考圖一樣）
  function cultureMarkup(doc, p) {
    if (!p.culture) return '';
    const y0 = -symExtent(p).top - 2;
    // 一個 S 形彎（由下往上）；多元文化＝兩條並排
    const loop = (x) => `M${x},${y0}C${x + 7},${y0 - 3} ${x + 7},${y0 - 9} ${x},${y0 - 11}C${x - 7},${y0 - 13} ${x - 7},${y0 - 19} ${x},${y0 - 22}`;
    const d = p.culture === 'multiple' ? loop(-4) + loop(4) : loop(0);
    const color = tint(doc, G.BLACK);
    return `<path d="${d}" fill="none" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round"/>` +
           `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>`;
  }

  function symbolMarkup(doc, p) {
    const out = [];
    const ink = tint(doc, G.BLACK);
    const addictions = (p.conditions || []).map(k => GT.CONDITIONS.find(c => c.key === k)).filter(c => c && c.kind === 'addiction');
    const border = addictions.length ? tint(doc, addictions[0].color) : ink;
    const sw = p.index ? 3.6 : 2;                       // 服務對象＝框線加粗＋灰底
    const fill = p.index ? INDEX_FILL : '#FFFFFF';
    if (p.life === 'pregnancy') {
      out.push(`<polygon points="0,-15 14,13 -14,13" fill="${fill}" stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"/>`);
    } else if (p.life === 'miscarriage') {
      out.push(`<circle r="5.5" fill="${ink}"/>`);
    } else if (p.life === 'abortion') {
      out.push(`<path d="M-6,-6L6,6M6,-6L-6,6" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>`);
    } else if (p.gender === 'U') {                       // 參考圖：未知性別＝「?」
      if (p.index) out.push(`<rect x="-16" y="-20" width="32" height="40" rx="4" fill="${INDEX_FILL}" stroke="${ink}" stroke-width="${sw}"/>`);
      out.push(`<text y="13" text-anchor="middle" font-size="36" font-weight="700" fill="${ink}">?</text>`);
    } else {
      out.push(outline(p.gender, 0, `fill="${fill}"`));
      out.push(healthMarkup(doc, p));
      out.push(outline(p.gender, 0, `fill="none" stroke="${border}" stroke-width="${sw}"`));
      addictions.slice(1).forEach((c, i) => out.push(outline(p.gender, 3.5 * (i + 1) + sw / 2, `fill="none" stroke="${tint(doc, c.color)}" stroke-width="1.8"`)));
    }
    if (p.deceased && !p.life) {
      const k = p.gender === 'M' ? HALF : p.gender === 'F' ? HALF * 0.72 : p.gender === 'P' ? HALF * 0.62 : HALF * 0.7;
      out.push(`<path d="M${f(-k)},${f(-k)}L${f(k)},${f(k)}M${f(k)},${f(-k)}L${f(-k)},${f(k)}" stroke="${ink}" stroke-width="1.8" stroke-opacity="0.8"/>`);
    }
    if (ageInside(p)) {
      const age = GT.ageOf(doc, p).value;
      if (age !== null) {
        const fs = age >= 100 ? 12 : 15;
        const halo = p.deceased || p.illness || p.substance || p.index ? 3.5 : 0;
        out.push(`<text class="age" y="${fs / 3 + 0.5}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${C.INK}" stroke="#FFFFFF" stroke-width="${halo}" paint-order="stroke">${age}</text>`);
      }
    }
    out.push(cultureMarkup(doc, p));
    return out.join('');
  }

  function personMarkup(doc, p, o) {
    const sel = o.selection && o.selection.has(p.id);
    const pend = o.pending === p.id;
    const lb = labelBox(doc, p), e = symExtent(p);
    const ctop = e.top + (p.culture ? CULTURE_H : 0);
    const out = [`<g class="person" data-id="${esc(p.id)}" data-kind="person" transform="translate(${f(p.x)},${f(p.y)})">`];
    if (!o.forExport && (sel || pend)) {
      const w = Math.max(lb.w, GT.S) + 16, h = ctop + e.bottom + 20 + lb.h;
      out.push(`<rect class="sel" x="${f(-w / 2)}" y="${-ctop - 10}" width="${f(w)}" height="${f(h)}" rx="10" fill="${pend ? C.WARN : C.CYAN}" fill-opacity="0.12" stroke="${pend ? C.WARN : C.CYAN}" stroke-width="2" stroke-dasharray="${pend ? '4 3' : ''}"/>`);
    }
    out.push(symbolMarkup(doc, p));
    let y = e.bottom + 15;
    // 標籤整塊白底（GenoPro 同樣做法）：往下的伴侶／親子線從標籤後面經過，不會在字縫間露出來
    if (lb.lines.length) out.push(`<rect x="${f(-lb.w / 2 - 3)}" y="${e.bottom + 2}" width="${f(lb.w + 6)}" height="${lb.h - 2}" fill="${C.WHITE}" fill-opacity="0.92" rx="3"/>`);
    for (const l of lb.lines) {
      const isName = l.kind === 'name';
      out.push(`<text y="${y}" text-anchor="middle" font-size="${isName ? NAME_PX : ATTR_PX}" font-weight="${isName ? 700 : 400}" fill="${isName ? C.INK : C.INK_SOFT}" stroke="${C.WHITE}" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${esc(l.text)}</text>`);
      y += LINE_H;
    }
    if (!o.forExport) {
      const w = Math.max(lb.w, GT.S);
      out.push(`<rect class="hit" x="${f(-w / 2 - 4)}" y="${-ctop - 6}" width="${f(w + 8)}" height="${f(ctop + e.bottom + 12 + lb.h)}" fill="transparent"/>`);
    }
    out.push('</g>');
    return out.join('');
  }

  // ── 伴侶線與親子線 ──
  const TIER = 14;   // 同一人的多段關係橫線重疊時，每段往下錯開的距離
  // 這段關係要往下錯開幾層：比它早建立、跟它共用一位伴侶、而且橫線範圍重疊的關係有幾段
  function unionTier(doc, u) {
    const span = (x) => { const xs = x.partners.map(id => doc.persons[id]).filter(Boolean).map(p => p.x); return [Math.min(...xs), Math.max(...xs)]; };
    const [a1, a2] = span(u);
    let tier = 0;
    for (const o of Object.values(doc.unions)) {
      if (o === u) break;                      // 物件鍵依建立順序排列（id 流水號）
      if (o.partners.length !== 2 || !o.partners.some(id => u.partners.includes(id))) continue;
      const [b1, b2] = span(o);
      if (Math.min(a2, b2) - Math.max(a1, b1) > 1) tier++;
    }
    return tier;
  }

  function unionGeometry(doc, u) {
    const ps = u.partners.map(id => doc.persons[id]).filter(Boolean).sort((a, b) => a.x - b.x);
    if (!ps.length) return null;
    const kids = u.children.map(c => ({ c, p: doc.persons[c.id] })).filter(k => k.p);
    let yLine, midX, legs = '';
    const legPath = (y) => `M${f(ps[0].x)},${f(symBottom(ps[0]))}V${f(y)}M${f(ps[1].x)},${f(symBottom(ps[1]))}V${f(y)}`;
    if (ps.length === 2) {
      const [A, B] = ps;
      // 伴侶線放在兩人標籤文字的下方，不從「工人」「低收入戶」這些字中間橫切過去
      const below = (p) => symBottom(p) + labelBox(doc, p).h + 10;
      yLine = Math.max(symBottom(A) + DROP, symBottom(B) + DROP, below(A), below(B)) + TIER * unionTier(doc, u);
      midX = (A.x + B.x) / 2;
    } else {
      yLine = symBottom(ps[0]);
      midX = ps[0].x;
    }
    let ySib = null;
    if (kids.length) {
      const top = Math.min(...kids.map(k => symTop(k.p) - (k.p.culture ? CULTURE_H : 0)));
      const pb = Math.max(...ps.map(p => symBottom(p)));
      // 子女被拖得太靠近父母時，伴侶線往上縮（寧可壓到標籤，也不要讓線往上折）
      if (ps.length === 2 && yLine > top - 20) yLine = Math.max(pb + 8, top - 20);
      ySib = Math.max(yLine, Math.min(Math.max(yLine + 14, top - 26), top - 6));
    }
    if (ps.length === 2) legs = legPath(yLine);
    const marriage = ps.length === 2 ? `${legs}M${f(ps[0].x)},${f(yLine)}H${f(ps[1].x)}` : '';
    return { ps, kids, yLine, midX, legs, marriage, ySib };
  }

  // 伴侶線上的同居記號與斜線放在哪裡（畫線與擺線旁說明共用，兩邊才不會各算各的）
  function unionMarks(g, st) {
    const [A, B] = g.ps, at = (r) => A.x + (B.x - A.x) * r, hasKids = g.kids.length > 0;
    return { house: st.house ? at(hasKids ? 0.28 : st.slash ? 0.38 : 0.5) : null,
             slash: st.slash ? at(st.house ? 0.72 : hasKids ? 0.3 : 0.5) : null };
  }

  // 同居記號（參考圖的小房子）與斜線
  const houseMark = (x, y, color) =>
    `<path class="house" d="M${f(x - 6)},${f(y + 5)}V${f(y - 2)}L${f(x)},${f(y - 8)}L${f(x + 6)},${f(y - 2)}V${f(y + 5)}Z" fill="#FFFFFF" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`;
  function slashMarks(x, y, n, color, bold) {
    let d = '';
    for (let i = 0; i < n; i++) { const dx = (i - (n - 1) / 2) * 7; d += `M${f(x + dx - 5)},${f(y + 8)}L${f(x + dx + 5)},${f(y - 8)}`; }
    return `<path class="slash" d="${d}" stroke="${color}" stroke-width="${bold ? 3.4 : 2}" stroke-linecap="round"/>`;
  }

  function unionMarkup(doc, u, o) {
    const g = unionGeometry(doc, u);
    if (!g) return '';
    const sel = o.selection && o.selection.has(u.id);
    const st = FAMILY_STYLE[u.type] || FAMILY_STYLE.Other;
    const color = tint(doc, st.color), ink = tint(doc, G.BLACK);
    const out = [`<g class="union" data-id="${esc(u.id)}" data-kind="union">`];
    const twinOf = new Map();
    for (const t of (u.twins || [])) for (const id of t.ids) twinOf.set(id, t);
    let trunk = '';
    if (g.kids.length) {
      const xs = g.kids.map(k => k.p.x).concat([g.midX]);
      trunk = `M${f(g.midX)},${f(g.yLine)}V${f(g.ySib)}M${f(Math.min(...xs))},${f(g.ySib)}H${f(Math.max(...xs))}`;
    }
    if (sel) out.push(`<path d="${g.marriage}${trunk}" fill="none" stroke="${C.CYAN}" stroke-width="7" stroke-opacity="0.45" stroke-linejoin="round"/>`);
    if (g.ps.length === 2) {
      const [A, B] = g.ps, y = g.yLine, dash = st.dash || '';
      out.push(`<path d="${g.legs}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="${dash}"/>`);
      const hz = (dy) => `<path d="M${f(A.x)},${f(y + dy)}H${f(B.x)}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="${dash}"/>`;
      out.push(st.double ? hz(-2.5) + hz(2.5) : hz(0));
      const m = unionMarks(g, st);                // 記號位置：有子女時避開正中間的子女線
      if (m.house !== null) out.push(houseMark(m.house, y, color));
      if (m.slash !== null) out.push(slashMarks(m.slash, y, st.slash, color, st.bold));
    }
    if (trunk) out.push(`<path d="${trunk}" fill="none" stroke="${ink}" stroke-width="2"/>`);
    const kidLine = (k) => {
      const cs = k.p.gender === 'P' ? PET_LINK : (CHILD_STYLE[k.c.link] || CHILD_STYLE.bio);
      return { dash: cs.dash, color: cs.color ? tint(doc, cs.color) : ink };
    };
    const topOf = (p) => symTop(p) - (p.culture ? CULTURE_H - 4 : 0);
    for (const k of g.kids) {
      if (twinOf.has(k.c.id)) continue;
      const s = kidLine(k);
      out.push(`<path d="M${f(k.p.x)},${f(g.ySib)}V${f(topOf(k.p))}" fill="none" stroke="${s.color}" stroke-width="2" stroke-dasharray="${s.dash}"/>`);
    }
    // 雙胞胎：從同一點分岔（倒 V）；同卵在兩線之間加橫槓；不確定加「?」
    const drawn = new Set();
    let twinHit = '';
    for (const t of (u.twins || [])) {
      if (drawn.has(t)) continue;
      drawn.add(t);
      const mem = g.kids.filter(k => t.ids.includes(k.c.id)).sort((a, b) => a.p.x - b.p.x);
      if (mem.length < 2) continue;
      const ax = mem.reduce((s, k) => s + k.p.x, 0) / mem.length, ay = g.ySib;
      for (const k of mem) {
        const s = kidLine(k);
        const d = `M${f(ax)},${f(ay)}L${f(k.p.x)},${f(topOf(k.p))}`;
        twinHit += d;
        out.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-dasharray="${s.dash}"/>`);
      }
      const pt = (k, r) => ({ x: ax + (k.p.x - ax) * r, y: ay + (topOf(k.p) - ay) * r });
      if (t.kind === 'Identical') {
        const a = pt(mem[0], 0.55), b = pt(mem[mem.length - 1], 0.55);
        out.push(`<path class="twin-bar" d="M${f(a.x)},${f(a.y)}L${f(b.x)},${f(b.y)}" stroke="${ink}" stroke-width="2"/>`);
      } else if (t.kind === 'Unknown') {
        const a = pt(mem[0], 0.6), b = pt(mem[mem.length - 1], 0.6);
        out.push(`<text x="${f((a.x + b.x) / 2)}" y="${f(a.y + 4)}" text-anchor="middle" font-size="11" font-weight="700" fill="${ink}">?</text>`);
      }
    }
    if (!o.forExport) {
      const kidLines = g.kids.filter(k => !twinOf.has(k.c.id)).map(k => `M${f(k.p.x)},${f(g.ySib)}V${f(topOf(k.p))}`).join('');
      out.push(`<path class="hit" d="${g.marriage}${trunk}${kidLines}${twinHit}" fill="none" stroke="transparent" stroke-width="12"/>`);
    }
    out.push('</g>');
    return out.join('');
  }

  // ── 情感關係線 ──
  /* 軌跡：兩人中心的直線；途中被別人（符號或標籤）擋住 → 改成二次曲線繞開（先試往上彎）。
     曾經直線穿過中間的人，中斷記號被那人的符號蓋住，讀起來變成跟那個人有關係——報告上會被誤讀。
     兩端從「符號＋標籤」整塊的外緣起算，往下的線不會先穿過自己的名字。各種線型都沿軌跡畫。 */
  function shapeBoxes(doc, p, pad) {           // 一個人佔的範圍：符號框（含文化波浪線）＋（有的話）標籤框
    const e = symExtent(p), lb = labelBox(doc, p), w = Math.max(e.top, 6);
    const boxes = [{ x1: p.x - w - pad, y1: p.y - e.top - (p.culture ? CULTURE_H : 0) - pad, x2: p.x + w + pad, y2: p.y + e.bottom + pad }];
    if (lb.lines.length) boxes.push({ x1: p.x - lb.w / 2 - pad, y1: p.y + e.bottom, x2: p.x + lb.w / 2 + pad, y2: p.y + e.bottom + lb.h + pad });
    return boxes;
  }
  const inBoxes = (pt, boxes) => boxes.some(b => pt.x > b.x1 && pt.x < b.x2 && pt.y > b.y1 && pt.y < b.y2);

  function sampleCurve(ax, ay, bx, by, cx, cy) {   // cx 為 null＝直線
    const n = Math.max(8, Math.ceil(Math.hypot(bx - ax, by - ay) * (cx == null ? 1 : 1.4) / 3));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      pts.push(cx == null ? { x: ax + (bx - ax) * t, y: ay + (by - ay) * t }
                          : { x: u * u * ax + 2 * u * t * cx + t * t * bx, y: u * u * ay + 2 * u * t * cy + t * t * by });
    }
    return pts;
  }

  function relationTrack(doc, A, B) {
    const reach = 220;                            // 最大彎曲幅度以外的人不可能擋到，先排除（拖曳時要夠快）
    const bx1 = Math.min(A.x, B.x) - reach, bx2 = Math.max(A.x, B.x) + reach;
    const by1 = Math.min(A.y, B.y) - reach, by2 = Math.max(A.y, B.y) + reach;
    const obstacles = Object.values(doc.persons)
      .filter(p => p !== A && p !== B && p.x > bx1 && p.x < bx2 && p.y > by1 && p.y < by2)
      .map(p => shapeBoxes(doc, p, 4));
    const hits = (pts) => obstacles.filter(bs => pts.some(pt => inBoxes(pt, bs))).length;
    let pts = sampleCurve(A.x, A.y, B.x, B.y, null, null), straight = true;
    if (obstacles.length && hits(pts)) {
      const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
      let nx = -(B.y - A.y) / len, ny = (B.x - A.x) / len;
      if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny; }   // 先試往上（或往左）彎
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      let best = null;
      search: for (const bow of [36, 60, 90, 130, 180]) {
        for (const side of [1, -1]) {
          const cand = sampleCurve(A.x, A.y, B.x, B.y, mx + nx * bow * side * 2, my + ny * bow * side * 2);
          const h = hits(cand);
          if (!best || h < best.h) best = { h, pts: cand };
          if (!h) break search;
        }
      }
      pts = best.pts; straight = false;
    }
    const aBox = shapeBoxes(doc, A, 6), bBox = shapeBoxes(doc, B, 6);   // 兩端修掉落在自己範圍裡的部分
    let i = 0, j = pts.length - 1;
    while (i < j && inBoxes(pts[i], aBox)) i++;
    while (j > i && inBoxes(pts[j], bBox)) j--;
    return { pts: pts.slice(i, j + 1), straight };
  }

  // 軌跡工具：總長、沿線距離 s 處的位置＋切線＋法線、等距重新取樣
  function trackInfo(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const at = (s) => {
      let i = 1;
      while (i < pts.length - 1 && cum[i] < s) i++;
      const seg = cum[i] - cum[i - 1] || 1, t = Math.max(0, Math.min(1, (s - cum[i - 1]) / seg));
      const ux = (pts[i].x - pts[i - 1].x) / seg, uy = (pts[i].y - pts[i - 1].y) / seg;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t, ux, uy, nx: -uy, ny: ux };
    };
    const along = (step, a, b) => {
      const n = Math.max(1, Math.round((b - a) / step)), out = [];
      for (let k = 0; k <= n; k++) out.push(at(a + (b - a) * k / n));
      return out;
    };
    return { L: cum[cum.length - 1], at, along };
  }
  const polyD = (qs, off) => qs.map((q, k) => `${k ? 'L' : 'M'}${f(q.x + q.nx * off)},${f(q.y + q.ny * off)}`).join('');
  const zigD = (qs, amp) => qs.map((q, k) => {
    const s = k === 0 || k === qs.length - 1 ? 0 : (k % 2 ? amp : -amp);
    return `${k ? 'L' : 'M'}${f(q.x + q.nx * s)},${f(q.y + q.ny * s)}`;
  }).join('');

  // 情感關係配色＝參考圖（綠＝親近、紅＝衝突／暴力／控制、藍紫＝虐待、黑＝中性與關注）
  const EMOTION_COLOR = {
    Harmony: G.LIGHT_GREEN, Friendship: G.GREEN, Intimacy: G.GREEN, Love: G.GREEN, InLove: G.GREEN, Psyritual: G.GREEN,
    CutoffRepaired: G.GREEN, Caretaker: G.GREEN, Fused: G.RED,
    Indifferent: G.BLACK, Distant: G.BLACK, NeverMet: G.BLACK, Plain: G.BLACK,
    FocusedOn: G.BLACK, FocusedOnNegatively: G.BLACK, Fan: G.BLACK, Limerence: G.BLACK,
    Cutoff: G.RED, Discord: G.RED, Hate: G.RED, Distrust: G.RED, Hostile: G.RED,
    HostileDistant: G.RED, HostileClose: G.RED, HostileFused: G.RED,
    Violence: G.RED, ViolenceDistant: G.RED, ViolenceClose: G.RED, ViolenceFused: G.RED,
    Manipulative: G.RED, Controlling: G.RED, Jealous: G.RED,
    Abuse: G.PURPLE, AbusePhysical: G.ABUSE, AbuseEmotional: G.ABUSE, AbuseSexual: G.ABUSE, AbuseNeglect: G.ABUSE,
    Other: C.MUTED,
  };

  function relationMarkup(doc, r, o) {
    const A = doc.persons[r.a], B = doc.persons[r.b];
    if (!A || !B) return '';
    const { pts, straight } = relationTrack(doc, A, B);
    if (pts.length < 2) return '';
    const tk = trackInfo(pts), L = tk.L;
    if (L < 12) return '';
    const color = doc.settings.colorRelations ? (EMOTION_COLOR[r.type] || C.MUTED) : (BW_GRAY[r.type] || C.INK);
    const fine = straight ? [tk.at(0), tk.at(L)] : tk.along(3, 0, L);
    const at = (s) => tk.at(Math.max(0, Math.min(L, s)));
    const mid = at(L / 2);
    // ── 線型零件（全部沿軌跡畫，曲線繞道時一樣適用）──
    const line = (off, extra, w) => `<path d="${polyD(fine, off)}" stroke="${color}" stroke-width="${w || 1.8}" fill="none" stroke-linejoin="round" ${extra || ''}/>`;
    const zz = (amp, wave, w, stroke) => `<path d="${zigD(tk.along(wave, 0, L), amp)}" stroke="${stroke || color}" stroke-width="${w || 1.8}" fill="none" stroke-linejoin="round"/>`;
    const dashed = (off) => line(off, 'stroke-dasharray="5 4"');
    const ticks = (step, len) => {           // 垂直短槓（知己的梯子、不信任的梳子）
      let d = '';
      for (let s = step; s < L - step / 2; s += step) { const q = at(s); d += `M${f(q.x + q.nx * len / 2)},${f(q.y + q.ny * len / 2)}L${f(q.x - q.nx * len / 2)},${f(q.y - q.ny * len / 2)}`; }
      return `<path d="${d}" stroke="${color}" stroke-width="1.5"/>`;
    };
    const ring = (q, r0, along) => `<circle cx="${f(q.x + q.ux * (along || 0))}" cy="${f(q.y + q.uy * (along || 0))}" r="${r0}" fill="#FFFFFF" stroke="${color}" stroke-width="1.8"/>`;
    const xMark = (q, s) => `<path d="M${f(q.x - (q.ux + q.nx) * s)},${f(q.y - (q.uy + q.ny) * s)}L${f(q.x + (q.ux + q.nx) * s)},${f(q.y + (q.uy + q.ny) * s)}` +
                            `M${f(q.x - (q.ux - q.nx) * s)},${f(q.y - (q.uy - q.ny) * s)}L${f(q.x + (q.ux - q.nx) * s)},${f(q.y + (q.uy - q.ny) * s)}" stroke="${color}" stroke-width="2"/>`;
    const boxX = (q, s) => {
      const c = (a, b) => `${f(q.x + q.ux * a + q.nx * b)},${f(q.y + q.uy * a + q.ny * b)}`;
      return `<path d="M${c(-s, -s)}L${c(s, -s)}L${c(s, s)}L${c(-s, s)}Z" fill="#FFFFFF" stroke="${color}" stroke-width="1.8"/>` + xMark(q, s * 0.72);
    };
    const chevron = (s, size) => {           // 開口箭頭「>」，尖端在 s
      const q = at(s);
      return `<path class="arrow" d="M${f(q.x - q.ux * size + q.nx * size * 0.6)},${f(q.y - q.uy * size + q.ny * size * 0.6)}L${f(q.x)},${f(q.y)}L${f(q.x - q.ux * size - q.nx * size * 0.6)},${f(q.y - q.uy * size - q.ny * size * 0.6)}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
    };
    const arrowHead = (hollow) => {          // 實心／空心三角箭頭（虐待類）
      const q = at(L - 1);
      return `<path class="arrow" d="M${f(q.x)},${f(q.y)}L${f(q.x - q.ux * 13 + q.nx * 7)},${f(q.y - q.uy * 13 + q.ny * 7)}L${f(q.x - q.ux * 13 - q.nx * 7)},${f(q.y - q.uy * 13 - q.ny * 7)}Z" fill="${hollow ? '#FFFFFF' : color}" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`;
    };
    const gapped = (extra, gap) => {         // 中間斷開的線（絕交、修復截斷）
      const g = gap || 7, a = at(L / 2 - g), b = at(L / 2 + g);
      const bar = (q) => `M${f(q.x + q.nx * 9)},${f(q.y + q.ny * 9)}L${f(q.x - q.nx * 9)},${f(q.y - q.ny * 9)}`;
      return `<path d="${polyD(tk.along(3, 0, L / 2 - g), 0)}${polyD(tk.along(3, L / 2 + g, L), 0)}" stroke="${color}" stroke-width="1.8" fill="none" ${extra || ''}/>` +
             `<path d="${bar(a)}${bar(b)}" stroke="${color}" stroke-width="2"/>`;
    };
    const out = [`<g class="relation" data-id="${esc(r.id)}" data-kind="relation">`];
    if (o.selection && o.selection.has(r.id)) out.push(`<path d="${polyD(fine, 0)}" stroke="${C.CYAN}" stroke-width="12" stroke-opacity="0.4" stroke-linecap="round" fill="none"/>`);
    switch (r.type) {
      // 親近
      case 'Harmony': out.push(line(0)); break;
      case 'Friendship': out.push(line(-2.5), line(2.5)); break;
      case 'Intimacy': out.push(line(-3), line(3), ticks(6, 10)); break;
      case 'Fused': out.push(line(-4.5), line(0), line(4.5)); break;
      case 'Love': out.push(line(0), ring(mid, 5.5)); break;
      case 'InLove': out.push(line(0), ring(mid, 5.5, -4.5), ring(mid, 5.5, 4.5)); break;
      case 'Psyritual': {
        const n = Math.max(2, Math.floor(L / 10));
        for (let i = 0; i < n; i++) out.push(ring(at(5 + i * (L - 10) / (n - 1)), 4.5));
        break;
      }
      // 疏離
      case 'Indifferent': out.push(line(0, 'stroke-dasharray="1 4" stroke-linecap="round"', 2.2)); break;
      case 'Distant': out.push(line(0, 'stroke-dasharray="7 5"')); break;
      case 'Cutoff': out.push(gapped('stroke-dasharray="6 4"')); break;
      case 'CutoffRepaired': out.push(gapped('stroke-dasharray="6 4"', 9), ring(mid, 4)); break;
      case 'NeverMet': out.push(line(0), boxX(mid, 6.5)); break;
      // 衝突
      case 'Discord': out.push(line(0, '', 2.4)); break;
      case 'Hate': out.push(dashed(-5), dashed(0), dashed(5)); break;
      case 'Distrust': out.push(line(0), ticks(5, 12)); break;
      case 'Hostile': out.push(zz(6, 12)); break;
      case 'HostileDistant': out.push(dashed(0), zz(6, 12)); break;
      case 'HostileClose': out.push(line(-3), line(3), zz(6, 12)); break;
      case 'HostileFused': out.push(line(-5), line(0), line(5), zz(6, 12)); break;
      // 暴力（較密的鋸齒）
      case 'Violence': out.push(zz(6, 6, 2.2)); break;
      case 'ViolenceDistant': out.push(dashed(0), zz(6, 6, 2.2)); break;
      case 'ViolenceClose': out.push(line(-3), line(3), zz(6, 6, 2.2)); break;
      case 'ViolenceFused': out.push(line(-5), line(0), line(5), zz(6, 6, 2.2)); break;
      // 虐待（有方向，箭頭指向受虐者）
      case 'Abuse': out.push(zz(5, 12, 2), arrowHead(false)); break;
      case 'AbusePhysical': out.push(zz(6, 12, 3), arrowHead(false)); break;
      case 'AbuseEmotional': out.push(line(0, '', 1.2), zz(5, 12, 1.8), arrowHead(false)); break;
      case 'AbuseSexual': out.push(zz(6, 12, 4), zz(6, 12, 1.6, '#FFFFFF'), arrowHead(true)); break;
      case 'AbuseNeglect': out.push(line(0, 'stroke-dasharray="6 4"'), chevron(L, 11)); break;
      // 控制與關注（有方向）
      case 'Manipulative': out.push(line(0), xMark(mid, 6), chevron(L, 11)); break;
      case 'Controlling': out.push(line(0), boxX(mid, 7), chevron(L, 11)); break;
      case 'Jealous': out.push(line(0, '', 2.2), chevron(L, 11)); break;
      case 'FocusedOn': out.push(line(0), chevron(L, 11)); break;
      case 'FocusedOnNegatively': out.push(zz(5, 12), chevron(L, 11)); break;
      case 'Fan': out.push(line(0), ring(mid, 5.5), chevron(L, 11)); break;
      case 'Limerence': out.push(line(0), ring(mid, 5.5, -5.5), ring(mid, 5.5, 5.5), chevron(L, 11)); break;
      // 一般
      case 'Plain': out.push(line(0)); break;
      case 'Caretaker': out.push(line(0), chevron(L - 9, 10), chevron(L, 10)); break;   // 參考圖的「≫」
      default: out.push(line(0, 'stroke-dasharray="1 4" stroke-linecap="round"'));
    }
    if (!o.forExport) out.push(`<path class="hit" d="${polyD(fine, 0)}" stroke="transparent" stroke-width="14" fill="none"/>`);
    out.push('</g>');
    return out.join('');
  }

  // ── 生活圈（虛線圈起同住成員）──
  function personBox(doc, p) {
    const lb = labelBox(doc, p), e = symExtent(p);
    const w = Math.max(GT.S, lb.w);
    return { x1: p.x - w / 2, y1: p.y - e.top - (p.culture ? CULTURE_H : 0), x2: p.x + w / 2, y2: p.y + e.bottom + lb.h + 4 };
  }

  /* 生活圈的形狀（不再是一個大矩形——大矩形會把不同住的人也圈進去，評估報告上等於錯誤陳述）：
     1. 成員依 y 分列（同一代）；
     2. 同一列中，兩位成員之間夾著非成員 → 斷成兩段，再從非成員的標籤下方用橫帶繞過去（凸形／U 形）；
     3. 相鄰兩列之間，用最近的兩段之間的連接帶接起來（L 形、階梯形）。
     回傳這些矩形；畫的時候只描它們聯集的外圈。 */
  const HH_PAD = 12;
  function householdParts(doc, h) {
    const mem = new Set(h.members);
    const items = h.members.map(id => doc.persons[id]).filter(Boolean).map(p => ({ p, b: personBox(doc, p) }));
    if (!items.length) return [];
    const others = Object.values(doc.persons).filter(p => !mem.has(p.id)).map(p => ({ p, b: personBox(doc, p) }));
    items.sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x);
    const rows = [];
    for (const it of items) {
      const row = rows.find(r => Math.abs(r.y - it.p.y) < GT.S);
      if (row) row.items.push(it); else rows.push({ y: it.p.y, items: [it] });
    }
    const pad = HH_PAD, parts = [], rowRuns = [];
    const boxOf = (run) => ({ x1: Math.min(...run.map(i => i.b.x1)) - pad, y1: Math.min(...run.map(i => i.b.y1)) - pad,
                              x2: Math.max(...run.map(i => i.b.x2)) + pad, y2: Math.max(...run.map(i => i.b.y2)) + pad });
    for (const row of rows) {
      row.items.sort((a, b) => a.p.x - b.p.x);
      const sameRow = others.filter(o => Math.abs(o.p.y - row.y) < GT.S);
      const runs = [[row.items[0]]];
      for (let i = 1; i < row.items.length; i++) {
        const prev = row.items[i - 1].p.x, cur = row.items[i].p.x;
        if (sameRow.some(o => o.p.x > prev && o.p.x < cur)) runs.push([row.items[i]]);
        else runs[runs.length - 1].push(row.items[i]);
      }
      const rr = runs.map(boxOf);
      if (rr.length > 1) {                       // 從夾在中間的非成員下方繞過
        const bottom = Math.max(...rr.map(r => r.y2), ...sameRow.map(o => o.b.y2 + pad));
        for (const r of rr) r.y2 = Math.max(r.y2, bottom + 2 * pad);
        for (let i = 1; i < rr.length; i++) parts.push({ x1: rr[i - 1].x2 - 2 * pad, y1: bottom, x2: rr[i].x1 + 2 * pad, y2: bottom + 2 * pad });
      }
      parts.push(...rr);
      rowRuns.push(rr);
    }
    for (let i = 1; i < rowRuns.length; i++) {  // 相鄰兩列：挑最近的兩段接起來
      let best = null;
      for (const a of rowRuns[i - 1]) for (const b of rowRuns[i]) {
        const ov = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);   // 正＝水平重疊寬度；負＝水平間隔
        if (!best || ov > best.ov) best = { a, b, ov };             // 重疊越多越好；不重疊就挑間隔最小的
      }
      const { a, b, ov } = best;
      let x1, x2;
      if (ov >= 2 * pad) { const c = (Math.max(a.x1, b.x1) + Math.min(a.x2, b.x2)) / 2, w = Math.min(ov / 2, 3 * pad); x1 = c - w; x2 = c + w; }
      else { x1 = Math.min(a.x2, b.x2) - 2 * pad; x2 = Math.max(a.x1, b.x1) + 2 * pad; }
      parts.push({ x1, y1: a.y2 - 2 * pad, x2, y2: b.y1 + 2 * pad });
    }
    if (h.label && parts.length) {                // 最上面那塊往上多留一行給名稱，不壓到人
      const top = parts.reduce((m, r) => (r.y1 < m.y1 ? r : m));
      top.y1 -= 16;
    }
    return parts;
  }

  // 還是被圈進去的非成員（例如成員上下兩代之間夾著別人）：面板會提醒使用者挪位置
  function householdIntruders(doc, h) {
    const parts = householdParts(doc, h), mem = new Set(h.members);
    return Object.values(doc.persons)
      .filter(p => !mem.has(p.id) && parts.some(r => p.x > r.x1 && p.x < r.x2 && p.y > r.y1 && p.y < r.y2))
      .map(p => p.id);
  }

  function householdMarkup(doc, h, o) {
    const parts = householdParts(doc, h);
    if (!parts.length) return '';
    const sel = o.selection && o.selection.has(h.id);
    const mid = `hm-${esc(h.id)}`;
    const X1 = Math.min(...parts.map(r => r.x1)) - 20, Y1 = Math.min(...parts.map(r => r.y1)) - 20;
    const X2 = Math.max(...parts.map(r => r.x2)) + 20, Y2 = Math.max(...parts.map(r => r.y2)) + 20;
    const rects = (attrs) => parts.map(r => `<rect x="${f(r.x1)}" y="${f(r.y1)}" width="${f(r.x2 - r.x1)}" height="${f(r.y2 - r.y1)}" rx="14" ${attrs}/>`).join('');
    const out = [`<g class="household" data-id="${esc(h.id)}" data-kind="household">`];
    // mask：各塊矩形內部挖空 → 描邊只剩聯集的外圈（內部接縫不會出現虛線）
    out.push(`<mask id="${mid}" maskUnits="userSpaceOnUse" x="${f(X1)}" y="${f(Y1)}" width="${f(X2 - X1)}" height="${f(Y2 - Y1)}">` +
             `<rect x="${f(X1)}" y="${f(Y1)}" width="${f(X2 - X1)}" height="${f(Y2 - Y1)}" fill="#FFFFFF"/>${rects('fill="#000000"')}</mask>`);
    // 底色與外框都不接收點擊（圈內空白處要能拖曳畫布）；只有外框那圈可以點選
    out.push(`<g opacity="0.06" pointer-events="none">${rects(`fill="${C.BRAND}"`)}</g>`);
    out.push(`<g mask="url(#${mid})" pointer-events="none">${rects(`fill="none" stroke="${sel ? C.CYAN : C.BRAND}" stroke-width="${sel ? 6 : 3.2}" stroke-dasharray="8 5"`)}</g>`);
    if (h.label) {
      const top = parts.reduce((a, r) => (r.y1 < a.y1 || (r.y1 === a.y1 && r.x1 < a.x1) ? r : a));
      out.push(`<text x="${f(top.x1 + 10)}" y="${f(top.y1 + 15)}" font-size="12" fill="${C.BRAND}" pointer-events="none">${esc(h.label)}</text>`);
    }
    if (!o.forExport) out.push(`<g class="hit">${rects('fill="none" stroke="transparent" stroke-width="12"')}</g>`);
    out.push('</g>');
    return out.join('');
  }

  // ── 文字說明 ──
  const LABEL_PX = 13;
  function textLabelMarkup(doc, t, o) {
    const lines = GT.wrapText(t.text || ' ', 18);
    const w = Math.max(24, ...lines.map(l => GT.textEm(l) * LABEL_PX)), h = lines.length * 18;
    const sel = o.selection && o.selection.has(t.id);
    const out = [`<g class="tlabel" data-id="${esc(t.id)}" data-kind="label" transform="translate(${f(t.x)},${f(t.y)})">`];
    if (sel && !o.forExport) out.push(`<rect x="-6" y="-16" width="${f(w + 12)}" height="${h + 10}" rx="6" fill="${C.CYAN}" fill-opacity="0.12" stroke="${C.CYAN}" stroke-width="2"/>`);
    lines.forEach((l, i) => out.push(`<text y="${i * 18}" font-size="${LABEL_PX}" fill="${C.INK}">${esc(l)}</text>`));
    if (!o.forExport) out.push(`<rect class="hit" x="-6" y="-16" width="${f(w + 12)}" height="${h + 10}" fill="transparent"/>`);
    out.push('</g>');
    return out.join('');
  }

  /* ── 線旁說明（使用者 2026-09-21）──
     比較特殊、一般人看不出意思的線（GT.isSpecialLine），自動在線旁寫出名稱；使用者寫的「線旁說明」一律顯示。
     畫在人物之上的獨立一層，不會被標籤蓋住；點字也等於點那條線。 */
  const LINE_LABEL_PX = 11;
  function lineLabelText(doc, types, type, note) {
    if (doc.settings.lineLabels === false) return '';
    const t = types.find(x => x.key === type);
    const name = t && GT.isSpecialLine(type) ? t.label : '';
    const n = String(note || '').trim();
    return [name, n].filter(Boolean).join('：');
  }
  // 伴侶線：寫在橫線下方（有子女時靠子女線右側）。線上的記號最低到線下 8px，字從線下 10px 起，不會重疊
  function unionLabel(doc, u, g) {
    if (!g || g.ps.length !== 2) return null;
    const text = lineLabelText(doc, GT.FAMILY_TYPES, u.type, u.note);
    if (!text) return null;
    const base = { id: u.id, kind: 'union', text };
    const hasKids = g.kids.length > 0;
    if (!hasKids || g.ySib - g.yLine >= 30)
      return Object.assign(base, { anchor: hasKids ? 'start' : 'middle', x: hasKids ? g.midX + 8 : g.midX, y: g.yLine + 21 });
    // 子女拉得很近、下方放不下 → 寫在橫線上方，左右挑一邊避開同居記號與斜線（審查 2026-09-21：原本會壓在斜線上）
    const st = FAMILY_STYLE[u.type] || FAMILY_STYLE.Other, m = unionMarks(g, st), w = GT.textEm(text) * LINE_LABEL_PX;
    const zones = [];
    if (m.house !== null) zones.push([m.house - 10, m.house + 10]);
    if (m.slash !== null) { const half = (st.slash - 1) * 3.5 + 9; zones.push([m.slash - half, m.slash + half]); }
    const clear = (x1, x2) => zones.every(([a, b]) => x2 < a || x1 > b);
    if (clear(g.midX + 8, g.midX + 8 + w)) return Object.assign(base, { anchor: 'start', x: g.midX + 8, y: g.yLine - 5 });
    if (clear(g.midX - 8 - w, g.midX - 8)) return Object.assign(base, { anchor: 'end', x: g.midX - 8, y: g.yLine - 5 });
    return Object.assign(base, { anchor: 'start', x: g.midX + 8, y: g.yLine - 13 });   // 兩邊都有記號：抬高到記號上方
  }
  // 情感關係：寫在線的中點旁（往上方那一側偏，垂直的線往右偏），避開中點的記號
  function relationLabel(doc, r) {
    const text = lineLabelText(doc, GT.EMOTION_TYPES, r.type, r.note);
    if (!text) return null;
    const A = doc.persons[r.a], B = doc.persons[r.b];
    if (!A || !B) return null;
    const { pts } = relationTrack(doc, A, B);
    if (pts.length < 2) return null;
    const tk = trackInfo(pts);
    if (tk.L < 12) return null;
    const m = tk.at(tk.L / 2);
    let nx = m.nx, ny = m.ny;
    if (ny > 0.2 || (Math.abs(ny) <= 0.2 && nx < 0)) { nx = -nx; ny = -ny; }
    return { id: r.id, kind: 'relation', text, anchor: 'middle', x: m.x + nx * 17, y: m.y + ny * 17 + 4 };
  }
  function lineLabelBox(L) {
    const w = GT.textEm(L.text) * LINE_LABEL_PX;
    const x1 = L.anchor === 'start' ? L.x : L.anchor === 'end' ? L.x - w : L.x - w / 2;
    return { x1: x1 - 2, y1: L.y - 11, x2: x1 + w + 2, y2: L.y + 3 };
  }
  const lineLabelSVG = (L) => `<g class="linelabel" data-id="${esc(L.id)}" data-kind="${L.kind}">` +
    `<text x="${f(L.x)}" y="${f(L.y)}" text-anchor="${L.anchor}" font-size="${LINE_LABEL_PX}" fill="${C.INK_SOFT}" ` +
    `stroke="${C.WHITE}" stroke-width="3.5" stroke-linejoin="round" paint-order="stroke">${esc(L.text)}</text></g>`;
  function lineLabels(doc) {
    const out = [];
    for (const u of Object.values(doc.unions)) { const L = unionLabel(doc, u, unionGeometry(doc, u)); if (L) out.push(L); }
    for (const r of Object.values(doc.relations)) { const L = relationLabel(doc, r); if (L) out.push(L); }
    return out;
  }

  /* ── 生態圖：外部系統（資源）與生態連結 ──
     畫法依社工慣例：資源畫圓、名稱寫在圓裡；強＝雙線、弱＝虛線、有壓力＝鋸齒線、箭頭＝資源或能量的流向。
     線停在生活圈的界線＝連到整個家庭；穿進去連到人＝連到那個人（參考圖：家庭界線幫你分辨）。 */
  const viewMode = (doc) => {
    const v = doc.settings && doc.settings.view;
    return v === 'genogram' || v === 'ecomap' ? v : 'both';
  };
  const SYS_FONT = 12.5, SYS_LINE = 15, FAMILY_R = 52;
  const systemLines = (s) => GT.wrapText(s.name || '資源', 5);
  function systemRadius(s) {
    const lines = systemLines(s);
    const w = Math.max(...lines.map(l => GT.textEm(l))) * SYS_FONT, h = lines.length * SYS_LINE;
    return Math.max(30, Math.round(Math.hypot(w, h) / 2) + 6);
  }
  const systemBox = (s) => { const r = systemRadius(s); return { x1: s.x - r, y1: s.y - r, x2: s.x + r, y2: s.y + r }; };

  // 生態圖模式：整張家系圖收成一個「家庭」圓，位置＝所有人的中心
  function familyNode(doc) {
    const ps = Object.values(doc.persons);
    if (!ps.length) return { x: 0, y: 0, r: FAMILY_R };
    const xs = ps.map(p => p.x), ys = ps.map(p => p.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, r: FAMILY_R };
  }

  // 連結端點：人、資源、生活圈（整個家庭）；生態圖模式下人與生活圈都收進家庭圓
  function tieAnchor(doc, id, mode) {
    const p = doc.persons[id];
    if (p) {
      if (mode === 'ecomap') return Object.assign(familyNode(doc), { kind: 'circle' });
      const e = symExtent(p);
      return { kind: 'rect', x: p.x, y: p.y, box: { x1: p.x - HALF, y1: p.y - e.top, x2: p.x + HALF, y2: p.y + e.bottom } };
    }
    const s = doc.systems[id];
    if (s) return { kind: 'circle', x: s.x, y: s.y, r: systemRadius(s) };
    const h = doc.households[id];
    if (h) {
      if (mode === 'ecomap') return Object.assign(familyNode(doc), { kind: 'circle' });
      const parts = householdParts(doc, h);
      if (!parts.length) return null;
      const box = { x1: Math.min(...parts.map(r => r.x1)), y1: Math.min(...parts.map(r => r.y1)),
                    x2: Math.max(...parts.map(r => r.x2)), y2: Math.max(...parts.map(r => r.y2)) };
      // 生活圈是好幾塊矩形拼成的，用整體外框會讓線停在空中；改用實際形狀（rects）找邊界
      return { kind: 'rects', x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2, box, rects: parts };
    }
    return null;
  }
  // 從中心往目標方向走到形狀邊界（圓＝半徑，矩形＝邊）
  function edgePoint(a, tx, ty) {
    const dx = tx - a.x, dy = ty - a.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    if (a.kind === 'circle') return { x: a.x + ux * a.r, y: a.y + uy * a.r };
    // 由外面往中心走，第一個碰到形狀的點＝看得見的那圈邊界
    // （不能從中心往外找：生活圈是好幾塊拼的，中心常常落在缺口上）
    if (a.kind === 'rects') {
      const inAny = (px, py) => a.rects.some(r => px >= r.x1 && px <= r.x2 && py >= r.y1 && py <= r.y2);
      // 走到中心還不夠：中心可能在缺口上，最近的那塊在中心的另一邊，所以要穿過去再走一個對角線
      const reach = L + Math.hypot(a.box.x2 - a.box.x1, a.box.y2 - a.box.y1);
      const step = Math.max(2, reach / 400);      // 距離再遠也只掃 400 步（審查：極端座標下曾測到 18 毫秒）
      for (let t = 0; t <= reach; t += step) {
        const px = tx - ux * t, py = ty - uy * t;
        if (inAny(px, py)) return { x: px, y: py };
      }
    }
    const hw = (a.box.x2 - a.box.x1) / 2, hh = (a.box.y2 - a.box.y1) / 2;
    const t = Math.min(hw / (Math.abs(ux) || 1e-6), hh / (Math.abs(uy) || 1e-6));
    return { x: a.x + ux * t, y: a.y + uy * t };
  }

  function systemMarkup(doc, s, o) {
    const r = systemRadius(s), lines = systemLines(s);
    const sel = o.selection && o.selection.has(s.id), pend = o.pending === s.id;
    const out = [`<g class="system" data-id="${esc(s.id)}" data-kind="system" transform="translate(${f(s.x)},${f(s.y)})">`];
    if ((sel || pend) && !o.forExport)
      out.push(`<circle r="${f(r + 7)}" fill="${pend ? C.WARN : C.CYAN}" fill-opacity="0.14" stroke="${pend ? C.WARN : C.CYAN}" stroke-width="2"${pend ? ' stroke-dasharray="4 3"' : ''}/>`);
    out.push(`<circle r="${f(r)}" fill="${C.WHITE}" stroke="${tint(doc, G.BLACK)}" stroke-width="1.8"/>`);
    const y0 = -(lines.length - 1) * SYS_LINE / 2 + 4.5;
    lines.forEach((l, i) => out.push(`<text y="${f(y0 + i * SYS_LINE)}" text-anchor="middle" font-size="${SYS_FONT}" fill="${C.INK}">${esc(l)}</text>`));
    out.push('</g>');
    return out.join('');
  }

  // 生態圖模式下代表整個家庭的圓
  function familyMarkup(doc, o) {
    const n = familyNode(doc);
    const label = Object.keys(doc.persons).length ? '家庭' : '';
    if (!label) return '';
    return `<g class="famnode" transform="translate(${f(n.x)},${f(n.y)})">` +
           `<circle r="${n.r}" fill="${C.WHITE}" stroke="${tint(doc, G.BLACK)}" stroke-width="2.4"/>` +
           `<text y="6" text-anchor="middle" font-size="17" font-weight="700" fill="${C.INK}">${label}</text></g>`;
  }

  // 一條連結畫出來會佔到的範圍：兩端點＋線上文字的白底框（審查 2026-09-20：bbox 沒算這塊，匯出會裁掉字）
  const TIE_NOTE_PX = 12;
  function tieGeometry(doc, t, mode) {
    const A = tieAnchor(doc, t.a, mode), B = tieAnchor(doc, t.b, mode);
    if (!A || !B) return null;
    const p1 = edgePoint(A, B.x, B.y), p2 = edgePoint(B, A.x, A.y);
    const L = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const tw = t.note ? GT.textEm(t.note) * TIE_NOTE_PX + 8 : 0;
    return { A, B, p1, p2, L, mid,
             note: t.note ? { x1: mid.x - tw / 2, y1: mid.y - 9, x2: mid.x + tw / 2, y2: mid.y + 8 } : null };
  }

  function tieMarkup(doc, t, o) {
    const mode = viewMode(doc);
    const g = tieGeometry(doc, t, mode);
    if (!g) return '';
    const { p1, p2 } = g;
    const tk = trackInfo([p1, p2]), L = tk.L;
    if (L < 8) return '';                       // 兩端重疊（例如生態圖模式下兩端都收成家庭圓）
    const strong = t.strength === 'strong', weak = t.strength === 'weak';
    const color = t.stress ? tint(doc, G.RED) : tint(doc, G.BLACK);
    const w = strong ? 3 : 1.8;
    const dash = weak ? ' stroke-dasharray="6 4"' : '';
    const out = [`<g class="tie" data-id="${esc(t.id)}" data-kind="tie">`];
    if (o.selection && o.selection.has(t.id))
      out.push(`<path d="${polyD([tk.at(0), tk.at(L)], 0)}" stroke="${C.CYAN}" stroke-width="12" stroke-opacity="0.4" stroke-linecap="round" fill="none"/>`);
    if (t.stress) {                             // 有壓力：鋸齒線（黑白列印也看得出來）
      out.push(`<path d="${zigD(tk.along(7, 0, L), 4)}" stroke="${color}" stroke-width="${w}" fill="none" stroke-linejoin="round"${dash}/>`);
    } else if (strong) {                        // 強：雙線
      out.push(`<path d="${polyD([tk.at(0), tk.at(L)], -2.2)}" stroke="${color}" stroke-width="1.8" fill="none"/>`,
               `<path d="${polyD([tk.at(0), tk.at(L)], 2.2)}" stroke="${color}" stroke-width="1.8" fill="none"/>`);
    } else {
      out.push(`<path d="${polyD([tk.at(0), tk.at(L)], 0)}" stroke="${color}" stroke-width="${w}" fill="none"${dash}/>`);
    }
    const head = (s, back) => {                 // 實心箭頭（資源或能量的流向）
      const q = tk.at(s), ux = back ? -q.ux : q.ux, uy = back ? -q.uy : q.uy, nx = -uy, ny = ux;
      return `<path class="arrow" d="M${f(q.x)},${f(q.y)}L${f(q.x - ux * 12 + nx * 6)},${f(q.y - uy * 12 + ny * 6)}` +
             `L${f(q.x - ux * 12 - nx * 6)},${f(q.y - uy * 12 - ny * 6)}Z" fill="${color}" stroke="${color}" stroke-width="1.4" stroke-linejoin="round"/>`;
    };
    if (t.dir === 'a2b' || t.dir === 'both') out.push(head(L, false));
    if (t.dir === 'b2a' || t.dir === 'both') out.push(head(0, true));
    if (t.note) {                               // 一條線寫一件事（白底，不讓線穿過字）
      const m = tk.at(L / 2), tw = GT.textEm(t.note) * 12;
      out.push(`<rect x="${f(m.x - tw / 2 - 4)}" y="${f(m.y - 9)}" width="${f(tw + 8)}" height="17" rx="3" fill="${C.WHITE}" fill-opacity="0.92"/>`,
               `<text x="${f(m.x)}" y="${f(m.y + 4)}" text-anchor="middle" font-size="12" fill="${C.INK}">${esc(t.note)}</text>`);
    }
    if (!o.forExport) out.push(`<path class="hit" d="${polyD([tk.at(0), tk.at(L)], 0)}" stroke="transparent" stroke-width="14" fill="none"/>`);
    out.push('</g>');
    return out.join('');
  }

  // ── 組合 ──
  function renderWorld(doc, opts) {
    const o = opts || {};
    const mode = viewMode(doc);
    const parts = [];
    if (mode !== 'ecomap') {
      for (const h of Object.values(doc.households)) parts.push(householdMarkup(doc, h, o));
      if (mode !== 'genogram') for (const t of Object.values(doc.ties)) parts.push(tieMarkup(doc, t, o));   // 線從符號底下穿過
      for (const u of Object.values(doc.unions)) parts.push(unionMarkup(doc, u, o));
      for (const r of Object.values(doc.relations)) parts.push(relationMarkup(doc, r, o));
      for (const p of Object.values(doc.persons)) parts.push(personMarkup(doc, p, o));
      for (const L of lineLabels(doc)) parts.push(lineLabelSVG(L));                   // 線旁說明在人物之上
    } else {                                      // 生態圖：整張家系圖收成一個「家庭」圓
      for (const t of Object.values(doc.ties)) parts.push(tieMarkup(doc, t, o));
      parts.push(familyMarkup(doc, o));
    }
    if (mode !== 'genogram') for (const y of Object.values(doc.systems)) parts.push(systemMarkup(doc, y, o));
    for (const t of Object.values(doc.labels)) parts.push(textLabelMarkup(doc, t, o));
    return parts.join('');
  }

  // 連結兩端與線上文字都要算進圖的範圍（匯出時才不會被裁掉）
  function addTies(doc, add, mode) {
    for (const t of Object.values(doc.ties)) {
      const g = tieGeometry(doc, t, mode);
      if (!g) continue;
      add({ x1: Math.min(g.p1.x, g.p2.x), y1: Math.min(g.p1.y, g.p2.y), x2: Math.max(g.p1.x, g.p2.x), y2: Math.max(g.p1.y, g.p2.y) });
      if (g.note) add(g.note);
    }
  }

  function bbox(doc) {
    const xs = [], ys = [];
    const add = (b) => { xs.push(b.x1, b.x2); ys.push(b.y1, b.y2); };
    const mode = viewMode(doc);
    if (mode === 'ecomap') {                      // 家庭收成一個圓：只算圓與資源
      const n = familyNode(doc);
      if (Object.keys(doc.persons).length) add({ x1: n.x - n.r, y1: n.y - n.r, x2: n.x + n.r, y2: n.y + n.r });
      for (const y of Object.values(doc.systems)) add(systemBox(y));
      addTies(doc, add, mode);
      for (const t of Object.values(doc.labels)) {
        const lines = GT.wrapText(t.text || ' ', 18);
        add({ x1: t.x - 6, y1: t.y - 16, x2: t.x + Math.max(24, ...lines.map(l => GT.textEm(l) * LABEL_PX)) + 6, y2: t.y + lines.length * 18 });
      }
      if (!xs.length) return { x: 0, y: 0, w: 400, h: 300 };
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
    }
    if (mode !== 'genogram') { for (const y of Object.values(doc.systems)) add(systemBox(y)); addTies(doc, add, mode); }
    for (const L of lineLabels(doc)) add(lineLabelBox(L));                          // 線旁說明也要包進匯出範圍
    for (const p of Object.values(doc.persons)) add(personBox(doc, p));
    for (const h of Object.values(doc.households)) householdParts(doc, h).forEach(r => add({ x1: r.x1 - 4, y1: r.y1 - 4, x2: r.x2 + 4, y2: r.y2 + 4 }));
    for (const t of Object.values(doc.labels)) {
      const lines = GT.wrapText(t.text || ' ', 18);
      add({ x1: t.x - 6, y1: t.y - 16, x2: t.x + Math.max(24, ...lines.map(l => GT.textEm(l) * LABEL_PX)) + 6, y2: t.y + lines.length * 18 });
    }
    for (const u of Object.values(doc.unions)) {
      const g = unionGeometry(doc, u);
      if (g) ys.push(g.yLine);
    }
    if (!xs.length) return { x: 0, y: 0, w: 400, h: 300 };
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  // 匯出用完整 SVG（白底、緊貼內容、字型寫在根節點）
  function exportSVG(doc, opts) {
    const o = opts || {};
    const m = o.margin == null ? 24 : o.margin;
    const b = bbox(doc);
    const x = f(b.x - m), y = f(b.y - m), w = f(b.w + m * 2), h = f(b.h + m * 2);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}" font-family="${esc(FONT)}">` +
           `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#FFFFFF"/>` +
           renderWorld(doc, { forExport: true }) + '</svg>';
  }

  // 圖例用的小樣本（說明對話框顯示每種線條長什麼樣子）
  function sampleSVG(kind, key, colored) {
    const d = GT.newDoc();
    d.settings.colorRelations = colored !== false;
    const mk = (id, x, y, g) => { d.persons[id] = { id, gender: g, x, y, name: '', index: false, deceased: false, age: '', birth: '', death: '', deathAge: '', attrs: {},
                                                    life: '', culture: '', illness: '', substance: '', conditions: [] }; };
    let body = '', vb = '0 -14 64 28', hpx = 28;
    if (kind === 'relation') {
      mk('a', -27, 0, 'M'); mk('b', 91, 0, 'F');
      d.relations.r = { id: 'r', a: 'a', b: 'b', type: key, note: '' };
      body = relationMarkup(d, d.relations.r, { forExport: true });
    } else if (kind === 'union') {
      mk('a', 8, -30, 'M'); mk('b', 56, -30, 'F');
      d.unions.u = { id: 'u', partners: ['a', 'b'], children: [], type: key, twins: [] };
      body = unionMarkup(d, d.unions.u, { forExport: true });
      vb = '0 -12 64 34';
    } else if (kind === 'child') {
      mk('a', 32, -60, 'M'); mk('c', 32, 26, key === 'pet' ? 'P' : 'U');
      d.unions.u = { id: 'u', partners: ['a'], children: [{ id: 'c', link: key === 'pet' ? 'bio' : key }], type: 'Other', twins: [] };
      body = unionMarkup(d, d.unions.u, { forExport: true });
      vb = '0 -24 64 30';
    } else if (kind === 'system') {                 // 生態圖圖例：資源圓
      d.systems.a = { id: 'a', name: key || '資源', x: 32, y: 0 };
      body = systemMarkup(d, d.systems.a, { forExport: true });
      vb = '0 -34 64 68'; hpx = 40;
    } else if (kind === 'tie') {                    // 生態圖圖例：連結的強弱、壓力、流向
      d.systems.a = { id: 'a', name: '資源', x: -28, y: 0 };
      d.systems.b = { id: 'b', name: '資源', x: 92, y: 0 };
      const o = { strong: { strength: 'strong' }, weak: { strength: 'weak' }, stress: { stress: true },
                  dir: { dir: 'a2b' }, both: { dir: 'both' } }[key] || {};
      d.ties.t = Object.assign({ id: 't', a: 'a', b: 'b', strength: 'normal', stress: false, dir: '', note: '' }, o);
      body = tieMarkup(d, d.ties.t, { forExport: true });
    } else if (kind === 'twins') {                  // key＝雙胞胎類型（異卵／同卵／不確定）
      mk('a', 32, -60, 'M'); mk('c', 14, 26, 'U'); mk('e', 50, 26, 'U');
      d.unions.u = { id: 'u', partners: ['a'], children: [{ id: 'c', link: 'bio' }, { id: 'e', link: 'bio' }], type: 'Other', twins: [{ ids: ['c', 'e'], kind: key }] };
      body = unionMarkup(d, d.unions.u, { forExport: true });
      vb = '0 -24 64 30';
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="64" height="${hpx}">${body}</svg>`;
  }

  // 屬性面板的小預覽：只畫符號本身（含成癮、疾病、文化等狀態），不畫標籤。
  // id 加前綴，避免跟畫布上同一人的 clipPath 撞 id
  function symbolSVG(doc, p, px) {
    const q = Object.assign({}, p, { id: 'pv-' + p.id });
    const e = symExtent(q), top = e.top + (q.culture ? CULTURE_H : 0) + 3, bot = e.bottom + 3, w = 29;
    const s = Math.max(2 * w, top + bot), y0 = -top - (s - top - bot) / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(-s / 2)} ${f(y0)} ${f(s)} ${f(s)}" width="${px}" height="${px}" font-family="${esc(FONT)}">${symbolMarkup(doc, q)}</svg>`;
  }

  // 生活圈由好幾塊矩形拼成，塊與塊之間的接縫看不見，但點擊範圍原本沿著每塊矩形的邊，接縫也點得到
  // （實測：在接縫附近開始拖曳圈選，結果選到生活圈）。上下左右各 3px 都還在圈裡＝圈的內部，不算點到外框
  function householdInterior(doc, h, x, y) {
    const rs = householdParts(doc, h), m = 3;
    const inAny = (px, py) => rs.some(r => px >= r.x1 && px <= r.x2 && py >= r.y1 && py <= r.y2);
    return inAny(x - m, y) && inAny(x + m, y) && inAny(x, y - m) && inAny(x, y + m);
  }

  // 拖曳圈選：框住「人的中心點」就算選到；文字說明看整塊的中心；
  // 線（伴侶線、情感關係）與生活圈在兩端／所有成員都被框到時一起選取
  function textLabelBox(t) {
    const lines = GT.wrapText(t.text || ' ', 18);
    const w = Math.max(24, ...lines.map(l => GT.textEm(l) * LABEL_PX));
    return { x1: t.x - 6, y1: t.y - 16, x2: t.x + w + 6, y2: t.y + lines.length * 18 - 6 };
  }
  function itemsInRect(doc, r) {
    const mode = viewMode(doc);
    const x1 = Math.min(r.x1, r.x2), x2 = Math.max(r.x1, r.x2), y1 = Math.min(r.y1, r.y2), y2 = Math.max(r.y1, r.y2);
    const inside = (x, y) => x >= x1 && x <= x2 && y >= y1 && y <= y2;
    const ps = new Set((mode === 'ecomap' ? [] : Object.values(doc.persons)).filter(p => inside(p.x, p.y)).map(p => p.id));
    const out = [...ps];
    if (mode !== 'genogram') {                    // 資源圓：中心點在框內就算；生態連結：兩端都框到才選
      for (const y of Object.values(doc.systems)) if (inside(y.x, y.y)) { ps.add(y.id); out.push(y.id); }
      // 端點是生活圈＝成員全都框到才算；生態圖模式下人與生活圈都收成家庭圓，看家庭圓在不在框裡
      const fam = mode === 'ecomap' && Object.keys(doc.persons).length ? familyNode(doc) : null;
      const famIn = !!fam && inside(fam.x, fam.y);
      const endIn = (id) => doc.systems[id] ? ps.has(id)
        : mode === 'ecomap' ? famIn
        : doc.persons[id] ? ps.has(id)
        : doc.households[id] ? (doc.households[id].members.length > 0 && doc.households[id].members.every(m => ps.has(m)))
        : false;
      for (const t of Object.values(doc.ties)) if (endIn(t.a) && endIn(t.b)) out.push(t.id);
    }
    for (const t of Object.values(doc.labels)) { const b = textLabelBox(t); if (inside((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2)) out.push(t.id); }
    for (const u of Object.values(doc.unions)) if (u.partners.every(x => ps.has(x))) out.push(u.id);
    for (const rl of Object.values(doc.relations)) if (ps.has(rl.a) && ps.has(rl.b)) out.push(rl.id);
    for (const h of Object.values(doc.households)) if (h.members.length && h.members.every(x => ps.has(x))) out.push(h.id);
    return out;
  }

  GT.render = { C, G, FONT, HALF, esc, renderWorld, exportSVG, bbox, unionGeometry, personBox, labelBox, sampleSVG, symbolSVG, itemsInRect, householdInterior,
                tieGeometry, lineLabels, lineLabelBox, lineLabelText, unionMarks,
                viewMode, systemRadius, systemBox, familyNode, tieAnchor, edgePoint,
                householdParts, householdIntruders, symExtent, symTop, symBottom,
                FAMILY_STYLE, EMOTION_COLOR, BW_GRAY, CHILD_STYLE, INDEX_FILL, SUSPECT_FILL };
})(globalThis.GT = globalThis.GT || {});
