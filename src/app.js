/* 家系圖工具 — app.js
 * 介面層：畫布操作（選取／拖曳／平移／縮放）、屬性面板、左側工具、檔案開存、匯出、快捷鍵。
 * 錯誤一律走 GT.fail()（core.js 的錯誤咽喉），畫面只顯示「狀態＋下一步＋代碼」。
 */
(function (GT) {
  'use strict';
  const APP_VERSION = '0.8.2';
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
  // 成功與提醒用 toast（會自己消失）；錯誤用畫布上的 alert（留著不動，使用者看完自己關）
  const ico = (name, size) => GT.icons.icon(name, size);
  // action＝{ label, run }：提示裡帶一個按鈕（例：拖進生活圈後問「加入」）；按了就執行並關掉提示
  function toast(msg, kind, ms, action) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'ok' ? ' toast--success' : kind === 'warn' ? ' toast--warn' : '');
    el.innerHTML = `<span class="toast__icon">${ico(kind === 'ok' ? 'check-circle' : kind === 'warn' ? 'alert-triangle' : 'info')}</span>` +
                   `<span class="toast__body"></span>`;
    el.querySelector('.toast__body').textContent = msg;      // 使用者文字不進 innerHTML
    if (action) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'toast__action'; b.textContent = action.label;
      b.addEventListener('click', () => { el.remove(); action.run(); });
      el.appendChild(b);
    }
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), ms || 3500);
    return el;
  }
  // 畫布上方的提示框（留著不動，使用者看完自己關）：錯誤用紅色、「沒有完成」用黃色；可以帶「再試一次」
  let retryFn = null;
  function showAlert(msg, o) {
    const bar = $('errorBar');
    bar.classList.toggle('alert--danger', o.kind !== 'warn');
    bar.classList.toggle('alert--warn', o.kind === 'warn');
    $('errorTitle').textContent = o.title;
    $('errorText').textContent = msg;
    retryFn = o.retry || null;
    $('errorActions').hidden = !retryFn;
    bar.hidden = false;
  }
  function showError(r, retry) {
    document.body.dataset.errors = String((+document.body.dataset.errors || 0) + 1);
    showAlert(r.message, { title: '無法完成', retry });
  }
  // 操作沒有完成、但不是程式出錯（例：選的人已經不在、檔案有幾筆資料略過）：
  // 不用會自己消失的 toast（審查 2026-10-28 M8：設計規範「不可以用 toast 報錯誤」；資料略過的通知 6 秒就不見）
  const notice = (msg, title) => showAlert(msg, { title: title || '沒有完成', kind: 'warn' });
  const clearError = () => { $('errorBar').hidden = true; retryFn = null; };
  async function act(code, fn) {
    try { return await fn(); }
    catch (e) {
      if (e && e.name === 'AbortError') return undefined;
      showError(GT.fail(code, e), () => act(code, fn));             // 失敗狀態要有下一步：再試一次
      return undefined;
    }
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

  // 「家庭」圓只在生態圖模式、而且有人的時候存在
  const familyShown = () => R.viewMode(state.doc) === 'ecomap' && Object.keys(state.doc.persons).length > 0;
  const kindOf = (id) => {
    const d = state.doc;
    return d.persons[id] ? 'person' : d.unions[id] ? 'union' : d.relations[id] ? 'relation'
         : d.households[id] ? 'household' : d.labels[id] ? 'label'
         : d.systems[id] ? 'system' : d.ties[id] ? 'tie'
         : id === GT.FAMILY_ID && familyShown() ? 'family' : null;
  };
  // 可以拖曳、方向鍵移動的東西
  const movable = (id) => !!(state.doc.persons[id] || state.doc.labels[id] || state.doc.systems[id]) || (id === GT.FAMILY_ID && familyShown());
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
    $('world').innerHTML = R.renderWorld(state.doc, { selection: state.sel, pending: state.pending && state.pending.from,
                                                      dropTarget: drag && drag.mode === 'move' ? drag.target : null });
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
    // 人、文字說明、資源、家庭圓都可以拖（2026-10-28 發現：資源原本拖不動，新增時的提示卻說可以拖）
    if (movable(id) && state.sel.has(id)) {
      const ids = [...state.sel].filter(movable);
      drag = { mode: 'move', last: toWorld(e), ids, moved: false, clickId: additive ? null : id,
               zones: dropZones(ids), target: null };
    } else drag = null;
  });
  // 拖人進生活圈（使用者 2026-10-28）：用「開始拖之前」的生活圈形狀判斷——拖的過程中形狀會跟著變，
  // 使用者瞄準的是他按下滑鼠時看到的那個圈。本來就在圈裡的人不算（輕輕挪一下不該跳出詢問）
  function dropZones(ids) {
    const d = state.doc, ps = ids.filter(x => d.persons[x]);
    if (!ps.length || R.viewMode(d) === 'ecomap') return [];
    const inParts = (parts, p) => parts.some(r => p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2);
    return Object.values(d.households).map(h => {
      const parts = R.householdParts(d, h);
      return { id: h.id, parts, area: parts.reduce((a, r) => a + (r.x2 - r.x1) * (r.y2 - r.y1), 0),
               ids: ps.filter(x => !h.members.includes(x) && !inParts(parts, d.persons[x])) };
    }).filter(z => z.ids.length);
  }
  // 現在放開的話會加入哪個生活圈：有好幾個圈重疊時挑最小（最裡面）的那個
  function dropTarget(zones) {
    const d = state.doc;
    const hits = zones.map(z => ({ z, ids: z.ids.filter(x => d.persons[x] && z.parts.some(r => {
      const p = d.persons[x];
      return p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2;
    })) })).filter(h => h.ids.length);
    if (!hits.length) return null;
    hits.sort((a, b) => a.z.area - b.z.area);
    return { hid: hits[0].z.id, ids: hits[0].ids };
  }
  function offerJoin(j) {
    const doc0 = state.doc, h = doc0.households[j.hid];
    const who = j.ids.length === 1 ? personName(j.ids[0]) : `${personName(j.ids[0])}等 ${j.ids.length} 人`;
    // 一個人只能在一個生活圈（使用者 2026-10-28）：本來住別的圈的人，加入＝搬過來，先講清楚
    const from = [...new Set(j.ids.map(x => GT.householdOf(doc0, x)).filter(o => o && o.id !== j.hid))];
    const moveNote = from.length === 1 ? `（會從「${from[0].label || '原本的生活圈'}」移出）` : from.length ? '（會從原本的生活圈移出）' : '';
    toast(`要把${who}加入「${h.label || '生活圈'}」嗎？${moveNote}`, 'info', 10000, { label: '加入', run: () => {
      // 這段時間裡按了復原、開了別的檔：圖已經不是同一張，不要套上去
      if (state.doc !== doc0 || !state.doc.households[j.hid]) { notice('圖已經有變動，所以沒有加入。請再拖曳一次。'); return; }
      const n = mutate(d => GT.joinHousehold(d, j.hid, j.ids));
      select([j.hid]);
      toast(n ? `已加入（按 Ctrl+Z 可以復原）。` : '他們已經是這個生活圈的成員了。', n ? 'ok' : 'info');
    } });
  }
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
    if (drag.zones.length) drag.target = (dropTarget(drag.zones) || {}).hid || null;
    scheduleRender();
  });
  const endDrag = () => {
    if (!drag) return;
    canvas.classList.remove('panning');
    if (drag.mode === 'move') {
      if (drag.moved) {
        GT.snapItems(state.doc, drag.ids);
        const join = drag.zones.length ? dropTarget(drag.zones) : null;
        const fam = drag.ids.includes(GT.FAMILY_ID);
        drag = null;                                                        // 重畫前清掉：放開後圈不再亮
        state.dirty = true; renderCanvas(); renderChrome();
        if (fam) renderPanel();                                             // 拖過家庭圓：面板要出現「回到自動位置」
        if (join) offerJoin(join);
        return;
      }
      if (drag.clickId && state.sel.size > 1) select([drag.clickId]);   // 多選中單點一個＝只選它
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
    if (!fromOk) { cancelPending(); notice('原本選的對象已經不在圖上了，請重新選取再操作。'); return; }
    if (p.action === 'tie') {
      if (kind !== 'person' && kind !== 'system' && kind !== 'household') { toast('請點選一個人、一個資源，或生活圈的虛線框。', 'warn'); return; }
      if (id === p.from) { toast('請點選「另一端」。', 'warn'); return; }
      const existed = GT.tieBetween(state.doc, p.from, id);
      const tid = mutate(d => GT.addTie(d, p.from, id));
      cancelPending();
      if (!tid) { notice('沒有連結成功，請重新選取再試一次。'); return; }
      select([tid]);
      toast(existed ? '這兩者之間原本就有線，又加了一條。' : '已連結。右邊可以設強弱、壓力、流向，也可以寫一件事。', 'ok', 6000);
      return;
    }
    if (p.action === 'attachChild') {
      if (kind !== 'union') { toast('請點「伴侶線」（兩個人下方相連的那條線）。', 'warn'); return; }
      const ok = mutate(d => GT.attachChild(d, id, p.from));
      cancelPending();
      if (ok) { select([p.from]); toast('已設為這段關係的子女。', 'ok'); }
      else notice('不能設為這段關係的子女：這個人是其中一位伴侶。');
      return;
    }
    if (kind !== 'person') { toast('請點選一個人。', 'warn'); return; }
    if (id === p.from) { toast('請點選「另一個」人。', 'warn'); return; }
    if (p.action === 'partner') {
      const existed = GT.unionBetween(state.doc, p.from, id);
      const uid = mutate(d => GT.linkPartners(d, p.from, id));
      cancelPending();
      if (!uid) { notice('沒有連結成功，請重新選取兩個人再試一次。'); return; }
      select([uid]);
      toast(existed ? '這兩人本來就是伴侶，已選取那條伴侶線。' : '已連結為伴侶。右邊可以改成同居、分居、離婚等。', 'ok');
    } else if (p.action === 'relation') {
      const rid = mutate(d => GT.addRelation(d, p.from, id, p.type));
      cancelPending();
      if (!rid) { notice('沒有建立成功，請重新選取兩個人再試一次。'); return; }
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
          toast('這個人有不只一段伴侶關係：請先點選要加子女的那條伴侶線，再按「兒子」或「女兒」。', 'warn', 7000); return;
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

  const renderTools = () => keepFocus($('tools'), renderToolsNow);
  function renderToolsNow() {
    const st = state.doc.settings;
    $('showFields').innerHTML = st.fields.map(f =>
      `<label class="check"><input type="checkbox" data-show="${esc(f.key)}"${f.show ? ' checked' : ''}><span>${esc(f.label)}</span></label>`).join('');
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
      : us.length === 1 ? '已選取伴侶線：可以按「兒子」「女兒」。' : '先在畫布上點選一個人。';
    $('btnRelation').disabled = !(ps.length === 1 || ps.length === 2);
    $('btnRelation').textContent = ps.length === 2 ? '連結選取的兩個人' : '從選取的人拉線…';
    $('btnHousehold').disabled = !ps.length;
    document.querySelectorAll('input[name=viewMode]').forEach(r => { r.checked = r.value === (st.view || 'both'); });
    const ends = [...state.sel].filter(id => GT.tieEndExists(state.doc, id));
    $('btnTie').disabled = !(ends.length === 1 || ends.length === 2);
    $('btnTie').textContent = ends.length === 2 ? '連結選取的兩者' : '拉生態連結…';
    $('tieHint').textContent = ends.length === 2 ? `${nodeName(ends[0])} 與 ${nodeName(ends[1])}`
      : ends.length === 1 ? `從「${nodeName(ends[0])}」拉線，按下後再點另一端。`
      : '先點選一個人或資源（或按住 Shift 選兩個），再按「拉生態連結」。';
    const rt = GT.EMOTION_TYPES.find(t => t.key === state.relType) || GT.EMOTION_TYPES[0];
    $('relTypeBtn').innerHTML = `${R.sampleSVG('relation', rt.key, st.colorRelations)}` +
      `<span class="label">${esc(rt.label)}</span>${ico('chevron-down', 16)}`;
    $('relTypeBtn').title = `新拉的線：${rt.label}（點這裡換類型：先選大類，再選線條）`;   // 窄螢幕標籤會被截斷
  }

  // 左邊「情感關係」的類型：跳出分類式選擇器（先選大類再選線條）
  function openRelTypePicker() {
    const body = dialog('新拉的情感關係線要用哪一種？',
      `<p class="help">先點上排的大類，再點線條。已經拉好的線，之後也可以點它在右邊改。</p>${pickerHTML('tool', GT.EMOTION_TYPES, GT.EMOTION_CATS, state.relType, 'relation')}`,
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
      <summary><span class="caret">${ico('chevron-down', 16)}</span><span class="t">${esc(title)}</span>` +
      `<span class="v${summary ? '' : ' none'}">${esc(summary || emptyText || '無')}</span></summary>
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
  // 有 icon 的選項（流向）用圖示＋只給讀屏軟體的文字
  const segHTML = (field, list, cur) => `<div class="segmented" role="group">${list.map(t =>
    `<button type="button" data-set="${field}" data-val="${esc(t.key)}" aria-pressed="${t.key === cur}" title="${esc(t.label)}">` +
    `${t.icon ? `${ico(t.icon, 18)}<span class="sr-only">${esc(t.label)}</span>` : esc(t.short || t.label)}</button>`).join('')}</div>`;
  const dirIcon = (name, label) => `<span class="kin__dir">${ico(name, 16)}<span class="sr-only">${label}</span></span>`;

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
      if (b.dataset.pcat) { pickerCat[name] = b.dataset.pcat; keepFocus(el, () => { el.innerHTML = pickerInner(name, types, cats, getCur(), kind); }); }
      else if (b.dataset.pick) onPick(b.dataset.pick);
    });
  }
  const curTypeHTML = (types, key, kind) => {
    const t = types.find(x => x.key === key) || { label: key };
    return `<div class="curtype"><span class="help">目前：</span>${R.sampleSVG(kind, key, state.doc.settings.colorRelations)}<b>${esc(t.label)}</b></div>`;
  };

  // 面板、側欄、選擇器整塊重畫後，把焦點放回同一個控制項
  // （審查 2026-10-28 M9：鍵盤使用者每按一次選項，焦點就掉到 <body>，下一次 Tab 從頭開始）
  function focusKey(el) {
    if (!el || el === document.body) return null;
    if (el.id) return '#' + CSS.escape(el.id);
    const own = [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => `[${a.name}="${CSS.escape(a.value)}"]`).join('');
    if (own) return el.tagName.toLowerCase() + own;
    const up = el.parentElement && focusKey(el.parentElement);           // 例：<details data-acc> 裡的 <summary>
    return up ? `${up} > ${el.tagName.toLowerCase()}` : null;
  }
  function keepFocus(root, fn) {
    const ae = document.activeElement, key = root && root.contains(ae) ? focusKey(ae) : null;
    const r = fn();
    if (key && !root.contains(document.activeElement)) {
      const el = root.querySelector(key);
      if (el && !el.disabled) el.focus({ preventScroll: true });
    }
    return r;
  }
  const renderPanel = () => keepFocus($('props'), renderPanelNow);
  function renderPanelNow() {
    const P = $('props'), ids = [...state.sel];
    if (!ids.length) return panelDoc(P);
    if (ids.length > 1) return panelMulti(P, ids);
    const id = ids[0];
    const fn = { person: panelPerson, union: panelUnion, relation: panelRelation, household: panelHousehold,
                 label: panelLabel, system: panelSystem, tie: panelTie, family: panelFamily }[kindOf(id)];
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
      <div class="field"><label for="attr-${esc(f.key)}">${esc(f.label)}${f.show ? ' <span class="badge badge--accent">圖上顯示</span>' : ''}</label>
      <input type="text" class="input" id="attr-${esc(f.key)}" data-attr="${esc(f.key)}" list="dl-${esc(f.key)}" value="${esc((p.attrs || {})[f.key] || '')}" maxlength="500"></div>
      <datalist id="dl-${esc(f.key)}">${GT.suggestionsFor(d, f.key).map(s => `<option value="${esc(s)}">`).join('')}</datalist>`).join('');
    const conds = p.conditions || [];
    // 審查 2026-10-28 M3：改版時樣式改名成 .check、標記沒跟著改，色塊寬度變 0、勾選區只有 28px
    const condChip = (c) => `<label class="check cond"><input type="checkbox" data-cond="${c.key}"${conds.includes(c.key) ? ' checked' : ''}><i style="background:${c.color}"></i><span>${esc(c.label)}</span></label>`;
    const meds = GT.CONDITIONS.filter(c => c.kind === 'medical'), adds = GT.CONDITIONS.filter(c => c.kind === 'addiction');
    // 先選「有沒有疾病」，有了才列出疾病別（先大類後細項）；原本就勾了疾病別的照樣列出，才能取消
    const showMed = !!p.illness || meds.some(c => conds.includes(c.key));
    const health = `
      <fieldset class="field"><legend>身體或精神疾病<span class="hint">符號左半塗黑</span></legend>${segHTML('illness', GT.ILLNESS, p.illness)}</fieldset>
      ${showMed ? `<fieldset class="field"><legend>哪一種疾病（選填）<span class="hint">顏色填在左上角</span></legend><div class="conds">${meds.map(condChip).join('')}</div></fieldset>` : ''}
      <fieldset class="field"><legend>酒精或藥物濫用<span class="hint">下半塗黑，疑似＝灰色</span></legend>${segHTML('substance', GT.SUBSTANCE, p.substance)}</fieldset>
      <fieldset class="field"><legend>成癮（選填）<span class="hint">改外框顏色</span></legend><div class="conds">${adds.map(condChip).join('')}</div></fieldset>`;
    const tw = GT.twinGroupOf(d, id);
    P.innerHTML = `
    <section class="card"><div class="card__header"><h2 class="card__title">基本資料</h2></div>
      <div class="field"><label for="f-name">姓名</label>
      <input type="text" class="input" id="f-name" data-f="name" data-autofocus value="${esc(p.name)}" maxlength="60" placeholder="例：王小明（可留空）"></div>
      <fieldset class="field"><legend>性別</legend>${segHTML('gender', GT.GENDERS, p.gender)}</fieldset>
      <label class="check"><input type="checkbox" data-flag="index"${p.index ? ' checked' : ''}><span>服務使用者（粗框灰底）</span></label>
      <label class="check"><input type="checkbox" data-flag="deceased"${p.deceased ? ' checked' : ''}><span>已歿（打叉）</span></label>
    </section>
    <section class="card"><div class="card__header"><h2 class="card__title">狀態</h2><span class="card__aside symprev">${R.symbolSVG(d, p, 34)}</span></div>
      ${accHTML('life', '生命狀態', p.life ? labelOf(GT.LIFE_STATES, p.life) : '',
        segHTML('life', GT.LIFE_STATES, p.life) + '<p class="help">懷孕、流產、墮胎會換成參考圖的符號（△、●、×）。</p>', '一般')}
      ${accHTML('culture', '文化背景', p.culture ? labelOf(GT.CULTURES, p.culture) : '',
        segHTML('culture', GT.CULTURES, p.culture) + '<p class="help">符號上方加波浪線；住過兩個以上的文化地區畫兩條。</p>')}
      ${accHTML('health', '健康與成癮', healthSummary(p), health)}
    </section>
    <section class="card"><div class="card__header"><h2 class="card__title">年齡</h2><span class="card__aside">顯示在符號中間</span></div>
      <div class="field"><label for="ageInput">${p.deceased ? '過世時年齡' : '年齡'}</label>
      <input type="number" class="input" min="0" max="149" id="ageInput" data-f="${ageKey}" value="${esc(ageVal == null ? '' : ageVal)}"${auto ? ' disabled' : ''}></div>
      <div class="field"><label for="f-birth">出生日期（選填）</label>
      <input type="text" class="input" id="f-birth" data-f="birth" value="${esc(p.birth)}" maxlength="20" placeholder="例：1965、1965-03-08、民國54年"></div>
      ${p.deceased ? `<div class="field"><label for="f-death">死亡日期（選填）</label>
      <input type="text" class="input" id="f-death" data-f="death" value="${esc(p.death)}" maxlength="20" placeholder="例：2019、2019-05"></div>` : ''}
      <div class="agehint${p.deceased && a.value === null ? " warn" : ""}" id="ageHint">${esc(ageHintText(p))}</div>
    </section>
    <section class="card"><div class="card__header"><h2 class="card__title">其他資料</h2><span class="card__aside"><button class="btn btn--ghost" id="btnFieldsP">管理欄位</button></span></div>
      ${fields || '<div class="text-muted">沒有欄位，按「管理欄位」新增。</div>'}
    </section>
    <section class="card"><div class="card__header"><h2 class="card__title">家庭</h2></div>
      <div class="kin">父母：<b>${pu ? names(pu.partners) : '—'}</b><br>伴侶：<b>${names(partners)}</b><br>子女：<b>${names(kids)}</b></div>
      ${tw ? `<div class="kin">雙胞胎：<b>${names(tw.group.ids.filter(x => x !== id))}</b></div>
      <div class="cluster"><select class="input input--sm" data-twinkind style="flex:1" aria-label="雙胞胎類型">${opts(GT.TWIN_KINDS, tw.group.kind)}</select><button class="btn" data-untwin>取消雙胞胎</button></div>` : ''}
      <div class="grid2 toolgroup__rows">
        <button class="btn" data-kin2="partner" data-plus>${ico('plus', 16)}<span class="sr-only">新增</span>伴侶</button><button class="btn" data-kin2="parents" data-plus${pu ? ' disabled' : ''}>${ico('plus', 16)}<span class="sr-only">新增</span>父母</button>
        <button class="btn" data-kin2="son" data-plus>${ico('plus', 16)}<span class="sr-only">新增</span>兒子</button><button class="btn" data-kin2="daughter" data-plus>${ico('plus', 16)}<span class="sr-only">新增</span>女兒</button>
      </div>
    </section>
    ${usingEcomap() ? tieListHTML(id, 6) : ''}
    <section class="card"><button class="btn btn--danger btn--block" data-del>刪除這個人</button></section>`;

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
    <section class="card"><div class="card__header"><h2 class="card__title">${two ? '伴侶關係' : '單親家庭'}</h2></div>
      <div class="kin"><b>${u.partners.map(x => esc(personName(x))).join('</b> 與 <b>')}</b></div>
      ${two ? `<fieldset class="field"><legend>關係類型（先選大類，再選線條）</legend>${curTypeHTML(GT.FAMILY_TYPES, u.type, 'union')}
      ${pickerHTML('union:' + id, GT.FAMILY_TYPES, GT.FAMILY_CATS, u.type, 'union')}</fieldset>
      <div class="field"><label for="u-note">線旁說明（選填，會寫在線旁邊）</label>
      <input type="text" class="input" id="u-note" data-unote value="${esc(u.note || '')}" maxlength="60" placeholder="例：1990 結婚、2015 離婚"></div>
      ${GT.isSpecialLine(u.type) ? '<p class="help">這種線比較少見，圖上會自動寫出名稱（左邊「顯示設定」可以關掉）。</p>' : ''}` : ''}
    </section>
    <section class="card"><div class="card__header"><h2 class="card__title">子女</h2><span class="card__aside">${u.children.length} 位</span></div>
      ${u.children.map(c => `<div class="childrow"><span>${esc(personName(c.id))}${(u.twins || []).some(t => t.ids.includes(c.id)) ? '<span class="text-muted">・雙胞胎</span>' : ''}</span>` +
        `<select class="input" data-child="${esc(c.id)}" aria-label="${esc(personName(c.id))}與父母的關係">${opts(GT.CHILD_LINKS, c.link)}</select></div>`).join('') || '<div class="text-muted">還沒有子女</div>'}
      <div class="grid2 toolgroup__rows"><button class="btn" data-uadd="M" data-plus>${ico('plus', 16)}<span class="sr-only">新增</span>兒子</button><button class="btn" data-uadd="F" data-plus>${ico('plus', 16)}<span class="sr-only">新增</span>女兒</button></div>
      ${u.children.length >= 2 ? '<p class="help">雙胞胎：按住 Shift 點選兩個孩子，右邊會出現「設為雙胞胎」。</p>' : ''}
    </section>
    <section class="card"><button class="btn btn--danger btn--block" data-del>刪除這段關係（人會保留）</button></section>`;
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
    <section class="card"><div class="card__header"><h2 class="card__title">情感關係</h2></div>
      <div class="kin"><b>${esc(personName(r.a))}</b> ${isDir(r.type) ? dirIcon('arrow-right', '指向') : '與'} <b>${esc(personName(r.b))}</b></div>
      <fieldset class="field"><legend>類型（先選大類，再選線條）</legend>${curTypeHTML(GT.EMOTION_TYPES, r.type, 'relation')}
      ${pickerHTML('rel:' + id, GT.EMOTION_TYPES, GT.EMOTION_CATS, r.type, 'relation')}</fieldset>
      <div class="field"><label for="r-note">線旁說明（選填，會寫在線旁邊）</label>
      <input type="text" class="input" id="r-note" data-rnote data-autofocus value="${esc(r.note)}" maxlength="300" placeholder="例：自 2020 年起、情緒虐待"></div>
      ${GT.isSpecialLine(r.type) ? '<p class="help">這種線比較少見，圖上會自動寫出名稱（左邊「顯示設定」可以關掉）。</p>' : ''}
      ${isDir(r.type) ? '<button class="btn btn--block" data-swap>對調方向（箭頭指向另一個人）</button>' : ''}
    </section>
    <section class="card"><button class="btn btn--danger btn--block" data-del>刪除這條情感關係</button></section>`;
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
    ${intruders.length ? `<div class="alert alert--warn" role="status"><strong>圈內有非成員</strong>
      <span><b>${intruders.map(x => esc(personName(x))).join('、')}</b> 不是這個生活圈的成員，但位置落在圈內。請把他們拖到圈外，或調整成員的位置，以免報告被誤讀。</span></div>` : ''}
    <section class="card"><div class="card__header"><h2 class="card__title">生活圈（同住）</h2></div>
      <div class="field"><label for="h-label">名稱（選填，顯示在圈的左上角）</label>
      <input type="text" class="input" id="h-label" data-hl data-autofocus value="${esc(h.label)}" maxlength="30" placeholder="例：同住、祖父母家"></div>
      <h3 class="lh">成員（${h.members.length} 人）</h3>
      <ul class="members">${h.members.map(x => `<li><span>${esc(personName(x))}</span>` +
        `<button class="btn" data-hout="${esc(x)}" aria-label="把${esc(personName(x))}移出這個生活圈">移出</button></li>`).join('')}</ul>
      <p class="help">要加人：在圖上把那個人拖進圈裡，放開後按「加入」。一個人只能住在一個生活圈，從別的圈拖過來的人會從原本的圈移出。</p>
    </section>
    ${usingEcomap() ? tieListHTML(id, 2) : ''}
    <section class="card"><button class="btn btn--danger btn--block" data-del>刪除這個生活圈（人會保留）</button></section>`;
    bindLive(P.querySelector('[data-hl]'), (d, v) => { d.households[id].label = v.slice(0, 30); });
    bindTieList(P, id);
    P.querySelectorAll('[data-hout]').forEach(b => b.addEventListener('click', () => {
      const last = state.doc.households[id].members.length === 1;
      mutate(d => GT.leaveHousehold(d, id, b.dataset.hout));
      if (last) { select([]); toast('生活圈沒有成員了，已一併刪除（按 Ctrl+Z 可以復原）。', 'ok', 6000); }
    }));
    P.querySelector('[data-del]').addEventListener('click', deleteSelection);
  }

  // 圈成生活圈（使用者 2026-10-28：一個人只能在一個生活圈；A 跟 B 同住、又圈 A、B、C＝就是 A、B、C 同住，只畫一個圈）
  function circleHousehold(ps) {
    const d = state.doc;
    const old = [...new Set(ps.map(x => GT.householdOf(d, x)).filter(Boolean))];
    const make = (mode) => { const hid = mutate(dd => GT.addHousehold(dd, ps, '', mode)); select([hid]); return hid; };
    if (!old.length) { make(); return; }
    if (old.length === 1 && ps.every(x => old[0].members.includes(x))) {
      select([old[0].id]);
      toast(`他們已經在同一個生活圈${old[0].label ? `「${old[0].label}」` : ''}裡了。要把人移出，請在右邊按「移出」。`, 'info', 6000);
      return;
    }
    const all = new Set(ps.concat(...old.map(h => h.members)));
    const merged = () => { make('merge'); toast(old.length > 1 ? '已合併成一個生活圈（一個人只能在一個生活圈）。' : '已把選取的人併進原本的生活圈。', 'ok', 6000); };
    if (all.size === ps.length) { merged(); return; }                  // 選到的人涵蓋原本的整個生活圈（例：原本 A、B，現在圈 A、B、C）
    // 只選到原本生活圈的一部分人：合併（連沒選到的同住者一起）或只圈選到的人（他們搬出原本的圈），讓使用者選
    const names = (ids) => ids.map(x => esc(personName(x))).join('、');
    dialog('這些人已經有生活圈', `<div class="help-doc"><p>一個人只能住在一個生活圈。選取的人裡面：</p><ul>${old.map(h =>
      `<li><b>${names(h.members.filter(x => ps.includes(x)))}</b> 原本跟 <b>${names(h.members.filter(x => !ps.includes(x)))}</b> 同住` +
      `${h.label ? `（「${esc(h.label)}」）` : ''}</li>`).join('')}</ul>
      <p><b>合併成一個</b>：他們全部算同住，畫成一個圈。<br><b>只圈選取的人</b>：選取的人從原本的生活圈移出，另外圈一個。</p></div>`,
      [{ label: '取消' },
       { label: `只圈選取的 ${ps.length} 人`, onClick: () => { make(); toast('已另外圈成一個生活圈；選取的人已經從原本的生活圈移出。', 'ok', 6000); } },
       { label: `合併成一個（${all.size} 人）`, primary: true, onClick: merged }]);
  }

  // 生態圖模式的「家庭」圓（使用者 2026-10-28：要能拖位置）
  function panelFamily(P) {
    const moved = !!state.doc.familyPos;
    P.innerHTML = `
    <section class="card"><div class="card__header"><h2 class="card__title">家庭（生態圖）</h2></div>
      <p class="help">生態圖模式把整個家庭畫成一個圓。可以拖曳移動位置，資源的連線會跟著走。</p>
      <p class="help">要改家庭裡的人，請在「顯示」切回含家系圖的模式。</p>
      ${moved ? '<button class="btn btn--block toolgroup__rows" data-famreset>回到自動位置（所有人的中間）</button>' : ''}
    </section>`;
    const b = P.querySelector('[data-famreset]');
    if (b) b.addEventListener('click', () => mutate(d => { d.familyPos = null; }));
  }

  function panelLabel(P, id) {
    const t = state.doc.labels[id];
    P.innerHTML = `
    <section class="card"><div class="card__header"><h2 class="card__title">文字說明</h2></div>
      <div class="field"><label for="label-text">文字</label>
      <textarea class="input" id="label-text" data-tl data-autofocus maxlength="1000" rows="5">${esc(t.text)}</textarea></div>
      <p class="help">可以拖曳移動位置；按 Enter 換行。</p>
    </section>
    <section class="card"><button class="btn btn--danger btn--block" data-del>刪除這段文字</button></section>`;
    bindLive(P.querySelector('[data-tl]'), (d, v) => { d.labels[id].text = v.slice(0, 1000); });
    P.querySelector('[data-del]').addEventListener('click', deleteSelection);
  }

  function panelMulti(P, ids) {
    const ps = ids.filter(x => state.doc.persons[x]);
    const twinU = ps.length >= 2 ? GT.commonParentUnion(state.doc, ps) : null;   // 同一對父母的子女才能設雙胞胎
    const relLabel = labelOf(GT.EMOTION_TYPES, state.relType);
    // 選了一個生活圈＋幾個人：可以直接把人加進去（不會拖曳的人也做得到）
    const hs = ids.filter(x => state.doc.households[x]);
    const joinable = hs.length === 1 ? ps.filter(x => !state.doc.households[hs[0]].members.includes(x)) : [];
    P.innerHTML = `
    <section class="card"><div class="card__header"><h2 class="card__title">已選取 ${ids.length} 個項目</h2></div>
      <div class="help">其中 ${ps.length} 個人。按住 Shift 點選或拖曳框選可以加選。</div>
      <div class="stack-2 toolgroup__rows">
        ${ps.length === 2 ? `<button class="btn btn--block" data-m="partner">連結為伴侶</button><button class="btn btn--block" data-m="relation">建立情感關係（${esc(relLabel)}）</button>` : ''}
        ${joinable.length ? `<button class="btn btn--block" data-m="join">把選取的 ${joinable.length} 人加入這個生活圈</button>` : ''}
        ${ps.length ? '<button class="btn btn--block" data-m="household">圈成生活圈（同住）</button>' : ''}
        ${ids.filter(id => GT.tieEndExists(state.doc, id)).length === 2 ? '<button class="btn btn--block" data-m="tie">建立生態連結</button>' : ''}
        ${ps.length > 1 ? '<button class="btn btn--block" data-m="alignY">對齊成同一列（同一代）</button>' : ''}
        <button class="btn btn--danger btn--block" data-m="delete">刪除選取的項目</button>
      </div>
    </section>
    ${twinU ? `<section class="card"><div class="card__header"><h2 class="card__title">設為雙胞胎</h2></div>
      <div class="help">這 ${ps.length} 人是同一對父母的子女。</div>
      <div class="stack-2 toolgroup__rows">${GT.TWIN_KINDS.map(k => `<button class="btn btn--block" data-twin="${k.key}">${esc(k.label)}</button>`).join('')}</div>
    </section>` : ''}`;
    P.querySelectorAll('[data-twin]').forEach(b => b.addEventListener('click', () => {
      const cur = GT.twinGroupOf(state.doc, ps[0]);                          // 已經是同一組、同一種＝不要留下空的復原步驟
      if (cur && cur.group.kind === b.dataset.twin && cur.group.ids.length === ps.length && ps.every(x => cur.group.ids.includes(x))) {
        toast('他們已經是這一種雙胞胎了。'); return;
      }
      const ok = mutate(d => GT.setTwins(d, twinU.id, ps, b.dataset.twin), { keepPanel: true });
      if (ok) toast('已設為雙胞胎。點其中一人，可以在「家庭」改類型或取消。', 'ok');
      else notice('沒有設定成功：雙胞胎必須是同一對父母的子女。');
    }));
    P.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => {
      const m = b.dataset.m;
      if (m === 'partner') { const uid = mutate(d => GT.linkPartners(d, ps[0], ps[1])); select([uid]); }
      else if (m === 'relation') { const rid = mutate(d => GT.addRelation(d, ps[0], ps[1], state.relType)); select([rid]); }
      else if (m === 'household') circleHousehold(ps);
      else if (m === 'join') {
        const moved = joinable.some(x => GT.householdOf(state.doc, x));
        mutate(d => GT.joinHousehold(d, hs[0], joinable)); select([hs[0]]);
        toast(moved ? '已加入；本來住在別的生活圈的人已經從那裡移出（按 Ctrl+Z 可以復原）。' : '已加入（按 Ctrl+Z 可以復原）。', 'ok', 6000);
      }
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
    <section class="card"><div class="card__header"><h2 class="card__title">這張家系圖</h2></div>
      <div class="field"><label for="meta-caseNo">個案編號（選填；存檔的預設檔名會用到）</label>
      <input type="text" class="input" id="meta-caseNo" data-meta="caseNo" value="${esc(m.caseNo || '')}" maxlength="40" placeholder="例：A113-0921">
      <p class="help" id="fileHint">預設檔名：${esc(GT.defaultFileName(state.doc, '.json'))}（不會放姓名）</p></div>
      <div class="field"><label for="meta-title">標題（選填，給自己辨認用）</label>
      <input type="text" class="input" id="meta-title" data-meta="title" value="${esc(m.title)}" maxlength="100" placeholder="例：第一次家訪"></div>
      <div class="field"><label for="assessDate">評估日期</label>
      <input type="date" class="input" id="assessDate" value="${esc(dateVal)}"></div>
      <p class="help">圖上的年齡以這個日期計算。兩年後重開這個檔，年齡仍會跟當時的紀錄一致。</p>
    </section>
    <section class="card"><div class="card__header"><h2 class="card__title">小技巧</h2></div>
      <ul class="help" style="padding-left:18px;margin:0">
        <li>點人物，在右邊填年齡、職業、經濟，圖會即時更新。</li>
        <li>在空白處按住左鍵拖曳可以框選多個人；按住 <b>Shift</b> 點選或框選可以加選。</li>
        <li>移動畫面：按住<b>空白鍵</b>拖曳，或按住滑鼠中鍵拖曳；滾輪上下捲動，<b>Shift</b>＋滾輪左右捲動。</li>
        <li><b>Ctrl</b>＋滾輪放大縮小。</li>
        <li><b>Ctrl+Z</b> 復原、<b>Ctrl+S</b> 儲存、<b>Delete</b> 刪除。</li>
        <li>「複製圖片」後到 Word 按 <b>Ctrl+V</b> 就能貼上。</li>
      </ul>
    </section>`;
    bindLive(P.querySelector('[data-meta=title]'), (d, v) => { d.meta.title = v.slice(0, 100); });
    bindLive(P.querySelector('[data-meta=caseNo]'), (d, v) => { d.meta.caseNo = v.slice(0, 40); },
             () => { $('fileHint').textContent = `預設檔名：${GT.defaultFileName(state.doc, '.json')}（不會放姓名）`; });
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
    return `<section class="card"><div class="card__header"><h2 class="card__title">生態連結</h2><span class="card__aside">${ts.length} 條</span></div>
      ${ts.map(t => `<div class="childrow"><span>${esc(nodeName(otherEnd(t, id)))}${t.note ? `<span class="text-muted">・${esc(t.note)}</span>` : ''}</span>` +
        `<button class="btn" data-goto="${esc(t.id)}">選這條線</button></div>`).join('') || '<div class="text-muted">還沒有連結。</div>'}
      <button class="btn btn--block toolgroup__rows" data-tiefrom>從這裡拉一條生態連結…</button>
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
    <section class="card"><div class="card__header"><h2 class="card__title">資源（外部系統）</h2></div>
      <div class="field"><label for="s-name">名稱<span class="hint">寫在圓裡面</span></label>
      <input type="text" class="input" id="s-name" data-sname data-autofocus value="${esc(s.name)}" maxlength="30" placeholder="例：○○國小、家防中心"></div>
      <p class="help">字多會自動換行，圓也會跟著變大；建議寫簡稱。</p>
    </section>
    ${tieListHTML(id, 2)}
    <section class="card"><button class="btn btn--danger btn--block" data-del>刪除這個資源（線會一起刪）</button></section>`;
    bindLive(P.querySelector('[data-sname]'), (dd, v) => { dd.systems[id].name = v.slice(0, 30); });
    bindTieList(P, id);
    P.querySelector('[data-del]').addEventListener('click', deleteSelection);
  }

  function panelTie(P, id) {
    const t = state.doc.ties[id];
    const arrow = { a2b: dirIcon('arrow-right', '流向'), b2a: dirIcon('arrow-left', '來自'), both: dirIcon('move-horizontal', '互相') }[t.dir] || '與';
    P.innerHTML = `
    <section class="card"><div class="card__header"><h2 class="card__title">生態連結</h2></div>
      <div class="kin"><b>${esc(nodeName(t.a))}</b> ${arrow} <b>${esc(nodeName(t.b))}</b></div>
      <fieldset class="field"><legend>關係強度<span class="hint">強＝雙線、弱＝虛線</span></legend>
      ${segHTML('strength', GT.TIE_STRENGTHS, t.strength)}</fieldset>
      <label class="check"><input type="checkbox" data-tstress${t.stress ? ' checked' : ''}><span>有壓力／衝突（畫成鋸齒線）</span></label>
      <fieldset class="field"><legend>流向<span class="hint">資源或能量往哪邊</span></legend>
      ${segHTML('dir', GT.TIE_DIRS, t.dir)}</fieldset>
      <div class="field"><label for="t-note">線上寫一件事（選填）</label>
      <input type="text" class="input" id="t-note" data-tnote data-autofocus value="${esc(t.note)}" maxlength="60" placeholder="例：通報 2025-03、保護令、每週送餐"></div>
      <button class="btn btn--block toolgroup__rows" data-tswap>對調兩端</button>
    </section>
    <section class="card"><button class="btn btn--danger btn--block" data-del>刪除這條線</button></section>`;
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

  // 自動排版（使用者 2026-10-28：要不要用由使用者決定）→ 只在按下並確認後執行，一次復原就回去
  function openAutoLayout() {
    if (Object.keys(state.doc.persons).length < 2) { toast('圖上至少要有兩個人才需要排版。', 'warn'); return; }
    if (R.viewMode(state.doc) === 'ecomap') { toast('生態圖模式看不到每個人的位置。請先在「顯示」切到「家系圖＋生態圖」或「只看家系圖」。', 'warn', 6000); return; }
    dialog('自動排版', `<div class="help-doc">
      <p>依世代和家庭關係，重新排列<b>所有人</b>的位置：</p>
      <ul><li>同一代排在同一列，伴侶相鄰。</li><li>子女排在父母下方；多段婚姻照「前任—本人—現任」排。</li>
      <li>資源圓和文字說明會跟著整張圖移動。</li></ul>
      <p class="help">排完不滿意，按「復原」（Ctrl+Z）就回到原來的樣子；也可以排完再手動拖曳微調。</p></div>`,
      [{ label: '取消' }, { label: '開始排版', primary: true, onClick: () => {
        if (state.pending) cancelPending();
        mutate(d => GT.layout.autoLayout(d));
        fitView();
        toast('已重新排版。不滿意可以按復原（Ctrl+Z）。', 'ok', 6000);
      } }]);
  }

  // 新增資源：先選大類、再選項目（跟關係選擇器同一種操作）
  function openSystemPicker() {
    const body = dialog('新增資源（外部系統）',
      `<p class="help">先點上排的大類，再點要加的資源。加進去之後可以改名稱，例如把「學校」改成「○○國小」。</p>` +
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
    dlg.classList.toggle('dialog--wide', !!(opts && opts.wide));        // 使用說明、圖例用寬版
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
      el.className = 'btn' + (b.primary ? ' btn--primary' : '');
      el.addEventListener('click', () => { dlg.close(); if (b.onClick) b.onClick(); });
      foot.appendChild(el);
    }
    if (!dlg.open) dlg.showModal();
    return $('dlgBody');
  }

  function openFieldManager() {
    const body = dialog('管理欄位', `
      <p class="help">這些欄位會出現在每個人的「其他資料」裡；打勾的會顯示在圖上。<br>改名只改顯示名稱，已經填的資料不會受影響。</p>
      <div id="fmList"></div>
      <div class="input-group toolgroup__rows">
        <label class="sr-only" for="fmNew">新欄位名稱</label>
        <input type="text" class="input" id="fmNew" placeholder="例：宗教、居住地、身分別" maxlength="20">
        <button class="btn" id="fmAdd">新增欄位</button>
      </div>`, [{ label: '完成', primary: true }]);
    // 驗證訊息寫在出問題的欄位正下方，欄位標成不合格（審查 2026-10-28 M8：原本是 toast，跑到對話框的遮罩底下）
    const clearFieldError = () => {
      body.querySelectorAll('.field__error').forEach(x => x.remove());
      body.querySelectorAll('[aria-invalid]').forEach(x => { x.removeAttribute('aria-invalid'); x.removeAttribute('aria-describedby'); });
    };
    const fieldError = (inp, msg) => {
      clearFieldError();
      const p = document.createElement('p');
      p.className = 'field__error'; p.id = 'fmErr'; p.setAttribute('role', 'alert'); p.textContent = msg;
      inp.closest('.fieldrow, .input-group').after(p);
      inp.setAttribute('aria-invalid', 'true'); inp.setAttribute('aria-describedby', 'fmErr');
      inp.focus();
    };
    const draw = () => {
      const fs = state.doc.settings.fields;
      $('fmList').innerHTML = fs.map((f, i) => `
        <div class="fieldrow">
          <label class="check"><input type="checkbox" data-fs="${esc(f.key)}"${f.show ? ' checked' : ''} aria-label="在圖上顯示「${esc(f.label)}」"></label>
          <input type="text" class="input" data-fr="${esc(f.key)}" value="${esc(f.label)}" maxlength="20" aria-label="欄位名稱">
          <span class="n">${GT.fieldUsage(state.doc, f.key)} 人填</span>
          <span class="ops"><button class="btn" data-fu="${esc(f.key)}"${i === 0 ? ' disabled' : ''} aria-label="往上移">${ico('chevron-up', 16)}</button>` +
          `<button class="btn" data-fd="${esc(f.key)}"${i === fs.length - 1 ? ' disabled' : ''} aria-label="往下移">${ico('chevron-down', 16)}</button>` +
          `<button class="btn btn--danger" data-fx="${esc(f.key)}">刪除</button></span>
        </div>`).join('') || '<div class="text-muted">目前沒有欄位。</div>';
    };
    draw();
    body.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.fs) mutate(d => { d.settings.fields.find(f => f.key === t.dataset.fs).show = t.checked; });
      else if (t.dataset.fr) {
        const ok = GT.renameField(GT.clone(state.doc), t.dataset.fr, t.value);
        if (!ok) { fieldError(t, '欄位名稱不能空白，也不能跟其他欄位重複。請改一個名稱。'); return; }
        clearFieldError();
        mutate(d => GT.renameField(d, t.dataset.fr, t.value));
      }
    });
    body.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.id === 'fmAdd') {
        const name = $('fmNew').value;
        if (!GT.addField(GT.clone(state.doc), name)) { fieldError($('fmNew'), '請輸入欄位名稱，不能空白，也不能跟現有欄位重複。'); return; }
        clearFieldError();
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
    const row = ([svg, label, key, special]) => `<div>${svg}</div><div><b>${esc(label)}</b>` +
      (special ? ' <span class="badge badge--accent">圖上標名稱</span>' : '') +
      (key && D[key] ? `<div class="desc">${esc(D[key])}</div>` : '') + '</div>';
    const sym = (over, g) => {
      const d = GT.newDoc(); d.settings.colorRelations = colored;
      const id = GT.addPerson(d, { gender: g || 'M', x: 0, y: 0 });
      Object.assign(d.persons[id], over);
      return R.symbolSVG(d, d.persons[id], 34);
    };
    const grid = (rows) => `<div class="legend">${rows.map(row).join('')}</div>`;
    const byCat = (types, cats, kind) => cats.map(c => `<h3 class="lh">${esc(c.label)}</h3>` +
      grid(types.filter(t => t.cat === c.key && t.sheet !== false)
        .map(t => [R.sampleSVG(kind, t.key, colored), t.label, t.key, GT.isSpecialLine(t.key)]))).join('');
    const special = '<p class="help">標「圖上標名稱」的線比較少見，畫在圖上時會自動在線旁寫出名稱（左邊「顯示設定」可以關掉）。</p>';
    const tabs = [
      { key: 'person', label: '人物', html: grid([
        [sym({}, 'M'), '男性', 'sym:M'], [sym({}, 'F'), '女性', 'sym:F'], [sym({}, 'U'), '未知性別', 'sym:U'], [sym({}, 'P'), '寵物', 'sym:P'],
        [sym({ index: true }), '服務使用者（指標人物）：粗框灰底', 'sym:index'], [sym({ deceased: true }), '已歿：打叉', 'sym:deceased'],
        [sym({ life: 'pregnancy' }, 'U'), '懷孕', 'life:pregnancy'], [sym({ life: 'miscarriage' }, 'U'), '流產', 'life:miscarriage'],
        [sym({ life: 'abortion' }, 'U'), '墮胎', 'life:abortion'],
        [sym({ culture: 'immigration' }), '移民', 'culture:immigration'], [sym({ culture: 'multiple' }), '住過兩個以上的文化地區', 'culture:multiple'],
      ]) + '<p class="help">符號中間的數字＝年齡；已歿的人是過世時的年齡。</p>' },
      { key: 'health', label: '成癮與疾病', html: grid([
        [sym({ illness: 'active' }), '身體或精神疾病（左半）', 'health:illness'],
        [sym({ substance: 'active' }), '酒精或藥物濫用（下半）', 'health:substance'],
        [sym({ substance: 'suspected' }), '疑似酒精或藥物濫用（灰色）', 'health:suspected'],
        [sym({ illness: 'active', substance: 'active' }), '疾病合併酒精或藥物濫用', 'health:both'],
        [sym({ illness: 'recovery' }), '疾病復原中', 'health:illrec'], [sym({ substance: 'recovery' }), '濫用復原中', 'health:subrec'],
        [sym({ illness: 'recovery', substance: 'recovery' }), '兩者都在復原中', 'health:bothrec'],
        [sym({ illness: 'active', substance: 'recovery' }), '濫用復原中，但有疾病', 'health:ill-subrec'],
        [sym({ illness: 'recovery', substance: 'active' }), '疾病復原中，但有濫用', 'health:illrec-sub'],
      ]) + '<h3 class="lh">疾病別（顏色填在左上角）與成癮（外框顏色）</h3>' + grid(GT.CONDITIONS.map(c =>
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
      ]) + '<p class="help">線停在生活圈的虛線框＝連到整個家庭；線穿進去連到某個人＝只跟那個人有關。</p>' },
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
      <div class="help-doc" id="helpBody"></div>
      <p class="text-muted" style="margin-top:12px">版本 ${esc(APP_VERSION)}（${esc(BUILD)}）｜作者 王錫凡（GW-TW）｜僅限公益用途，不開放商業使用｜聯絡 amber31345@gmail.com</p>`,
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

  // 關於這個工具：CRPD 精神、作者、聯絡方式、授權（使用者 2026-10-28：作者資訊放在「使用說明」旁邊）
  function openAbout() {
    const c = GT.manual.MANUAL.find(x => x.key === 'about');
    dialog('關於這個工具', `<div class="help-doc">${GT.manual.render(c.body)}</div>
      <p class="text-muted" style="margin-top:12px">版本 ${esc(APP_VERSION)}（${esc(BUILD)}）</p>`,
      [{ label: '看使用說明', onClick: () => openHelp() }, { label: '關閉', primary: true }]);
  }

  // ───── 檔案 ─────
  const TYPES_JSON = [{ description: '家系圖檔案', accept: { 'application/json': ['.json'] } }];

  const confirmDiscard = () => !state.dirty || confirm('目前的圖還沒儲存，確定要放棄這些變更嗎？');

  function setDoc(doc, o) {
    state.doc = doc; state.history.clear(); state.sel = new Set();
    if (state.pending) cancelPending();
    state.handle = o.handle || null; state.fileName = o.fileName || ''; if (o.dirty) { state.dirty = true; state.savedJSON = null; } else markSaved();
    renderAll(); fitView();
  }

  // 開檔大小上限（驗收發現：原本整個檔案無條件讀進記憶體）；本工具的 .json 不會超過數 MB
  const MAX_JSON_FILE = 30 * 1024 * 1024;

  async function loadFile(file, handle) {
    // GenoPro 的 .gno 檔不再支援（使用者 2026-09-21 決定拿掉匯入）：講清楚原因，不要讓人以為檔案壞了
    if (/\.gno$/i.test(file.name)) { notice('這個工具不支援 GenoPro 的 .gno 檔，請用 GenoPro 開啟。', '無法開啟'); return; }
    if (file.size > MAX_JSON_FILE) { showError(GT.fail('TOO_LARGE', new Error(`file size ${file.size}`))); return; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let parsed;
    try { parsed = GT.normalizeDoc(JSON.parse(new TextDecoder('utf-8').decode(bytes))); }
    catch (e) { showError(GT.fail('OPEN', e)); return; }
    setDoc(parsed.doc, { handle, fileName: file.name, dirty: false });
    const merged = parsed.warnings.filter(w => w === 'household-merged').length, skipped = parsed.warnings.length - merged;
    if (parsed.warnings.length) {
      notice([skipped ? `有 ${skipped} 筆資料不完整，已略過` : '',
              merged ? `有 ${merged} 個生活圈跟別的生活圈有同一個人，已合併成一個（一個人只能住在一個生活圈）` : '']
        .filter(Boolean).join('；') + '；其他內容已正常開啟。建議先另存新檔，保留原來的檔案。', skipped ? '部分資料略過' : '生活圈已合併');
    }
    else toast('已開啟。', 'ok');
  }

  async function openFile() {
    if (!confirmDiscard()) return;
    if (window.showOpenFilePicker) {
      let h;
      try { [h] = await window.showOpenFilePicker({ types: TYPES_JSON, multiple: false }); }
      catch (e) { if (e && e.name === 'AbortError') return; throw e; }
      await loadFile(await h.getFile(), h);
    } else { $('fileInput').value = ''; $('fileInput').click(); }
  }

  const suggestName = (ext) => GT.defaultFileName(state.doc, ext);   // 個案編號_家系生態圖_建立日期（不放姓名）
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
    const ids = [...state.sel].filter(id => id !== GT.FAMILY_ID), np = ids.filter(id => state.doc.persons[id]).length;
    if (!ids.length) { toast('「家庭」圓代表整個家庭，不能刪除。', 'warn'); return; }
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
    const ids = [...state.sel].filter(movable);
    if (!ids.length) return;
    mutate(d => GT.moveItems(d, ids, dx, dy), { keepPanel: !ids.includes(GT.FAMILY_ID) });
  }

  function renderChrome() {
    const n = Object.keys(state.doc.persons).length;
    $('fileLabel').innerHTML = `<span class="name"></span>${state.dirty ? '<span class="badge badge--warn">未儲存</span>' : ''}`;
    $('fileLabel').firstElementChild.textContent = state.fileName || '未命名';
    $('fileLabel').firstElementChild.title = state.fileName || '';           // 檔名太長被截斷時，滑過去看得到全名
    document.title = (state.dirty ? '未儲存｜' : '') + (state.fileName || '未命名') + ' — 家系圖工具';
    const ns = Object.keys(state.doc.systems).length;
    $('stCount').textContent = `${n} 人` + (ns ? `、${ns} 個資源` : '');
    $('stDate').textContent = `評估日期 ${state.doc.meta.assessDate}（年齡以此計算）`;
    $('btnUndo').disabled = !state.history.canUndo;
    $('btnRedo').disabled = !state.history.canRedo;
    $('btnDelete').disabled = ![...state.sel].some(id => id !== GT.FAMILY_ID);
    renderTools();
  }

  // ───── 綁定 ─────
  function bind() {
    document.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => addPersonAtCenter(b.dataset.add)));
    document.querySelectorAll('[data-kin]').forEach(b => b.addEventListener('click', () => onKin(b.dataset.kin)));
    $('viewModes').innerHTML = GT.VIEW_MODES.map(v =>
      `<label class="check"><input type="radio" name="viewMode" value="${esc(v.key)}"><span>${esc(v.label)}</span></label>`).join('');
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
      circleHousehold(ps);
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
    $('btnLayout').addEventListener('click', openAutoLayout);

    // 圖示（Lucide 風格的內嵌 SVG；設計規範：不要用 emoji 或符號當圖示）
    const setIcon = (id, name) => { const el = $(id); if (el) el.insertAdjacentHTML('afterbegin', ico(name)); };
    setIcon('btnUndo', 'undo-2'); setIcon('btnRedo', 'redo-2'); setIcon('btnDelete', 'trash-2');
    setIcon('zoomIn', 'zoom-in'); setIcon('zoomOut', 'zoom-out');
    setIcon('errorClose', 'x');
    $('stSafe').insertAdjacentHTML('afterbegin', ico('lock-keyhole', 16));
    $('errorClose').addEventListener('click', clearError);
    $('errorRetry').addEventListener('click', () => { const f = retryFn; clearError(); if (f) f(); });
    setIcon('errorRetry', 'rotate-ccw');
    // 加號按鈕（側欄）：圖示放在文字前面
    document.querySelectorAll('#tools [data-plus]').forEach(b => b.insertAdjacentHTML('afterbegin', ico('plus', 16)));

    // 配色：跟隨系統 → 淺色 → 深色（只放在這次開啟的視窗裡，不寫進瀏覽器儲存）
    const THEMES = [
      { key: '', label: '跟隨系統', icon: 'monitor' },
      { key: 'light', label: '淺色', icon: 'sun' },
      { key: 'dark', label: '深色', icon: 'moon' },
    ];
    let themeIx = 0;
    const applyTheme = () => {
      const t = THEMES[themeIx];
      if (t.key) document.documentElement.setAttribute('data-theme', t.key);
      else document.documentElement.removeAttribute('data-theme');
      $('btnTheme').innerHTML = ico(t.icon);
      $('btnTheme').dataset.tip = `配色：${t.label}`;
      $('btnTheme').setAttribute('aria-label', `配色：${t.label}（按一下換下一種）`);
    };
    applyTheme();
    $('btnTheme').addEventListener('click', () => { themeIx = (themeIx + 1) % THEMES.length; applyTheme(); });

    // 匯出選單
    const exportMenu = $('exportMenu');
    const closeExport = () => { exportMenu.hidden = true; $('btnExport').setAttribute('aria-expanded', 'false'); };
    $('btnExport').addEventListener('click', (e) => {
      e.stopPropagation();
      const open = exportMenu.hidden;
      exportMenu.hidden = !open;
      $('btnExport').setAttribute('aria-expanded', String(open));
    });
    // 一般的「按鈕＋展開清單」（審查 2026-10-28 M5：原本宣告成 ARIA 選單卻沒有選單的鍵盤行為）
    const exportItems = () => [...exportMenu.querySelectorAll('button')];
    exportMenu.addEventListener('click', (e) => { closeExport(); if (e.detail === 0) $('btnExport').focus(); });   // 鍵盤選的：焦點回到「匯出」
    document.addEventListener('click', (e) => { if (!exportMenu.hidden && !e.target.closest('.menu')) closeExport(); });
    $('btnExport').closest('.menu').addEventListener('focusout', (e) => {
      if (!exportMenu.hidden && !(e.relatedTarget && e.target.closest('.menu').contains(e.relatedTarget))) closeExport();
    });
    $('btnExport').closest('.menu').addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !exportMenu.hidden) { e.preventDefault(); e.stopPropagation(); closeExport(); $('btnExport').focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault(); e.stopPropagation();
      if (exportMenu.hidden) $('btnExport').click();
      const items = exportItems(), i = items.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
      items[next].focus();
    });

    $('btnNew').addEventListener('click', () => { if (confirmDiscard()) setDoc(GT.newDoc(), { dirty: false }); });
    $('btnOpen').addEventListener('click', () => act('OPEN', openFile));
    $('fileInput').addEventListener('change', () => { const f = $('fileInput').files[0]; if (f) act('OPEN', () => loadFile(f, null)); });
    $('btnSave').addEventListener('click', () => act('SAVE', () => save(false)));
    $('btnSaveAs').addEventListener('click', () => act('SAVE', () => save(true)));
    // 產生 PNG 要一點時間：這段期間「匯出」顯示處理中、不能再按（審查 2026-10-28 L7：原本沒有處理中狀態）
    const busy = async (fn) => {
      const b = $('btnExport'), label = b.textContent;
      b.disabled = true; b.setAttribute('aria-busy', 'true'); b.textContent = '處理中…';
      try { return await fn(); } finally { b.disabled = false; b.removeAttribute('aria-busy'); b.textContent = label; }
    };
    $('btnPng').addEventListener('click', () => act('EXPORT', async () => {
      if (isEmpty()) { toast('圖上還沒有內容。', 'warn'); return; }
      const blob = await busy(pngBlob);
      if (await saveBlob(blob, suggestName('.png'), [{ description: 'PNG 圖檔', accept: { 'image/png': ['.png'] } }]))
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
      const blob = await busy(pngBlob);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('已複製圖片，到 Word 按 Ctrl+V 貼上。', 'ok');
    }));
    $('btnHelp').addEventListener('click', () => openHelp());
    $('btnAbout').addEventListener('click', openAbout);
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
      const ae = document.activeElement;
      const onControl = ae && /^(BUTTON|SUMMARY|A)$/.test(ae.tagName);
      if (onControl && (key === 'delete' || key === 'backspace' || key.startsWith('arrow'))) return;
      if (e.code === 'Space') {
        // 焦點在按鈕／摺疊標題／連結上時，空白鍵是「啟動它」（鍵盤操作的人靠這個）：不攔截
        // 用滑鼠點過的按鈕不會保留焦點（見下方 click 監聽），所以滑鼠使用者按空白鍵照樣是平移
        if (onControl) return;
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
      // 拖曳（使用者 2026-10-28）：在真的畫面上按住、移動、放開
      const scr = (wx, wy) => ({ x: state.view.x + wx * state.view.k, y: state.view.y + wy * state.view.k });
      const ptr = (type, p, target) => (target || canvas).dispatchEvent(new PointerEvent(type, { clientX: cr.left + p.x, clientY: cr.top + p.y,
        button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 7, bubbles: true }));
      const dragEl = (sel, from, to, beforeUp) => {
        ptr('pointerdown', from, $('world').querySelector(sel));
        ptr('pointermove', { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }); ptr('pointermove', to);
        if (beforeUp) beforeUp();
        ptr('pointerup', to);
      };
      // 資源圓拖得動（原本拖不動，新增時的提示卻說可以拖）
      const sys = state.doc.systems[sysId], s0 = { x: sys.x, y: sys.y };
      dragEl(`[data-id="${sysId}"]`, scr(s0.x, s0.y), scr(s0.x + 60, s0.y + 40));
      checks.sysdrag = Math.abs(sys.x - s0.x - 60) <= 10 && Math.abs(sys.y - s0.y - 40) <= 10;
      // 生態圖模式的家庭圓拖得動；面板可以回到自動位置
      document.querySelector('input[name=viewMode][value=ecomap]').click();
      const f0 = GT.familyAt(state.doc);
      dragEl('.famnode', scr(f0.x, f0.y), scr(f0.x + 80, f0.y - 50));
      const fp = state.doc.familyPos;
      const famMoved = !!fp && Math.abs(fp.x - f0.x - 80) <= 10 && Math.abs(fp.y - f0.y + 50) <= 10 && state.sel.has(GT.FAMILY_ID);
      const reset = document.querySelector('#props [data-famreset]');
      if (reset) reset.click();
      checks.famdrag = famMoved && !!reset && state.doc.familyPos === null;
      document.querySelector('input[name=viewMode][value=both]').click();
      // 把人拖進生活圈：經過時圈會亮、放開後問「加入」、按了才加入；面板可以移出
      const hid = mutate(d => GT.addHousehold(d, [a], '同住'));
      const q = Object.keys(state.doc.persons).find(x => x !== a && !GT.parentUnionOf(state.doc, x));
      const pa = state.doc.persons[a], pq = state.doc.persons[q];
      let lit = false;
      dragEl(`[data-id="${q}"]`, scr(pq.x, pq.y), scr(pa.x + 25, pa.y), () => { renderCanvas(); lit = $('world').innerHTML.includes('class="droptarget"'); });
      const askBtn = [...document.querySelectorAll('#toasts .toast__action')].pop();
      const notYet = !state.doc.households[hid].members.includes(q);
      if (askBtn) askBtn.click();
      const joined = state.doc.households[hid].members.includes(q) && !$('world').innerHTML.includes('class="droptarget"');
      const outBtn = document.querySelector(`#props [data-hout="${q}"]`);
      if (outBtn) outBtn.click();
      checks.hhjoin = lit && !!askBtn && askBtn.textContent === '加入' && notYet && joined && askBtn.getBoundingClientRect().height === 0;
      checks.hhleave = !!outBtn && !state.doc.households[hid].members.includes(q) && state.doc.households[hid].members.includes(a);
      // 一個人只能在一個生活圈（使用者 2026-10-28）：原本 a 一人，再圈 a、q → 併進原本的圈（同一個 id，連線不掉）；
      // a、q 同住，又圈 a、r（只選到一部分）→ 先問；選「合併成一個」→ 一個圈三個人
      select([a, q]); $('btnHousehold').click();
      const hs1 = Object.values(state.doc.households);
      const superset = hs1.length === 1 && hs1[0].id === hid && hs1[0].members.length === 2 && !$('dlg').open;
      const r3 = Object.keys(state.doc.persons).find(x => x !== a && x !== q);
      select([a, r3]); $('btnHousehold').click();
      const askedMerge = $('dlg').open && $('dlgTitle').textContent === '這些人已經有生活圈';
      const mergeBtn = [...$('dlgFoot').querySelectorAll('button')].find(b => b.textContent.startsWith('合併成一個'));
      if (mergeBtn) mergeBtn.click();
      const hs2 = Object.values(state.doc.households);
      checks.hhunique = superset && askedMerge && hs2.length === 1 && hs2[0].id === hid && hs2[0].members.length === 3 &&
        Object.keys(state.doc.persons).every(p => hs2.filter(h => h.members.includes(p)).length <= 1);
      // 自動排版：要確認才排；排完不重疊；一次復原回到原樣
      const beforeLayout = JSON.stringify(state.doc);
      $('btnLayout').click();
      const asked = $('dlg').open && $('dlgTitle').textContent === '自動排版' && JSON.stringify(state.doc) === beforeLayout;
      [...$('dlgFoot').querySelectorAll('button')].find(b => b.textContent === '開始排版').click();
      const laid = Object.values(state.doc.persons);
      const apart = laid.every(p => laid.every(o => o === p || o.y !== p.y || Math.abs(o.x - p.x) >= 60));
      const changed = JSON.stringify(state.doc) !== beforeLayout;
      undo();
      checks.autolayout = asked && changed && apart && !$('dlg').open && JSON.stringify(state.doc) === beforeLayout;
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
      // 授權標示（使用者 2026-10-28：作者王錫凡、僅限公益用途、不開放商業使用、聯絡信箱）
      checks.license = ['王錫凡', '僅限公益用途', '不開放商業使用', 'amber31345@gmail.com'].every(w => $('dlgBody').textContent.includes(w));
      $('dlg').close();
      // 作者資訊在「使用說明」旁邊，打開是「關於這個工具」：CRPD 精神、作者、聯絡、授權
      const ab = $('btnAbout'), hb = $('btnHelp');
      const nextToHelp = hb.nextElementSibling === ab && ab.textContent.includes('王錫凡');
      ab.click();
      checks.about = nextToHelp && $('dlg').open && $('dlgTitle').textContent === '關於這個工具' &&
                     ['CRPD', '王錫凡', 'amber31345@gmail.com', '僅限公益用途', '不開放商業使用'].every(w => $('dlgBody').textContent.includes(w));
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
      checks.helpcss = !!helpUl && parseFloat(getComputedStyle(helpUl).marginBottom) >= 8;
      $('dlg').close();
      // 不再支援 .gno（使用者 2026-09-21 拿掉匯入）：開 .gno 要說清楚原因，目前的圖不能被動到
      const beforeGno = JSON.stringify(state.doc);
      await loadFile(new File(['<GenoPro></GenoPro>'], '舊個案.gno'), null);
      // 審查 2026-10-28 M8：「沒辦法開」要留在畫面上（提示框），不是幾秒就消失的 toast；也不算程式錯誤
      checks.gnorefused = JSON.stringify(state.doc) === beforeGno && !$('errorBar').hidden &&
                          $('errorText').textContent.includes('不支援 GenoPro') && $('errorBar').classList.contains('alert--warn') &&
                          ![...document.querySelectorAll('.toast')].some(t => t.textContent.includes('不支援 GenoPro')) &&
                          document.body.dataset.errors === undefined;
      clearError();
      // 用詞統一為「服務使用者」（使用者 2026-10-28）：人物面板、整個畫面、圖例都不可以再出現舊用詞
      // （舊用詞拆開寫，程式碼裡才不會殘留；看的是畫面上的字 innerText，不含腳本本身）
      const oldTerms = ['案' + '主', '服務' + '對象'];
      select([a]);
      const panelTerm = $('props').innerText.includes('服務使用者');
      openLegend('person');
      checks.term = panelTerm && $('dlgBody').innerText.includes('服務使用者') &&
                    oldTerms.every(t => !document.body.innerText.includes(t));
      $('dlg').close();
      // 預設檔名：個案編號_家系生態圖_建立日期（使用者 2026-09-21）；面板即時顯示，檔名不放姓名
      select([]);
      const caseInput = document.querySelector('#props [data-meta=caseNo]');
      caseInput.value = 'A001'; caseInput.dispatchEvent(new Event('input'));
      checks.filename = state.doc.meta.caseNo === 'A001' && $('fileHint').textContent.includes('A001_家系生態圖_') &&
                        suggestName('.png').startsWith('A001_家系生態圖_') && !suggestName('.json').includes('測試甲');
      // ── 2026-10-28 改版：配色切換、匯出選單、錯誤改用 alert、觸控目標 ──
      const root = document.documentElement;
      $('btnTheme').click();
      const t1 = root.getAttribute('data-theme');
      $('btnTheme').click();
      const t2 = root.getAttribute('data-theme');
      $('btnTheme').click();
      checks.theme = t1 === 'light' && t2 === 'dark' && !root.hasAttribute('data-theme') &&
                     !!getComputedStyle(root).getPropertyValue('--focus-ring').trim();
      $('btnExport').click();
      const menuOpen = !$('exportMenu').hidden && $('btnExport').getAttribute('aria-expanded') === 'true';
      document.body.click();
      checks.exportmenu = menuOpen && $('exportMenu').hidden;
      // 錯誤用畫布上的 alert，不用 toast（設計規範：不可以用 toast 報錯誤）
      const errs0 = document.body.dataset.errors;        // 可能是 undefined：還原時要整個拿掉，不能留 "0"
      showError({ message: '測試用訊息（代碼 TEST）' });
      const shown = !$('errorBar').hidden && $('errorText').textContent.includes('TEST') &&
                    ![...document.querySelectorAll('.toast')].some(t => t.textContent.includes('TEST'));
      $('errorClose').click();
      if (errs0 === undefined) delete document.body.dataset.errors; else document.body.dataset.errors = errs0;
      checks.erroralert = shown && $('errorBar').hidden;
      // ── 審查 2026-10-28 的守衛 ──
      // 觸控目標 ≥ 44px（設計規範的底線）＋按鈕上不用符號當圖示：逐一走過各種面板、對話框、提示框量
      // （原本只量上列、側欄、工具列的高度；分段按鈕、下拉、勾選區、提示框關閉鈕都漏掉）
      const tiny = [], glyph = [];
      const GLYPH = /[＋←-⇿✓✔✗⚠●▾▸↶↷]|[\uD83C-\uDBFF][\uDC00-\uDFFF]/;
      const inspect = (where) => {
        for (const el of document.querySelectorAll('header button, #tools button, #tools .check, .stage button, #props button, #props select, #props summary, #props .check, #dlg[open] button, #dlg[open] .check, #toasts button')) {
          if (el.offsetParent === null || el.closest('[hidden]')) continue;
          // 量版面尺寸（offset），不量畫面上的框：對話框打開時有 0.98 倍的縮放動畫
          const w = el.offsetWidth, h = el.offsetHeight;
          if (h < 44 || (el.matches('button, select') && w < 44)) tiny.push(`${where}:${el.id || el.dataset.set || el.className || el.tagName}:${w}x${h}`);
          if (el.matches('button') && GLYPH.test(el.textContent)) glyph.push(`${where}:${el.textContent.trim()}`);
        }
      };
      inspect('doc');
      select([a]);
      const accHealth = document.querySelector('#props [data-acc=health]');
      if (accHealth && !accHealth.open) accHealth.querySelector('summary').click();
      inspect('person');
      // 疾病別的顏色小方塊看得到（M3）；分段按鈕的選取態有外框（M4）
      const chip = document.querySelector('#props .conds .check i');
      const pressed = document.querySelector('#props .segmented [aria-pressed="true"]');
      checks.condchip = !!chip && chip.getBoundingClientRect().width >= 10 && !!pressed && getComputedStyle(pressed).boxShadow.includes('inset');
      // 鍵盤按了分段按鈕、面板重畫之後，焦點還在同一顆（M9）
      const gBtn = document.querySelector('#props [data-set=gender][aria-pressed="false"]');
      const gVal = gBtn.dataset.val, g0 = state.doc.persons[a].gender;
      gBtn.focus(); gBtn.click();
      const ae = document.activeElement;
      checks.keepfocus = state.doc.persons[a].gender === gVal && ae && ae.dataset.set === 'gender' && ae.dataset.val === gVal && ae.isConnected;
      document.querySelector(`#props [data-set=gender][data-val="${g0}"]`).click();
      select([u0]); inspect('union');
      select([tieId]); inspect('tie');
      select([a, sysId]); inspect('multi');
      select([hid]); inspect('household');
      openFieldManager(); inspect('fields');
      // 欄位名稱重複：訊息寫在那個欄位下方、欄位標成不合格，不用 toast（M8）
      const fr = [...document.querySelectorAll('#dlg [data-fr]')];
      fr[1].value = fr[0].value; fr[1].dispatchEvent(new Event('change', { bubbles: true }));
      const ferr = document.querySelector('#dlg .field__error');
      checks.fielderror = !!ferr && ferr.previousElementSibling === fr[1].closest('.fieldrow') && fr[1].getAttribute('aria-invalid') === 'true' &&
                          ![...document.querySelectorAll('.toast')].some(t => t.textContent.includes('不能跟其他欄位重複'));
      $('dlg').close();
      notice('測試用提醒'); inspect('alert'); clearError();
      toast('測試用提示', 'info', 3000, { label: '加入', run: () => {} }); inspect('toast');
      checks.tapsize = tiny.length === 0;
      checks.noglyph = glyph.length === 0;
      if (tiny.length || glyph.length) GT.log.push({ time: new Date().toISOString(), ref: 'SELFTEST', code: 'SELFTEST', detail: tiny.concat(glyph).join('; ') });
      // 長對話框：本文自己捲，標題與「關閉」一直看得到（M2）
      openHelp('draw');
      const fr0 = $('dlgFoot').getBoundingClientRect(), hd = document.querySelector('#dlg .dialog__header').getBoundingClientRect();
      checks.dlgfoot = fr0.bottom <= innerHeight && fr0.height > 0 && hd.top >= 0 && $('dlgBody').scrollHeight > $('dlgBody').clientHeight;
      $('dlg').close();
      // 匯出選單的鍵盤：↓ 打開並移到第一項、Esc 關閉且焦點回到「匯出」，而且 Esc 不會順便取消選取（M5）
      select([a]);
      const kd = (el, key) => el.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
      $('btnExport').focus(); kd($('btnExport'), 'ArrowDown');
      const firstItem = document.activeElement === $('exportMenu').querySelector('button') && !$('exportMenu').hidden;
      kd(document.activeElement, 'Escape');
      const escOk = $('exportMenu').hidden && document.activeElement === $('btnExport') && state.sel.has(a);
      kd($('btnExport'), 'Delete');
      checks.exportkeys = firstItem && escOk && !!state.doc.persons[a];          // 焦點在按鈕上按 Delete 不會刪人
      $('btnExport').blur();
      // 對比（M7）：淺色與深色下，頁面文字、側欄輔助文字、側欄的連結按鈕都要 ≥ 4.5:1；深色要真的變深
      const rgb = (c) => (c.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
      const lum = (c) => { const [r, g, b] = rgb(c).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const ratio = (x, y) => { const p = lum(x), q2 = lum(y); return (Math.max(p, q2) + 0.05) / (Math.min(p, q2) + 0.05); };
      const pairs = () => {
        const sb = getComputedStyle($('tools')).backgroundColor, cs = (el) => getComputedStyle(el).color;
        return [ratio(getComputedStyle(document.body).backgroundColor, cs(document.body)), ratio(sb, cs($('kinHint'))),
                ratio(sb, cs(document.querySelector('#tools .sidebar__group'))), ratio(sb, cs($('btnLegend')))];
      };
      const still = document.createElement('style');                // 量的時候先停掉顏色轉場，不然讀到的是轉場中途的顏色
      still.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
      document.head.appendChild(still);
      root.setAttribute('data-theme', 'light'); const light = pairs();
      root.setAttribute('data-theme', 'dark'); const dark = pairs(), darkBg = lum(getComputedStyle(document.body).backgroundColor);
      root.removeAttribute('data-theme');
      still.remove();
      checks.contrast = light.concat(dark).every(r => r >= 4.5) && darkBg < 0.1;
      // 焦點環：按鈕、輸入框、勾選框、摺疊標題、分段按鈕都要有 :focus-visible 的焦點環規則（審查 M11：拿掉焦點環測試照樣全綠）
      const ringRules = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch (_) { return []; } })
        .flatMap(r => r.cssRules ? [r, ...r.cssRules] : [r])
        .filter(r => r.selectorText && r.selectorText.includes(':focus-visible') && /focus-ring/.test(r.style.boxShadow + r.style.outline + r.cssText));
      const ringFor = (sel) => ringRules.some(r => r.selectorText.split(',').some(x => x.trim() === sel));
      checks.focusring = [':focus-visible', '.btn:focus-visible', '.input:focus-visible', '.check input:focus-visible', '.segmented > button:focus-visible'].every(ringFor) &&
                         getComputedStyle(root).getPropertyValue('--focus-ring').includes('0.9');
      // 注入（M11）：所有使用者能打字的地方都塞 HTML，選取每一種項目、開各種對話框，畫面上不能多出任何元素
      // 腳本結尾標籤拆開寫：整段程式要內嵌進 <script>，原字不能出現（build.py 會擋）
      const evil = '<img src=x onerror="window.__pwn=1"></text><scr' + 'ipt>window.__pwn=1</scr' + 'ipt>"><svg onload=window.__pwn=1>';
      const x = GT.newDoc();
      const p1 = GT.addPerson(x, { gender: 'M', x: 0, y: 0 });
      const rp = GT.addPartner(x, p1), kid = GT.addChild(x, rp.unionId, 'F');
      Object.assign(x.persons[p1], { name: evil, birth: evil.slice(0, 20), attrs: { occupation: evil } });
      x.persons[kid].name = evil;
      x.settings.fields[0].label = evil.slice(0, 20);
      x.unions[rp.unionId].note = evil.slice(0, 60);
      const xr = GT.addRelation(x, p1, kid, 'Abuse'); x.relations[xr].note = evil;
      const xh = GT.addHousehold(x, [p1, kid], evil.slice(0, 30));
      const xt = GT.addLabel(x, 0, 300, evil);
      const xs = GT.addSystem(x, { name: evil.slice(0, 30), x: 300, y: 0 });
      const xe = GT.addTie(x, xs, xh, { note: evil.slice(0, 60) });
      Object.assign(x.meta, { caseNo: evil.slice(0, 40), title: evil });
      setDoc(GT.normalizeDoc(JSON.parse(GT.serialize(x))).doc, { fileName: evil.slice(0, 40) + '.json', dirty: true });
      const dirty = [];
      const scan = (where) => {
        for (const sel of ['#props', '#tools', '#dlg', '#fileLabel', '#toasts', '#world', '.stage__notices'])
          for (const el of document.querySelectorAll(`${sel} img, ${sel} script, ${sel} iframe, ${sel} object, ${sel} embed, ${sel} foreignObject, ${sel} [onerror], ${sel} [onload]`))
            dirty.push(`${where}:${sel}:${el.tagName}`);
      };
      for (const id of [null, p1, kid, rp.unionId, xr, xh, xt, xs, xe]) { select(id ? [id] : []); scan(id || 'doc'); }
      select([p1, kid]); scan('multi');
      openLegend('family'); scan('legend'); $('dlg').close();
      openFieldManager(); scan('fields'); $('dlg').close();
      openHelp('draw'); scan('help'); $('dlg').close();
      notice(evil); scan('alert'); clearError();
      toast(evil, 'warn', 1000, { label: evil, run: () => {} }); scan('toast');
      checks.injection = dirty.length === 0 && window.__pwn === undefined &&
                         !/<(img|script|svg)\b/i.test(GT.render.exportSVG(state.doc).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace(/<svg xmlns[^>]*>/g, ''));
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
