/* 家系圖工具 — layout.js
 * 自動排版（使用者 2026-10-28：「可以增加這個功能，但要不要用由使用者決定」）：
 * 只在使用者按「自動排版」並確認後才執行；介面層會先存復原點，排完不滿意按復原就回去。
 * 做法：
 *   1. 分世代：伴侶同一代、子女比父母低一代（從畫面最上面的人開始往外推）；
 *   2. 同一代裡，伴侶連成一組（「前任—本人—現任」排成一串）；
 *   3. 各組的左右順序：由上而下跟著父母、由下而上跟著子女，來回幾次；
 *   4. 擺位置：子女置中在父母下方、父母置中在子女上方，同一列不重疊（保持順序、移動量最小）；
 *   5. 資源圓與文字說明跟著整張圖移動：在圖外的保持跟圖邊的距離，在圖內的照比例。
 * 跨世代的伴侶這類少見的結構不會出錯，只是排得沒那麼漂亮；使用者可以再手動調整。
 */
(function (GT) {
  'use strict';
  const R = GT.render;
  const SPACE = { partner: 24, sibling: 28, family: 64 };   // 相鄰兩人的標籤之間至少留的空白（px）
  const MIN = { partner: GT.GAP_X, sibling: GT.GAP_X * 0.8, family: GT.GAP_X * 1.2 };   // 中心距離下限
  const COMP_GAP = 120;                                       // 互不相連的兩群人之間
  const ROUNDS = 12;
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;

  // 1. 世代：伴侶同代、子女下一代；先推到的算數（跨世代的怪結構不會當掉）。
  //    用 Map 不用物件：人的 id 可能剛好是 toString 這類物件內建的名字
  function generations(doc) {
    const P = doc.persons, adj = new Map(Object.keys(P).map(id => [id, []]));
    const link = (a, b, d) => { adj.get(a).push({ id: b, d }); adj.get(b).push({ id: a, d: -d }); };
    for (const u of Object.values(doc.unions)) {
      const ps = u.partners.filter(id => P[id]);
      if (ps.length === 2) link(ps[0], ps[1], 0);
      for (const c of u.children) if (P[c.id]) for (const p of ps) link(p, c.id, 1);
    }
    const gen = new Map(), comps = [];
    for (const s of Object.values(P).sort((a, b) => a.y - b.y || a.x - b.x)) {
      if (gen.has(s.id)) continue;
      gen.set(s.id, 0);
      const ids = [s.id];
      for (let i = 0; i < ids.length; i++)
        for (const e of adj.get(ids[i])) if (!gen.has(e.id)) { gen.set(e.id, gen.get(ids[i]) + e.d); ids.push(e.id); }
      const min = Math.min(...ids.map(id => gen.get(id)));
      ids.forEach(id => gen.set(id, gen.get(id) - min));
      comps.push(ids);
    }
    return { gen, comps };
  }

  // 2. 同一代裡用伴侶關係連成一組
  function orderUnit(grp, nb, P) {
    const byX = (a, b) => P[a].x - P[b].x;
    if (grp.length <= 2) return grp.sort(byX);
    const deg = (id) => nb.get(id).size, edges = grp.reduce((s, id) => s + deg(id), 0) / 2;
    if (edges === grp.length - 1 && grp.every(id => deg(id) <= 2)) {       // 一串：從比較左邊的一端走到另一端
      const out = [grp.filter(id => deg(id) === 1).sort(byX)[0]];
      while (out.length < grp.length) out.push([...nb.get(out[out.length - 1])].find(m => !out.includes(m)));
      return out;
    }
    const hub = grp.find(id => deg(id) === grp.length - 1);
    if (hub && edges === grp.length - 1) {                                   // 一人有三段以上關係：本人在中間
      const others = grp.filter(id => id !== hub).sort(byX);
      const left = others.filter(id => P[id].x < P[hub].x), right = others.filter(id => P[id].x >= P[hub].x);
      if (left.length && right.length) return [...left, hub, ...right];
      const k = Math.floor(others.length / 2);                               // 全在同一邊：對半分，伴侶線才不會一條疊一條
      return [...others.slice(0, k), hub, ...others.slice(k)];
    }
    return grp.sort(byX);
  }
  function unitsOf(doc, ids, gen) {
    const P = doc.persons, inSet = new Set(ids), nb = new Map(ids.map(id => [id, new Set()]));
    for (const u of Object.values(doc.unions)) {
      const ps = u.partners.filter(id => inSet.has(id));
      if (ps.length === 2 && gen.get(ps[0]) === gen.get(ps[1])) { nb.get(ps[0]).add(ps[1]); nb.get(ps[1]).add(ps[0]); }
    }
    const seen = new Set(), units = [];
    for (const id of [...ids].sort((a, b) => P[a].x - P[b].x)) {
      if (seen.has(id)) continue;
      const grp = [id];
      seen.add(id);
      for (let i = 0; i < grp.length; i++) for (const m of nb.get(grp[i])) if (!seen.has(m)) { seen.add(m); grp.push(m); }
      units.push({ members: orderUnit(grp, nb, P), gen: gen.get(id), x: 0, off: [], span: 0 });
    }
    return units;
  }

  // 保持順序、移動量最小：y 非遞減的加權最小平方（PAV）
  function pav(targets, weights) {
    const blocks = [];
    targets.forEach((t, i) => {
      blocks.push({ s: t * weights[i], w: weights[i], n: 1 });
      while (blocks.length > 1) {
        const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
        if (a.s / a.w <= b.s / b.w) break;
        a.s += b.s; a.w += b.w; a.n += b.n; blocks.pop();
      }
    });
    return blocks.flatMap(b => Array(b.n).fill(b.s / b.w));
  }

  // 一群相連的人：排順序、擺 x；回傳 { X: 人→x, units }
  function layoutComponent(doc, ids, gen, half) {
    const P = doc.persons;
    const parentOf = new Map(), partnerIn = new Map(ids.map(id => [id, []]));
    for (const u of Object.values(doc.unions)) {
      for (const c of u.children) if (partnerIn.has(c.id)) parentOf.set(c.id, u);
      for (const p of u.partners) if (partnerIn.has(p)) partnerIn.get(p).push(u);
    }
    const units = unitsOf(doc, ids, gen);
    const gens = [...new Set(units.map(u => u.gen))].sort((a, b) => a - b);
    const rows = new Map(gens.map(g => [g, units.filter(u => u.gen === g)]));
    const kidsIn = (u, g) => u.children.map(c => c.id).filter(id => partnerIn.has(id) && gen.get(id) === g);
    const siblings = (a, b) => !!parentOf.get(a) && parentOf.get(a) === parentOf.get(b);

    // 3. 左右順序（位置用 0～1 的名次，各列才能互相比較）
    const pos = new Map();
    const refresh = (g) => { const ms = rows.get(g).flatMap(u => u.members); ms.forEach((id, i) => pos.set(id, (i + 0.5) / ms.length)); };
    gens.forEach(refresh);
    const upAnchor = (id) => { const u = parentOf.get(id); const ps = u ? u.partners.filter(p => pos.has(p)) : []; return ps.length ? avg(ps.map(p => pos.get(p))) : null; };
    const downAnchor = (id, g) => {
      const kids = partnerIn.get(id).flatMap(u => kidsIn(u, g + 1));
      return kids.length ? avg(kids.map(k => pos.get(k))) : null;
    };
    const sweep = (g, anchorOf) => {
      for (const u of rows.get(g)) {
        // 伴侶各自靠向自己的原生家庭：組內順序跟錨點位置負相關（共變異數 < 0）就左右翻過來
        const pts = u.members.map((m, i) => ({ i, v: anchorOf(m) })).filter(q => q.v != null);
        if (pts.length >= 2) {
          const mi = avg(pts.map(q => q.i)), mv = avg(pts.map(q => q.v));
          if (pts.reduce((s, q) => s + (q.i - mi) * (q.v - mv), 0) < -1e-9) u.members.reverse();
        }
        u.key = pts.length ? avg(pts.map(q => q.v)) : avg(u.members.map(m => pos.get(m)));
      }
      rows.get(g).sort((p, q) => p.key - q.key);
      refresh(g);
    };
    for (let r = 0; r < ROUNDS / 2; r++) {
      gens.slice(1).forEach(g => sweep(g, upAnchor));
      gens.slice(0, -1).reverse().forEach(g => sweep(g, id => downAnchor(id, g)));
    }

    // 4. 擺 x：組內間距固定；組與組之間保持順序、不重疊
    const need = (a, b, kind) => Math.max(MIN[kind], half(a) + half(b) + SPACE[kind]);
    for (const u of units) {
      u.off = [0];
      for (let i = 1; i < u.members.length; i++) u.off.push(u.off[i - 1] + need(u.members[i - 1], u.members[i], 'partner'));
      u.span = u.off[u.off.length - 1];
    }
    const X = new Map();
    const commit = (row) => row.forEach(u => u.members.forEach((m, i) => X.set(m, u.x + u.off[i])));
    const place = (row, desired) => {
      const o = [0];
      for (let i = 1; i < row.length; i++) {
        const a = row[i - 1], b = row[i];
        const kind = a.members.some(m => b.members.some(n => siblings(m, n))) ? 'sibling' : 'family';
        o.push(o[i - 1] + a.span + need(a.members[a.members.length - 1], b.members[0], kind));
      }
      const y = pav(row.map((u, i) => desired[i] - o[i]), row.map(u => u.members.length));
      row.forEach((u, i) => { u.x = y[i] + o[i]; });
      commit(row);
    };
    gens.forEach(g => place(rows.get(g), rows.get(g).map(() => 0)));
    const mid = (un) => avg(un.partners.filter(p => X.has(p)).map(p => X.get(p)));
    const span = (xs) => (Math.min(...xs) + Math.max(...xs)) / 2;
    const shifted = (u, shifts) => u.x + (shifts.length ? avg(shifts) : 0);
    for (let r = 0; r < ROUNDS; r++) {
      for (const g of gens.slice(1)) {                                        // 子女置中在父母下方
        const row = rows.get(g);
        place(row, row.map(u => shifted(u, u.members.filter(m => parentOf.get(m)).map(m => {
          const pu = parentOf.get(m);
          return mid(pu) - span(kidsIn(pu, g).map(k => X.get(k)));
        }))));
      }
      for (const g of gens.slice(0, -1).reverse()) {                         // 父母置中在子女上方
        const row = rows.get(g);
        place(row, row.map(u => shifted(u, [...new Set(u.members.flatMap(m => partnerIn.get(m)))]
          .filter(un => kidsIn(un, g + 1).length)
          .map(un => span(kidsIn(un, g + 1).map(k => X.get(k))) - mid(un)))));
      }
    }
    return X;
  }

  // 主程式：只改座標，不改任何關係資料；回傳排了幾個人
  function autoLayout(doc) {
    const ps = Object.values(doc.persons);
    if (ps.length < 2) return 0;
    const boxes0 = ps.map(p => R.personBox(doc, p));
    const old = { x1: Math.min(...boxes0.map(b => b.x1)), x2: Math.max(...boxes0.map(b => b.x2)),
                  y1: Math.min(...boxes0.map(b => b.y1)), y2: Math.max(...boxes0.map(b => b.y2)) };
    const cx0 = (Math.min(...ps.map(p => p.x)) + Math.max(...ps.map(p => p.x))) / 2, top0 = Math.min(...ps.map(p => p.y));
    const ext = new Map(ps.map((p, i) => [p.id, { half: (boxes0[i].x2 - boxes0[i].x1) / 2, above: p.y - boxes0[i].y1, below: boxes0[i].y2 - p.y }]));
    const half = (id) => ext.get(id).half;

    const { gen, comps } = generations(doc);
    // 每群人放在哪幾列：人最多的那群從第 0 列開始；其他群照它們目前的高度對齊到最接近的列
    comps.sort((a, b) => b.length - a.length);
    const base = (ids) => avg(ids.map(id => doc.persons[id].y - gen.get(id) * GT.GAP_Y));
    const b0 = base(comps[0]);
    const rowOf = new Map();
    comps.forEach((ids, i) => {
      const k = i ? Math.round((base(ids) - b0) / GT.GAP_Y) : 0;
      ids.forEach(id => rowOf.set(id, gen.get(id) + k));
    });
    // 列與列的距離：至少一個世代的高度，標籤很多行時再拉開（伴侶線在標籤下方，要留位置）
    const rowsUsed = [...new Set(rowOf.values())].sort((a, b) => a - b);
    const rowY = new Map([[rowsUsed[0], 0]]);
    for (let i = 1; i < rowsUsed.length; i++) {
      const r0 = rowsUsed[i - 1], r1 = rowsUsed[i];
      const below = Math.max(...ps.filter(p => rowOf.get(p.id) === r0).map(p => ext.get(p.id).below));
      const above = Math.max(...ps.filter(p => rowOf.get(p.id) === r1).map(p => ext.get(p.id).above));
      rowY.set(r1, rowY.get(r0) + Math.max(GT.GAP_Y * (r1 - r0), below + 60 + above));
    }

    // 各群由左到右排（照它們目前的左右位置），群與群之間留空
    comps.sort((a, b) => avg(a.map(id => doc.persons[id].x)) - avg(b.map(id => doc.persons[id].x)));
    const X = new Map();
    let right = null;
    for (const ids of comps) {
      const Xc = layoutComponent(doc, ids, gen, half);
      const left = Math.min(...ids.map(id => Xc.get(id) - half(id)));
      const dx = right == null ? -left : right + COMP_GAP - left;
      ids.forEach(id => X.set(id, Xc.get(id) + dx));
      right = Math.max(...ids.map(id => X.get(id) + half(id)));
    }

    // 整張圖放回原來的位置：水平置中對齊、最上面一列對齊原本最上面的人。
    // 先吸附「相對位置」、再整塊平移整數格：排好的圖再按一次，位置才不會因為四捨五入跳一格
    const x0 = Math.min(...X.values());
    const XS = new Map([...X].map(([id, x]) => [id, GT.snap(x - x0)]));
    const xs = [...XS.values()], shiftX = GT.snap(cx0 - (Math.min(...xs) + Math.max(...xs)) / 2);
    for (const p of ps) { p.x = XS.get(p.id) + shiftX; p.y = GT.snap(top0 + rowY.get(rowOf.get(p.id))); }

    // 5. 資源圓與文字說明跟著整張圖移動
    const boxes1 = ps.map(p => R.personBox(doc, p));
    const now = { x1: Math.min(...boxes1.map(b => b.x1)), x2: Math.max(...boxes1.map(b => b.x2)),
                  y1: Math.min(...boxes1.map(b => b.y1)), y2: Math.max(...boxes1.map(b => b.y2)) };
    const map = (v, a0, a1, b0, b1) => v < a0 ? b0 - (a0 - v) : v > a1 ? b1 + (v - a1)
      : a1 - a0 < 1 ? (b0 + b1) / 2 : b0 + (v - a0) * (b1 - b0) / (a1 - a0);
    for (const o of [...Object.values(doc.systems), ...Object.values(doc.labels)]) {
      o.x = GT.snap(map(o.x, old.x1, old.x2, now.x1, now.x2));
      o.y = GT.snap(map(o.y, old.y1, old.y2, now.y1, now.y2));
    }
    return ps.length;
  }

  GT.layout = { autoLayout, generations, pav };
})(globalThis.GT = globalThis.GT || {});
