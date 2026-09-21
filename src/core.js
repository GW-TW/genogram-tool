/* 家系圖工具 — core.js
 * 純邏輯層：資料模型、欄位定義、日期與年齡、圖上標籤、編輯指令、復原/重做、檔案正規化、錯誤咽喉。
 * 規則：本檔載入時不得碰 DOM（測試直接在無介面的狀態呼叫這裡的函式）。
 */
(function (GT) {
  'use strict';

  const FORMAT = 'genogram-tool';
  const VERSION = 3;     // v2（2026-09-18）：關係類型改存 GenoPro 原始代碼；v1 檔開啟時自動轉換
  const S = 40;          // 人物符號邊長（px）
  const GRID = 10;       // 拖曳吸附格距
  const GAP_X = 100;     // 新增伴侶／手足的水平間距
  const GAP_Y = 160;     // 世代之間的垂直距離（要容得下符號下方 3～4 行標籤＋伴侶線）

  /* ── 類型表（模式 2：key＝資料鍵、label＝顯示名；改顯示名不動歷史資料）──
     依據：GenoPro「Genogram Symbols 基本常用家族圖符號」參考圖（使用者提供，2026-09-17）。
     key 直接用 GenoPro 的代碼 → 匯入一對一不失真。sheet:false＝參考圖上沒有、只在匯入時出現，不列進選單。
     中文標籤照參考圖；兩處參考圖明顯誤譯的已更正（Nullity→婚姻無效、Committed→長期承諾關係）。 */
  const FAMILY_CATS = [
    { key: 'marriage',   label: '婚姻' },
    { key: 'engagement', label: '婚約' },
    { key: 'cohabit',    label: '同居' },
    { key: 'dating',     label: '交往' },
  ];
  const FAMILY_TYPES = [
    { key: 'Marriage',                                label: '結婚',               en: 'Marriage',                          cat: 'marriage' },
    { key: 'Separation',                              label: '事實上分開',          en: 'Separation in fact',                cat: 'marriage' },
    { key: 'SeparationLegal',                         label: '合法分居',            en: 'Legal separation',                  cat: 'marriage' },
    { key: 'Divorce',                                 label: '離婚',               en: 'Divorce',                           cat: 'marriage' },
    { key: 'Nullity',                                 label: '婚姻無效',            en: 'Nullity',                           cat: 'marriage' },
    { key: 'Widowed',                                 label: '喪偶',               en: 'Widowed',                           cat: 'marriage', sheet: false },
    { key: 'Engagement',                              label: '婚約',               en: 'Engagement',                        cat: 'engagement' },
    { key: 'EngagementAndCohabitation',               label: '婚約並同居',          en: 'Engagement and cohabitation',       cat: 'engagement' },
    { key: 'EngagementAndSeparation',                 label: '婚約後解除',          en: 'Engagement and separation',         cat: 'engagement' },
    { key: 'LegalCohabitation',                       label: '合法同居',            en: 'Legal cohabitation',                cat: 'cohabit' },
    { key: 'LegalCohabitationAndSeparation',          label: '合法同居事實上分開',   en: 'Legal cohabitation and separation in fact', cat: 'cohabit' },
    { key: 'LegalCohabitationAndLegalSeparation',     label: '合法同居後合法分開',   en: 'Legal cohabitation and legal separation',   cat: 'cohabit' },
    { key: 'Cohabitation',                            label: '同居',               en: 'Cohabitation',                      cat: 'cohabit' },
    { key: 'CohabitationAndSeparation',               label: '同居後分開',          en: 'Cohabitation and separation',       cat: 'cohabit' },
    { key: 'NonSentimentalCohabitation',              label: '沒有感情的同居',       en: 'Non-sentimental cohabitation',      cat: 'cohabit' },
    { key: 'NonSentimentalCohabitationAndSeparation', label: '沒有感情的同居後分開', en: 'Non-sentimental cohabitation and separation', cat: 'cohabit' },
    { key: 'CommittedRelationship',                   label: '長期承諾關係',        en: 'Committed (long-term) relationship', cat: 'dating' },
    { key: 'CommittedRelationshipAndSeparation',      label: '長期承諾關係後分開',   en: 'Committed relationship and separation', cat: 'dating', sheet: false },
    { key: 'CasualRelationship',                      label: '偶然聯繫（短期交往）', en: 'Casual relationship or dating',     cat: 'dating' },
    { key: 'CasualRelationshipAndSeparation',         label: '偶然聯繫後分開',       en: 'Casual relationship and separation', cat: 'dating' },
    { key: 'TemporaryRelation',                       label: '臨時關係／一夜情',     en: 'Temporary relation / One night stand', cat: 'dating' },
    { key: 'LoveAffair',                              label: '戀愛',               en: 'Love Affair',                       cat: 'dating' },
    { key: 'LoveAffairAndSeparation',                 label: '戀愛後分開',          en: 'Love affair and separation',        cat: 'dating', sheet: false },
    { key: 'Liaison',                                 label: '非承諾關係',          en: 'Liaison / Uncommitted',             cat: 'dating', sheet: false },
    { key: 'Rape',                                    label: '強迫關係',            en: 'Rape / Forced relationship',        cat: 'dating', sheet: false },
    { key: 'Other',                                   label: '其他',               en: 'Other',                             cat: 'dating', sheet: false },
  ];
  const CHILD_LINKS = [
    { key: 'bio',     label: '親生' },
    { key: 'adopted', label: '收養' },
    { key: 'foster',  label: '寄養' },
  ];
  const TWIN_KINDS = [
    { key: 'Fraternal', label: '雙胞胎（異卵）' },
    { key: 'Identical', label: '同卵雙胞胎' },
    { key: 'Unknown',   label: '雙胞胎（不確定）' },
  ];
  // 情感關係：dir＝有方向（a → b，箭頭指向 b）
  const EMOTION_CATS = [
    { key: 'close',    label: '親近' },
    { key: 'distant',  label: '疏離' },
    { key: 'conflict', label: '衝突' },
    { key: 'violence', label: '暴力' },
    { key: 'abuse',    label: '虐待' },
    { key: 'control',  label: '控制與關注' },
    { key: 'other',    label: '一般' },
  ];
  const EMOTION_TYPES = [
    { key: 'Harmony',             label: '和諧相處',          en: 'Harmony',                    cat: 'close' },
    { key: 'Friendship',          label: '朋友／親近',        en: 'Friendship / Close',         cat: 'close' },
    { key: 'Intimacy',            label: '知己／密友',        en: 'Best Friends / Very Close',  cat: 'close' },
    { key: 'Fused',               label: '融合（過度親密）',   en: 'Fused',                      cat: 'close' },
    { key: 'Love',                label: '喜愛',             en: 'Love',                       cat: 'close' },
    { key: 'InLove',              label: '戀愛中',            en: 'In Love',                    cat: 'close' },
    { key: 'Psyritual',           label: '情感連繫／靈性關係', en: 'Emotional Connection',       cat: 'close' },
    { key: 'Indifferent',         label: '冷漠的／防心重的',   en: 'Indifferent / Apathetic',    cat: 'distant' },
    { key: 'Distant',             label: '不親近的／差的',     en: 'Distant / Poor',             cat: 'distant' },
    { key: 'Cutoff',              label: '絕交／疏遠的',       en: 'Cutoff / Estranged',         cat: 'distant' },
    { key: 'CutoffRepaired',      label: '修復截斷',          en: 'Cutoff Repaired',            cat: 'distant' },
    { key: 'NeverMet',            label: '未曾謀面',          en: 'Never Met',                  cat: 'distant' },
    { key: 'Discord',             label: '不和／衝突',        en: 'Discord / Conflict',         cat: 'conflict' },
    { key: 'Hate',                label: '憎恨',             en: 'Hate',                       cat: 'conflict' },
    { key: 'Distrust',            label: '不信任的',          en: 'Distrust',                   cat: 'conflict' },
    { key: 'Hostile',             label: '敵對的',            en: 'Hostile',                    cat: 'conflict' },
    { key: 'HostileDistant',      label: '疏離的－敵視的',     en: 'Distant-Hostile',            cat: 'conflict' },
    { key: 'HostileClose',        label: '親近的－敵視的',     en: 'Close-Hostile',              cat: 'conflict' },
    { key: 'HostileFused',        label: '融合的－敵視的',     en: 'Fused-Hostile',              cat: 'conflict' },
    { key: 'Violence',            label: '暴力相待的',        en: 'Violence',                   cat: 'violence' },
    { key: 'ViolenceDistant',     label: '疏離的－暴力相待的', en: 'Distant-Violence',           cat: 'violence' },
    { key: 'ViolenceClose',       label: '密切的－暴力相待',   en: 'Close-Violence',             cat: 'violence' },
    { key: 'ViolenceFused',       label: '融合的－暴力相待',   en: 'Fused-Violence',             cat: 'violence' },
    { key: 'Abuse',               label: '虐待的',            en: 'Abuse',                      cat: 'abuse', dir: true },
    { key: 'AbusePhysical',       label: '身體虐待',          en: 'Physical Abuse',             cat: 'abuse', dir: true },
    { key: 'AbuseEmotional',      label: '情感（精神）虐待',   en: 'Emotional Abuse',            cat: 'abuse', dir: true },
    { key: 'AbuseSexual',         label: '性虐待',            en: 'Sexual Abuse',               cat: 'abuse', dir: true },
    { key: 'AbuseNeglect',        label: '忽視（虐待）',       en: 'Neglect (abuse)',            cat: 'abuse', dir: true },
    { key: 'Manipulative',        label: '操縱的',            en: 'Manipulative',               cat: 'control', dir: true },
    { key: 'Controlling',         label: '支配的',            en: 'Controlling',                cat: 'control', dir: true },
    { key: 'Jealous',             label: '嫉妒的',            en: 'Jealous',                    cat: 'control', dir: true },
    { key: 'FocusedOn',           label: '專注於的',          en: 'Focused On',                 cat: 'control', dir: true },
    { key: 'FocusedOnNegatively', label: '負面地專注於的',     en: 'Focused On Negatively',      cat: 'control', dir: true },
    { key: 'Fan',                 label: '粉絲／崇拜者',       en: 'Fan / Admirer',              cat: 'control', dir: true },
    { key: 'Limerence',           label: '迷戀',             en: 'Limerence',                  cat: 'control', dir: true },
    { key: 'Plain',               label: '一般的／正常的',     en: 'Plain / Normal',             cat: 'other' },
    { key: 'Caretaker',           label: '看護（照顧）',       en: 'Caretaker',                  cat: 'other', dir: true },
    { key: 'Other',               label: '其他',             en: 'Other',                      cat: 'other', sheet: false },
  ];
  const GENDERS = [
    { key: 'M', label: '男' },
    { key: 'F', label: '女' },
    { key: 'U', label: '未知性別', short: '未知' },
    { key: 'P', label: '寵物' },
  ];
  // 生命事件：懷孕／流產／墮胎會取代原本的方形或圓形符號（照參考圖：△、●、×）
  const LIFE_STATES = [
    { key: '',            label: '一般' },
    { key: 'pregnancy',   label: '懷孕' },
    { key: 'miscarriage', label: '流產' },
    { key: 'abortion',    label: '墮胎' },
  ];
  const CULTURES = [
    { key: '',            label: '無' },
    { key: 'immigration', label: '移民' },
    { key: 'multiple',    label: '住過兩個以上的文化地區', short: '多元文化' },
  ];
  // 成癮與疾病（參考圖左欄）：兩個獨立軸組合出 9 種狀態——疾病畫左半、濫用畫下半、兩者都有＝3/4
  const ILLNESS = [
    { key: '',         label: '無' },
    { key: 'active',   label: '身體或精神疾病', short: '有' },
    { key: 'recovery', label: '復原中' },
  ];
  const SUBSTANCE = [
    { key: '',          label: '無' },
    { key: 'active',    label: '酒精或藥物濫用', short: '有' },
    { key: 'suspected', label: '疑似' },
    { key: 'recovery',  label: '復原中' },
  ];
  // 參考圖右欄：成癮類別改符號外框顏色；疾病類別填在疾病那一半（左上格）
  const CONDITIONS = [
    { key: 'Gambling',     label: '賭博成癮', color: '#E0107A', kind: 'addiction' },
    { key: 'DrugAbuse',    label: '藥物濫用', color: '#F57C00', kind: 'addiction' },
    { key: 'Alcoholism',   label: '酗酒',     color: '#1E40D8', kind: 'addiction' },
    { key: 'Depression',   label: '憂鬱症',   color: '#1A237E', kind: 'medical' },
    { key: 'Obesity',      label: '肥胖症',   color: '#1B8A2E', kind: 'medical' },
    { key: 'Cancer',       label: '癌症',     color: '#D81B90', kind: 'medical' },
    { key: 'HeartDisease', label: '心臟病',   color: '#D32F2F', kind: 'medical' },
    { key: 'Hypertension', label: '高血壓',   color: '#8E0000', kind: 'medical' },
    { key: 'HIV',          label: '愛滋病',   color: '#F9A825', kind: 'medical' },
    { key: 'STD',          label: '性傳染病', color: '#FDD835', kind: 'medical' },
    { key: 'Hepatitis',    label: '肝炎',     color: '#7CB342', kind: 'medical' },
    { key: 'Diabetes',     label: '糖尿病',   color: '#6A1B9A', kind: 'medical' },
    { key: 'Arthritis',    label: '關節炎',   color: '#78909C', kind: 'medical' },
    { key: 'Autism',       label: '自閉症',   color: '#00ACC1', kind: 'medical' },
    { key: 'Alzheimer',    label: '失智症',   color: '#1565C0', kind: 'medical' },
  ];

  // ── 生態圖（v3）：外部系統（資源）與生態連結 ──
  // 畫法依社工慣例：強＝雙線、弱＝虛線、有壓力＝鋸齒線、箭頭＝資源或能量的流向
  const SYSTEM_CATS = [
    { key: 'edu',       label: '教育' },
    { key: 'health',    label: '醫療' },
    { key: 'welfare',   label: '社政' },
    { key: 'justice',   label: '警政司法' },
    { key: 'community', label: '社區與信仰' },
    { key: 'work',      label: '工作與經濟' },
    { key: 'other',     label: '其他' },
  ];
  const SYSTEM_PRESETS = [
    { key: 'school',       label: '學校',       cat: 'edu' },
    { key: 'teacher',      label: '導師',       cat: 'edu' },
    { key: 'counselor',    label: '輔導老師',   cat: 'edu' },
    { key: 'kinder',       label: '幼兒園／托育', cat: 'edu' },
    { key: 'hospital',     label: '醫院',       cat: 'health' },
    { key: 'clinic',       label: '診所',       cat: 'health' },
    { key: 'psych',        label: '身心科',     cat: 'health' },
    { key: 'counseling',   label: '心理諮商',   cat: 'health' },
    { key: 'ltc',          label: '長照單位',   cat: 'health' },
    { key: 'socialcenter', label: '社福中心',   cat: 'welfare' },
    { key: 'socialworker', label: '社工員',     cat: 'welfare' },
    { key: 'childprotect', label: '家防中心',   cat: 'welfare' },
    { key: 'shelter',      label: '安置機構',   cat: 'welfare' },
    { key: 'subsidy',      label: '福利補助',   cat: 'welfare' },
    { key: 'police',       label: '警察局',     cat: 'justice' },
    { key: 'court',        label: '法院',       cat: 'justice' },
    { key: 'probation',    label: '觀護／更生', cat: 'justice' },
    { key: 'church',       label: '教會／廟宇', cat: 'community' },
    { key: 'neighbor',     label: '鄰居',       cat: 'community' },
    { key: 'village',      label: '里長',       cat: 'community' },
    { key: 'ngo',          label: '民間團體',   cat: 'community' },
    { key: 'friend',       label: '朋友',       cat: 'community' },
    { key: 'relative',     label: '親戚',       cat: 'community' },
    { key: 'job',          label: '職場',       cat: 'work' },
    { key: 'employer',     label: '雇主',       cat: 'work' },
    { key: 'debt',         label: '債務',       cat: 'work' },
    { key: 'blank',        label: '空白（自己打字）', cat: 'other' },
  ];
  const TIE_STRENGTHS = [
    { key: 'strong', label: '強（雙線）',   short: '強' },
    { key: 'normal', label: '普通（單線）', short: '普通' },
    { key: 'weak',   label: '弱（虛線）',   short: '弱' },
  ];
  const TIE_DIRS = [
    { key: '',     label: '沒有箭頭', short: '無' },
    { key: 'a2b',  label: '單向：往後者', short: '→' },
    { key: 'b2a',  label: '單向：往前者', short: '←' },
    { key: 'both', label: '雙向',     short: '↔' },
  ];
  // 顯示模式：家系圖／家系圖＋生態圖／生態圖（把整個家系圖收成一個「家庭」圓）
  const VIEW_MODES = [
    { key: 'genogram', label: '只看家系圖' },
    { key: 'both',     label: '家系圖＋生態圖' },
    { key: 'ecomap',   label: '生態圖（家庭收成一個圓）' },
  ];

  // v1 → v2 對照（v1 只有 5 種關係 × 3 種狀態、11 種情感關係）
  const V1_UNION = {
    married: { '': 'Marriage', separated: 'Separation', divorced: 'Divorce' },
    cohabit: { '': 'Cohabitation', separated: 'CohabitationAndSeparation', divorced: 'CohabitationAndSeparation' },
    engaged: { '': 'Engagement', separated: 'EngagementAndSeparation', divorced: 'EngagementAndSeparation' },
    affair:  { '': 'CasualRelationship', separated: 'CasualRelationshipAndSeparation', divorced: 'CasualRelationshipAndSeparation' },
    other:   { '': 'Other', separated: 'Other', divorced: 'Other' },
  };
  const V1_RELATION = {
    plain: 'Harmony', close: 'Friendship', fused: 'Fused', distant: 'Distant', conflict: 'Discord',
    closeConflict: 'HostileClose', cutoff: 'Cutoff', deteriorating: 'Discord', violence: 'Violence',
    abuse: 'Abuse', other: 'Other',
  };

  // 預設欄位。suggest 只是輸入提示，使用者可以打任何內容（模式 9：提示＝預設值 ∪ 本檔已用過的值）
  const DEFAULT_FIELDS = [
    { key: 'occupation', label: '職業',     show: true,  suggest: ['無業', '家管', '學生', '退休', '臨時工'] },
    { key: 'economy',    label: '經濟',     show: true,  suggest: ['低收入戶', '中低收入戶', '一般', '不詳'] },
    { key: 'education',  label: '教育程度', show: false, suggest: ['不識字', '國小', '國中', '高中職', '大專', '研究所'] },
    { key: 'health',     label: '健康狀況', show: false, suggest: ['良好', '慢性病', '身心障礙', '重大傷病'] },
    { key: 'note',       label: '備註',     show: false, suggest: [] },
  ];

  const has = (list, key) => list.some(t => t.key === key);
  const labelOf = (list, key) => (list.find(t => t.key === key) || { label: key }).label;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const snap = (v) => Math.round(v / GRID) * GRID;
  const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  function todayISO(now) {
    const d = now || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // ── 文件 ──
  function newDoc(now) {
    return {
      format: FORMAT, version: VERSION,
      meta: { title: '', assessDate: todayISO(now) },
      settings: {
        fields: DEFAULT_FIELDS.map(f => ({ key: f.key, label: f.label, show: f.show })),
        labelMode: 'value',     // value＝只顯示內容；labelled＝「欄位名：內容」
        showYears: false,       // 圖上顯示生卒年
        colorRelations: true,   // 情感關係線彩色（關掉＝黑白列印友善）
        view: 'both',           // 顯示模式（VIEW_MODES）：只看家系圖／家系圖＋生態圖／生態圖
      },
      persons: {}, unions: {}, relations: {}, households: {}, labels: {},
      systems: {}, ties: {},    // 生態圖：外部系統（資源）與生態連結
      seq: 0,
    };
  }

  function newId(doc, prefix) {
    doc.seq = (doc.seq || 0) + 1;
    return prefix + doc.seq;
  }

  // ── 日期與年齡 ──
  // 接受：1965、1965-03、1965-03-08、1965/3/8、民國54年3月8日、民54、54/3/8（年份 < 1000 視為民國）
  function parseDate(input) {
    if (input == null) return null;
    let s = String(input).trim();
    if (!s) return null;
    let roc = false;
    if (/^民國?/.test(s)) { roc = true; s = s.replace(/^民國?/, ''); }
    s = s.replace(/[年月]/g, '-').replace(/日/g, '').replace(/[./]/g, '-').replace(/-+$/, '');
    const m = s.match(/^(\d{1,4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
    if (!m) return null;
    let y = +m[1];
    const mo = m[2] ? +m[2] : null;
    const d = m[3] ? +m[3] : null;
    if (roc || y < 1000) y += 1911;
    if (mo !== null && (mo < 1 || mo > 12)) return null;
    if (d !== null && (d < 1 || d > 31)) return null;
    return { y, m: mo, d };
  }

  function formatDate(pd) {
    if (!pd) return '';
    const p = (n) => String(n).padStart(2, '0');
    if (pd.m == null) return String(pd.y);
    if (pd.d == null) return `${pd.y}-${p(pd.m)}`;
    return `${pd.y}-${p(pd.m)}-${p(pd.d)}`;
  }

  // 完整歲數；只有年份時＝年份相減（標記 approx）
  function yearsBetween(a, b) {
    let n = b.y - a.y;
    const approx = a.m == null || b.m == null;
    if (!approx) {
      const ad = a.d == null ? 1 : a.d;
      const bd = b.d == null ? 1 : b.d;
      if (b.m < a.m || (b.m === a.m && bd < ad)) n -= 1;
    }
    return { n, approx: approx || a.d == null || b.d == null };
  }

  const toAge = (v) => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n < 150 ? Math.floor(n) : null;
  };

  /* 年齡以「評估日期」為基準，不是今天：
     兩年後重開舊檔，圖上的年齡仍要跟當時的個案紀錄一致。 */
  function ageOf(doc, p) {
    const ref = parseDate(doc.meta && doc.meta.assessDate) || parseDate(todayISO());
    const birth = parseDate(p.birth);
    if (p.deceased) {
      const da = toAge(p.deathAge);
      if (da !== null) return { value: da, source: 'manual' };
      const death = parseDate(p.death);
      if (birth && death) {
        const r = yearsBetween(birth, death);
        if (r.n >= 0) return { value: r.n, source: 'birth', approx: r.approx };
      }
      const ma = toAge(p.age);
      return ma !== null ? { value: ma, source: 'manual' } : { value: null, source: null };
    }
    if (birth) {
      const r = yearsBetween(birth, ref);
      if (r.n >= 0) return { value: r.n, source: 'birth', approx: r.approx };
    }
    const ma = toAge(p.age);
    return ma !== null ? { value: ma, source: 'manual' } : { value: null, source: null };
  }

  // ── 圖上文字 ──
  // 字寬估算（決定換行與外框大小；不依賴瀏覽器量字，測試才能重現）
  function charEm(ch) {
    const c = ch.codePointAt(0);
    if (c >= 0x2E80 && c <= 0x9FFF) return 1;       // 中日韓文字與符號
    if (c >= 0xAC00 && c <= 0xD7AF) return 1;       // 韓文
    if (c >= 0xFF00 && c <= 0xFFEF) return 1;       // 全形
    return ch === ' ' ? 0.3 : 0.58;
  }
  const textEm = (s) => Array.from(String(s)).reduce((a, ch) => a + charEm(ch), 0);

  function wrapText(s, maxEm) {
    const out = [];
    for (const para of String(s).split(/\r?\n/)) {
      let line = '', w = 0;
      for (const ch of Array.from(para)) {
        const cw = charEm(ch);
        if (w + cw > maxEm && line) { out.push(line); line = ''; w = 0; }
        line += ch; w += cw;
      }
      out.push(line);
    }
    return out;
  }

  const LABEL_WRAP_EM = 8;  // 人物下方標籤每行最多約 8 個中文字寬

  // 人物下方要顯示的文字（每個元素＝一行；kind='name' 給畫圖層套粗體）
  function labelLines(doc, p) {
    const lines = [];
    const push = (text, kind) => wrapText(text, LABEL_WRAP_EM).forEach(t => { if (t) lines.push({ text: t, kind }); });
    if (p.name && p.name.trim()) push(p.name.trim(), 'name');
    const st = doc.settings;
    if (st.showYears) {
      const b = parseDate(p.birth), d = parseDate(p.death);
      if (b || (p.deceased && d)) push(`${b ? b.y : '?'}–${p.deceased ? (d ? d.y : '?') : ''}`, 'attr');
    }
    for (const f of st.fields) {
      if (!f.show) continue;
      const v = (p.attrs && p.attrs[f.key] != null) ? String(p.attrs[f.key]).trim() : '';
      if (!v) continue;
      push(st.labelMode === 'labelled' ? `${f.label}：${v}` : v, 'attr');
    }
    return lines;
  }

  // 欄位輸入提示：預設提示 ∪ 本檔已出現過的值（模式 9）
  function suggestionsFor(doc, key) {
    const base = (DEFAULT_FIELDS.find(f => f.key === key) || { suggest: [] }).suggest;
    const used = Object.values(doc.persons).map(p => (p.attrs || {})[key]).filter(v => v && String(v).trim());
    return Array.from(new Set([...base, ...used.map(v => String(v).trim())]));
  }

  // ── 欄位管理 ──
  function addField(doc, label) {
    const name = String(label || '').trim().slice(0, 20);
    if (!name || doc.settings.fields.some(f => f.label === name)) return null;
    let key;
    do { key = newId(doc, 'f'); } while (doc.settings.fields.some(f => f.key === key));
    doc.settings.fields.push({ key, label: name, show: true });
    return key;
  }
  function renameField(doc, key, label) {
    const f = doc.settings.fields.find(x => x.key === key);
    const name = String(label || '').trim().slice(0, 20);
    if (!f || !name || doc.settings.fields.some(x => x.key !== key && x.label === name)) return false;
    f.label = name;          // 只改顯示名，資料鍵不動
    return true;
  }
  function fieldUsage(doc, key) {
    return Object.values(doc.persons).filter(p => p.attrs && String(p.attrs[key] || '').trim()).length;
  }
  function removeField(doc, key) {
    const i = doc.settings.fields.findIndex(f => f.key === key);
    if (i < 0) return false;
    doc.settings.fields.splice(i, 1);
    for (const p of Object.values(doc.persons)) if (p.attrs) delete p.attrs[key];
    return true;
  }
  function moveField(doc, key, delta) {
    const a = doc.settings.fields, i = a.findIndex(f => f.key === key), j = i + delta;
    if (i < 0 || j < 0 || j >= a.length) return false;
    [a[i], a[j]] = [a[j], a[i]];
    return true;
  }

  // ── 查詢 ──
  const unionsOf = (doc, pid) => Object.values(doc.unions).filter(u => u.partners.includes(pid));
  const parentUnionOf = (doc, pid) => Object.values(doc.unions).find(u => u.children.some(c => c.id === pid)) || null;
  function unionBetween(doc, a, b) {
    return Object.values(doc.unions).find(u => u.partners.length === 2 && u.partners.includes(a) && u.partners.includes(b)) || null;
  }
  function occupied(doc, x, y) {
    return Object.values(doc.persons).some(p => Math.abs(p.x - x) < S * 1.5 && Math.abs(p.y - y) < S * 1.5);
  }
  function freeSpot(doc, x, y, dir) {
    let nx = snap(x);
    for (let i = 0; i < 60 && occupied(doc, nx, snap(y)); i++) nx += (dir || 1) * GAP_X / 2;
    return nx;
  }

  // ── 編輯指令（呼叫前由介面層先存復原點）──
  function blankPerson(id, gender, x, y) {
    return { id, gender, x: snap(x), y: snap(y), name: '', index: false, deceased: false,
             age: '', birth: '', death: '', deathAge: '', attrs: {},
             life: '', culture: '', illness: '', substance: '', conditions: [] };
  }

  function addPerson(doc, opts) {
    const o = opts || {};
    const x = o.x || 0, y = o.y || 0;
    const id = newId(doc, 'p');
    const p = blankPerson(id, has(GENDERS, o.gender) ? o.gender : 'U', freeSpot(doc, x, y), y);
    p.name = String(o.name || '').slice(0, 60);
    doc.persons[id] = p;
    return id;
  }

  function linkPartners(doc, a, b, type) {
    if (a === b || !doc.persons[a] || !doc.persons[b]) return null;
    const ex = unionBetween(doc, a, b);
    if (ex) return ex.id;
    const id = newId(doc, 'u');
    const [l, r] = doc.persons[a].x <= doc.persons[b].x ? [a, b] : [b, a];
    doc.unions[id] = { id, partners: [l, r], type: has(FAMILY_TYPES, type) ? type : 'Marriage', children: [], twins: [] };
    return id;
  }

  function addPartner(doc, pid) {
    const p = doc.persons[pid];
    if (!p) return null;
    const g = p.gender === 'M' ? 'F' : p.gender === 'F' ? 'M' : 'U';
    // 右邊已經有伴侶 → 新伴侶放左邊（「前任—本人—現任」的標準排法，兩條伴侶線才不會疊在一起）
    const others = unionsOf(doc, pid).map(u => u.partners.find(x => x !== pid)).filter(x => x && doc.persons[x]);
    const rightTaken = others.some(x => doc.persons[x].x > p.x), leftTaken = others.some(x => doc.persons[x].x < p.x);
    let dir = rightTaken && !leftTaken ? -1 : 1;
    // 旁邊的位置被別人（例如手足）佔住、另一側是空的 → 放另一側，伴侶線才不會從別人底下穿過
    const slot = (d) => snap(p.x + d * GAP_X);
    const otherSideFree = dir === 1 ? !leftTaken : !rightTaken;
    if (occupied(doc, slot(dir), p.y) && !occupied(doc, slot(-dir), p.y) && otherSideFree) dir = -dir;
    const nid = newId(doc, 'p');
    doc.persons[nid] = blankPerson(nid, g, freeSpot(doc, p.x + dir * GAP_X, p.y, dir), p.y);
    return { personId: nid, unionId: linkPartners(doc, pid, nid) };
  }

  function addChild(doc, unionId, gender) {
    const u = doc.unions[unionId];
    if (!u) return null;
    const ps = u.partners.map(id => doc.persons[id]).filter(Boolean);
    if (!ps.length) return null;
    const baseY = Math.max(...ps.map(p => p.y)) + GAP_Y;
    const kids = u.children.map(c => doc.persons[c.id]).filter(Boolean);
    const midX = ps.reduce((a, p) => a + p.x, 0) / ps.length;
    const x = kids.length ? Math.max(...kids.map(k => k.x)) + GAP_X * 0.8 : midX;
    const id = newId(doc, 'p');
    doc.persons[id] = blankPerson(id, has(GENDERS, gender) ? gender : 'U', freeSpot(doc, x, baseY, 1), baseY);
    u.children.push({ id, link: 'bio' });
    return id;
  }

  // 對「人」加子女：只有一段關係＝加在那段；沒有＝建單親家庭；多段＝回傳 needUnion 讓介面請使用者先點關係線
  function addChildToPerson(doc, pid, gender) {
    if (!doc.persons[pid]) return null;
    const us = unionsOf(doc, pid);
    if (us.length > 1) return { needUnion: true };
    let uid = us.length ? us[0].id : null;
    if (!uid) {
      uid = newId(doc, 'u');
      doc.unions[uid] = { id: uid, partners: [pid], type: 'Other', children: [], twins: [] };
    }
    return { personId: addChild(doc, uid, gender), unionId: uid };
  }

  function addParents(doc, pid) {
    const c = doc.persons[pid];
    if (!c) return null;
    if (parentUnionOf(doc, pid)) return { exists: true };
    const y = c.y - GAP_Y;
    const fid = newId(doc, 'p');
    doc.persons[fid] = blankPerson(fid, 'M', freeSpot(doc, c.x - GAP_X / 2, y, -1), y);
    const mid = newId(doc, 'p');
    doc.persons[mid] = blankPerson(mid, 'F', freeSpot(doc, doc.persons[fid].x + GAP_X, y, 1), y);
    const uid = linkPartners(doc, fid, mid);
    doc.unions[uid].children.push({ id: pid, link: 'bio' });
    return { fatherId: fid, motherId: mid, unionId: uid };
  }

  function addSibling(doc, pid, gender) {
    const u = parentUnionOf(doc, pid);
    if (!u) return { needParents: true };
    return { personId: addChild(doc, u.id, gender), unionId: u.id };
  }

  // 把某人加為某段關係的子女（例：先各自畫好再連起來）
  function attachChild(doc, unionId, pid) {
    const u = doc.unions[unionId];
    if (!u || !doc.persons[pid] || u.partners.includes(pid)) return false;
    const cur = parentUnionOf(doc, pid);
    if (cur) { cur.children = cur.children.filter(c => c.id !== pid); pruneTwins(cur); }
    u.children.push({ id: pid, link: 'bio' });
    return true;
  }

  // ── 雙胞胎：同一段關係底下的子女才能設為雙胞胎；一個人只屬於一組；少於 2 人的組自動拿掉 ──
  function pruneTwins(u) {
    const kids = new Set(u.children.map(c => c.id));
    u.twins = (u.twins || []).map(t => ({ ids: t.ids.filter(id => kids.has(id)), kind: t.kind }))
                             .filter(t => t.ids.length >= 2);
  }
  // 選到的人是不是同一段關係的子女（設雙胞胎前檢查用）；是的話回傳那段關係
  function commonParentUnion(doc, ids) {
    const us = ids.map(id => parentUnionOf(doc, id));
    return us.length >= 2 && us[0] && us.every(u => u === us[0]) ? us[0] : null;
  }
  function setTwins(doc, unionId, ids, kind) {
    const u = doc.unions[unionId];
    if (!u) return false;
    const kids = new Set(u.children.map(c => c.id));
    const group = Array.from(new Set(ids)).filter(id => kids.has(id));
    if (group.length < 2) return false;
    u.twins = (u.twins || []).map(t => ({ ids: t.ids.filter(id => !group.includes(id)), kind: t.kind }));
    u.twins.push({ ids: group, kind: has(TWIN_KINDS, kind) ? kind : 'Fraternal' });
    pruneTwins(u);
    return true;
  }
  function twinGroupOf(doc, pid) {
    for (const u of Object.values(doc.unions)) {
      const g = (u.twins || []).find(t => t.ids.includes(pid));
      if (g) return { union: u, group: g };
    }
    return null;
  }
  function clearTwin(doc, pid) {
    const hit = twinGroupOf(doc, pid);
    if (!hit) return false;
    hit.union.twins = hit.union.twins.map(t => ({ ids: t.ids.filter(id => id !== pid), kind: t.kind }));
    pruneTwins(hit.union);
    return true;
  }

  function addRelation(doc, a, b, type) {
    if (a === b || !doc.persons[a] || !doc.persons[b]) return null;
    const id = newId(doc, 'r');
    doc.relations[id] = { id, a, b, type: has(EMOTION_TYPES, type) ? type : 'Plain', note: '' };
    return id;
  }

  function addHousehold(doc, members, label) {
    const ms = Array.from(new Set(members)).filter(id => doc.persons[id]);
    if (!ms.length) return null;
    const id = newId(doc, 'h');
    doc.households[id] = { id, members: ms, label: String(label || '').slice(0, 30) };
    return id;
  }

  function addLabel(doc, x, y, text) {
    const id = newId(doc, 't');
    doc.labels[id] = { id, x: snap(x), y: snap(y), text: String(text == null ? '文字說明' : text).slice(0, 1000) };
    return id;
  }

  // 生態圖：外部系統（畫成圓，名稱寫在圓裡）
  function addSystem(doc, o) {
    const id = newId(doc, 's');
    doc.systems[id] = { id, name: str(o && o.name, 30), x: snap((o && o.x) || 0), y: snap((o && o.y) || 0) };
    return id;
  }
  // 生態連結：兩端可以是人、外部系統、或生活圈（＝整個家庭）；同一端不能連自己
  const tieEndExists = (doc, id) => !!(doc.persons[id] || doc.systems[id] || doc.households[id]);
  function addTie(doc, a, b, o) {
    if (a === b || !tieEndExists(doc, a) || !tieEndExists(doc, b)) return null;
    const id = newId(doc, 'e');
    const q = o || {};
    doc.ties[id] = { id, a, b,
      strength: has(TIE_STRENGTHS, q.strength) ? q.strength : 'normal',
      stress: !!q.stress,
      dir: has(TIE_DIRS, q.dir) ? q.dir : '',
      note: str(q.note, 60) };
    return id;
  }
  const tieBetween = (doc, a, b) => Object.values(doc.ties).find(t => (t.a === a && t.b === b) || (t.a === b && t.b === a)) || null;

  function moveItems(doc, ids, dx, dy) {
    for (const id of ids) {
      const o = doc.persons[id] || doc.labels[id] || doc.systems[id];
      if (o) { o.x += dx; o.y += dy; }
    }
  }
  function snapItems(doc, ids) {
    for (const id of ids) {
      const o = doc.persons[id] || doc.labels[id] || doc.systems[id];
      if (o) { o.x = snap(o.x); o.y = snap(o.y); }
    }
  }

  // 刪除：人→從所有關係移除；沒有伴侶、或只剩一位伴侶且沒有子女的關係一併刪；情感關係與生活圈同步清理
  function deleteItems(doc, ids) {
    for (const id of new Set(ids)) {
      delete doc.persons[id]; delete doc.unions[id]; delete doc.relations[id];
      delete doc.households[id]; delete doc.labels[id];
      delete doc.systems[id]; delete doc.ties[id];
    }
    for (const u of Object.values(doc.unions)) {
      u.partners = u.partners.filter(p => doc.persons[p]);
      u.children = u.children.filter(c => doc.persons[c.id]);
      pruneTwins(u);
      if (!u.partners.length || (u.partners.length === 1 && !u.children.length)) delete doc.unions[u.id];
    }
    for (const r of Object.values(doc.relations)) if (!doc.persons[r.a] || !doc.persons[r.b]) delete doc.relations[r.id];
    for (const h of Object.values(doc.households)) {
      h.members = h.members.filter(m => doc.persons[m]);
      if (!h.members.length) delete doc.households[h.id];
    }
    // 生態連結：任一端不見了就一起刪（人、資源、生活圈都算）
    for (const t of Object.values(doc.ties)) if (!tieEndExists(doc, t.a) || !tieEndExists(doc, t.b)) delete doc.ties[t.id];
  }

  // ── 復原／重做（快照式：每次變更前存整份 JSON；家系圖檔很小，這樣最不容易出錯）──
  class History {
    constructor(max) { this.max = max || 100; this.undoStack = []; this.redoStack = []; }
    push(doc) {
      this.undoStack.push(JSON.stringify(doc));
      if (this.undoStack.length > this.max) this.undoStack.shift();
      this.redoStack = [];
    }
    undo(doc) {
      if (!this.undoStack.length) return null;
      this.redoStack.push(JSON.stringify(doc));
      return JSON.parse(this.undoStack.pop());
    }
    redo(doc) {
      if (!this.redoStack.length) return null;
      this.undoStack.push(JSON.stringify(doc));
      return JSON.parse(this.redoStack.pop());
    }
    clear() { this.undoStack = []; this.redoStack = []; }
    get canUndo() { return this.undoStack.length > 0; }
    get canRedo() { return this.redoStack.length > 0; }
  }

  // ── 邊界正規化（模式 8：外部來的檔案一律在這裡驗證並重建，只留認得的欄位）──
  const str = (v, max) => (v == null ? '' : String(v)).slice(0, max);
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(-1e6, Math.min(1e6, n)) : 0; };
  // id 會拿來當物件鍵：__proto__ 等字串也符合字元規則，必須另外排除（驗收發現：否則會換掉集合的原型）
  const okId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) && !BAD_KEYS.has(v);
  const okKey = (k) => typeof k === 'string' && k.length > 0 && k.length <= 40 && !BAD_KEYS.has(k);
  const values = (o) => (o && typeof o === 'object' && !Array.isArray(o))
    ? Object.keys(o).filter(k => !BAD_KEYS.has(k)).map(k => o[k]) : [];

  class FormatError extends Error {}

  function normalizeDoc(raw) {
    if (!raw || typeof raw !== 'object' || raw.format !== FORMAT) throw new FormatError('not a genogram-tool document');
    if (typeof raw.version !== 'number' || raw.version > VERSION) throw new FormatError('unsupported version');
    const warn = [];
    const doc = newDoc();
    const m = raw.meta || {};
    doc.meta.title = str(m.title, 100);
    if (parseDate(m.assessDate)) doc.meta.assessDate = str(m.assessDate, 20);

    const s = raw.settings || {};
    if (Array.isArray(s.fields)) {
      const seen = new Set();
      doc.settings.fields = s.fields
        .filter(f => f && okKey(f.key) && !seen.has(f.key) && seen.add(f.key))
        .map(f => ({ key: f.key, label: str(f.label, 20) || f.key, show: !!f.show }));
    }
    doc.settings.labelMode = s.labelMode === 'labelled' ? 'labelled' : 'value';
    doc.settings.showYears = !!s.showYears;
    doc.settings.colorRelations = s.colorRelations !== false;
    doc.settings.view = has(VIEW_MODES, s.view) ? s.view : 'both';

    // id 在整份文件裡必須唯一：同一個 id 既是人又是資源的話，連結會靜默解析成其中一個（審查 2026-09-20）
    const taken = new Set();
    const freeId = (id) => { if (!okId(id) || taken.has(id)) return false; taken.add(id); return true; };
    const v1 = raw.version < 2;
    const own = (map, k) => (typeof k === 'string' && Object.prototype.hasOwnProperty.call(map, k) ? map[k] : undefined);
    for (const p of values(raw.persons)) {
      if (!p || !freeId(p.id)) { warn.push('person'); continue; }
      const q = blankPerson(p.id, has(GENDERS, p.gender) ? p.gender : 'U', 0, 0);
      q.x = num(p.x); q.y = num(p.y);
      q.name = str(p.name, 60); q.index = !!p.index; q.deceased = !!p.deceased;
      q.age = str(p.age, 5); q.birth = str(p.birth, 20); q.death = str(p.death, 20); q.deathAge = str(p.deathAge, 5);
      // v2 新欄位（v1 檔沒有 → 預設值；不認得的值一律回到預設）
      q.life = has(LIFE_STATES, p.life) ? p.life : '';
      q.culture = has(CULTURES, p.culture) ? p.culture : '';
      q.illness = has(ILLNESS, p.illness) ? p.illness : '';
      q.substance = has(SUBSTANCE, p.substance) ? p.substance : '';
      q.conditions = Array.isArray(p.conditions) ? Array.from(new Set(p.conditions.filter(k => has(CONDITIONS, k)))) : [];
      if (p.attrs && typeof p.attrs === 'object') {
        for (const k of Object.keys(p.attrs)) {
          if (!okKey(k)) continue;
          const v = str(p.attrs[k], 500);
          if (!v) continue;
          q.attrs[k] = v;
          // 資料裡有、欄位表沒有的欄位：補進欄位表（不丟資料），預設不顯示
          if (!doc.settings.fields.some(f => f.key === k)) doc.settings.fields.push({ key: k, label: k, show: false });
        }
      }
      doc.persons[q.id] = q;
    }
    const P = doc.persons;
    for (const u of values(raw.unions)) {
      if (!u || !freeId(u.id) || !Array.isArray(u.partners)) { warn.push('union'); continue; }
      const partners = Array.from(new Set(u.partners.filter(id => P[id]))).slice(0, 2);
      const seenKid = new Set();
      const children = (Array.isArray(u.children) ? u.children : [])
        .filter(c => c && P[c.id] && !partners.includes(c.id) && !seenKid.has(c.id) && seenKid.add(c.id))
        .map(c => ({ id: c.id, link: has(CHILD_LINKS, c.link) ? c.link : 'bio' }));
      if (!partners.length) { warn.push('union'); continue; }
      let type;
      if (v1) {   // v1：類型＋狀態兩欄；有 GenoPro 原值（gp）就直接用原值，最準
        const end = ['', 'separated', 'divorced'].includes(u.end) ? u.end : '';
        type = has(FAMILY_TYPES, u.gp) ? u.gp : (own(V1_UNION, u.type) || V1_UNION.married)[end];
      } else type = has(FAMILY_TYPES, u.type) ? u.type : 'Other';
      // 雙胞胎：成員必須是這段關係的子女、同一人只能在一組、每組至少 2 人
      const kids = new Set(children.map(c => c.id)), used = new Set(), twins = [];
      for (const t of (v1 || !Array.isArray(u.twins) ? [] : u.twins)) {
        const ids = Array.isArray(t && t.ids) ? Array.from(new Set(t.ids.filter(id => kids.has(id) && !used.has(id)))) : [];
        if (ids.length < 2) continue;
        ids.forEach(id => used.add(id));
        twins.push({ ids, kind: has(TWIN_KINDS, t.kind) ? t.kind : 'Fraternal' });
      }
      doc.unions[u.id] = { id: u.id, partners, children, type, twins };
    }
    for (const r of values(raw.relations)) {
      if (!r || !freeId(r.id) || !P[r.a] || !P[r.b] || r.a === r.b) { warn.push('relation'); continue; }
      let type, note = str(r.note, 300);
      if (v1) {
        type = has(EMOTION_TYPES, r.gp) ? r.gp : (own(V1_RELATION, r.type) || 'Other');
        // 「關係惡化」是 Word 範本才有的類型，參考圖沒有 → 轉成不和／衝突，原類型寫進備註，不讓意思消失
        if (r.type === 'deteriorating' && !has(EMOTION_TYPES, r.gp)) note = ('原類型：關係惡化' + (note ? '；' + note : '')).slice(0, 300);
      } else type = has(EMOTION_TYPES, r.type) ? r.type : 'Other';
      doc.relations[r.id] = { id: r.id, a: r.a, b: r.b, type, note };
    }
    for (const h of values(raw.households)) {
      if (!h || !freeId(h.id) || !Array.isArray(h.members)) { warn.push('household'); continue; }
      const members = Array.from(new Set(h.members.filter(id => P[id])));
      if (!members.length) { warn.push('household'); continue; }
      doc.households[h.id] = { id: h.id, members, label: str(h.label, 30) };
    }
    for (const t of values(raw.labels)) {
      if (!t || !freeId(t.id)) { warn.push('label'); continue; }
      doc.labels[t.id] = { id: t.id, x: num(t.x), y: num(t.y), text: str(t.text, 1000) };
    }
    // v3：外部系統與生態連結（v2 以前的檔沒有這兩塊 → 空的）
    for (const y of values(raw.systems)) {
      if (!y || !freeId(y.id)) { warn.push('system'); continue; }
      doc.systems[y.id] = { id: y.id, x: num(y.x), y: num(y.y), name: str(y.name, 30) };
    }
    for (const e of values(raw.ties)) {
      const ok = e && freeId(e.id) && e.a !== e.b && tieEndExists(doc, e.a) && tieEndExists(doc, e.b);
      if (!ok) { warn.push('tie'); continue; }
      doc.ties[e.id] = { id: e.id, a: e.a, b: e.b,
        strength: has(TIE_STRENGTHS, e.strength) ? e.strength : 'normal',
        stress: !!e.stress,
        dir: has(TIE_DIRS, e.dir) ? e.dir : '',
        note: str(e.note, 60) };
    }
    // 流水號至少要大於現存最大編號，之後新增才不會撞 id
    let maxSeq = Math.max(0, Math.floor(Number(raw.seq)) || 0);
    for (const coll of [doc.persons, doc.unions, doc.relations, doc.households, doc.labels, doc.systems, doc.ties])
      for (const id of Object.keys(coll)) { const n = parseInt(id.replace(/^\D+/, ''), 10); if (n > maxSeq) maxSeq = n; }
    for (const f of doc.settings.fields) { const n = parseInt(String(f.key).replace(/^f/, ''), 10); if (/^f\d+$/.test(f.key) && n > maxSeq) maxSeq = n; }
    doc.seq = maxSeq;
    return { doc, warnings: warn };
  }

  function serialize(doc) {
    return JSON.stringify(Object.assign({}, doc, { format: FORMAT, version: VERSION }), null, 1);
  }

  // ── 錯誤咽喉（模式 18／鐵律 11）：使用者只看到「狀態＋下一步＋代碼」，技術細節只進記錄 ──
  const MESSAGES = {
    OPEN:      '檔案無法開啟：格式不符或檔案已損毀。請確認選的是本工具存的檔案，或 GenoPro 的 .gno 檔。',
    GNO:       'GenoPro 檔案讀取失敗：檔案可能已損毀，或是本工具還不支援的版本。原檔沒有被修改。',
    GNO_LOCK:  '這個 GenoPro 檔案有設定密碼，無法讀取。請先在 GenoPro 取消密碼並另存一份，再匯入那一份。',
    TOO_LARGE: '檔案太大，不像是一般的家系圖檔，已停止讀取。請確認選的是正確的檔案。',
    SAVE:      '儲存失敗，檔案沒有寫入。請再按一次「儲存」，或改用「另存新檔」存到其他位置。',
    EXPORT:    '匯出圖片失敗，沒有產生檔案。請再試一次；若持續發生，請改用「匯出 SVG」。',
    CLIPBOARD: '無法複製到剪貼簿（瀏覽器沒有允許）。請改用「匯出 PNG」，再從 Word 插入圖片。',
    UNEXPECTED:'發生未預期的狀況，剛才的操作可能沒有完成。建議先按「另存新檔」保存目前的圖。',
  };
  const log = [];   // 記錄（最多 200 筆）；只在開發者工具主控台看得到

  function randHex(n) {
    const a = new Uint8Array(n);
    if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  function fail(code, err) {
    const c = MESSAGES[code] ? code : 'UNEXPECTED';
    const ref = `${c}-${randHex(2)}`;
    log.push({ time: new Date().toISOString(), ref, code: c, detail: err ? String((err && err.stack) || err) : '' });
    if (log.length > 200) log.shift();
    if (globalThis.console && !GT.quietLog) console.error('[家系圖工具]', ref, err);
    return { ref, message: `${MESSAGES[c]}（代碼 ${ref}）` };
  }

  Object.assign(GT, {
    FORMAT, VERSION, S, GRID, GAP_X, GAP_Y,
    FAMILY_CATS, FAMILY_TYPES, CHILD_LINKS, TWIN_KINDS, EMOTION_CATS, EMOTION_TYPES, GENDERS, DEFAULT_FIELDS,
    LIFE_STATES, CULTURES, ILLNESS, SUBSTANCE, CONDITIONS, V1_UNION, V1_RELATION,
    SYSTEM_CATS, SYSTEM_PRESETS, TIE_STRENGTHS, TIE_DIRS, VIEW_MODES,
    labelOf, clone, snap, todayISO,
    newDoc, newId, parseDate, formatDate, yearsBetween, ageOf,
    charEm, textEm, wrapText, labelLines, LABEL_WRAP_EM, suggestionsFor,
    addField, renameField, fieldUsage, removeField, moveField,
    unionsOf, parentUnionOf, unionBetween,
    addPerson, linkPartners, addPartner, addChild, addChildToPerson, addParents, addSibling, attachChild,
    commonParentUnion, setTwins, twinGroupOf, clearTwin,
    addRelation, addHousehold, addLabel, moveItems, snapItems, deleteItems,
    addSystem, addTie, tieBetween, tieEndExists,
    History, normalizeDoc, serialize, FormatError,
    MESSAGES, log, fail,
  });
})(globalThis.GT = globalThis.GT || {});
