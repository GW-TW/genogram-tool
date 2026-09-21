/* gno.js 測試：ZIP 解壓、XML 對應、類型對照完整性、匯入報告 */

const byName = (doc, name) => Object.values(doc.persons).find(p => p.name === name);
const fieldKey = (doc, label) => (doc.settings.fields.find(f => f.label === label) || {}).key;

T.test('ZIP：deflate 與 stored 兩種壓縮都讀得到', async () => {
  const e1 = GT.gno.zipEntries(fixBytes('synDeflate'));
  T.eq(e1.map(e => [e.name, e.method]), [['Data.xml', 8]]);
  const e2 = GT.gno.zipEntries(fixBytes('synStored'));
  T.eq(e2.map(e => [e.name, e.method]), [['Data.xml', 0]]);
  const x1 = new TextDecoder().decode(await GT.gno.zipRead(fixBytes('synDeflate'), e1[0]));
  const x2 = new TextDecoder().decode(await GT.gno.zipRead(fixBytes('synStored'), e2[0]));
  T.ok(x1.startsWith('<?xml') && x1 === x2, '兩種解出來內容相同');
});

T.test('真實 GenoPro 檔（Document1.gno）', async () => {
  const { doc, report } = await GT.gno.readGno(fixBytes('document1'));
  const ps = Object.values(doc.persons);
  T.eq(ps.length, 5, '5 人');
  T.eq(ps.filter(p => p.gender === 'M').length, 2, '男 2');
  T.eq(ps.filter(p => p.gender === 'F').length, 3, '女 3');
  T.eq(ps.filter(p => p.deceased).length, 1, '已歿 1');
  const us = Object.values(doc.unions);
  T.eq(us.length, 1, '1 個家庭');
  T.eq(us[0].partners.length, 2);
  T.eq(us[0].children.map(c => c.link), ['bio', 'bio', 'bio']);
  T.eq(Object.values(doc.relations).map(r => r.type).sort(), ['Discord', 'Harmony'], 'GenoPro 代碼一對一保留');
  const parentY = Math.max(...us[0].partners.map(id => doc.persons[id].y));
  T.ok(us[0].children.every(c => doc.persons[c.id].y > parentY), 'y 軸翻轉：子女在父母下方');
  T.ok(ps.every(p => p.x % GT.GRID === 0 && p.y % GT.GRID === 0), '座標吸附到格線');
  T.eq(report.customFields, []);
  T.eq(Object.values(report.skipped).reduce((a, b) => a + b, 0), 0, '沒有略過任何東西');
  // 回歸：GenoPro 世代間距很緊，直接等比縮放會讓伴侶線掉到子女頭頂下面、親子線往上折
  const gen = Math.min(...us[0].children.map(c => doc.persons[c.id].y)) - parentY;
  T.ok(gen >= GT.GAP_Y - 20 && gen <= GT.GAP_Y + 20, `世代間距換算成本工具的間距（實得 ${gen}）`);
  const g = GT.render.unionGeometry(doc, us[0]);
  const kidTop = Math.min(...us[0].children.map(c => doc.persons[c.id].y)) - GT.render.HALF;
  T.ok(g.yLine < g.ySib && g.ySib < kidTop, '伴侶線 → 手足線 → 子女，由上往下');
});

T.test('合成檔：人物欄位', async () => {
  const { doc } = await GT.gno.readGno(fixBytes('synDeflate'));
  T.eq(Object.keys(doc.persons).length, 5);
  const wang = byName(doc, '王大明');
  T.ok(wang, '中文姓名＝姓＋名');
  T.eq(wang.gender, 'M');
  T.eq(wang.birth, '1950-03-15', '「15 Mar 1950」轉成 1950-03-15');
  T.eq(wang.attrs.occupation, '工人', '<Occupations><Occupation><Title> → 職業');
  T.eq(wang.attrs.economy, '低收入戶', '自訂的 <經濟> 併入預設「經濟」欄位');
  T.eq(wang.attrs.note, '長期失業', 'Comment → 備註');
  const lee = byName(doc, '李美麗');
  T.ok(lee, '只有 First/Last 也能組出中文姓名');
  T.ok(lee.deceased, 'IsDead=Y');
  T.eq([lee.death, lee.deathAge], ['2019', '65']);
  T.eq(lee.attrs[fieldKey(doc, '宗教')], '佛教', '<CustomTags> 底下的自訂欄位');
  const john = byName(doc, 'John Smith');
  T.eq(john.birth, '1980', 'ABT 1980 → 1980');
  T.eq(john.attrs[fieldKey(doc, 'GenoPro 下標籤')], '高風險', '圖下方標籤文字保留');
  T.eq(Object.values(doc.persons).filter(p => p.gender === 'U').length, 1, '_Blank → 未知性別');
  T.ok(!doc.settings.fields.find(f => f.label === '宗教').show, '帶入的自訂欄位預設不顯示在圖上');
});

T.test('合成檔：家庭、親子、情感關係', async () => {
  const { doc } = await GT.gno.readGno(fixBytes('synDeflate'));
  const wang = byName(doc, '王大明'), lee = byName(doc, '李美麗'), john = byName(doc, 'John Smith');
  const us = Object.values(doc.unions);
  T.eq(us.length, 2, '沒有有效伴侶的家庭略過');
  const div = us.find(u => u.partners.includes(lee.id));
  T.eq(div.partners, [wang.id, lee.id], '伴侶依左右排序');
  T.eq([div.type, div.twins.map(t => t.kind)], ['Divorce', ['Identical']], '離婚＋同卵雙胞胎（Twin 物件）一起帶入');
  T.eq(div.children.map(c => c.link), ['bio', 'adopted'], 'Adopted → 收養');
  const co = us.find(u => u !== div);
  T.eq([co.type, co.twins], ['Cohabitation', []]);
  const rs = Object.values(doc.relations);
  T.eq(rs.length, 3, '連到非人物的情感線略過');
  T.eq(rs.find(r => r.b === john.id && r.a === wang.id).type, 'HostileClose');
  const abuse = rs.find(r => r.type === 'AbuseSexual');
  T.eq(abuse.note, '通報中', '類型本身就是性虐待，備註只留原本的註解');
  T.eq(abuse.a, wang.id, '虐待方向保留（加害→受害）');
  const other = rs.find(r => r.type === 'Other');
  T.eq(other.note, 'SomethingNew', '不認得的類型 → 其他，原值寫進備註');
  T.ok(john.y > wang.y, '子女在下方');
});

T.test('合成檔：匯入報告與文字標籤', async () => {
  const { doc, report } = await GT.gno.readGno(fixBytes('synDeflate'));
  T.eq(report.customFields, ['宗教', 'GenoPro 下標籤']);
  T.eq(report.skipped, { twins: 0, shapes: 0, social: 1, pictures: 1, households: 0, links: 1, fields: 0 }, '雙胞胎已帶入，不再算略過');
  T.eq(Object.values(doc.labels).map(t => t.text), ['主要照顧者：母']);
  const lines = GT.gno.describeReport(report);
  T.ok(lines[0].includes('1 組雙胞胎'), '報告提到帶入的雙胞胎');
  T.ok(lines.some(l => l.includes('宗教')), '報告列出帶入的自訂欄位');
  T.ok(lines.every(l => !T.TECH.test(l)), '報告不含技術字眼');
});

T.test('合成檔：stored ZIP、未壓縮 XML 結果一致', async () => {
  const a = await GT.gno.readGno(fixBytes('synDeflate'));
  const b = await GT.gno.readGno(fixBytes('synStored'));
  const c = await GT.gno.readGno(fixBytes('synPlain'));
  const sig = (r) => Object.values(r.doc.persons).map(p => [p.name, p.gender, p.x, p.y]);
  T.eq(sig(b), sig(a), 'stored');
  T.eq(sig(c), sig(a), '未壓縮 XML');
});

T.test('匯入結果可以正常存檔再開', async () => {
  const { doc } = await GT.gno.readGno(fixBytes('synDeflate'));
  const back = GT.normalizeDoc(JSON.parse(GT.serialize(doc)));
  T.eq(back.warnings, [], '匯入產生的文件本身是合法的');
  T.eq(back.doc.persons, doc.persons);
  T.eq(back.doc.unions, doc.unions);
});

T.test('壞檔：加密、非 GenoPro', async () => {
  await T.throws(() => GT.gno.readGno(fixBytes('synLocked')), GT.gno.GnoLockedError, '有密碼的檔');
  await T.throws(() => GT.gno.readGno(fixBytes('garbage')), GT.gno.GnoError, '不是 GenoPro');
  await T.throws(() => GT.gno.readGno(new TextEncoder().encode('<?xml version="1.0"?><Other/>')), GT.gno.GnoError, '根節點不是 GenoPro');
  await T.throws(() => GT.gno.readGno(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])), GT.gno.GnoError, '殘缺的 ZIP');
});

T.test('惡意 .gno：ID 與類型值用 __proto__／constructor 不會崩也不會污染（回歸：驗收 #1）', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><GenoPro><Individuals>
    <Individual ID="__proto__"><Position>0,0</Position><Gender>M</Gender><Name>甲</Name></Individual>
    <Individual ID="constructor"><Position>100,0</Position><Gender>F</Gender><Name>乙</Name></Individual>
    <Individual ID="k1"><Position>50,-80</Position><Gender>M</Gender><Name>丙</Name></Individual></Individuals>
    <Families><Family ID="prototype"><Relation>constructor</Relation></Family></Families>
    <PedigreeLinks><PedigreeLink PedigreeLink="Parent" Family="prototype" Individual="__proto__"/>
      <PedigreeLink PedigreeLink="Parent" Family="prototype" Individual="constructor"/>
      <PedigreeLink PedigreeLink="toString" Family="prototype" Individual="k1"/></PedigreeLinks>
    <EmotionalRelationships><EmotionalRelationship EmotionalLink="__proto__" Entity1="__proto__" Entity2="constructor"/></EmotionalRelationships></GenoPro>`;
  const { doc } = await GT.gno.readGno(new TextEncoder().encode(xml));
  T.eq(Object.values(doc.persons).map(p => p.name).sort(), ['丙', '乙', '甲'], '三個人都在');
  const u = Object.values(doc.unions);
  T.eq(u.length, 1, '家庭照樣建立');
  T.eq([u[0].type, u[0].twins], ['Other', []], '不認得的關係值 → 其他，而不是查到內建函式');
  T.eq(u[0].children.map(c => c.link), ['bio'], '不認得的親子類型 → 親生');
  T.eq(Object.values(doc.relations).map(r => r.type), ['Other'], '不認得的情感類型 → 其他');
  T.eq(({}).polluted, undefined);
  T.eq(Object.getPrototypeOf(doc.persons), Object.prototype, '集合的原型沒被換掉');
});

T.test('大小上限：宣告過大、宣告造假、未壓縮 XML 都會被擋（回歸：驗收 #2）', async () => {
  const E = GT.gno.GnoTooLargeError;
  await T.throws(() => GT.gno.readGno(fixBytes('synDeflate'), { maxXml: 100 }), E, 'ZIP 宣告的解壓大小超過上限');
  const lying = fixBytes('synDeflate').slice();
  const cd = lying.findIndex((b, i) => b === 0x50 && lying[i + 1] === 0x4b && lying[i + 2] === 1 && lying[i + 3] === 2);
  lying[cd + 24] = 10; lying[cd + 25] = 0; lying[cd + 26] = 0; lying[cd + 27] = 0;   // 把宣告大小改成 10 bytes（造假）
  await T.throws(() => GT.gno.readGno(lying, { maxXml: 100 }), E, '宣告造假時，邊解壓邊計數照樣擋下');
  await T.throws(() => GT.gno.readGno(fixBytes('synStored'), { maxXml: 100 }), E, '未壓縮的 ZIP 內容');
  await T.throws(() => GT.gno.readGno(fixBytes('synPlain'), { maxXml: 100 }), E, '直接是 XML 的檔');
  T.ok((await GT.gno.readGno(fixBytes('synDeflate'))).doc, '正常大小不受影響');
  T.ok(GT.gno.MAX_XML >= 10 * 1024 * 1024, '預設上限不會小到擋掉正常的大家系圖');
});

T.test('XML 有實體宣告一律拒絕（回歸：驗收 #7）', async () => {
  const xml = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]><GenoPro><Individuals/></GenoPro>';
  await T.throws(() => GT.gno.readGno(new TextEncoder().encode(xml)), GT.gno.GnoError, '含 ENTITY');
});

T.test('自訂欄位數量有上限，超過的寫進報告（回歸：驗收 #2 附帶）', async () => {
  const extra = Array.from({ length: 50 }, (_, k) => `<欄${k}>值${k}</欄${k}>`).join('');
  const xml = `<?xml version="1.0"?><GenoPro><Individuals><Individual ID="i1"><Position>0,0</Position><Gender>M</Gender>${extra}</Individual></Individuals></GenoPro>`;
  const { doc, report } = await GT.gno.readGno(new TextEncoder().encode(xml));
  T.eq(doc.settings.fields.length, GT.gno.MAX_FIELDS, '欄位總數停在上限');
  T.eq(report.skipped.fields, 50 - (GT.gno.MAX_FIELDS - GT.DEFAULT_FIELDS.length), '超過的種數有記錄');
  T.ok(GT.gno.describeReport(report).some(l => l.includes('超過欄位數上限')), '報告有說明，不是靜默丟掉');
});

T.test('GenoPro 日期格式', () => {
  const p = GT.gno.parseGnoDate;
  T.eq(p('15 Mar 1950'), '1950-03-15');
  T.eq(p('Mar 1950'), '1950-03');
  T.eq(p('1950'), '1950');
  T.eq(p('ABT 1950'), '1950');
  T.eq(p('BET 1950 AND 1960'), '1950');
  T.eq(p('1950-3-8'), '1950-03-08');
  T.eq(p(''), '');
  T.eq(p('unknown'), '');
});

T.test('姓名組合', () => {
  const el = (s) => new DOMParser().parseFromString(s, 'application/xml').documentElement;
  T.eq(GT.gno.nameOf(el('<Name>小明 王<First>小明</First><Last>王</Last></Name>')), '王小明', '中文一律姓在前、不留空白');
  T.eq(GT.gno.nameOf(el('<Name><First>John</First><Last>Smith</Last></Name>')), 'John Smith');
  T.eq(GT.gno.nameOf(el('<Name>陳阿姨</Name>')), '陳阿姨');
  T.eq(GT.gno.nameOf(null), '');
});

T.test('類型對照完整：GenoPro 每個列舉值都有對應', () => {
  // 清單取自 GenoPro 3.0.1.5 執行檔內建的 Enumerations（FamilyRelation 26 個、EmotionalLink 37 個）
  const FAMILY = ['Marriage', 'Separation', 'SeparationLegal', 'Divorce', 'Nullity', 'Widowed', 'Engagement',
    'EngagementAndCohabitation', 'EngagementAndSeparation', 'LegalCohabitation', 'LegalCohabitationAndSeparation',
    'LegalCohabitationAndLegalSeparation', 'Cohabitation', 'CohabitationAndSeparation', 'NonSentimentalCohabitation',
    'NonSentimentalCohabitationAndSeparation', 'CommittedRelationship', 'CommittedRelationshipAndSeparation', 'Liaison',
    'CasualRelationship', 'CasualRelationshipAndSeparation', 'TemporaryRelation', 'LoveAffair', 'LoveAffairAndSeparation',
    'Rape', 'Other'];
  const EMOTION = ['Plain', 'Indifferent', 'Distant', 'Cutoff', 'CutoffRepaired', 'Discord', 'Hate', 'Harmony',
    'Friendship', 'Intimacy', 'Love', 'InLove', 'Psyritual', 'Fused', 'Distrust', 'Hostile', 'HostileDistant',
    'HostileClose', 'HostileFused', 'Violence', 'ViolenceDistant', 'ViolenceClose', 'ViolenceFused', 'Abuse',
    'AbusePhysical', 'AbuseEmotional', 'AbuseSexual', 'AbuseNeglect', 'Manipulative', 'Controlling', 'Jealous',
    'FocusedOn', 'FocusedOnNegatively', 'Fan', 'Limerence', 'NeverMet', 'Other'];
  T.eq(FAMILY.length, 26); T.eq(EMOTION.length, 37);
  T.eq(FAMILY.filter(k => !GT.gno.isFamilyType(k)), [], '家庭關係 26 種全部直接對應（v2 一對一）');
  T.eq(EMOTION.filter(k => !GT.gno.isEmotionType(k)), [], '情感關係 37 種全部直接對應（v2 一對一）');
  T.eq(GT.FAMILY_TYPES.map(t => t.key).sort(), FAMILY.slice().sort(), '本工具的家庭類型剛好就是這 26 種');
  T.eq(GT.EMOTION_TYPES.filter(t => t.key !== 'Caretaker').map(t => t.key).sort(), EMOTION.slice().sort(), '情感類型＝這 37 種＋看護');
});

/* ── v2（2026-09-18）：寵物、流產、墮胎、死產、懷孕、移民、看護、雙胞胎 ── */

T.test('匯入：寵物、流產、墮胎、死產、懷孕、移民、看護、雙胞胎（PedigreeLink 的 Twin）', async () => {
  const xml = `<?xml version="1.0"?><GenoPro><Individuals>
    <Individual ID="m"><Position>0,0</Position><Gender>M</Gender><Name>父</Name><SpecialSymbol>Immigration</SpecialSymbol></Individual>
    <Individual ID="f"><Position>100,0</Position><Gender>F</Gender><Name>母</Name></Individual>
    <Individual ID="k1"><Position>0,-80</Position><Gender>M</Gender><Name>甲</Name></Individual>
    <Individual ID="k2"><Position>60,-80</Position><Gender>F</Gender><Name>乙</Name></Individual>
    <Individual ID="k3"><Position>120,-80</Position><Gender>_Blank</Gender><IsDead>Y</IsDead><Death><Cause>Miscarriage</Cause></Death></Individual>
    <Individual ID="k4"><Position>180,-80</Position><Gender>_Blank</Gender><IsDead>Y</IsDead><Death><Cause>Abortion</Cause></Death></Individual>
    <Individual ID="k5"><Position>240,-80</Position><Gender>M</Gender><IsDead>Y</IsDead><Death><Cause>Stillbirth</Cause></Death></Individual>
    <Individual ID="k6"><Position>300,-80</Position><Gender>_Blank</Gender><Birth><PregnancyLength>20 weeks</PregnancyLength></Birth></Individual>
    <Individual ID="pet"><Position>360,-80</Position><Gender>P</Gender><Name>小黑</Name></Individual></Individuals>
    <Families><Family ID="f1"><Relation>SeparationLegal</Relation></Family><Family ID="f2"><Relation>Bogus</Relation></Family></Families>
    <PedigreeLinks>
      <PedigreeLink PedigreeLink="Parent" Family="f1" Individual="m"/><PedigreeLink PedigreeLink="Parent" Family="f1" Individual="f"/>
      <PedigreeLink PedigreeLink="Biological" Family="f1" Individual="k1" Twin="t1"/><PedigreeLink PedigreeLink="Biological" Family="f1" Individual="k2" Twin="t1"/>
      <PedigreeLink PedigreeLink="Biological" Family="f1" Individual="k3"/><PedigreeLink PedigreeLink="Biological" Family="f1" Individual="k4"/>
      <PedigreeLink PedigreeLink="Biological" Family="f1" Individual="k5"/><PedigreeLink PedigreeLink="Biological" Family="f1" Individual="k6"/>
      <PedigreeLink PedigreeLink="Biological" Family="f1" Individual="pet"/>
      <PedigreeLink PedigreeLink="Parent" Family="f2" Individual="m"/><PedigreeLink PedigreeLink="Parent" Family="f2" Individual="pet"/></PedigreeLinks>
    <Twins><Twin ID="t1" TwinLink="Fraternal" Family="f1"/></Twins>
    <SocialRelationships><SocialRelationship Connection="Caretaker" Entity1="f" Entity2="k1"/><SocialRelationship Connection="Neighbor" Entity1="m" Entity2="f"/></SocialRelationships>
  </GenoPro>`;
  const { doc, report } = await GT.gno.readGno(new TextEncoder().encode(xml));
  const ps = Object.values(doc.persons);
  T.eq(byName(doc, '小黑').gender, 'P', '寵物');
  T.eq(ps.filter(p => p.life === 'miscarriage').length, 1, '流產（GenoPro 記在死因 Miscarriage）');
  T.eq(ps.filter(p => p.life === 'abortion').length, 1, '墮胎（死因 Abortion）');
  T.ok(ps.filter(p => p.life).every(p => !p.deceased), '流產／墮胎／懷孕不再另外打叉');
  const still = ps.find(p => Object.values(p.attrs).includes('死產'));
  T.ok(still && still.deceased, '死產＝已歿＋備註');
  T.eq(ps.filter(p => p.life === 'pregnancy').length, 1, '有懷孕週數、沒有出生日期 → 懷孕');
  T.eq(byName(doc, '父').culture, 'immigration', '移民');
  const u = Object.values(doc.unions).find(x => x.children.length);
  T.eq(u.type, 'SeparationLegal', '合法分居一對一');
  T.eq(u.twins, [{ ids: [byName(doc, '甲').id, byName(doc, '乙').id], kind: 'Fraternal' }], 'Twin 沒寫 Siblings 時，從 PedigreeLink 的 Twin 找成員');
  T.eq(Object.values(doc.relations).filter(r => r.type === 'Caretaker').map(r => [r.a, r.b]),
       [[byName(doc, '母').id, byName(doc, '甲').id]], '看護：照顧者 → 被照顧的人');
  T.eq(report.skipped.social, 1, '其他社會關係（鄰居）計入略過');
  T.eq(report.unknownTypes, 1, '不認得的家庭關係（Bogus）計入報告');
  T.ok(GT.gno.describeReport(report).some(l => l.includes('不認得')), '報告有說明');
});

T.test('回歸：GenoPro 不認得的伴侶關係類型，原名寫進線旁說明（審查 2026-09-21）', async () => {
  const xml = `<?xml version="1.0"?><GenoPro><Individuals>
    <Individual ID="m"><Position>0,0</Position><Gender>M</Gender></Individual>
    <Individual ID="f"><Position>100,0</Position><Gender>F</Gender></Individual></Individuals>
    <Families><Family ID="f1"><Relation>Bogus</Relation></Family></Families>
    <PedigreeLinks><PedigreeLink PedigreeLink="Parent" Family="f1" Individual="m"/>
      <PedigreeLink PedigreeLink="Parent" Family="f1" Individual="f"/></PedigreeLinks></GenoPro>`;
  const { doc, report } = await GT.gno.readGno(new TextEncoder().encode(xml));
  const u = Object.values(doc.unions)[0];
  T.eq(u.type, 'Other', '不認得的類型標成「其他」');
  T.eq(u.note, 'Bogus', '原本的類型寫在線旁說明（跟情感關係一致）');
  T.ok(GT.render.lineLabels(doc).some(L => L.text.includes('Bogus')), '圖上看得到原本的類型');
  T.ok(GT.gno.describeReport(report).some(l => l.includes('線旁說明')), '匯入報告說的位置跟實際一致');
});
