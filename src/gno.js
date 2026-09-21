/* 家系圖工具 — gno.js
 * 讀取 GenoPro 的 .gno 檔（＝ZIP 包一個 Data.xml；也接受未壓縮的 XML 匯出檔）並轉成本工具的文件格式。
 * 原則（模式 8：邊界防禦解析）：外部檔案一律視為不可信；認得的轉過來、不認得的欄位變自訂欄位、
 * 不支援的物件計數後寫進匯入報告——不靜默丟資料，也不讓髒資料進到畫布。
 * 本檔載入時不碰 DOM；DOMParser / DecompressionStream 在函式被呼叫時才使用。
 */
(function (GT) {
  'use strict';

  class GnoError extends Error {}
  class GnoLockedError extends GnoError {}
  class GnoTooLargeError extends GnoError {}

  // 上限（驗收發現：原本不設限，壓縮炸彈檔可以讓分頁記憶體耗盡）
  const MAX_XML = 30 * 1024 * 1024;    // Data.xml 解壓後最多 30 MB（上千人的家系圖也只有數 MB）
  const MAX_FIELDS = 40;               // 欄位總數上限（預設 5 個＋匯入的自訂欄位）
  const dict = () => Object.create(null);   // 以外部字串（GenoPro 的 ID）當鍵的查表一律不帶原型
  // 用外部字串查常數表：只認自己的鍵（否則 "constructor" 會查到內建函式，匯入直接崩掉）
  const lookup = (map, k) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : undefined);

  // ── ZIP 讀取（只支援 .gno 會用到的：不加密、stored 或 deflate）──
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

  function zipEntries(bytes) {
    const b = bytes;
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
      if (u32(b, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new GnoError('zip: end of central directory not found');
    const count = u16(b, eocd + 10);
    let p = u32(b, eocd + 16);
    const list = [];
    for (let n = 0; n < count; n++) {
      if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw new GnoError('zip: bad central directory');
      const flags = u16(b, p + 8), method = u16(b, p + 10);
      const csize = u32(b, p + 20), usize = u32(b, p + 24);
      const nlen = u16(b, p + 28), xlen = u16(b, p + 30), clen = u16(b, p + 32);
      const local = u32(b, p + 42);
      const nameBytes = b.subarray(p + 46, p + 46 + nlen);
      const name = new TextDecoder((flags & 0x800) ? 'utf-8' : 'latin1').decode(nameBytes);
      list.push({ name, flags, method, csize, usize, local });
      p += 46 + nlen + xlen + clen;
    }
    return list;
  }

  // 邊解壓邊計數：不相信 ZIP 宣告的大小（可以造假），實際解出來超過上限就中止
  async function inflateRaw(data, limit) {
    const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) { await reader.cancel(); throw new GnoTooLargeError('zip: inflated data exceeds limit'); }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
  }

  async function zipRead(bytes, entry, limit) {
    const b = bytes, o = entry.local, max = limit || MAX_XML;
    if (o + 30 > b.length || u32(b, o) !== 0x04034b50) throw new GnoError('zip: bad local header');
    if (entry.flags & 0x1) throw new GnoLockedError('zip: encrypted entry');
    if (entry.usize > max) throw new GnoTooLargeError('zip: declared size exceeds limit');
    const start = o + 30 + u16(b, o + 26) + u16(b, o + 28);
    const data = b.subarray(start, start + entry.csize);
    if (entry.method === 0) { if (data.length > max) throw new GnoTooLargeError('zip: stored data exceeds limit'); return data; }
    if (entry.method === 8) return inflateRaw(data, max);
    throw new GnoError('zip: unsupported compression method ' + entry.method);
  }

  // 取出 XML 位元組：ZIP 就找 Data.xml（沒有就第一個 .xml）；不是 ZIP 就當成 XML 本身
  async function extractXml(bytes, limit) {
    const max = limit || MAX_XML;
    if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const list = zipEntries(bytes);
      const entry = list.find(e => /(^|\/)data\.xml$/i.test(e.name)) || list.find(e => /\.xml$/i.test(e.name));
      if (!entry) throw new GnoError('zip: no xml entry');
      return zipRead(bytes, entry, max);
    }
    if (bytes.length > max) throw new GnoTooLargeError('xml: exceeds limit');
    return bytes;
  }

  function decodeXml(bytes) {
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return new TextDecoder('utf-8').decode(bytes.subarray(3));
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
    const m = head.match(/encoding=["']([A-Za-z0-9_-]+)["']/);
    let enc = m ? m[1].toLowerCase() : 'utf-8';
    try { return new TextDecoder(enc).decode(bytes); } catch (e) { return new TextDecoder('utf-8').decode(bytes); }
  }

  function parseXml(text) {
    // GenoPro 的 Data.xml 不會有實體宣告；有的話一律拒絕（杜絕實體層層展開把分頁撐爆）
    if (/<!ENTITY/i.test(text)) throw new GnoError('xml: entity declarations are not allowed');
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    if (xml.getElementsByTagName('parsererror').length) throw new GnoError('xml: parse error');
    const root = xml.documentElement;
    if (!root || root.tagName !== 'GenoPro') throw new GnoError('xml: root is not GenoPro');
    return root;
  }

  // ── XML 小工具（GenoPro 用「元素直接文字＋子元素」的混合內容，如 <Position>-305,-15<Top>…</Top></Position>）──
  const kids = (el, name) => el ? Array.from(el.children).filter(c => c.tagName === name) : [];
  const kid = (el, name) => kids(el, name)[0] || null;
  function ownText(el) {
    if (!el) return '';
    let s = '';
    for (const n of el.childNodes) if (n.nodeType === 3 || n.nodeType === 4) s += n.nodeValue;
    return s.trim();
  }
  // 'Birth.Date' → <Birth><Date>…</Date></Birth>；最後一段找不到元素時改找上一層的屬性
  function path(el, dotted) {
    const parts = dotted.split('.');
    let cur = el;
    for (let i = 0; i < parts.length; i++) {
      const next = kid(cur, parts[i]);
      if (!next) return (i === parts.length - 1 && cur && cur.getAttribute && cur.getAttribute(parts[i])) || '';
      cur = next;
    }
    return ownText(cur);
  }

  // ── 日期：GenoPro 常見「28 Aug 2026」「Aug 2026」「2026」「ABT 1950」「BET 1950 AND 1960」──
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function parseGnoDate(s) {
    if (!s) return '';
    let t = String(s).trim().replace(/^(ABT|ABOUT|EST|CAL|BEF|AFT|BET|FROM|TO|CA\.?|~)\s+/i, '').replace(/\s+(AND|TO)\s+.*$/i, '');
    let m;
    if ((m = t.match(/^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{3,4})$/)) && MONTHS[m[2].toLowerCase()])
      return GT.formatDate({ y: +m[3], m: MONTHS[m[2].toLowerCase()], d: +m[1] });
    if ((m = t.match(/^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{3,4})$/)) && MONTHS[m[1].toLowerCase()])
      return GT.formatDate({ y: +m[2], m: MONTHS[m[1].toLowerCase()], d: null });
    if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return GT.formatDate({ y: +m[1], m: +m[2], d: +m[3] });
    if ((m = t.match(/(\d{4})/))) return m[1];
    return '';
  }

  // ── 類型對照：v2 起本工具直接存 GenoPro 代碼（core.js 的 FAMILY_TYPES／EMOTION_TYPES），匯入一對一 ──
  const isFamilyType = (k) => GT.FAMILY_TYPES.some(t => t.key === k);
  const isEmotionType = (k) => k !== 'Caretaker' && GT.EMOTION_TYPES.some(t => t.key === k);   // 看護是社會關係，另外處理
  const CHILD_MAP = { Biological: 'bio', Adopted: 'adopted', Foster: 'foster' };
  const TWIN_MAP = { Fraternal: 'Fraternal', Identical: 'Identical', Unknown: 'Unknown' };
  // GenoPro 把流產、墮胎記在「死因」欄位（CauseOfDeath），參考圖畫成 ●、×
  const LIFE_BY_CAUSE = { Miscarriage: 'miscarriage', Abortion: 'abortion' };
  // 移民／多元文化在 GenoPro 是「特殊符號」；檔案裡的寫法尚未用真實檔確認，先接受兩種常見拼法
  const CULTURE_MAP = { Immigration: 'immigration', MultipleCultures: 'multiple', MultipleCulture: 'multiple' };

  // Individual 底下「結構性」子元素：由匯入器專門處理，不當成自訂欄位
  const KNOWN_IND = new Set(['Position', 'Display', 'Gender', 'IsDead', 'Name', 'Birth', 'Death', 'Comment',
    'Pictures', 'Picture', 'Sources', 'SourceCitations', 'Contacts', 'Contact', 'Occupations', 'Occupation',
    'Educations', 'Education', 'Hyperlinks', 'Hyperlink', 'Bookmarks', 'Bookmark', 'Medical', 'Twin',
    'FamilyRank', 'Age', 'AgeOfDeath', 'Employer', 'SpecialSymbol', 'SpecialSymbols']);
  const CJK = /[⺀-鿿豈-﫿]/;

  function nameOf(el) {
    if (!el) return '';
    const first = path(el, 'First'), middle = path(el, 'Middle'), last = path(el, 'Last');
    if (CJK.test(last + first + middle)) return (last + middle + first).replace(/\s+/g, '');
    const own = ownText(el);
    if (own) return own;
    return [first, middle, last].filter(Boolean).join(' ');
  }

  function parsePos(el) {
    const m = ownText(el).match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    return m ? { x: +m[1], y: +m[2] } : null;
  }

  // ── GenoPro XML → 本工具文件 ──
  function mapGenoPro(root, opts) {
    const o = opts || {};
    const doc = GT.newDoc(o.now);
    const report = { persons: 0, unions: 0, relations: 0, labels: 0, twins: 0, customFields: [], genomaps: 1, unknownTypes: 0,
                     skipped: { twins: 0, shapes: 0, social: 0, pictures: 0, households: 0, links: 0, fields: 0 } };
    const idMap = dict();                      // GenoPro ID → 本工具 ID
    const fieldByLabel = dict();
    const droppedFields = new Set();
    for (const f of doc.settings.fields) fieldByLabel[f.label] = f.key;

    function fieldFor(label) {
      const name = String(label).slice(0, 20);
      if (fieldByLabel[name]) return fieldByLabel[name];
      if (doc.settings.fields.length >= MAX_FIELDS) { droppedFields.add(name); report.skipped.fields = droppedFields.size; return null; }
      const key = GT.addField(doc, name);
      if (!key) return null;
      doc.settings.fields.find(f => f.key === key).show = false;   // 匯入的自訂欄位預設不顯示，使用者自己勾
      fieldByLabel[name] = key;
      report.customFields.push(name);
      return key;
    }
    function setAttr(p, label, value) {
      const v = String(value || '').trim().slice(0, 500);
      if (!v) return;
      const key = fieldFor(label);
      if (key) p.attrs[key] = p.attrs[key] ? p.attrs[key] + '；' + v : v;
    }

    // 人物
    const raw = [];
    for (const ind of kids(kid(root, 'Individuals'), 'Individual')) {
      const gid = ind.getAttribute('ID');
      if (!gid) continue;
      const posEl = kid(ind, 'Position');
      raw.push({ gid, ind, pos: parsePos(posEl), map: posEl ? posEl.getAttribute('GenoMap') || '' : '',
                 w: (() => { const r = (posEl && posEl.getAttribute('BoundaryRect') || '').split(',').map(Number);
                             return r.length === 4 && r.every(Number.isFinite) ? Math.abs(r[2] - r[0]) : 0; })() });
    }
    // 座標：GenoPro 的 y 軸朝上 → 翻轉；依符號寬度等比縮放；多張 GenoMap 並排
    const widths = raw.map(r => r.w).filter(w => w > 10).sort((a, b) => a - b);
    const scale = GT.S / (widths.length ? widths[Math.floor(widths.length / 2)] : 52);
    // 垂直另外縮放：GenoPro 的世代間距很緊（常見 80 單位），本工具的名字與欄位寫在符號下方，
    // 所以依檔案實際的「父母到子女」距離，換算成本工具的世代間距（GAP_Y），相對位置不變
    const posOf = dict();
    raw.forEach(r => { if (r.pos) posOf[r.gid] = r.pos; });
    const famUp = dict(), famDown = dict();
    for (const pl of kids(kid(root, 'PedigreeLinks'), 'PedigreeLink')) {
      const f = pl.getAttribute('Family'), pos = posOf[pl.getAttribute('Individual')];
      if (!f || !pos) continue;
      const bucket = (pl.getAttribute('PedigreeLink') || 'Biological') === 'Parent' ? famUp : famDown;
      (bucket[f] = bucket[f] || []).push(pos.y);
    }
    const gaps = Object.keys(famUp).filter(f => famDown[f])
      .map(f => Math.min(...famUp[f]) - Math.max(...famDown[f])).filter(g => g > 5).sort((a, b) => a - b);
    const scaleY = Math.min(scale * 4, Math.max(scale, GT.GAP_Y / (gaps.length ? gaps[Math.floor(gaps.length / 2)] : 80)));
    const maps = Array.from(new Set(raw.map(r => r.map)));
    report.genomaps = Math.max(1, maps.length);
    const frames = dict();                     // 每張 GenoMap 的座標框架（文字標籤也用同一套換算）
    let offsetX = 0;
    for (const mp of maps) {
      const group = raw.filter(r => r.map === mp && r.pos);
      if (!group.length) continue;
      const minX = Math.min(...group.map(r => r.pos.x)), maxX = Math.max(...group.map(r => r.pos.x));
      const maxY = Math.max(...group.map(r => r.pos.y));
      frames[mp] = { minX, maxY, offsetX };
      for (const r of group) { r.x = (r.pos.x - minX) * scale + offsetX; r.y = (maxY - r.pos.y) * scaleY; }
      offsetX += (maxX - minX) * scale + GT.GAP_X * 3;
    }
    const toCanvas = (pos, mp) => {
      const f = frames[mp] || frames[maps[0]] || { minX: 0, maxY: 0, offsetX: 0 };
      return { x: (pos.x - f.minX) * scale + f.offsetX, y: (f.maxY - pos.y) * scaleY };
    };
    raw.forEach((r, i) => { if (r.x == null) { r.x = offsetX + (i % 8) * GT.GAP_X; r.y = Math.floor(i / 8) * GT.GAP_Y; } });

    for (const r of raw) {
      const ind = r.ind;
      const g = ownText(kid(ind, 'Gender'));
      const id = GT.newId(doc, 'p');
      idMap[r.gid] = id;
      const deathEl = kid(ind, 'Death');
      const cause = path(ind, 'Death.Cause');
      const p = {
        id, gender: g === 'M' ? 'M' : g === 'F' ? 'F' : g === 'P' ? 'P' : 'U',
        x: GT.snap(r.x), y: GT.snap(r.y),
        name: nameOf(kid(ind, 'Name')).slice(0, 60),
        index: false,
        deceased: ownText(kid(ind, 'IsDead')).toUpperCase() === 'Y' || !!(deathEl && deathEl.children.length),
        age: '', birth: parseGnoDate(path(ind, 'Birth.Date')), death: parseGnoDate(path(ind, 'Death.Date')),
        deathAge: (path(ind, 'Death.Age').match(/\d+/) || [''])[0], attrs: {},
        life: '', culture: '', illness: '', substance: '', conditions: [],
      };
      // 流產／墮胎：GenoPro 記在死因；參考圖用 ●／× 取代原本的符號，不再另外打叉
      const life = lookup(LIFE_BY_CAUSE, cause);
      if (life) { p.life = life; p.deceased = false; }
      else if (!p.deceased && !p.birth && path(ind, 'Birth.PregnancyLength')) p.life = 'pregnancy';   // 未出生、有懷孕週數＝懷孕中（推定，待真實檔確認）
      if (cause === 'Stillbirth') setAttr(p, '備註', '死產');
      const special = kid(ind, 'SpecialSymbol') || kid(ind, 'SpecialSymbols');
      const culture = special && lookup(CULTURE_MAP, ownText(special) || special.getAttribute('Type') || special.getAttribute('ID') || '');
      if (culture) p.culture = culture;
      doc.persons[id] = p;

      setAttr(p, '備註', ownText(kid(ind, 'Comment')));
      // 職業：個人底下直接寫的，或 <Occupations><Occupation><Title>
      const occ = [ownText(kid(ind, 'Occupation'))];
      for (const oc of kids(kid(ind, 'Occupations'), 'Occupation')) occ.push(path(oc, 'Title') || ownText(oc));
      setAttr(p, '職業', occ.filter(Boolean).join('、'));
      const edu = [];
      for (const ed of kids(kid(ind, 'Educations'), 'Education')) edu.push(path(ed, 'Level') || path(ed, 'Program') || ownText(ed));
      setAttr(p, '教育程度', edu.filter(Boolean).join('、'));
      // 使用者在 GenoPro 圖上自己打的上／下標籤文字
      setAttr(p, 'GenoPro 上標籤', path(ind, 'Display.Label.Top.Text'));
      setAttr(p, 'GenoPro 下標籤', path(ind, 'Display.Label.Bottom.Text'));
      if (kid(ind, 'Pictures') || kid(ind, 'Picture')) report.skipped.pictures++;
      // 其他不認得的子元素＝使用者自訂欄位（例如「經濟」）：直接帶過來，名稱相同就併入預設欄位
      for (const c of Array.from(ind.children)) {
        if (KNOWN_IND.has(c.tagName)) continue;
        if (c.children.length) {
          for (const gc of Array.from(c.children)) {
            const label = gc.getAttribute('Name') || gc.getAttribute('ID') || gc.tagName;
            if (!gc.children.length) setAttr(p, label, ownText(gc));
          }
        } else setAttr(p, c.getAttribute('Name') || c.tagName, ownText(c));
      }
    }
    report.persons = Object.keys(doc.persons).length;

    // 家庭（伴侶關係）與親子
    const famMap = dict();
    for (const fam of kids(kid(root, 'Families'), 'Family')) {
      const gid = fam.getAttribute('ID');
      if (!gid) continue;
      const rel = ownText(kid(fam, 'Relation')) || fam.getAttribute('Relation') || '';
      // 沒寫關係＝GenoPro 預設的結婚；寫了但不認得 → 「其他」並計入報告
      const type = !rel ? 'Marriage' : isFamilyType(rel) ? rel : 'Other';
      if (rel && !isFamilyType(rel)) report.unknownTypes++;
      famMap[gid] = { partners: [], children: [], type };
    }
    for (const pl of kids(kid(root, 'PedigreeLinks'), 'PedigreeLink')) {
      const f = famMap[pl.getAttribute('Family')], pid = idMap[pl.getAttribute('Individual')];
      if (!f || !pid) { report.skipped.links++; continue; }
      const kind = pl.getAttribute('PedigreeLink') || 'Biological';
      if (kind === 'Parent') { if (!f.partners.includes(pid) && f.partners.length < 2) f.partners.push(pid); }
      else if (!f.children.some(c => c.id === pid)) f.children.push({ id: pid, link: lookup(CHILD_MAP, kind) || 'bio' });
    }
    for (const f of Object.values(famMap)) {
      f.children = f.children.filter(c => !f.partners.includes(c.id));
      if (!f.partners.length) { if (f.children.length) report.skipped.links += f.children.length; continue; }
      if (f.partners.length === 1 && !f.children.length) continue;
      const id = GT.newId(doc, 'u');
      f.partners.sort((a, b) => doc.persons[a].x - doc.persons[b].x);
      doc.unions[id] = { id, partners: f.partners, children: f.children, type: f.type, twins: [] };
    }
    report.unions = Object.keys(doc.unions).length;

    // 雙胞胎：<Twin TwinLink=… Family=… Siblings="ind1,ind2"/>；Siblings 沒寫時改看 PedigreeLink 的 Twin 屬性
    const twinMembers = dict();
    for (const pl of kids(kid(root, 'PedigreeLinks'), 'PedigreeLink')) {
      const tw = pl.getAttribute('Twin');
      if (tw) (twinMembers[tw] = twinMembers[tw] || []).push(pl.getAttribute('Individual'));
    }
    for (const tw of kids(kid(root, 'Twins'), 'Twin')) {
      let sibs = (tw.getAttribute('Siblings') || ownText(kid(tw, 'Siblings')) || '').split(/[\s,;]+/).filter(Boolean);
      if (sibs.length < 2) sibs = twinMembers[tw.getAttribute('ID') || ''] || [];
      const ids = Array.from(new Set(sibs.map(g => idMap[g]).filter(Boolean)));
      const kind = lookup(TWIN_MAP, tw.getAttribute('TwinLink') || ownText(kid(tw, 'TwinLink'))) || 'Unknown';
      const u = GT.commonParentUnion(doc, ids);
      if (u && GT.setTwins(doc, u.id, ids, kind)) report.twins++;
      else report.skipped.twins++;
    }

    // 情感關係（參考圖 36 種＋其他，一對一）
    for (const er of kids(kid(root, 'EmotionalRelationships'), 'EmotionalRelationship')) {
      const a = idMap[er.getAttribute('Entity1')], b = idMap[er.getAttribute('Entity2')];
      if (!a || !b || a === b) { report.skipped.social++; continue; }
      const gp = er.getAttribute('EmotionalLink') || ownText(kid(er, 'EmotionalLink')) || '';
      const known = isEmotionType(gp);
      if (gp && !known) report.unknownTypes++;
      const id = GT.addRelation(doc, a, b, known ? gp : 'Other');
      const comment = ownText(kid(er, 'Comment'));
      doc.relations[id].note = [known ? '' : gp, comment].filter(Boolean).join('；').slice(0, 300);
    }
    // 社會關係：目前只帶入「看護」（Entity1 是照顧者，箭頭指向被照顧的人）；其他種類計入報告
    for (const sr of kids(kid(root, 'SocialRelationships'), 'SocialRelationship')) {
      const conn = sr.getAttribute('Connection') || ownText(kid(sr, 'Connection'));
      const a = idMap[sr.getAttribute('Entity1')], b = idMap[sr.getAttribute('Entity2')];
      if (conn === 'Caretaker' && a && b && a !== b) {
        const id = GT.addRelation(doc, a, b, 'Caretaker');
        doc.relations[id].note = ownText(kid(sr, 'Comment')).slice(0, 300);
      } else report.skipped.social++;
    }
    report.relations = Object.keys(doc.relations).length;

    // 文字標籤
    const people = Object.values(doc.persons);
    let spareY = people.length ? Math.max(...people.map(p => p.y)) + GT.GAP_Y : 0;
    for (const lb of kids(kid(root, 'Labels'), 'Label')) {
      const text = path(lb, 'Text') || ownText(lb);
      if (!text) continue;
      const posEl = kid(lb, 'Position');
      const pos = parsePos(posEl);
      const c = pos ? toCanvas(pos, posEl.getAttribute('GenoMap') || '') : { x: 0, y: (spareY += 40) };
      GT.addLabel(doc, c.x, c.y, text);
    }
    report.labels = Object.keys(doc.labels).length;

    // 本版不支援、但原檔有的物件：計數寫進報告（雙胞胎與看護已在上面處理，只有對不上的才算略過）
    report.skipped.shapes = kids(kid(root, 'Shapes'), 'Shape').length;
    report.skipped.households = kids(kid(root, 'Households'), 'Household').length;
    report.skipped.social += kids(kid(root, 'SocialEntities'), 'SocialEntity').length;

    // 帶過來的自訂欄位若含資料，預設在屬性面板看得到；是否顯示在圖上由使用者決定
    return { doc, report };
  }

  async function readGno(buffer, opts) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const xmlBytes = await extractXml(bytes, opts && opts.maxXml);
    const root = parseXml(decodeXml(xmlBytes));
    return mapGenoPro(root, opts);
  }

  // 匯入報告 → 給使用者看的中文摘要（純業務描述，不含技術細節）
  function describeReport(r) {
    const lines = [`已匯入 ${r.persons} 人、${r.unions} 段伴侶／親子關係、${r.relations} 條情感關係` +
      (r.twins ? `、${r.twins} 組雙胞胎` : '') + (r.labels ? `、${r.labels} 個文字說明` : '') + '。'];
    if (r.unknownTypes) lines.push(`有 ${r.unknownTypes} 條關係的類型本工具不認得，已標成「其他」，原本的類型寫在備註裡。`);
    if (r.genomaps > 1) lines.push(`原檔有 ${r.genomaps} 張 GenoMap，已並排在同一張畫布上。`);
    if (r.customFields.length) lines.push(`帶入的其他欄位：${r.customFields.join('、')}（可在左側「顯示設定」勾選是否顯示在圖上）。`);
    const s = r.skipped, miss = [];
    if (s.twins) miss.push(`對不上父母的雙胞胎標記 ${s.twins} 組`);
    if (s.households) miss.push(`生活圈 ${s.households} 個`);
    if (s.shapes) miss.push(`圖形 ${s.shapes} 個`);
    if (s.social) miss.push(`社會資源／機構相關項目 ${s.social} 個`);
    if (s.pictures) miss.push(`照片 ${s.pictures} 人`);
    if (s.links) miss.push(`無法對應的親子連結 ${s.links} 條`);
    if (s.fields) miss.push(`超過欄位數上限（${MAX_FIELDS} 個）的其他欄位 ${s.fields} 種`);
    if (miss.length) lines.push(`本版還不支援、沒有帶入的項目：${miss.join('、')}。原檔沒有被修改，可以回 GenoPro 查看。`);
    lines.push('匯入後請核對一次，確認沒問題再按「另存新檔」存成本工具的檔案。');
    return lines;
  }

  GT.gno = { GnoError, GnoLockedError, GnoTooLargeError, MAX_XML, MAX_FIELDS, zipEntries, zipRead, extractXml, decodeXml, parseXml,
             ownText, path, parseGnoDate, nameOf, mapGenoPro, readGno, describeReport,
             isFamilyType, isEmotionType, CHILD_MAP, TWIN_MAP, LIFE_BY_CAUSE, CULTURE_MAP };
})(globalThis.GT = globalThis.GT || {});
