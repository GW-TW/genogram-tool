/* 家系圖工具 — narrate.js
 * 把圖上的家庭結構寫成一段文字（家庭概況），讓社工複製後貼進紀錄（2026-11-11）。
 *
 * 用詞（使用者 2026-11-11 決定）：主述的人稱「服務使用者」；親屬稱謂沿用實務慣用的
 * 案父、案母、案兄、案弟、案夫、案妻、案子、案女……（目前沒有其他專業規範可以參酌的替代用詞）。
 *
 * 三條原則：
 *   1. 只寫圖上畫出來的。圖上沒畫伴侶，不寫成「未婚」；沒填年齡，不寫年齡。
 *   2. 不靜默丟人。判斷不出稱謂的人，最後一段會列出來，說明沒有寫進前面的敘述。
 *   3. 這裡只產生純文字；畫面上一律用 textContent 放進去，不經過 HTML。
 * 手足的長幼＝圖上由左到右的順序（跟自動排版、使用說明講的出生序同一個規則）。
 */
(function (GT) {
  'use strict';

  const ORD_OLD = ['長', '次', '三', '四', '五', '六', '七', '八', '九', '十'];     // 案長兄、案次兄；案長子、案次子
  const ORD_YOUNG = ['大', '二', '三', '四', '五', '六', '七', '八', '九', '十'];   // 案大弟、案二弟
  const ANON = '甲乙丙丁戊己庚辛壬癸';

  // 伴侶關係的類型 → 稱謂用的狀態。
  // 「臨時關係、非承諾關係、強迫關係、其他」不是伴侶：一律用中性的「關係對象」，不可以寫成男友、女友或伴侶
  const DATING = new Set(['CommittedRelationship', 'CasualRelationship', 'LoveAffair']);
  function unionKind(type) {
    const cat = (GT.FAMILY_TYPES.find(t => t.key === type) || {}).cat;
    if (type === 'Marriage') return 'married';
    if (type === 'Divorce' || type === 'Nullity') return 'divorced';
    if (type === 'Widowed') return 'widowed';
    if (type === 'Separation' || type === 'SeparationLegal') return 'separated';
    const ended = /Separation$/.test(type), base = type.replace(/And(Legal)?Separation$/, '');
    if (cat === 'engagement') return ended ? 'exengaged' : 'engaged';
    if (cat === 'cohabit') return ended ? 'excohab' : 'cohab';
    if (DATING.has(base)) return ended ? 'exdating' : 'dating';
    return 'neutral';
  }
  // 句子裡怎麼寫兩人的關係：常見的幾種用口語，其餘直接寫類型名稱（不自己詮釋，例如「沒有感情的同居」不簡化成「同居」）
  const PHRASE = { Marriage: '已婚', Separation: '分居', SeparationLegal: '合法分居', Divorce: '已離婚', Nullity: '婚姻無效', Widowed: '喪偶',
                   Engagement: '已訂婚', Cohabitation: '同居', CohabitationAndSeparation: '曾同居，現已分開' };
  const phraseOf = (type) => PHRASE[type] || `的關係為「${GT.labelOf(GT.FAMILY_TYPES, type)}」`;
  const WEDDED = new Set(['married', 'separated', 'widowed']);
  // 「某人的伴侶」怎麼稱呼：看狀態與對方的性別
  function partnerWord(kind, gender) {
    const mf = (m, f, u) => (gender === 'M' ? m : gender === 'F' ? f : u);
    return { married: mf('夫', '妻', '配偶'), separated: mf('夫', '妻', '配偶'), widowed: mf('夫', '妻', '配偶'),
             divorced: mf('前夫', '前妻', '前配偶'), engaged: mf('未婚夫', '未婚妻', '未婚伴侶'), exengaged: mf('前未婚夫', '前未婚妻', '前未婚伴侶'),
             cohab: '同居人', excohab: '前同居人', dating: mf('男友', '女友', '伴侶'), exdating: mf('前男友', '前女友', '前伴侶'),
             neutral: '關係對象' }[kind];
  }

  // ── 稱謂：以 ix（服務使用者）為中心，回傳 Map（人的 id → 稱謂）；判斷不出來的人不在裡面 ──
  function kinTerms(doc, ix) {
    const P = doc.persons, T = new Map();
    if (!P[ix]) return T;
    T.set(ix, '服務使用者');
    const set = (id, term) => { if (id && P[id] && !T.has(id)) T.set(id, term); };
    const g = (id) => P[id].gender;
    const mf = (id, m, f, u) => (g(id) === 'M' ? m : g(id) === 'F' ? f : u);
    const byX = (ids) => ids.filter(id => P[id]).sort((a, b) => P[a].x - P[b].x);
    const pu = (id) => GT.parentUnionOf(doc, id);
    const unions = (id) => GT.unionsOf(doc, id);
    const other = (u, id) => u.partners.find(x => x !== id && P[x]);
    const kidsOf = (u) => byX(u.children.map(c => c.id));
    // 同一種稱謂只有一個人：案兄；有好幾個：案長兄、案次兄……
    const numbered = (ids, one, many) => ids.forEach((id, i) => set(id, ids.length === 1 ? one : many(i)));
    const ord = (list, i) => list[i] || '';

    const U = pu(ix), parents = U ? U.partners.filter(id => P[id]) : [];
    for (const p of parents) set(p, mf(p, '案父', '案母', '案家長'));

    // 手足（同一對父母）：左邊的是兄姊、右邊的是弟妹
    if (U) {
      const sibs = kidsOf(U), i0 = sibs.indexOf(ix);
      const older = sibs.slice(0, i0), younger = sibs.slice(i0 + 1);
      const pick = (ids, gender) => ids.filter(id => g(id) === gender);
      numbered(pick(older, 'M'), '案兄', i => `案${ord(ORD_OLD, i)}兄`);
      numbered(pick(older, 'F'), '案姊', i => `案${ord(ORD_OLD, i)}姊`);
      numbered(pick(younger, 'M'), '案弟', i => `案${ord(ORD_YOUNG, i)}弟`);
      numbered(pick(younger, 'F'), '案妹', i => `案${ord(ORD_YOUNG, i)}妹`);
      for (const s of sibs) if (s !== ix) set(s, '案手足');                    // 性別未註明的手足
      for (const s of sibs) {
        if (s === ix) continue;
        const st = T.get(s), isBro = /[兄弟]$/.test(st), isSis = /[姊妹]$/.test(st);
        for (const u of unions(s)) {
          const q = other(u, s), kind = unionKind(u.type);
          if (q) {
            const inlaw = /兄$/.test(st) ? st.replace(/兄$/, '嫂') : /弟$/.test(st) ? st + '媳' : isSis ? st + '夫' : null;
            const fits = WEDDED.has(kind) && inlaw && ((isBro && g(q) === 'F') || (isSis && g(q) === 'M'));
            set(q, fits ? inlaw : `${st}之${partnerWord(kind, g(q))}`);
          }
          for (const c of kidsOf(u)) set(c, isBro ? mf(c, '案姪', '案姪女', '案姪輩') : isSis ? mf(c, '案外甥', '案外甥女', '案外甥輩') : `${st}之子女`);
        }
      }
    }

    // 祖父母、父母的手足、父母另一段關係
    for (const p of parents) {
      const pt = T.get(p), paternal = g(p) === 'M', maternal = g(p) === 'F';
      const gu = pu(p);
      if (gu) {
        for (const gp of gu.partners) {
          set(gp, paternal ? mf(gp, '案祖父', '案祖母', '案祖輩') : maternal ? mf(gp, '案外祖父', '案外祖母', '案外祖輩') : '案祖輩');
        }
        const ps = kidsOf(gu), i0 = ps.indexOf(p);
        ps.forEach((s, i) => {
          if (s === p) return;
          const st = paternal ? mf(s, i < i0 ? '案伯父' : '案叔父', '案姑母', '案父之手足')
                   : maternal ? mf(s, '案舅父', '案姨母', '案母之手足') : `${pt}之手足`;
          set(s, st);
          for (const u of unions(s)) {
            const q = other(u, s), kind = unionKind(u.type);
            if (q) {
              const inlaw = { 案伯父: '案伯母', 案叔父: '案叔母', 案姑母: '案姑丈', 案舅父: '案舅母', 案姨母: '案姨丈' }[st];
              const fits = WEDDED.has(kind) && inlaw && g(q) !== g(s) && g(q) !== 'U';
              set(q, fits ? inlaw : `${st}之${partnerWord(kind, g(q))}`);
            }
            const cousin = paternal && g(s) === 'M' ? '堂' : '表';              // 父親兄弟的子女＝堂，其餘＝表
            for (const c of kidsOf(u)) set(c, mf(c, `案${cousin}兄弟`, `案${cousin}姊妹`, `案${cousin}手足`));
          }
        });
      }
      for (const u of unions(p)) {
        if (u === U) continue;
        const q = other(u, p), kind = unionKind(u.type);
        if (q) set(q, WEDDED.has(kind) ? mf(q, '案繼父', '案繼母', `${pt}之配偶`) : `${pt}之${partnerWord(kind, g(q))}`);
        const half = paternal ? '案同父異母' : maternal ? '案同母異父' : null;
        for (const c of kidsOf(u)) set(c, half ? half + mf(c, '兄弟', '姊妹', '手足') : `${pt}之子女`);
      }
    }

    // 伴侶、伴侶的父母、子女、子女的伴侶、孫子女
    const sons = [], daughters = [], kidsAll = [];
    for (const u of unions(ix)) {
      const q = other(u, ix), kind = unionKind(u.type);
      if (q) {
        set(q, kind === 'neutral' ? '關係對象' : '案' + partnerWord(kind, g(q)));
        const qt = T.get(q), qu = pu(q);
        if (qu) for (const pp of qu.partners) {
          const law = kind !== 'married' && kind !== 'separated' && kind !== 'widowed' ? null
            : g(q) === 'M' ? mf(pp, '案公公', '案婆婆', null) : g(q) === 'F' ? mf(pp, '案岳父', '案岳母', null) : null;
          set(pp, law || `${qt}之${mf(pp, '父', '母', '家長')}`);
        }
        for (const u2 of unions(q)) {
          if (u2 === u) continue;
          for (const c of kidsOf(u2)) set(c, WEDDED.has(kind) ? mf(c, '案繼子', '案繼女', '案繼子女') : `${qt}之子女`);
        }
      }
      for (const c of kidsOf(u)) kidsAll.push(c);
    }
    for (const c of byX(kidsAll)) (g(c) === 'M' ? sons : g(c) === 'F' ? daughters : []).push(c);
    numbered(sons, '案子', i => `案${ord(ORD_OLD, i)}子`);
    numbered(daughters, '案女', i => `案${ord(ORD_OLD, i)}女`);
    for (const c of kidsAll) set(c, '案子女');
    for (const c of kidsAll) {
      const ct = T.get(c), son = /子$/.test(ct) && ct !== '案子女', dau = /女$/.test(ct) && ct !== '案子女';
      for (const u of unions(c)) {
        const q = other(u, c), kind = unionKind(u.type);
        if (q) {
          const inlaw = son ? ct.replace(/子$/, '媳') : dau ? ct + '婿' : null;
          const fits = WEDDED.has(kind) && inlaw && ((son && g(q) === 'F') || (dau && g(q) === 'M'));
          set(q, fits ? inlaw : `${ct}之${partnerWord(kind, g(q))}`);
        }
        for (const k of kidsOf(u)) set(k, son ? mf(k, '案孫', '案孫女', '案孫輩') : dau ? mf(k, '案外孫', '案外孫女', '案外孫輩') : '案孫輩');
      }
    }
    return T;
  }

  const SECTIONS = [
    { key: 'self',      title: '基本資料' },
    { key: 'origin',    title: '原生家庭' },
    { key: 'siblings',  title: '手足' },
    { key: 'marriage',  title: '婚姻與子女' },
    { key: 'household', title: '同住情形' },
    { key: 'relations', title: '情感關係' },
    { key: 'health',    title: '健康狀況' },
    { key: 'eco',       title: '外部資源' },
    { key: 'others',    title: '其他成員' },
  ];

  // 可以當主述的人：圖上勾了「服務使用者」的人（由上到下、由左到右）
  const indexPersons = (doc) => Object.values(doc.persons).filter(p => p.index).sort((a, b) => a.y - b.y || a.x - b.x).map(p => p.id);

  // 主程式。opts：index（主述的人，預設第一位服務使用者）、names（寫出姓名）、ages（寫出年齡）、attrs（寫出服務使用者的其他資料）、
  // sections（要寫哪幾段的 key 陣列，預設全部）。回傳 { index, candidates, sections: [{ key, title, text }], text }
  function build(doc, opts) {
    const o = Object.assign({ names: true, ages: true, attrs: true }, opts || {});
    const P = doc.persons, candidates = indexPersons(doc);
    const ix = o.index && P[o.index] ? o.index : candidates[0] || null;
    if (!ix) return { index: null, candidates, sections: [], text: '' };
    const T = kinTerms(doc, ix), mentioned = new Set(), anon = new Map();
    const g = (id) => P[id].gender;
    const byX = (ids) => ids.filter(id => P[id]).sort((a, b) => P[a].x - P[b].x);
    const other = (u, id) => u.partners.find(x => x !== id && P[x]);
    const nameOf = (id) => (o.names ? P[id].name.trim() : '');
    // 稱呼：有稱謂用稱謂；沒有稱謂的，寫姓名；連姓名都沒有（或不寫姓名）就叫「親屬甲、親屬乙」
    const ref = (id) => {
      mentioned.add(id);
      if (T.has(id)) return T.get(id);
      if (nameOf(id)) return nameOf(id);
      if (!anon.has(id)) anon.set(id, `親屬${ANON[anon.size] || anon.size + 1}`);
      return anon.get(id);
    };
    const ageBit = (id) => {
      const p = P[id], age = GT.ageOf(doc, p).value, has = o.ages && age !== null && age !== '' && age !== undefined;
      return has ? (p.deceased ? `歿年 ${age} 歲` : `${age} 歲`) : (p.deceased ? '已歿' : '');
    };
    // 第一次提到一個人：稱謂後面括號寫姓名、年齡、是否已歿
    const who = (id) => {
      const bits = [T.has(id) ? nameOf(id) : '', ageBit(id)].filter(Boolean);
      return ref(id) + (bits.length ? `（${bits.join('，')}）` : '');
    };
    const count = (ids) => {
      const m = ids.filter(id => g(id) === 'M').length, f = ids.filter(id => g(id) === 'F').length, u = ids.length - m - f;
      return [m ? `${m} 子` : '', f ? `${f} 女` : '', u ? `${u} 名性別未註明的子女` : ''].filter(Boolean).join(' ');
    };
    const kidsOf = (u) => byX(u.children.map(c => c.id));
    const noteOf = (u) => (u.note && u.note.trim() ? `（${u.note.trim()}）` : '');
    const phrase = (u) => phraseOf(u.type);
    // 一個人自己的家庭（伴侶與子女）：接在他的稱呼後面
    const family = (id, skip) => GT.unionsOf(doc, id).filter(u => u !== skip).map(u => {
      const q = other(u, id), kids = kidsOf(u);
      const head = q ? `與${who(q)}${phrase(u)}${noteOf(u)}` : '';
      const tail = kids.length ? `育有 ${count(kids)}（${kids.map(who).join('、')}）` : '';
      return [head, tail].filter(Boolean).join('，');
    }).filter(Boolean).join('；');
    const S = {};
    const p0 = P[ix];

    // 1. 基本資料
    {
      mentioned.add(ix);
      const bits = [{ M: '男性', F: '女性' }[p0.gender] || '', ageBit(ix),
                    p0.life ? GT.labelOf(GT.LIFE_STATES, p0.life) : '', p0.culture ? `文化背景：${GT.labelOf(GT.CULTURES, p0.culture)}` : ''].filter(Boolean);
      const attrs = o.attrs ? doc.settings.fields.filter(f => (p0.attrs || {})[f.key]).map(f => `${f.label}：${String(p0.attrs[f.key]).trim()}`) : [];
      const head = '服務使用者' + (nameOf(ix) ? nameOf(ix) : '') + (bits.length ? `，${bits.join('，')}` : '');
      if (nameOf(ix) || bits.length || attrs.length) S.self = head + '。' + (attrs.length ? attrs.join('；') + '。' : '');
    }

    // 2. 原生家庭
    {
      const U = GT.parentUnionOf(doc, ix), out = [];
      if (U) {
        const ps = U.partners.filter(id => P[id]), kids = kidsOf(U), rank = kids.indexOf(ix) + 1;
        const link = (U.children.find(c => c.id === ix) || {}).link;
        const lead = ps.length === 2 ? `${who(ps[0])}與${who(ps[1])}${phrase(U)}${noteOf(U)}，` : ps.length ? `${who(ps[0])}` : '';
        const kidsText = kids.length === 1 ? `育有服務使用者 1 名子女` : `育有 ${count(kids)}，服務使用者排行第 ${rank}`;
        out.push(lead + kidsText + (link === 'adopted' ? '，為收養子女' : link === 'foster' ? '，為寄養子女' : '') + '。');
        const elders = [], seen = new Set(ps);
        for (const p of ps) {
          const gu = GT.parentUnionOf(doc, p);
          if (gu) for (const id of gu.partners.filter(x => P[x]).concat(kidsOf(gu))) if (!seen.has(id)) { seen.add(id); elders.push(id); }
        }
        const gps = elders.filter(id => /祖/.test(T.get(id) || '')), aunts = elders.filter(id => !gps.includes(id));
        if (gps.length) out.push(`祖父母輩：${gps.map(who).join('、')}。`);
        if (aunts.length) out.push(`父母的手足：${aunts.map(id => { const f = family(id); return who(id) + (f ? `，${f}` : ''); }).join('；')}。`);
        for (const p of ps) {
          const f = family(p, U);
          if (f) out.push(`${ref(p)}另${f}。`);
        }
      }
      if (out.length) S.origin = out.join('');
    }

    // 3. 手足
    {
      const U = GT.parentUnionOf(doc, ix);
      const sibs = U ? kidsOf(U).filter(id => id !== ix) : [];
      if (sibs.length) S.siblings = sibs.map(id => { const f = family(id); return who(id) + (f ? `，${f}` : ''); }).join('；') + '。';
    }

    // 4. 婚姻與子女
    {
      const out = [], kidsAll = [];
      for (const u of GT.unionsOf(doc, ix)) {
        const q = other(u, ix), kids = kidsOf(u);
        kids.forEach(k => kidsAll.push(k));
        if (!q && !kids.length) continue;
        const head = q ? `服務使用者與${who(q)}${phrase(u)}${noteOf(u)}` : '服務使用者';
        out.push(head + (kids.length ? `${q ? '，' : ''}育有 ${count(kids)}：${kids.map(who).join('、')}` : '') + '。');
        if (q) {
          const qu = GT.parentUnionOf(doc, q), qps = qu ? qu.partners.filter(x => P[x]) : [];
          if (qps.length) out.push(`${ref(q)}的父母：${qps.map(who).join('、')}。`);
          const f = family(q, u);
          if (f) out.push(`${ref(q)}另${f}。`);
        }
      }
      for (const k of byX(kidsAll)) {
        const f = family(k);
        if (f) out.push(`${ref(k)}${f}。`);
      }
      if (out.length) S.marriage = out.join('');
    }

    // 5. 同住情形
    {
      const out = [];
      const hs = Object.values(doc.households).sort((a, b) => (b.members.includes(ix) ? 1 : 0) - (a.members.includes(ix) ? 1 : 0));
      for (const h of hs) {
        const ms = h.members.filter(id => P[id]), label = h.label && h.label.trim() ? `（${h.label.trim()}）` : '';
        if (!ms.length) continue;
        if (ms.includes(ix)) {
          const rest = ms.filter(id => id !== ix).sort((a, b) => P[a].y - P[b].y || P[a].x - P[b].x).map(ref);
          out.push((rest.length ? `服務使用者與${rest.join('、')}同住` : '服務使用者獨自居住') + label + '。');
        } else {
          const names = ms.slice().sort((a, b) => P[a].y - P[b].y || P[a].x - P[b].x).map(ref);
          out.push((names.length > 1 ? `${names.join('、')}同住` : `${names[0]}獨自居住`) + label + '。');
        }
      }
      if (out.length) S.household = out.join('');
    }

    // 6. 情感關係
    {
      const rs = Object.values(doc.relations).filter(r => P[r.a] && P[r.b]);
      const touch = (r) => (r.a === ix || r.b === ix ? 0 : 1);
      const out = rs.sort((a, b) => touch(a) - touch(b)).map(r => {
        const t = GT.EMOTION_TYPES.find(x => x.key === r.type) || { label: r.type };
        return `${ref(r.a)}${t.dir ? '對' : '與'}${ref(r.b)}：${t.label}` + (r.note && r.note.trim() ? `（${r.note.trim()}）` : '');
      });
      if (out.length) S.relations = out.join('；') + '。';
    }

    // 7. 健康狀況
    {
      const order = Object.values(P).sort((a, b) => (a.id === ix ? -1 : b.id === ix ? 1 : a.y - b.y || a.x - b.x));
      const out = [];
      for (const p of order) {
        const cond = (kind) => (p.conditions || []).map(k => GT.CONDITIONS.find(c => c.key === k)).filter(c => c && c.kind === kind).map(c => c.label);
        const med = cond('medical'), bits = [];
        if (p.illness || med.length) bits.push((p.illness === 'recovery' ? '疾病復原中' : '身體或精神疾病') + (med.length ? `（${med.join('、')}）` : ''));
        if (p.substance) bits.push({ active: '酒精或藥物濫用', suspected: '疑似酒精或藥物濫用', recovery: '酒精或藥物濫用復原中' }[p.substance]);
        cond('addiction').forEach(x => bits.push(x));
        if (bits.length) out.push(`${ref(p.id)}：${bits.join('、')}`);
      }
      if (out.length) S.health = out.join('；') + '。';
    }

    // 8. 外部資源（生態圖）
    {
      const end = (id) => (P[id] ? ref(id)
        : doc.systems[id] ? `「${doc.systems[id].name.trim() || '資源'}」`
        : doc.households[id] ? `${doc.households[id].label && doc.households[id].label.trim() ? `「${doc.households[id].label.trim()}」` : ''}同住家庭` : '');
      const out = [], used = new Set();
      for (const t of Object.values(doc.ties)) {
        const a = end(t.a), b = end(t.b);
        if (!a || !b) continue;
        used.add(t.a); used.add(t.b);
        out.push(`${a}與${b}：關係${GT.TIE_STRENGTHS.find(x => x.key === t.strength).short}` + (t.stress ? '，有壓力或衝突' : '') +
          (t.dir === 'a2b' ? `，資源由${a}流向${b}` : t.dir === 'b2a' ? `，資源由${b}流向${a}` : t.dir === 'both' ? '，雙向往來' : '') +
          (t.note && t.note.trim() ? `（${t.note.trim()}）` : ''));
      }
      const loose = Object.values(doc.systems).filter(s => !used.has(s.id)).map(s => `「${s.name.trim() || '資源'}」`);
      if (loose.length) out.push(`圖上另有資源${loose.join('、')}，尚未畫出連結`);
      if (out.length) S.eco = out.join('；') + '。';
    }

    // 9. 其他成員：前面每一段都沒提到的人（判斷不出稱謂、也不在同住或關係線裡）→ 列出來，不靜默丟掉
    {
      const rest = Object.values(P).filter(p => !mentioned.has(p.id)).sort((a, b) => a.y - b.y || a.x - b.x).map(p => p.id);
      if (rest.length) S.others = `圖上另有 ${rest.length} 人，判斷不出與服務使用者的稱謂，沒有寫進上面的敘述：${rest.map(who).join('、')}。`;
    }

    const want = Array.isArray(o.sections) ? new Set(o.sections) : null;
    const sections = SECTIONS.filter(s => S[s.key] && (!want || want.has(s.key))).map(s => ({ key: s.key, title: s.title, text: S[s.key] }));
    return { index: ix, candidates, sections, text: sections.map(s => s.text).join('\n') };
  }

  GT.narrate = { build, kinTerms, unionKind, phraseOf, indexPersons, SECTIONS };
})(globalThis.GT = globalThis.GT || {});
