/* 家系圖工具 — app.js
 * 介面層：畫布操作（選取／拖曳／平移／縮放）、屬性面板、左側工具、檔案開存、匯出、快捷鍵。
 * 錯誤一律走 GT.fail()（core.js 的錯誤咽喉），畫面只顯示「狀態＋下一步＋代碼」。
 */
(function (GT) {
  'use strict';
  const APP_VERSION = '0.4.0';
  const BUILD = '__BUILD__';
  const R = GT.render, esc = R.esc;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const state = {
    doc: GT.newDoc(), history: new GT.History(100),
    sel: new Set(), pending: null,
    view: { x: 0, y: 0, k: 1 },
    handle: null, fileName: '', dirty: false, typing: false,
    relType: 'Plain',                 // 左邊「情感關係」新拉的線用哪一種
  };
  GT.app = { state, APP_VERSION };

  // ───── 提示與錯誤 ─────
  function toast(msg, kind, ms) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), ms || (kind === 'error' ? 10000 : 3500));
  }
  function showError(r) {
    document.body.dataset.errors = String((+document.body.dataset.errors || 0) + 1);
    toast(r.message, 'error');
  }
  async function act(code, fn) {
    try { return await fn(); }
    catch (e) { if (e && e.name === 'AbortError') return undefined; showError(GT.fail(code, e)); return undefined; }
  }

  // ───── 變更流程：先存復原點 → 改資料 → 重畫 ─────
  function mutate(fn, opt) {
    state.history.push(state.doc);
    const r = fn(state.doc);
    state.dirty = true;
    renderCanvas();
    if (!(opt && opt.keepPanel)) renderPanel();
    renderChrome();
    return r;
  }
  function renderAll() { renderCanvas(); renderPanel(); renderChrome(); }

  const kindOf = (id) => {
    const d = state.doc;
    return d.persons[id] ? 'person' : d.unions[id] ? 'union' : d.relations[id] ? 'relation'
         : d.households[id] ? 'household' : d.labels[id] ? 'label'
         : d.systems[id] ? 'system' : d.ties[id] ? 'tie' : null;
  };
  const selOf = (kind) => [...state.sel].filter(id => kindOf(id) === kind);
  const personName = (id) => {
    const p = state.doc.persons[id];
    if (!p) return '（已刪除）';
    return p.name.trim() || `（未命名${{ M: '男性', F: '女性', P: '寵物' }[p.gender] || ''}）`;
  };
  const nodeName = (id) => {
    const d = state.doc;
    if (d.persons[id]) return personName(id);
    if (d.systems[id]) return d.systems[id].name || '資源';
    if (d.households[id]) return (d.households[id].label || '生活圈') + '（整個家庭）';
    return '（已刪除）';
  };
  const opts = (list, cur) => list.map(t => `<option value="${esc(t.key)}"${t.key === cur ? ' selected' : ''}>${esc(t.label)}</option>`).join('');
  const isDir = (type) => !!(GT.EMOTION_TYPES.find(t => t.key === type) || {}).dir;
  const isEmpty = () => !Object.keys(state.doc.persons).length && !Object.keys(state.doc.labels).length
                        && !Object.keys(state.doc.systems).length;

  function select(ids) { state.sel = new Set(ids.filter(Boolean)); renderAll(); }
  function toggleSel(id) { state.sel.has(id) ? state.sel.delete(id) : state.sel.add(id); renderAll(); }

  // ───── 畫布 ─────
  const canvas = $('canvas');

  function renderCanvas() {
    for (const id of [...state.sel]) if (!kindOf(id)) state.sel.delete(id);
    $('world').innerHTML = R.renderWorld(state.doc, { selection: state.sel, pending: state.pending && state.pending.from });
    applyView();
    $('empty').hidden = !isEmpty();
  }
  function applyView() {
    const v = state.view;
    $('viewport').setAttribute('transform', `translate(${v.x},${v.y}) scale(${v.k})`);
    $('zoomVal').textContent = Math.round(v.k * 100) + '%';
  }
  function toWorld(e) {
    const r = canvas.getBoundingClientRect(), v = state.view;
    return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k };
  }
  function viewCenter() {
    const r = canvas.getBoundingClientRect(), v = state.view;
    return { x: (r.width / 2 - v.x) / v.k, y: (r.height / 2 - v.y) / v.k };
  }
  function zoomAt(k, cx, cy) {
    const v = state.view, nk = clamp(k, 0.2, 4);
    v.x = cx - (cx - v.x) * (nk / v.k); v.y = cy - (cy - v.y) * (nk / v.k); v.k = nk;
    applyView();
  }
  function zoomBy(f) { const r = canvas.getBoundingClientRect(); zoomAt(state.view.k * f, r.width / 2, r.height / 2); }
  function fitView() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (isEmpty()) { state.view = { x: r.width / 2, y: r.height / 3, k: 1 }; applyView(); return; }
    const b = R.bbox(state.doc), pad = 70;
    const k = clamp(Math.min((r.width - pad * 2) / Math.max(b.w, 1), (r.height - pad * 2) / Math.max(b.h, 1)), 0.2, 1.4);
    state.view = { k, x: r.width / 2 - (b.x + b.w / 2) * k, y: r.height / 2 - (b.y + b.h / 2) * k };
    applyView();
  }

  let drag = null, raf = 0, spaceDown = false;
  const scheduleRender = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderCanvas(); }); };

  // 拖曳圈選的框（畫在 viewport 裡，跟著縮放；線寬固定）
  function drawMarquee(r) {
    $('overlay').innerHTML = r ? `<rect x="${Math.min(r.x1, r.x2)}" y="${Math.min(r.y1, r.y2)}" width="${Math.abs(r.x2 - r.x1)}" height="${Math.abs(r.y2 - r.y1)}" ` +
      'fill="#38BDF8" fill-opacity="0.08" stroke="#2E86AB" stroke-width="1.2" stroke-dasharray="5 3" vector-effect="non-scaling-stroke"/>' : '';
  }
  function startPan(e) {
    drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y };
    canvas.classList.add('panning');
  }

  // 操作方式（使用者 2026-09-18 要求拖曳圈選）：空白處左鍵拖曳＝圈選（Shift 追加）；
  // 平移＝滑鼠中鍵拖曳或按住空白鍵拖曳；滾輪＝捲動，Shift＋滾輪＝左右捲動，Ctrl＋滾輪＝縮放
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* 沒有實體指標（自我測試的合成事件）時不需要捕捉 */ }
    if (e.button === 1 || spaceDown) { e.preventDefault(); startPan(e); return; }
    let hit = e.target.closest('[data-kind]');
    if (hit && hit.getAttribute('data-kind') === 'household') {         // 生活圈內部看不見的接縫不算點到外框（當成空白處）
      const w = toWorld(e), h = state.doc.households[hit.getAttribute('data-id')];
      if (h && R.householdInterior(state.doc, h, w.x, w.y)) hit = null;
    }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!hit) {
      if (state.pending) { startPan(e); return; }        // 點選模式中不圈選：拖曳空白處照舊移動畫面
      if (!additive && state.sel.size) select([]);
      const w = toWorld(e);
      drag = { mode: 'marquee', sx: e.clientX, sy: e.clientY, rect: { x1: w.x, y1: w.y, x2: w.x, y2: w.y }, base: additive ? [...state.sel] : [], active: false };
      return;
    }
    const id = hit.getAttribute('data-id'), kind = hit.getAttribute('data-kind');
    if (state.pending) { completePending(id, kind); drag = null; return; }
    if (additive) toggleSel(id);
    else if (!state.sel.has(id)) select([id]);
    if ((kind === 'person' || kind === 'label') && state.sel.has(id)) {
      const ids = [...state.sel].filter(x => state.doc.persons[x] || state.doc.labels[x]);
      drag = { mode: 'move', last: toWorld(e), ids, moved: false, clickId: additive ? null : id };
    } else drag = null;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.mode === 'pan') {
      state.view.x = drag.vx + e.clientX - drag.sx; state.view.y = drag.vy + e.clientY - drag.sy;
      applyView(); return;
    }
    if (drag.mode === 'marquee') {
      if (!drag.active && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;   // 手抖不算拖曳
      drag.active = true;
      const w = toWorld(e);
      drag.rect.x2 = w.x; drag.rect.y2 = w.y;
      drawMarquee(drag.rect);
      state.sel = new Set(drag.base.concat(R.itemsInRect(state.doc, drag.rect)));
      scheduleRender();
      return;
    }
    const w = toWorld(e), dx = w.x - drag.last.x, dy = w.y - drag.last.y;
    if (!drag.moved && Math.hypot(dx, dy) * state.view.k < 3) return;
    if (!drag.moved) { state.history.push(state.doc); drag.moved = true; }
    GT.moveItems(state.doc, drag.ids, dx, dy);
    drag.last = w;
    scheduleRender();
  });
  const endDrag = () => {
    if (!drag) return;
    canvas.classList.remove('panning');
    if (drag.mode === 'move') {
      if (drag.moved) { GT.snapItems(state.doc, drag.ids); state.dirty = true; renderCanvas(); renderChrome(); }
      else if (drag.clickId && state.sel.size > 1) select([drag.clickId]);   // 多選中單點一個＝只選它
    } else if (drag.mode === 'marquee') {
      drawMarquee(null);
      if (drag.active) select([...state.sel]);                            // 放開時才重畫右邊面板
    }
    drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) { zoomAt(state.view.k * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); return; }
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;   // 以「行」或「頁」回報的滑鼠換算成像素
    let dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    state.view.x -= dx; state.view.y -= dy;
    applyView();
  }, { passive: false });
  // 中鍵不要觸發瀏覽器的自動捲動
  canvas.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
  // 按住空白鍵＝拖曳可移動畫面（放開或視窗失焦就恢復）
  const setSpace = (on) => { spaceDown = on; canvas.classList.toggle('grab', on); };
  // 用滑鼠點過的按鈕不保留焦點：接著按空白鍵是平移畫面，不會又觸發那顆按鈕一次。
  // e.detail === 0 ＝鍵盤（或程式）觸發的 click，不動它，鍵盤操作照常
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button, summary');
    if (b && e.detail > 0 && document.activeElement === b) b.blur();
  });
  window.addEventListener('blur', () => setSpace(false));
  document.addEventListener('keyup', (e) => { if (e.code === 'Space') setSpace(false); });
  canvas.addEventListener('dblclick', (e) => {
    const hit = e.target.closest('[data-kind]');
    if (hit) focusFirstInput();
  });

  // ───── 點選模式（連結伴侶／情感關係／設為子女）─────
  const canvasHint = {
    partner: '請點選要連結為伴侶的另一個人',
    relation: '請點選情感關係的另一端（另一個人）',
    attachChild: '請點選父母之間的「伴侶線」（或單親的那條線）',
    tie: '請點選生態連結的另一端：人、資源，或生活圈的虛線框',
  };
  function startPending(action, from, extra) {
    state.pending = Object.assign({ action, from }, extra || {});
    $('bannerText').textContent = canvasHint[action];
    $('banner').hidden = false;
    canvas.classList.add('picking');
    renderCanvas();
  }
  function cancelPending() {
    if (!state.pending) return;
    state.pending = null;
    $('banner').hidden = true;
    canvas.classList.remove('picking');
    renderCanvas();
  }
  function completePending(id, kind) {
    const p = state.pending;
    // 起點已經不在（例如點選模式中按了復原）：取消，不要假裝成功（驗收發現：原本會顯示「已連結」）
    const fromOk = p.action === 'tie' ? GT.tieEndExists(state.doc, p.from) : !!state.doc.persons[p.from];
    if (!fromOk) { cancelPending(); toast('原本選的對象已經不在圖上了，請重新選取再操作。', 'warn'); return; }
    if (p.action === 'tie') {
      if (kind !== 'person' && kind !== 'system' && kind !== 'household') { toast('請點選一個人、一個資源，或生活圈的虛線框。', 'warn'); return; }
      if (id === p.from) { toast('請點選「另一端」。', 'warn'); return; }
      const existed = GT.tieBetween(state.doc, p.from, id);
      const tid = mutate(d => GT.addTie(d, p.from, id));
      cancelPending();
      if (!tid) { toast('沒有連結成功，請重新選取再試一次。', 'warn'); return; }
      select([tid]);
      toast(existed ? '這兩者之間原本就有線，又加了一條。' : '已連結。右邊可以設強弱、壓力、流向，也可以寫一件事。', 'ok', 6000);
      return;
    }
    if (p.action === 'attachChild') {
      if (kind !== 'union') { toast('請點「伴侶線」（兩個人下方相連的那條線）。', 'warn'); return; }
      const ok = mutate(d => GT.attachChild(d, id, p.from));
      cancelPending();
      if (ok) { select([p.from]); toast('已設為這段關係的子女。', 'ok'); }
      else toast('不能設為這段關係的子女（這個人是其中一位伴侶）。', 'warn');
      return;
    }
    if (kind !== 'person') { toast('請點選一個人。', 'warn'); return; }
    if (id === p.from) { toast('請點選「另一個」人。', 'warn'); return; }
    if (p.action === 'partner') {
      const existed = GT.unionBetween(state.doc, p.from, id);
      const uid = mutate(d => GT.linkPartners(d, p.from, id));
      cancelPending();
      if (!uid) { toast('沒有連結成功，請重新選取兩個人再試一次。', 'warn'); return; }
      select([uid]);
      toast(existed ? '這兩人本來就是伴侶，已選取那條伴侶線。' : '已連結為伴侶。右邊可以改成同居、分居、離婚等。', 'ok');
    } else if (p.action === 'relation') {
      const rid = mutate(d => GT.addRelation(d, p.from, id, p.type));
      cancelPending();
      if (!rid) { toast('沒有建立成功，請重新選取兩個人再試一次。', 'warn'); return; }
      select([rid]);
    }
  }
  $('bannerCancel').addEventListener('click', cancelPending);

  // ───── 左側工具 ─────
  // 同步聚焦（面板在 select() 裡已同步重畫完）：延後聚焦的話，手快的人按完「＋伴侶」立刻打字，前幾個字會掉
  function focusFirstInput() {
    const el = document.querySelector('#props [data-autofocus]');
    if (el) { el.focus(); if (el.select) el.select(); }
  }

  function addPersonAtCenter(gender) {
    const c = viewCenter();
    const id = mutate(d => GT.addPerson(d, { gender, x: c.x, y: c.y }));
    select([id]); focusFirstInput();
  }

  function onKin(kind) {
    const persons = selOf('person'), unions = selOf('union');
    if ((kind === 'son' || kind === 'daughter') && unions.length === 1 && !persons.length) {
      const id = mutate(d => GT.addChild(d, unions[0], kind === 'son' ? 'M' : 'F'));
      select([id]); focusFirstInput(); return;
    }
    if (persons.length !== 1) { toast('請先在畫布上點選一個人。', 'warn'); return; }
    const pid = persons[0];
    switch (kind) {
      case 'partner': { const r = mutate(d => GT.addPartner(d, pid)); select([r.personId]); focusFirstInput(); break; }
      case 'parents': {
        if (GT.parentUnionOf(state.doc, pid)) { toast('這個人已經有父母了。', 'warn'); return; }
        const r = mutate(d => GT.addParents(d, pid)); select([r.fatherId]); focusFirstInput(); break;
      }
      case 'son': case 'daughter': {
        if (GT.unionsOf(state.doc, pid).length > 1) {
          toast('這個人有不只一段伴侶關係：請先點選要加子女的那條伴侶線，再按「＋兒子／＋女兒」。', 'warn', 7000); return;
        }
        const r = mutate(d => GT.addChildToPerson(d, pid, kind === 'son' ? 'M' : 'F'));
        select([r.personId]); focusFirstInput(); break;
      }
      case 'brother': case 'sister': {
        const g = kind === 'brother' ? 'M' : 'F';
        const r = mutate(d => {
          let x = GT.addSibling(d, pid, g);
          if (x.needParents) { GT.addParents(d, pid); x = GT.addSibling(d, pid, g); x.madeParents = true; }
          return x;
        });
        select([r.personId]);
        if (r.madeParents) toast('已自動加上父母（可以填資料，不需要也可以刪掉）。', 'ok', 5000);
        focusFirstInput(); break;
      }
      case 'linkPartner': startPending('partner', pid); break;
      case 'attachChild': startPending('attachChild', pid); break;
      default: break;
    }
  }

  function renderTools() {
    const st = state.doc.settings;
    $('showFields').innerHTML = st.fields.map(f =>
      `<label class="check"><input type="checkbox" data-show="${esc(f.key)}"${f.show ? ' checked' : ''}>${esc(f.label)}</label>`).join('');
    $('optYears').checked = st.showYears;
    $('optColor').checked = st.colorRelations;
    $('optLineLabels').checked = st.lineLabels !== false;
    document.querySelectorAll('input[name=labelMode]').forEach(r => { r.checked = r.value === st.labelMode; });
    const ps = selOf('person'), us = selOf('union'), one = ps.length === 1;
    document.querySelectorAll('[data-kin]').forEach(b => {
      const k = b.dataset.kin;
      b.disabled = !(one || ((k === 'son' || k === 'daughter') && us.length === 1 && !ps.length));
    });
    $('kinHint').textContent = one ? `目前選取：${personName(ps[0])}`
      : us.length === 1 ? '已選取伴侶線：可以按「＋兒子／＋女兒」。' : '先在畫布上點選一個人。';
    $('btnRelation').disabled = !(ps.length === 1 || ps.length === 2);
    $('btnRelation').textContent = ps.length === 2 ? '連結選取的兩個人' : '從選取的人拉線…';
    $('btnHousehold').disabled = !ps.length;
    document.querySelectorAll('input[name=viewMode]').forEach(r => { r.checked = r.value === (st.view || 'both'); });
    const ends = [...state.sel].filter(id => GT.tieEndExists(state.doc, id));
    $('btnTie').disabled = !(ends.length === 1 || ends.length === 2);
    $('btnTie').textContent = ends.length === 2 ? '連結選取的兩者' : '拉生態連結…';
    $('tieHint').textContent = ends.length === 2 ? `${nodeName(ends[0])} ↔ ${nodeName(ends[1])}`
      : ends.length === 1 ? `從「${nodeName(ends[0])}」拉線，按下後再點另一端。`
      : '先點選一個人或資源（或按住 Shift 選兩個），再按「拉生態連結」。';
    const rt = GT.EMOTION_TYPES.find(t => t.key === state.relType) || GT.EMOTION_TYPES[0];
    $('relTypeBtn').innerHTML = `${R.sampleSVG('relation', rt.key, st.colorRelations)}<span>${esc(rt.label)}</span><span class="chev">▾</span>`;
  }

  // 左邊「情感關係」的類型：跳出分類式選擇器（先選大類再選線條）
  function openRelTypePicker() {
    const body = dialog('新拉的情感關係線要用哪一種？',
      `<p class="soft">先點上排的大類，再點線條。已經拉好的線，之後也可以點它在右邊改。</p>${pickerHTML('tool', GT.EMOTION_TYPES, GT.EMOTION_CATS, state.relType, 'relation')}`,
      [{ label: '取消' }]);
    bindPicker(body, 'tool', GT.EMOTION_TYPES, GT.EMOTION_CATS, () => state.relType, 'relation', (k) => {
      state.relType = k; $('dlg').close(); renderTools();
    });
  }

  // ───── 右側屬性面板 ─────
  function bindLive(inp, apply, after) {
    inp.addEventListener('focus', () => { state.typing = false; });
    inp.addEventListener('input', () => {
      if (!state.typing) { state.history.push(state.doc); state.typing = true; }
      apply(state.doc, inp.value);
      state.dirty = true;
      renderCanvas(); renderChrome();
      if (after) after();
    });
    inp.addEventListener('blur', () => { state.typing = false; });
  }

  // ───── 可收合區塊與分類式選擇器（使用者 2026-09-17：先選大類再選細項，不要一次全部展開）─────
  // 開合狀態只放記憶體（介面狀態，不是個案資料）；面板重畫後維持原樣
  const openSections = new Set(), pickerCat = {};
  function accHTML(key, title, summary, body, emptyText) {
    return `<details class="acc" data-acc="${key}"${openSections.has(key) ? ' open' : ''}>
      <summary><span class="t">${esc(title)}</span><span class="v${summary ? '' : ' none'}">${esc(summary || emptyText || '無')}</span></summary>
      <div class="accb">${body}</div></details>`;
  }
  // 在 click 就記下開合（toggle 事件是非同步的：展開後馬上點裡面的按鈕、面板重畫時會來不及記到）
  function bindAcc(P) {
    P.querySelectorAll('details.acc > summary').forEach(sm => sm.addEventListener('click', () => {
      const el = sm.parentElement;
      if (el.open) { openSections.delete(el.dataset.acc); return; }          // 這時 open 還是點之前的狀態
      P.querySelectorAll('details.acc[open]').forEach(o => { o.open = false; openSections.delete(o.dataset.acc); });   // 一次只展開一類
      openSections.add(el.dataset.acc);
    }));
  }
  const segHTML = (field, list, cur) => `<div class="seg">${list.map(t =>
    `<button type="button" data-set="${field}" data-val="${esc(t.key)}" class="${t.key === cur ? 'on' : ''}" title="${esc(t.label)}">${esc(t.short || t.label)}</button>`).join('')}</div>`;

  // 類型選擇器：上排大類、下面只列該類的線條（附縮圖）；參考圖以外的類型只在目前值剛好是它時才列出
  function pickerInner(name, types, cats, cur, kind) {
    const curT = types.find(t => t.key === cur);
    const cat = pickerCat[name] || (curT ? curT.cat : cats[0].key);
    const colored = state.doc.settings.colorRelations;
    const items = types.filter(t => t.cat === cat && (t.sheet !== false || t.key === cur));
    return `<div class="cats">${cats.map(c => `<button type="button" data-pcat="${c.key}" class="${c.key === cat ? 'on' : ''}">${esc(c.label)}</button>`).join('')}</div>
      <div class="items">${items.map(t => `<button type="button" data-pick="${esc(t.key)}" class="${t.key === cur ? 'on' : ''}" title="${esc(t.label)}（${esc(t.en || t.key)}）">` +
        `${kind === 'text' ? '' : R.sampleSVG(kind, t.key, colored)}<span>${esc(t.label)}</span></button>`).join('')}</div>`;
  }
  const pickerHTML = (name, types, cats, cur, kind) => `<div class="picker" data-picker="${esc(name)}">${pickerInner(name, types, cats, cur, kind)}</div>`;
  function bindPicker(root, name, types, cats, getCur, kind, onPick) {
    const el = root.querySelector(`[data-picker="${name}"]`);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.pcat) { pickerCat[name] = b.dataset.pcat; el.innerHTML = pickerInner(name, types, cats, getCur(), kind); }
      else if (b.dataset.pick) onPick(b.dataset.pick);
    });
  }
  const curTypeHTML = (types, key, kind) => {
    const t = types.find(x => x.key === key) || { label: key };
    return `<div class="curtype"><span class="soft">目前：</span>${R.sampleSVG(kind, key, state.doc.settings.colorRelations)}<b>${esc(t.label)}</b></div>`;
  };

  function renderPanel() {
    const P = $('props'), ids = [...state.sel];
    if (!ids.length) return panelDoc(P);
    if (ids.length > 1) return panelMulti(P, ids);
    const id = ids[0];
    const fn = { person: panelPerson, union: panelUnion, relation: panelRelation, household: panelHousehold,
                 label: panelLabel, system: panelSystem, tie: panelTie }[kindOf(id)];
    return fn ? fn(P, id) : panelDoc(P);
  }

  function ageHintText(p) {
    const a = GT.ageOf(state.doc, p);
    if (a.source === 'birth') {
      return `依${p.deceased ? '出生與死亡日期' : `出生日期與評估日期（${state.doc.meta.assessDate}）`}計算：${a.value} 歲` +
             (a.approx ? '（只有年份或月份，可能差一歲）' : '');
    }
    return p.deceased ? '圖上還沒有年齡：請填過世時年齡，或填出生與死亡日期自動計算。' : '可直接填年齡，或填出生日期自動計算。';
  }

  const labelOf = (list, key) => (list.find(t => t.key === key) || list[0]).label;
  // 「健康與成癮」收合時的摘要：有疾病別就列疾病名稱，沒有才寫「疾病」
  function healthSummary(p) {
    const cond = (kind) => (p.conditions || []).map(k => GT.CONDITIONS.find(c => c.key === k)).filter(c => c && c.kind === kind).map(c => c.label);
    const med = cond('medical'), parts = [];
    if (p.illness || med.length) parts.push((med.length ? med.join('、') : '疾病') + (p.illness === 'recovery' ? '（復原中）' : ''));
    if (p.substance) parts.push({ active: '酒精或藥物濫用', suspected: '疑似濫用', recovery: '濫用復原中' }[p.substance]);
    return parts.concat(cond('addiction')).join('、');
  }
  function setPersonField(id, field, val) {
    const q0 = state.doc.persons[id];
    if (!q0 || q0[field] === val) return;
    mutate(d => {
      const q = d.persons[id];
      q[field] = val;
      // 疾病改回「無」→ 疾病別一起清掉，不然左上角還留著顏色，看起來像沒改成功
      if (field === 'illness' && !val) q.conditions = (q.conditions || []).filter(k => (GT.CONDITIONS.find(c => c.key === k) || {}).kind !== 'medical');
    });
  }

  function panelPerson(P, id) {
    const d = state.doc, p = d.persons[id];
    const a = GT.ageOf(d, p), auto = a.source === 'birth';
    const ageKey = p.deceased ? 'deathAge' : 'age';
    const ageVal = auto ? a.value : p[ageKey];
    const pu = GT.parentUnionOf(d, id), us = GT.unionsOf(d, id);
    const names = (list) => list.map(x => esc(personName(x))).join('、') || '—';
    const partners = [].concat(...us.map(u => u.partners.filter(x => x !== id)));
    const kids = [].concat(...us.map(u => u.children.map(c => c.id)));
    const fields = d.settings.fields.map(f => `
      <label class="field">${esc(f.label)}${f.show ? '<span class="tag">圖上顯示</span>' : ''}</label>
      <input type="text" data-attr="${esc(f.key)}" list="dl-${esc(f.key)}" value="${esc((p.attrs || {})[f.key] || '')}" maxlength="500">
      <datalist id="dl-${esc(f.key)}">${GT.suggestionsFor(d, f.key).map(s => `<option value="${esc(s)}">`).join('')}</datalist>`).join('');
    const conds = p.conditions || [];
    const condChip = (c) => `<label class="cond"><input type="checkbox" data-cond="${c.key}"${conds.includes(c.key) ? ' checked' : ''}><i style="background:${c.color}"></i>${esc(c.label)}</label>`;
    const meds = GT.CONDITIONS.filter(c => c.kind === 'medical'), adds = GT.CONDITIONS.filter(c => c.kind === 'addiction');
    // 先選「有沒有疾病」，有了才列出疾病別（先大類後細項）；原本就勾了疾病別的照樣列出，才能取消
    const showMed = !!p.illness || meds.some(c => conds.includes(c.key));
    const health = `
      <label class="field">身體或精神疾病<span class="hint">符號左半塗黑</span></label>${segHTML('illness', GT.ILLNESS, p.illness)}
      ${showMed ? `<label class="field">哪一種疾病（選填）<span class="hint">顏色填在左上角</span></label><div class="conds">${meds.map(condChip).join('')}</div>` : ''}
      <label class="field">酒精或藥物濫用<span class="hint">下半塗黑，疑似＝灰色</span></label>${segHTML('substance', GT.SUBSTANCE, p.substance)}
      <label class="field">成癮（選填）<span class="hint">改外框顏色</span></label><div class="conds">${adds.map(condChip).join('')}</div>`;
    const tw = GT.twinGroupOf(d, id);
    P.innerHTML = `
    <section class="card"><h3><span class="badge">1</span>基本資料</h3>
      <label class="field">姓名</label>
      <input type="text" data-f="name" data-autofocus value="${esc(p.name)}" maxlength="60" placeholder="例：王小明（可留空）">
      <label class="field">性別</label>
      ${segHTML('gender', GT.GENDERS, p.gender)}
      <label class="check" style="margin-top:8px"><input type="checkbox" data-flag="index"${p.index ? ' checked' : ''}>案主（粗框灰底）</label>
      <label class="check"><input type="checkbox" data-flag="deceased"${p.deceased ? ' checked' : ''}>已歿（打叉）</label>
    </section>
    <section class="card"><h3><span class="badge">2</span>狀態<span class="right symprev" title="圖上的樣子">${R.symbolSVG(d, p, 34)}</span></h3>
      ${accHTML('life', '生命狀態', p.life ? labelOf(GT.LIFE_STATES, p.life) : '',
        segHTML('life', GT.LIFE_STATES, p.life) + '<p class="hint-text">懷孕、流產、墮胎會換成參考圖的符號（△、●、×）。</p>', '一般')}
      ${accHTML('culture', '文化背景', p.culture ? labelOf(GT.CULTURES, p.culture) : '',
        segHTML('culture', GT.CULTURES, p.culture) + '<p class="hint-text">符號上方加波浪線；住過兩個以上的文化地區畫兩條。</p>')}
      ${accHTML('health', '健康與成癮', healthSummary(p), health)}
    </section>
    <section class="card"><h3><span class="badge">3</span>年齡<span class="right">顯示在符號中間</span></h3>
      <label class="field">${p.deceased ? '過世時年齡' : '年齡'}</label>
      <input type="number" min="0" max="149" id="ageInput" data-f="${ageKey}" value="${esc(ageVal == null ? '' : ageVal)}"${auto ? ' disabled' : ''}>
      <label class="field">出生日期（選填）</label>
      <input type="text" data-f="birth" value="${esc(p.birth)}" maxlength="20" placeholder="例：1965、1965-03-08、民國54年">
      ${p.deceased ? `<label class="field">死亡日期（選填）</label>
      <input type="text" data-f="death" value="${esc(p.death)}" maxlength="20" placeholder="例：2019、2019-05">` : ''}
      <div class="agehint${p.deceased && a.value === null ? " warn" : ""}" id="ageHint">${esc(ageHintText(p))}</div>
    </section>
    <section class="card"><h3><span class="badge">4</span>其他資料<span class="right"><button class="link" id="btnFieldsP">管理欄位</button></span></h3>
      ${fields || '<div class="muted">沒有欄位，按「管理欄位」新增。</div>'}
    </section>
    <section class="card"><h3><span class="badge">5</span>家庭</h3>
      <div class="kin">父母：<b>${pu ? names(pu.partners) : '—'}</b><br>伴侶：<b>${names(partners)}</b><br>子女：<b>${names(kids)}</b></div>
      ${tw ? `<div class="kin">雙胞胎：<b>${names(tw.group.ids.filter(x => x !== id))}</b></div>
      <div class="row" style="margin-top:4px"><select data-twinkind style="flex:1" aria-label="雙胞胎類型">${opts(GT.TWIN_KINDS, tw.group.kind)}</select><button data-untwin>取消雙胞胎</button></div>` : ''}
      <div class="grid2" style="margin-top:6px">
        <button data-kin2="partner">＋伴侶</button><button data-kin2="parents"${pu ? ' disabled' : ''}>＋父母</button>
        <button data-kin2="son">＋兒子</button><button data-kin2="daughter">＋女兒</button>
      </div>
    </section>
    ${usingEcomap() ? tieListHTML(id, 6) : ''}
    <section class="card danger"><button class="danger" data-del style="width:100%">刪除這個人</button></section>`;

    const updateAge = () => {
      const q = state.doc.persons[id];
      if (!q) return;
      const cur = GT.ageOf(state.doc, q), inp = $('ageInput');
      const isAuto = cur.source === 'birth';
      inp.disabled = isAuto;
      if (isAuto) inp.value = cur.value;
      else if (document.activeElement !== inp) inp.value = q[q.deceased ? 'deathAge' : 'age'];
      $('ageHint').textContent = ageHintText(q); $('ageHint').classList.toggle('warn', q.deceased && cur.value === null);
    };
    P.querySelectorAll('[data-f]').forEach(inp => bindLive(inp, (dd, v) => { dd.persons[id][inp.dataset.f] = v.slice(0, 60); }, updateAge));
    P.querySelectorAll('[data-attr]').forEach(inp => bindLive(inp, (dd, v) => {
      const k = inp.dataset.attr, t = v.slice(0, 500);
      if (t.trim()) dd.persons[id].attrs[k] = t; else delete dd.persons[id].attrs[k];
    }));
    P.querySelectorAll('[data-set]').forEach(b => b.addEventListener('click', () => setPersonField(id, b.dataset.set, b.dataset.val)));
    P.querySelectorAll('[data-cond]').forEach(c => c.addEventListener('change', () => mutate(dd => {
      const q = dd.persons[id], on = new Set(q.conditions || []);
      if (c.checked) on.add(c.dataset.cond); else on.delete(c.dataset.cond);
      q.conditions = GT.CONDITIONS.map(x => x.key).filter(k => on.has(k));   // 照參考圖的順序存
    })));
    bindAcc(P);
    const tk = P.querySelector('[data-twinkind]'), ut = P.querySelector('[data-untwin]');
    if (tk) tk.addEventListener('change', () => mutate(dd => { const hit = GT.twinGroupOf(dd, id); if (hit) hit.group.kind = tk.value; }));
    if (ut) ut.addEventListener('click', () => mutate(dd => GT.clearTwin(dd, id)));
    P.querySelectorAll('[data-flag]').forEach(c => c.addEventListener('change', () => {
      const before = GT.ageOf(state.doc, state.doc.persons[id]).value;
      mutate(dd => {
        const q = dd.persons[id];
        q[c.dataset.flag] = c.checked;
        if (c.dataset.flag === 'deceased' && c.checked && !q.deathAge && q.age && !GT.parseDate(q.birth)) q.deathAge = q.age;
      });
      // 已歿者的數字＝過世時年齡；只知道出生日期時不能拿評估日期去算（會變成「活到今天」的年紀），所以不顯示並提醒補資料
      if (c.dataset.flag === 'deceased' && c.checked && before !== null && GT.ageOf(state.doc, state.doc.persons[id]).value === null)
        toast('已標為已歿：符號中的數字改為「過世時年齡」。請填死亡日期或過世時年齡，圖上才會顯示。', 'warn', 8000);
    }));
    P.querySelectorAll('[data-kin2]').forEach(b => b.addEventListener('click', () => onKin(b.dataset.kin2)));
    bindTieList(P, id);
    P.querySelector('[data-del]').addEventListener('click', deleteSelection);
    $('btnFieldsP').addEventListener('click', openFieldManager);
  }

  function panelUnion(P, id) {
    const u = state.doc.unions[id];
    const two = u.partners.length === 2;
    P.innerHTML = `
    <section class="card"><h3><span class="badge">1</span>${two ? '伴侶關係' : '單親家庭'}</h3>
      <div class="kin"><b>${u.partners.map(x => esc(personName(x))).join(' ＋ ')}</b></div>
      ${two ? `<label class="field">關係類型（先選大類，再選線條）</label>${curTypeHTML(GT.FAMILY_TYPES, u.type, 'union')}
      ${pickerHTML('union:' + id, GT.FAMILY_TYPES, GT.FAMILY_CATS, u.type, 'union')}
      <label class="field">線旁說明（選填，會寫在線旁邊）</label>
      <input type="text" data-unote value="${esc(u.note || '')}" maxlength="60" placeholder="例：1990 結婚、2015 離婚">
      ${GT.isSpecialLine(u.type) ? '<p class="hint-text">這種線比較少見，圖上會自動寫出名稱（左邊「顯示設定」可以關掉）。</p>' : ''}` : ''}
    </section>
    <section class="card"><h3><span class="badge">2</span>子女<span class="right">${u.children.length} 位</span></h3>
      ${u.children.map(c => `<div class="childrow"><span>${esc(personName(c.id))}${(u.twins || []).some(t => t.ids.includes(c.id)) ? '<span class="muted">・雙胞胎</span>' : ''}</span>` +
        `<select data-child="${esc(c.id)}">${opts(GT.CHILD_LINKS, c.link)}</select></div>`).join('') || '<div class="muted">還沒有子女</div>'}
      <div class="grid2" style="margin-top:6px"><button data-uadd="M">＋兒子</button><button data-uadd="F">＋女兒</button></div>
      ${u.children.length >= 2 ? '<p class="hint-text">雙胞胎：按住 Shift 點選兩個孩子，右邊會出現「設為雙胞胎」。</p>' : ''}
    </section>
    <section class="card danger"><button class="danger" data-del style="width:100%">刪除這段關係（人會保留）</button></section>`;
    if (two) bindLive(P.querySelector('[data-unote]'), (d, v) => { d.unions[id].note = v.slice(0, 60); });
    if (two) bindPicker(P, 'union:' + id, GT.FAMILY_TYPES, GT.FAMILY_CATS, () => state.doc.unions[id].type, 'union',
                        (k) => { if (state.doc.unions[id].type !== k) mutate(d => { d.unions[id].type = k; }); });
    P.querySelectorAll('[data-child]').forEach(s => s.addEventListener('change', () => mutate(d => {
      const c = d.unions[id].children.find(x => x.id === s.dataset.child);
      if (c) c.link = s.value;
    })));
    P.querySelectorAll('[data-uadd]').forEach(b => b.addEventListener('click', () => {
      const cid = mutate(d => GT.addChild(d, id, b.dataset.uadd)); select([cid]); focusFirstInput();
    }));
    P.querySelector('[data-del]').addEventListener('click', deleteSelection);
  }

  function panelRelation(P, id) {
    const r = state.doc.relations[id];
    P.innerHTML = `
    <section class="card"><h3><span class="badge">1</span>情感關係</h3>
      <div class="kin"><b>${esc(personName(r.a))}</b> ${isDir(r.type) ? '→' : '↔'} <b>${esc(personName(r.b))}</b></div>
      <label class="field">類型（先選大類，再選線條）</label>${curTypeHTML(GT.EMOTION_TYPES, r.type, 'relation')}
      ${pickerHTML('rel:' + id, GT.EMOTION_TYPES, GT.EMOTION_CATS, r.type, 'relation')}
      <label class="field">線旁說明（選填，會寫在線旁邊）</label>
      <input type="text" data-rnote data-autofocus value="${esc(r.note)}" maxlength="300" placeholder="例：自 2020 年起、情緒虐待">
      ${GT.isSpecialLine(r.type) ? '<p class="hint-text">這種線比較少見，圖上會自動寫出名稱（左邊「顯示設定」可以關掉）。</p>' : ''}
      ${isDir(r.type) ? '<button data-swap style="margin-top:8px;width:100%">對調方向（箭頭指向另一個人）</button>' : ''}
    </section>
    <section class="card danger"><button class="danger" data-del style="width:100%">刪除這條情感關係</button></section>`;
    bindPicker(P, 'rel:' + id, GT.EMOTION_TYPES, GT.EMOTION_CATS, () => state.doc.relations[id].type, 'relation',
               (k) => { if (state.doc.relations[id].type !== k) mutate(d => { d.relations[id].type = k; }); });
    bindLive(P.querySelector('[data-rnote]'), (d, v) => { d.relations[id].note = v.slice(0, 300); });
    const sw = P.querySelector('[data-swap]');
    if (sw) sw.addEventListener('click', () => mutate(d => { const x = d.relations[id]; [x.a, x.b] = [x.b, x.a]; }));
    P.querySelector('[data-del]').addEventListener('click', deleteSelection);
  }

  function panelHousehold(P, id) {
    const h = state.doc.households[id];
    const intruders = R.householdIntruders(state.doc, h);
    P.innerHTML = `
    ${intruders.length ? `<section class="card warn"><h3><span class="badge" style="background:var(--warn)">!</span>圈內有非成員</h3>
      <p class="hint-text" style="margin:0"><b>${intruders.map(x => esc(personName(x))).join('、')}</b> 不是這個生活圈的成員，但位置落在圈內。請把他們拖到圈外，或調整成員的位置，以免報告被誤讀。</p></section>` : ''}
    <section class="card"><h3><span class="badge">1</span>生活圈（同住）</h3>
      <label class="field">名稱（選填，顯示在圈的左上角）</label>
      <input type="text" data-hl data-autofocus value="${esc(h.label)}" maxlength="30" placeholder="例：同住、祖父母家">
      <div class="kin" style="margin-top:8px">成員：<b>${h.members.map(x => esc(personName(x))).join('、')}</b></div>
      <p class="hint-text">要增減成員：刪除這個生活圈，重新選取成員後再圈一次。</p>
    </section>
    ${usingEcomap() ? tieListHTML(id, 2) : ''}
    <section class="card danger"><button class="danger" data-del style="width:100%">刪除這個生活圈（人會保留）</button></section>`;
    bindLive(P.querySelector('[data-hl]'), (d, v) => { d.households[id].label = v.slice(0, 30); });
    bindTieList(P, id);
    P.querySelector('[data-del]').addEventListener('click', deleteSelection);
  }

  function panelLabel(P, id) {
    const t = state.doc.labels[id];
    P.innerHTML = `
    <section class="card"><h3><span class="badge">1</span>文字說明</h3>
      <textarea data-tl data-autofocus maxlength="1000" rows="5">${esc(t.text)}</textarea>
      <p class="hint-text">可以拖曳移動位置；按 Enter 換行。</p>
    </section>
    <section class="card danger"><button class="danger" data-del style="width:100%">刪除這段文字</button></section>`;
    bindLive(P.querySelector('[data-tl]'), (d, v) => { d.labels[id].text = v.slice(0, 1000); });
    P.querySelector('[data-del]').addEventListener('click', deleteSelection);
  }

  function panelMulti(P, ids) {
    const ps = ids.filter(x => state.doc.persons[x]);
    const twinU = ps.length >= 2 ? GT.commonParentUnion(state.doc, ps) : null;   // 同一對父母的子女才能設雙胞胎
    const relLabel = labelOf(GT.EMOTION_TYPES, state.relType);
    P.innerHTML = `
    <section class="card"><h3><span class="badge">✓</span>已選取 ${ids.length} 個項目</h3>
      <div class="soft">其中 ${ps.length} 個人。按住 Shift 點選或拖曳框選可以加選。</div>
      <div class="stack" style="margin-top:8px">
        ${ps.length === 2 ? `<button data-m="partner" class="secondary">連結為伴侶</button><button data-m="relation">建立情感關係（${esc(relLabel)}）</button>` : ''}
        ${ps.length ? '<button data-m="household">圈成生活圈（同住）</button>' : ''}
        ${ids.filter(id => GT.tieEndExists(state.doc, id)).length === 2 ? '<button data-m="tie">建立生態連結</button>' : ''}
        ${ps.length > 1 ? '<button data-m="alignY">對齊成同一列（同一代）</button>' : ''}
        <button data-m="delete" class="danger">刪除選取的項目</button>
      </div>
    </section>
    ${twinU ? `<section class="card"><h3><span class="badge">2</span>設為雙胞胎</h3>
      <div class="soft">這 ${ps.length} 人是同一對父母的子女。</div>
      <div class="stack" style="margin-top:6px">${GT.TWIN_KINDS.map(k => `<button data-twin="${k.key}">${esc(k.label)}</button>`).join('')}</div>
    </section>` : ''}`;
    P.querySelectorAll('[data-twin]').forEach(b => b.addEventListener('click', () => {
      const cur = GT.twinGroupOf(state.doc, ps[0]);                          // 已經是同一組、同一種＝不要留下空的復原步驟
      if (cur && cur.group.kind === b.dataset.twin && cur.group.ids.length === ps.length && ps.every(x => cur.group.ids.includes(x))) {
        toast('他們已經是這一種雙胞胎了。'); return;
      }
      const ok = mutate(d => GT.setTwins(d, twinU.id, ps, b.dataset.twin), { keepPanel: true });
      toast(ok ? '已設為雙胞胎。點其中一人，可以在「家庭」改類型或取消。' : '沒有設定成功：雙胞胎必須是同一對父母的子女。', ok ? 'ok' : 'warn');
    }));
    P.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => {
      const m = b.dataset.m;
      if (m === 'partner') { const uid = mutate(d => GT.linkPartners(d, ps[0], ps[1])); select([uid]); }
      else if (m === 'relation') { const rid = mutate(d => GT.addRelation(d, ps[0], ps[1], state.relType)); select([rid]); }
      else if (m === 'household') { const hid = mutate(d => GT.addHousehold(d, ps, '')); select([hid]); }
      else if (m === 'tie') startTie();
      else if (m === 'alignY') {
        mutate(d => { const y = GT.snap(ps.reduce((a, x) => a + d.persons[x].y, 0) / ps.length); ps.forEach(x => { d.persons[x].y = y; }); }, { keepPanel: true });
      } else if (m === 'delete') deleteSelection();
    }));
  }

  function panelDoc(P) {
    const m = state.doc.meta, pd = GT.parseDate(m.assessDate);
    const dateVal = pd && pd.m && pd.d ? GT.formatDate(pd) : '';
    P.innerHTML = `
    <section class="card"><h3><span class="badge">i</span>這張家系圖</h3>
      <label class="field">標題（選填；匯出檔名會用到）</label>
      <input type="text" data-meta="title" value="${esc(m.title)}" maxlength="100" placeholder="例：個案 A 家系圖">
      <label class="field">評估日期</label>
      <input type="date" id="assessDate" value="${esc(dateVal)}">
      <p class="hint-text">圖上的年齡以這個日期計算。兩年後重開這個檔，年齡仍會跟當時的紀錄一致。</p>
    </section>
    <section class="card"><h3><span class="badge">?</span>小技巧</h3>
      <ul class="hint-text" style="padding-left:18px;margin:0">
        <li>點人物 → 右邊填年齡、職業、經濟，圖會即時更新。</li>
        <li>在空白處按住左鍵拖曳可以框選多個人；按住 <b>Shift</b> 點選或框選可以加選。</li>
        <li>移動畫面：按住<b>空白鍵</b>拖曳，或按住滑鼠中鍵拖曳；滾輪上下捲動，<b>Shift</b>＋滾輪左右捲動。</li>
        <li><b>Ctrl</b>＋滾輪放大縮小。</li>
        <li><b>Ctrl+Z</b> 復原、<b>Ctrl+S</b> 儲存、<b>Delete</b> 刪除。</li>
        <li>「複製圖片」後到 Word 按 <b>Ctrl+V</b> 就能貼上。</li>
      </ul>
    </section>`;
    bindLive(P.querySelector('[data-meta=title]'), (d, v) => { d.meta.title = v.slice(0, 100); });
    $('assessDate').addEventListener('change', (e) => {
      if (!GT.parseDate(e.target.value)) { e.target.value = dateVal; return; }
      mutate(d => { d.meta.assessDate = e.target.value; }, { keepPanel: true });
    });
  }

  // ───── 生態圖：資源（外部系統）與生態連結 ─────
  const otherEnd = (t, id) => (t.a === id ? t.b : t.a);
  const tiesOf = (id) => Object.values(state.doc.ties).filter(t => t.a === id || t.b === id);
  // 連結清單：兩端疊在一起時線畫不出來，清單是唯一找得回來的地方（審查 2026-09-20）
  function tieListHTML(id, badge) {
    const ts = tiesOf(id);
    return `<section class="card"><h3><span class="badge">${badge}</span>生態連結<span class="right">${ts.length} 條</span></h3>
      ${ts.map(t => `<div class="childrow"><span>${esc(nodeName(otherEnd(t, id)))}${t.note ? `<span class="muted">・${esc(t.note)}</span>` : ''}</span>` +
        `<button data-goto="${esc(t.id)}">選這條線</button></div>`).join('') || '<div class="muted">還沒有連結。</div>'}
      <button data-tiefrom style="margin-top:6px;width:100%">從這裡拉一條生態連結…</button>
    </section>`;
  }
  function bindTieList(P, id) {
    P.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => select([b.dataset.goto])));
    const bt = P.querySelector('[data-tiefrom]');
    if (bt) bt.addEventListener('click', () => startPending('tie', id));
  }
  const usingEcomap = () => !!(Object.keys(state.doc.systems).length || Object.keys(state.doc.ties).length);
  function panelSystem(P, id) {
    const d = state.doc, s = d.systems[id];
    P.innerHTML = `
    <section class="card"><h3><span class="badge">1</span>資源（外部系統）</h3>
      <label class="field">名稱<span class="hint">寫在圓裡面</span></label>
      <input type="text" data-sname data-autofocus value="${esc(s.name)}" maxlength="30" placeholder="例：○○國小、家防中心">
      <p class="hint-text">字多會自動換行，圓也會跟著變大；建議寫簡稱。</p>
    </section>
    ${tieListHTML(id, 2)}
    <section class="card danger"><button class="danger" data-del style="width:100%">刪除這個資源（線會一起刪）</button></section>`;
    bindLive(P.querySelector('[data-sname]'), (dd, v) => { dd.systems[id].name = v.slice(0, 30); });
    bindTieList(P, id);
    P.querySelector('[data-del]').addEventListener('click', deleteSelection);
  }

  function panelTie(P, id) {
    const t = state.doc.ties[id];
    const arrow = { a2b: '→', b2a: '←', both: '↔' }[t.dir] || '—';
    P.innerHTML = `
    <section class="card"><h3><span class="badge">1</span>生態連結</h3>
      <div class="kin"><b>${esc(nodeName(t.a))}</b> ${arrow} <b>${esc(nodeName(t.b))}</b></div>
      <label class="field">關係強度<span class="hint">強＝雙線、弱＝虛線</span></label>
      ${segHTML('strength', GT.TIE_STRENGTHS, t.strength)}
      <label class="check" style="margin-top:8px"><input type="checkbox" data-tstress${t.stress ? ' checked' : ''}>有壓力／衝突（畫成鋸齒線）</label>
      <label class="field">流向<span class="hint">資源或能量往哪邊</span></label>
      ${segHTML('dir', GT.TIE_DIRS, t.dir)}
      <label class="field">線上寫一件事（選填）</label>
      <input type="text" data-tnote data-autofocus value="${esc(t.note)}" maxlength="60" placeholder="例：通報 2025-03、保護令、每週送餐">
      <button data-tswap style="margin-top:8px;width:100%">對調兩端</button>
    </section>
    <section class="card danger"><button class="danger" data-del style="width:100%">刪除這條線</button></section>`;
    P.querySelectorAll('[data-set]').forEach(b => b.addEventListener('click', () => {
      const field = b.dataset.set, val = b.dataset.val;
      if (state.doc.ties[id][field] === val) return;              // 值沒變就不留復原步驟
      mutate(d => { d.ties[id][field] = val; });
    }));
    P.querySelector('[data-tstress]').addEventListener('change', (e) => mutate(d => { d.ties[id].stress = e.target.checked; }));
    bindLive(P.querySelector('[data-tnote]'), (d, v) => { d.ties[id].note = v.slice(0, 60); });
    P.querySelector('[data-tswap]').addEventListener('click', () => mutate(d => {
      const x = d.ties[id];
      [x.a, x.b] = [x.b, x.a];
      x.dir = x.dir === 'a2b' ? 'b2a' : x.dir === 'b2a' ? 'a2b' : x.dir;    // 對調後箭頭指的人不變
    }));
    P.querySelector('[data-del]').addEventListener('click', deleteSelection);
  }

  // 新增資源：先選大類、再選項目（跟關係選擇器同一種操作）
  function openSystemPicker() {
    const body = dialog('新增資源（外部系統）',
      `<p class="soft">先點上排的大類，再點要加的資源。加進去之後可以改名稱，例如把「學校」改成「○○國小」。</p>` +
      pickerHTML('sys', GT.SYSTEM_PRESETS, GT.SYSTEM_CATS, '', 'text'), [{ label: '取消' }]);
    bindPicker(body, 'sys', GT.SYSTEM_PRESETS, GT.SYSTEM_CATS, () => '', 'text', (key) => {
      const preset = GT.SYSTEM_PRESETS.find(x => x.key === key);
      // 放在整張圖外圍的一圈上，不要疊在人身上；每加一個轉 47 度
      const b = R.bbox(state.doc), n = Object.keys(state.doc.systems).length;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rad = Math.max(b.w, b.h) / 2 + 150;
      const ang = (-90 + n * 47) * Math.PI / 180;
      const id = mutate(d => GT.addSystem(d, { name: key === 'blank' ? '' : preset.label,
                                              x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad * 0.7 }));
      $('dlg').close();
      if (state.doc.settings.view === 'genogram') mutate(d => { d.settings.view = 'both'; });   // 不然加了看不到
      select([id]);
      const rc = canvas.getBoundingClientRect(), v = state.view, s2 = state.doc.systems[id];
      const sx = s2.x * v.k + v.x, sy = s2.y * v.k + v.y;
      if (sx < 40 || sy < 40 || sx > rc.width - 40 || sy > rc.height - 40) fitView();           // 加在畫面外就整張縮進來
      focusFirstInput();
      toast('已新增資源。可以改名稱，或拖曳移動位置。', 'ok');
    });
  }

  function startTie() {
    const ids = [...state.sel].filter(id => GT.tieEndExists(state.doc, id));
    if (ids.length === 2) {
      const existed = GT.tieBetween(state.doc, ids[0], ids[1]);
      const tid = mutate(d => GT.addTie(d, ids[0], ids[1]));
      if (tid) { select([tid]); toast(existed ? '這兩者之間原本就有線，又加了一條。' : '已連結。右邊可以設強弱、壓力、流向，也可以寫一件事。', 'ok', 6000); }
      return;
    }
    if (ids.length !== 1) { toast('請先點選一個人、一個資源，或生活圈的虛線框（也可以按住 Shift 選兩個直接連）。', 'warn', 7000); return; }
    startPending('tie', ids[0]);
  }

  // ───── 對話框 ─────
  function dialog(title, bodyHTML, buttons, opts) {
    const dlg = $('dlg');
    dlg.classList.toggle('wide', !!(opts && opts.wide));                // 使用說明、圖例用寬版
    $('dlgTitle').textContent = title;
    // 每次換一個新的 body 元素：掛在舊 body 上的監聽器跟著丟掉
    // （驗收發現：「管理欄位」開第二次後，一次點擊會被處理兩次，↑↓ 一次移兩格）
    const fresh = $('dlgBody').cloneNode(false);
    $('dlgBody').replaceWith(fresh);
    fresh.innerHTML = bodyHTML;
    const foot = $('dlgFoot');
    foot.innerHTML = '';
    for (const b of (buttons || [{ label: '關閉', primary: true }])) {
      const el = document.createElement('button');
      el.textContent = b.label;
      if (b.primary) el.className = 'primary';
      el.addEventListener('click', () => { dlg.close(); if (b.onClick) b.onClick(); });
      foot.appendChild(el);
    }
    if (!dlg.open) dlg.showModal();
    return $('dlgBody');
  }

  function openFieldManager() {
    const body = dialog('管理欄位', `
      <p class="soft">這些欄位會出現在每個人的「其他資料」裡；打勾的會顯示在圖上。<br>改名只改顯示名稱，已經填的資料不會受影響。</p>
      <div id="fmList"></div>
      <div class="row" style="margin-top:12px">
        <input type="text" id="fmNew" placeholder="新欄位名稱，例：宗教、居住地、身分別" maxlength="20" style="flex:1">
        <button class="secondary" id="fmAdd">新增欄位</button>
      </div>`, [{ label: '完成', primary: true }]);
    const draw = () => {
      const fs = state.doc.settings.fields;
      $('fmList').innerHTML = fs.map((f, i) => `
        <div class="fieldrow">
          <input type="checkbox" data-fs="${esc(f.key)}"${f.show ? ' checked' : ''} title="顯示在圖上">
          <input type="text" data-fr="${esc(f.key)}" value="${esc(f.label)}" maxlength="20">
          <span class="n">${GT.fieldUsage(state.doc, f.key)} 人填</span>
          <span class="ops"><button data-fu="${esc(f.key)}"${i === 0 ? ' disabled' : ''} title="上移">↑</button><button data-fd="${esc(f.key)}"${i === fs.length - 1 ? ' disabled' : ''} title="下移">↓</button><button class="danger" data-fx="${esc(f.key)}">刪除</button></span>
        </div>`).join('') || '<div class="muted">目前沒有欄位。</div>';
    };
    draw();
    body.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.fs) mutate(d => { d.settings.fields.find(f => f.key === t.dataset.fs).show = t.checked; });
      else if (t.dataset.fr) {
        const ok = GT.renameField(GT.clone(state.doc), t.dataset.fr, t.value);
        if (!ok) { toast('欄位名稱不能空白，也不能跟其他欄位重複。', 'warn'); draw(); return; }
        mutate(d => GT.renameField(d, t.dataset.fr, t.value));
      }
    });
    body.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.id === 'fmAdd') {
        const name = $('fmNew').value;
        if (!GT.addField(GT.clone(state.doc), name)) { toast('請輸入欄位名稱（不能跟現有欄位重複）。', 'warn'); return; }
        mutate(d => GT.addField(d, name));
        $('fmNew').value = '';
      } else if (t.dataset.fu) mutate(d => GT.moveField(d, t.dataset.fu, -1));
      else if (t.dataset.fd) mutate(d => GT.moveField(d, t.dataset.fd, 1));
      else if (t.dataset.fx) {
        const f = state.doc.settings.fields.find(x => x.key === t.dataset.fx), n = GT.fieldUsage(state.doc, t.dataset.fx);
        if (n && !confirm(`有 ${n} 個人填了「${f.label}」。刪除這個欄位會一併刪除這些內容（可按 Ctrl+Z 復原）。確定要刪除嗎？`)) return;
        mutate(d => GT.removeField(d, t.dataset.fx));
      } else return;
      draw();
    });
  }

  // 圖例：分頁（一次只看一類）；每一項都附一句說明（使用者 2026-09-21：做一份各圖例的說明）
  // 說明文字的原稿在 src/manual.js 的 LEGEND_DESC
  let legendTab = 'person';
  function openLegend(tab) {
    if (tab) legendTab = tab;
    const colored = state.doc.settings.colorRelations;
    const D = GT.manual.LEGEND_DESC;
    const row = ([svg, label, key, special]) => `<div>${svg}</div><div><b>${special ? '● ' : ''}${esc(label)}</b>` +
      (key && D[key] ? `<div class="desc">${esc(D[key])}</div>` : '') + '</div>';
    const sym = (over, g) => {
      const d = GT.newDoc(); d.settings.colorRelations = colored;
      const id = GT.addPerson(d, { gender: g || 'M', x: 0, y: 0 });
      Object.assign(d.persons[id], over);
      return R.symbolSVG(d, d.persons[id], 34);
    };
    const grid = (rows) => `<div class="legend">${rows.map(row).join('')}</div>`;
    const byCat = (types, cats, kind) => cats.map(c => `<h4 class="lh">${esc(c.label)}</h4>` +
      grid(types.filter(t => t.cat === c.key && t.sheet !== false)
        .map(t => [R.sampleSVG(kind, t.key, colored), t.label, t.key, GT.isSpecialLine(t.key)]))).join('');
    const special = '<p class="hint-text">標 ● 的線比較少見，畫在圖上時會自動在線旁寫出名稱（左邊「顯示設定」可以關掉）。</p>';
    const tabs = [
      { key: 'person', label: '人物', html: grid([
        [sym({}, 'M'), '男性', 'sym:M'], [sym({}, 'F'), '女性', 'sym:F'], [sym({}, 'U'), '未知性別', 'sym:U'], [sym({}, 'P'), '寵物', 'sym:P'],
        [sym({ index: true }), '案主（指標人物）：粗框灰底', 'sym:index'], [sym({ deceased: true }), '已歿：打叉', 'sym:deceased'],
        [sym({ life: 'pregnancy' }, 'U'), '懷孕', 'life:pregnancy'], [sym({ life: 'miscarriage' }, 'U'), '流產', 'life:miscarriage'],
        [sym({ life: 'abortion' }, 'U'), '墮胎', 'life:abortion'],
        [sym({ culture: 'immigration' }), '移民', 'culture:immigration'], [sym({ culture: 'multiple' }), '住過兩個以上的文化地區', 'culture:multiple'],
      ]) + '<p class="hint-text">符號中間的數字＝年齡；已歿的人是過世時的年齡。</p>' },
      { key: 'health', label: '成癮與疾病', html: grid([
        [sym({ illness: 'active' }), '身體或精神疾病（左半）', 'health:illness'],
        [sym({ substance: 'active' }), '酒精或藥物濫用（下半）', 'health:substance'],
        [sym({ substance: 'suspected' }), '疑似酒精或藥物濫用（灰色）', 'health:suspected'],
        [sym({ illness: 'active', substance: 'active' }), '疾病合併酒精或藥物濫用', 'health:both'],
        [sym({ illness: 'recovery' }), '疾病復原中', 'health:illrec'], [sym({ substance: 'recovery' }), '濫用復原中', 'health:subrec'],
        [sym({ illness: 'recovery', substance: 'recovery' }), '兩者都在復原中', 'health:bothrec'],
        [sym({ illness: 'active', substance: 'recovery' }), '濫用復原中，但有疾病', 'health:ill-subrec'],
        [sym({ illness: 'recovery', substance: 'active' }), '疾病復原中，但有濫用', 'health:illrec-sub'],
      ]) + '<h4 class="lh">疾病別（顏色填在左上角）與成癮（外框顏色）</h4>' + grid(GT.CONDITIONS.map(c =>
        [sym(c.kind === 'medical' ? { illness: 'active', conditions: [c.key] } : { conditions: [c.key] }), c.label, 'cond:' + c.kind])) },
      { key: 'family', label: '家庭關係', html: special + byCat(GT.FAMILY_TYPES, GT.FAMILY_CATS, 'union') },
      { key: 'emotion', label: '情感關係', html: special + byCat(GT.EMOTION_TYPES, GT.EMOTION_CATS, 'relation') },
      { key: 'eco', label: '生態圖', html: grid([
        [R.sampleSVG('system', '學校', colored), '資源／外部系統', 'eco:system'],
        [R.sampleSVG('tie', 'normal', colored), '普通（單線）', 'eco:normal'],
        [R.sampleSVG('tie', 'strong', colored), '強（雙線）', 'eco:strong'],
        [R.sampleSVG('tie', 'weak', colored), '弱（虛線）', 'eco:weak'],
        [R.sampleSVG('tie', 'stress', colored), '有壓力／衝突（鋸齒線）', 'eco:stress'],
        [R.sampleSVG('tie', 'dir', colored), '單向流向（箭頭）', 'eco:dir'],
        [R.sampleSVG('tie', 'both', colored), '雙向', 'eco:both'],
      ]) + '<p class="hint-text">線停在生活圈的虛線框＝連到整個家庭；線穿進去連到某個人＝只跟那個人有關。</p>' },
      { key: 'child', label: '親子與雙胞胎', html: grid(GT.CHILD_LINKS.map(t => [R.sampleSVG('child', t.key, colored), t.label + '子女', 'child:' + t.key])
        .concat([[R.sampleSVG('child', 'pet', colored), '寵物', 'child:pet']],
                GT.TWIN_KINDS.map(t => [R.sampleSVG('twins', t.key, colored), t.label, t.key]))) },
    ];
    if (!tabs.some(t => t.key === legendTab)) legendTab = tabs[0].key;
    const body = dialog('圖例說明', `<div class="picker ltabs"><div class="cats">${tabs.map(t =>
      `<button type="button" data-ltab="${t.key}" class="${t.key === legendTab ? 'on' : ''}">${esc(t.label)}</button>`).join('')}</div></div>` +
      tabs.map(t => `<div data-lsec="${t.key}"${t.key === legendTab ? '' : ' hidden'}>${t.html}</div>`).join(''),
      [{ label: '看使用說明', onClick: () => openHelp() }, { label: '關閉', primary: true }], { wide: true });
    body.querySelector('.ltabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ltab]');
      if (!b) return;
      legendTab = b.dataset.ltab;
      body.querySelectorAll('[data-ltab]').forEach(x => x.classList.toggle('on', x === b));
      body.querySelectorAll('[data-lsec]').forEach(x => { x.hidden = x.dataset.lsec !== legendTab; });
      body.scrollTop = 0;
    });
  }

  // 使用說明：章節分頁（一次看一章）；原稿在 src/manual.js 的 MANUAL
  let helpTab = 'start';
  function openHelp(tab) {
    const M = GT.manual.MANUAL;
    if (tab) helpTab = tab;
    if (!M.some(c => c.key === helpTab)) helpTab = M[0].key;
    const body = dialog('使用說明', `<div class="picker htabs"><div class="cats">${M.map(c =>
      `<button type="button" data-htab="${esc(c.key)}" class="${c.key === helpTab ? 'on' : ''}">${esc(c.title)}</button>`).join('')}</div></div>
      <div class="help" id="helpBody"></div>
      <p class="muted" style="margin-top:12px">版本 ${esc(APP_VERSION)}（${esc(BUILD)}）</p>`,
      [{ label: '看圖例說明', onClick: () => openLegend() }, { label: '關閉', primary: true }], { wide: true });
    const draw = () => { body.querySelector('#helpBody').innerHTML = GT.manual.render(M.find(c => c.key === helpTab).body); };
    draw();
    body.querySelector('.htabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-htab]');
      if (!b) return;
      helpTab = b.dataset.htab;
      body.querySelectorAll('[data-htab]').forEach(x => x.classList.toggle('on', x === b));
      draw();
      body.scrollTop = 0;
    });
  }

  // ───── 檔案 ─────
  const TYPES_JSON = [{ description: '家系圖檔案', accept: { 'application/json': ['.json'] } }];
  const TYPES_OPEN = [{ description: '家系圖檔案（本工具 .json、GenoPro .gno）', accept: { 'application/json': ['.json'], 'application/octet-stream': ['.gno'] } }];

  const confirmDiscard = () => !state.dirty || confirm('目前的圖還沒儲存，確定要放棄這些變更嗎？');

  function setDoc(doc, o) {
    state.doc = doc; state.history.clear(); state.sel = new Set();
    if (state.pending) cancelPending();
    state.handle = o.handle || null; state.fileName = o.fileName || ''; if (o.dirty) { state.dirty = true; state.savedJSON = null; } else markSaved();
    renderAll(); fitView();
  }

  function looksGno(name, bytes) {
    if (/\.gno$/i.test(name) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) return true;
    return /<GenoPro[\s>]/.test(new TextDecoder('latin1').decode(bytes.subarray(0, 400)));
  }

  // 開檔大小上限（驗收發現：原本整個檔案無條件讀進記憶體）。.gno 可能內含照片，給寬一點；本工具的 .json 不會超過數 MB
  const MAX_GNO_FILE = 150 * 1024 * 1024, MAX_JSON_FILE = 30 * 1024 * 1024;

  async function loadFile(file, handle) {
    const isGnoName = /\.(gno|xml)$/i.test(file.name);
    if (file.size > (isGnoName ? MAX_GNO_FILE : MAX_JSON_FILE)) { showError(GT.fail('TOO_LARGE', new Error(`file size ${file.size}`))); return; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (looksGno(file.name, bytes)) {
      if (bytes.length > MAX_GNO_FILE) { showError(GT.fail('TOO_LARGE', new Error(`file size ${bytes.length}`))); return; }
      let res;
      try { res = await GT.gno.readGno(bytes); }
      catch (e) {
        const code = e instanceof GT.gno.GnoLockedError ? 'GNO_LOCK' : e instanceof GT.gno.GnoTooLargeError ? 'TOO_LARGE' : 'GNO';
        showError(GT.fail(code, e)); return;
      }
      setDoc(res.doc, { handle: null, fileName: file.name.replace(/\.(gno|xml)$/i, '') + '（GenoPro 匯入，尚未存檔）', dirty: true });
      dialog('GenoPro 匯入結果', GT.gno.describeReport(res.report).map(l => `<p>${esc(l)}</p>`).join(''), [{ label: '知道了', primary: true }]);
      return;
    }
    let parsed;
    try { parsed = GT.normalizeDoc(JSON.parse(new TextDecoder('utf-8').decode(bytes))); }
    catch (e) { showError(GT.fail('OPEN', e)); return; }
    setDoc(parsed.doc, { handle, fileName: file.name, dirty: false });
    if (parsed.warnings.length) toast(`有 ${parsed.warnings.length} 筆資料不完整，已略過；其他內容已正常開啟。`, 'warn', 6000);
    else toast('已開啟。', 'ok');
  }

  async function openFile() {
    if (!confirmDiscard()) return;
    if (window.showOpenFilePicker) {
      let h;
      try { [h] = await window.showOpenFilePicker({ types: TYPES_OPEN, multiple: false }); }
      catch (e) { if (e && e.name === 'AbortError') return; throw e; }
      await loadFile(await h.getFile(), h);
    } else { $('fileInput').value = ''; $('fileInput').click(); }
  }

  function suggestName(ext) {
    const base = state.doc.meta.title.trim()
      || state.fileName.replace(/（.*?）$/, '').replace(/\.(json|gno|xml)$/i, '').trim()
      || `家系圖_${state.doc.meta.assessDate}`;
    return base.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) + ext;
  }
  async function writeHandle(h, data) { const w = await h.createWritable(); await w.write(data); await w.close(); }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function save(asNew) {
    const text = GT.serialize(state.doc);
    if (!asNew && state.handle && state.handle.createWritable) {
      await writeHandle(state.handle, text);
    } else if (window.showSaveFilePicker) {
      let h;
      try { h = await window.showSaveFilePicker({ suggestedName: suggestName('.json'), types: TYPES_JSON }); }
      catch (e) { if (e && e.name === 'AbortError') return; throw e; }
      await writeHandle(h, text);
      state.handle = h; state.fileName = h.name;
    } else {
      const name = suggestName('.json');
      download(new Blob([text], { type: 'application/json' }), name);
      state.fileName = name;
    }
    markSaved(); renderChrome();
    toast('已儲存。', 'ok');
  }

  // ───── 匯出圖片 ─────
  function exportParts() {
    const svg = R.exportSVG(state.doc);
    const m = svg.match(/width="([\d.]+)" height="([\d.]+)"/);
    return { svg, w: +m[1], h: +m[2] };
  }
  async function pngBlob() {
    const { svg, w, h } = exportParts();
    const scale = Math.min(3, 9000 / Math.max(w, h));
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * scale); c.height = Math.ceil(h * scale);
    const ctx = c.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    if (!blob) throw new Error('canvas.toBlob returned null');
    return blob;
  }
  async function saveBlob(blob, name, types) {
    if (window.showSaveFilePicker) {
      let h;
      try { h = await window.showSaveFilePicker({ suggestedName: name, types }); }
      catch (e) { if (e && e.name === 'AbortError') return false; throw e; }
      await writeHandle(h, blob);
      return true;
    }
    download(blob, name);
    return true;
  }

  // ───── 其他動作 ─────
  // 復原／重做／刪除都會讓點選模式的起點失去意義 → 一律先取消（驗收發現：原本會對已不存在的人完成連結）
  function deleteSelection() {
    if (!state.sel.size) return;
    if (state.pending) cancelPending();
    const ids = [...state.sel], np = ids.filter(id => state.doc.persons[id]).length;
    mutate(d => GT.deleteItems(d, ids));
    select([]);
    toast(np ? `已刪除 ${np} 人（按 Ctrl+Z 可以復原）。` : '已刪除（按 Ctrl+Z 可以復原）。', 'ok');
  }
  // 未儲存標記：跟最後一次存檔（或開檔）的內容比對；復原回到存檔時的樣子就不算未儲存
  const markSaved = () => { state.savedJSON = JSON.stringify(state.doc); state.dirty = false; };
  const recheckDirty = () => { state.dirty = JSON.stringify(state.doc) !== state.savedJSON; };
  function undo() {
    if (state.pending) cancelPending();
    const d = state.history.undo(state.doc);
    if (!d) { toast('沒有可以復原的動作。'); return; }
    state.doc = d; recheckDirty(); renderAll();
  }
  function redo() {
    if (state.pending) cancelPending();
    const d = state.history.redo(state.doc);
    if (!d) { toast('沒有可以重做的動作。'); return; }
    state.doc = d; recheckDirty(); renderAll();
  }
  function nudge(dx, dy) {
    const ids = [...state.sel].filter(x => state.doc.persons[x] || state.doc.labels[x]);
    if (!ids.length) return;
    mutate(d => GT.moveItems(d, ids, dx, dy), { keepPanel: true });
  }

  function renderChrome() {
    const n = Object.keys(state.doc.persons).length;
    $('fileLabel').innerHTML = `${esc(state.fileName || '未命名')}${state.dirty ? ' <span class="dirty">● 未儲存</span>' : ''}`;
    document.title = (state.dirty ? '● ' : '') + (state.fileName || '未命名') + ' — 家系圖工具';
    const ns = Object.keys(state.doc.systems).length;
    $('stCount').textContent = `${n} 人` + (ns ? `、${ns} 個資源` : '');
    $('stDate').textContent = `評估日期 ${state.doc.meta.assessDate}（年齡以此計算）`;
    $('btnUndo').disabled = !state.history.canUndo;
    $('btnRedo').disabled = !state.history.canRedo;
    $('btnDelete').disabled = !state.sel.size;
    renderTools();
  }

  // ───── 綁定 ─────
  function bind() {
    document.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => addPersonAtCenter(b.dataset.add)));
    document.querySelectorAll('[data-kin]').forEach(b => b.addEventListener('click', () => onKin(b.dataset.kin)));
    $('viewModes').innerHTML = GT.VIEW_MODES.map(v =>
      `<label class="check"><input type="radio" name="viewMode" value="${esc(v.key)}">${esc(v.label)}</label>`).join('');
    document.querySelectorAll('input[name=viewMode]').forEach(r => r.addEventListener('change', () => {
      if (r.checked) mutate(d => { d.settings.view = r.value; }, { keepPanel: true });
    }));
    $('btnSystem').addEventListener('click', openSystemPicker);
    $('btnTie').addEventListener('click', startTie);
    $('relTypeBtn').addEventListener('click', openRelTypePicker);
    $('btnRelation').addEventListener('click', () => {
      const ps = selOf('person');
      if (ps.length === 2) { const rid = mutate(d => GT.addRelation(d, ps[0], ps[1], state.relType)); select([rid]); return; }
      if (ps.length !== 1) { toast('請先點選一個人（或按住 Shift 選兩個人）。', 'warn'); return; }
      startPending('relation', ps[0], { type: state.relType });
    });
    $('btnLegend').addEventListener('click', openLegend);
    $('btnHousehold').addEventListener('click', () => {
      const ps = selOf('person');
      if (!ps.length) { toast('請先選取同住的人：點第一個人，再按住 Shift 點其他人。', 'warn', 6000); return; }
      const hid = mutate(d => GT.addHousehold(d, ps, '')); select([hid]);
    });
    $('btnLabel').addEventListener('click', () => {
      const c = viewCenter();
      const id = mutate(d => GT.addLabel(d, c.x - 40, c.y + 90, '文字說明'));
      select([id]); focusFirstInput();
    });
    $('showFields').addEventListener('change', (e) => {
      const k = e.target.dataset.show;
      if (k) mutate(d => { const f = d.settings.fields.find(x => x.key === k); if (f) f.show = e.target.checked; });
    });
    $('optYears').addEventListener('change', (e) => mutate(d => { d.settings.showYears = e.target.checked; }));
    $('optColor').addEventListener('change', (e) => mutate(d => { d.settings.colorRelations = e.target.checked; }));
    $('optLineLabels').addEventListener('change', (e) => mutate(d => { d.settings.lineLabels = e.target.checked; }));
    document.querySelectorAll('input[name=labelMode]').forEach(r => r.addEventListener('change', () => mutate(d => { d.settings.labelMode = r.value; })));
    $('btnFields').addEventListener('click', openFieldManager);

    $('btnNew').addEventListener('click', () => { if (confirmDiscard()) setDoc(GT.newDoc(), { dirty: false }); });
    $('btnOpen').addEventListener('click', () => act('OPEN', openFile));
    $('fileInput').addEventListener('change', () => { const f = $('fileInput').files[0]; if (f) act('OPEN', () => loadFile(f, null)); });
    $('btnSave').addEventListener('click', () => act('SAVE', () => save(false)));
    $('btnSaveAs').addEventListener('click', () => act('SAVE', () => save(true)));
    $('btnPng').addEventListener('click', () => act('EXPORT', async () => {
      if (isEmpty()) { toast('圖上還沒有內容。', 'warn'); return; }
      if (await saveBlob(await pngBlob(), suggestName('.png'), [{ description: 'PNG 圖檔', accept: { 'image/png': ['.png'] } }]))
        toast('已匯出 PNG（高解析度，適合列印）。', 'ok');
    }));
    $('btnSvg').addEventListener('click', () => act('EXPORT', async () => {
      if (isEmpty()) { toast('圖上還沒有內容。', 'warn'); return; }
      const blob = new Blob([exportParts().svg], { type: 'image/svg+xml' });
      if (await saveBlob(blob, suggestName('.svg'), [{ description: 'SVG 向量圖', accept: { 'image/svg+xml': ['.svg'] } }]))
        toast('已匯出 SVG（向量圖，放大不失真）。', 'ok');
    }));
    $('btnCopy').addEventListener('click', () => act('CLIPBOARD', async () => {
      if (isEmpty()) { toast('圖上還沒有內容。', 'warn'); return; }
      const blob = await pngBlob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('已複製圖片，到 Word 按 Ctrl+V 貼上。', 'ok');
    }));
    $('btnHelp').addEventListener('click', openHelp);
    $('btnUndo').addEventListener('click', undo);
    $('btnRedo').addEventListener('click', redo);
    $('btnDelete').addEventListener('click', deleteSelection);
    $('zoomIn').addEventListener('click', () => zoomBy(1.2));
    $('zoomOut').addEventListener('click', () => zoomBy(1 / 1.2));
    $('zoomFit').addEventListener('click', fitView);

    document.addEventListener('keydown', (e) => {
      const tag = document.activeElement && document.activeElement.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
      if (e.key === 'F1') { e.preventDefault(); if (!$('dlg').open) openHelp(); return; }   // 對話框開著時不換掉它（審查 2026-09-21）
      if (mod && key === 's') { e.preventDefault(); act('SAVE', () => save(e.shiftKey)); return; }
      if (mod && key === 'o') { e.preventDefault(); act('OPEN', openFile); return; }
      if ($('dlg').open || typing) return;
      if (e.code === 'Space') {
        // 焦點在按鈕／摺疊標題／連結上時，空白鍵是「啟動它」（鍵盤操作的人靠這個）：不攔截
        // 用滑鼠點過的按鈕不會保留焦點（見下方 click 監聽），所以滑鼠使用者按空白鍵照樣是平移
        const ae = document.activeElement;
        if (ae && /^(BUTTON|SUMMARY|A)$/.test(ae.tagName)) return;
        e.preventDefault();                                                  // 不要捲動頁面
        if (!e.repeat) setSpace(true);
        return;
      }
      if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && key === 'y') { e.preventDefault(); redo(); }
      else if (mod && key === 'a') { e.preventDefault(); select(Object.keys(state.doc.persons).concat(Object.keys(state.doc.labels))); }
      else if (key === 'delete' || key === 'backspace') { e.preventDefault(); deleteSelection(); }
      else if (key === 'escape') { if (state.pending) cancelPending(); else if (state.sel.size) select([]); }
      else if (key.startsWith('arrow')) {
        e.preventDefault();
        const s = e.shiftKey ? 1 : GT.GRID;
        nudge(key === 'arrowleft' ? -s : key === 'arrowright' ? s : 0, key === 'arrowup' ? -s : key === 'arrowdown' ? s : 0);
      }
    });
    window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
    // 全域兜底（模式 18）：沒被接住的錯誤也只給使用者固定文案＋代碼
    window.addEventListener('error', (e) => showError(GT.fail('UNEXPECTED', e.error || e.message)));
    window.addEventListener('unhandledrejection', (e) => showError(GT.fail('UNEXPECTED', e.reason)));
  }

  // 開機自我測試（網址加 #selftest 才會跑；測試腳本用它確認打包後的單一檔案在 CSP 下各功能正常）
  async function selfTest() {
    try {
      const d = GT.newDoc();
      const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
      d.persons[a].name = '測試甲'; d.persons[a].age = '45'; d.persons[a].index = true;
      d.persons[a].attrs.occupation = '工人'; d.persons[a].attrs.economy = '低收入戶';
      const r = GT.addPartner(d, a);
      GT.addChild(d, r.unionId, 'F');
      GT.addRelation(d, a, r.personId, 'Discord');
      setDoc(d, { dirty: false });
      const html = $('world').innerHTML;
      const checks = {
        text: html.includes('測試甲') && html.includes('工人') && html.includes('低收入戶') && html.includes('>45<'),
        // 回歸：元件自己的 display 曾經蓋掉 hidden 屬性（提示條與空白說明關不掉）
        hidden: getComputedStyle($('banner')).display === 'none' && getComputedStyle($('empty')).display === 'none',
      };
      // 回歸：按「＋伴侶」後姓名欄要「立刻」取得焦點，不能延後（手快的人前幾個字會掉）
      select([a]);
      document.querySelector('[data-kin=partner]').click();
      checks.focus = !!document.activeElement && document.activeElement.dataset.f === 'name';
      // 回歸（驗收 #3）：點選模式中按復原 → 點選模式要一起取消，不能對已消失的人完成連結
      startPending('partner', a);
      undo();
      checks.pending = state.pending === null && $('banner').hidden;
      // 回歸（驗收 #5）：復原回到開檔時的內容 → 不算未儲存
      checks.dirty = state.dirty === false;
      // 第 6 步：人物狀態（分類收合）
      select([a]);
      document.querySelector('[data-acc=health] > summary').click();
      document.querySelector('[data-set=illness][data-val=active]').click();
      checks.states = state.doc.persons[a].illness === 'active' && $('world').innerHTML.includes('M-20,-20H0V20H-20Z') &&
                      !!document.querySelector('#props details[data-acc=health][open]') && !!document.querySelector('#props .symprev svg');
      // 分類式選擇器：先點大類、再點線條
      const uid = Object.keys(state.doc.unions)[0];
      select([uid]);
      document.querySelector('[data-pcat=cohabit]').click();
      document.querySelector('[data-pick=Cohabitation]').click();
      checks.picker = state.doc.unions[uid].type === 'Cohabitation';
      // 拖曳圈選：從空白處拉一個蓋住整張圖的框 → 人和他們之間的線都選到
      select([]);
      const cr = canvas.getBoundingClientRect();
      const pe = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, { clientX: cr.left + x, clientY: cr.top + y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 7, bubbles: true }));
      pe('pointerdown', 2, 2); pe('pointermove', cr.width / 2, cr.height / 2); pe('pointermove', cr.width - 2, cr.height - 2); pe('pointerup', cr.width - 2, cr.height - 2);
      const np = Object.keys(state.doc.persons).length;
      checks.marquee = Object.keys(state.doc.persons).every(x => state.sel.has(x)) && state.sel.size === np + 2 && $('overlay').innerHTML === '';
      // 滾輪＝捲動、Ctrl＋滾輪＝縮放
      const v0 = Object.assign({}, state.view);
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, clientX: cr.left + 10, clientY: cr.top + 10, bubbles: true, cancelable: true }));
      const scrolled = state.view.y === v0.y - 100 && state.view.k === v0.k;
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, clientX: cr.left + 10, clientY: cr.top + 10, bubbles: true, cancelable: true }));
      checks.wheel = scrolled && state.view.k > v0.k;
      // 回歸：「管理欄位」開第二次後，一次點擊被處理兩次（監聽器掛在共用的對話框上，越開越多）
      openFieldManager(); $('dlg').close(); openFieldManager();
      const before = state.doc.settings.fields.map(x => x.key);
      document.querySelector(`[data-fd="${before[0]}"]`).click();
      const after = state.doc.settings.fields.map(x => x.key);
      $('dlg').close();
      checks.fieldmgr = after[0] === before[1] && after[1] === before[0] && after[2] === before[2];
      // 回歸（審查 #1）：焦點在按鈕上時，空白鍵要按下那顆按鈕，不可以被平移快捷鍵吃掉
      const btn = $('btnHelp'), spaceKey = () => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }));
      btn.focus();
      const ev = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
      checks.spacebtn = !ev.defaultPrevented && document.activeElement === btn && !canvas.classList.contains('grab');
      btn.blur();
      spaceKey();
      checks.spacepan = canvas.classList.contains('grab');                   // 焦點不在按鈕上：照樣是平移
      document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }));
      // 回歸（審查 #2）：已經是同一種雙胞胎時再按一次，不留下空的復原步驟
      const u0 = Object.keys(state.doc.unions)[0];
      mutate(d => GT.addChild(d, u0, 'M'));
      const kids = state.doc.unions[u0].children.map(c => c.id).slice(0, 2);
      mutate(d => GT.setTwins(d, u0, kids, 'Identical'));
      select(kids);
      const n0 = state.history.undoStack.length;
      document.querySelector('[data-twin=Identical]').click();
      checks.twinnoop = state.history.undoStack.length === n0 && state.doc.unions[u0].twins.length === 1;
      // 生態圖：新增資源 → 拉線 → 切換顯示模式
      $('btnSystem').click();
      document.querySelector('[data-pcat=edu]').click();
      document.querySelector('[data-pick=school]').click();
      const sysId = Object.keys(state.doc.systems)[0];
      checks.system = !!sysId && state.doc.systems[sysId].name === '學校' && !$('dlg').open &&
                      $('world').innerHTML.includes('data-kind="system"');
      select([sysId, a]);
      $('btnTie').click();
      const tieId = Object.keys(state.doc.ties)[0];
      checks.tie = !!tieId && state.doc.ties[tieId].strength === 'normal' &&
                   $('world').innerHTML.includes('data-kind="tie"') && !!document.querySelector('#props [data-tnote]');
      document.querySelector('input[name=viewMode][value=ecomap]').click();
      checks.viewmode = $('world').innerHTML.includes('class="famnode"') && !$('world').innerHTML.includes('data-kind="person"');
      document.querySelector('input[name=viewMode][value=both]').click();
      checks.viewback = $('world').innerHTML.includes('data-kind="person"') && $('world').innerHTML.includes('data-kind="system"');
      // 線旁說明：特殊線條自動標名稱；顯示設定可以關掉
      mutate(d => { d.unions[u0].type = 'SeparationLegal'; });
      checks.linelabel = $('world').innerHTML.includes('合法分居');
      $('optLineLabels').click();
      checks.linelabeloff = !$('world').innerHTML.includes('class="linelabel"');
      $('optLineLabels').click();
      // 內建使用說明與圖例說明（BASE 模式 16 §6：開起來真的有內容）
      openHelp('ecomap');
      checks.manual = $('dlg').open && $('dlgBody').textContent.length > 500 && $('dlgBody').textContent.includes('拉生態連結');
      document.querySelector('[data-htab=save]').click();
      checks.manualtab = $('dlgBody').textContent.includes('轉換為圖形');
      $('dlg').close();
      openLegend('family');
      checks.legenddesc = $('dlgBody').textContent.includes(GT.manual.LEGEND_DESC.SeparationLegal);
      $('dlg').close();
      // 回歸（審查 2026-09-21）：「管理欄位」開著時按 F1，不可以把它換掉（打到一半的字會無聲消失）
      openFieldManager();
      $('fmNew').value = '宗教';
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', code: 'F1', bubbles: true, cancelable: true }));
      checks.f1dialog = !!$('fmNew') && $('fmNew').value === '宗教' && $('dlgTitle').textContent === '管理欄位';
      $('dlg').close();
      // 回歸（審查 2026-09-21）：使用說明的清單下方要有間距（新規則曾被後面的舊規則蓋掉）
      openHelp('draw');
      const helpUl = document.querySelector('#helpBody ul');
      checks.helpcss = !!helpUl && getComputedStyle(helpUl).marginBottom === '8px';
      $('dlg').close();
      const blob = await pngBlob();
      const bad = Object.keys(checks).filter(k => !checks[k]);
      document.body.dataset.selftest = `${bad.length ? 'fail-' + bad.join('-') : 'ok'}:${Object.keys(state.doc.persons).length}:${blob.size}`;
    } catch (e) {
      document.body.dataset.selftest = 'fail:' + GT.fail('UNEXPECTED', e).ref;   // 只留代碼，細節進記錄
    }
  }

  bind();
  markSaved();
  renderAll();
  requestAnimationFrame(fitView);
  $('stVer').textContent = `v${APP_VERSION}`;
  document.body.dataset.ready = '1';
  if (location.hash === '#selftest') selfTest();
})(globalThis.GT = globalThis.GT || {});
