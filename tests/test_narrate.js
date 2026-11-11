/* narrate.js 測試：家系圖轉文字敘述（2026-11-11）
 * 用詞（使用者 2026-11-11 決定）：主述的人稱「服務使用者」；案父、案母、案兄、案弟等親屬稱謂維持。
 * 三條原則各有守衛：只寫圖上畫的、不靜默丟人、只產生純文字。
 */

// 四代的大家庭：每一種稱謂至少一個人
function narrFamily() {
  const d = GT.newDoc();
  d.meta.assessDate = '2026-11-11';
  const id = {};
  const P = (key, g, name, x, y, over) => { id[key] = GT.addPerson(d, { gender: g, x, y, name }); Object.assign(d.persons[id[key]], over || {}); return id[key]; };
  const U = (key, a, b, type, kids) => { id[key] = GT.linkPartners(d, a, b, type); d.unions[id[key]].children = (kids || []).map(k => ({ id: k, link: 'bio' })); return id[key]; };
  // 第一代
  P('gf', 'M', '王祖', -300, 0, { deceased: true, deathAge: '80' }); P('gm', 'F', '李祖母', -200, 0, { age: '85' });
  P('mgf', 'M', '陳外公', 200, 0); P('mgm', 'F', '林外婆', 300, 0);
  // 第二代：父親的手足（由左到右＝長幼）、母親的手足
  P('uncle', 'M', '王伯', -600, 160); P('aunt', 'F', '王姑', -500, 160); P('fa', 'M', '王父', -300, 160, { age: '70', illness: 'active', conditions: ['Diabetes'] });
  P('shu', 'M', '王叔', -200, 160); P('mo', 'F', '陳母', 100, 160, { age: '68' }); P('jiu', 'M', '陳舅', 200, 160); P('yi', 'F', '陳姨', 300, 160);
  P('bomu', 'F', '林氏', -700, 160); P('guzhang', 'M', '張強', -450, 160); P('jiumu', 'F', '吳氏', 250, 160);
  P('exwife', 'F', '父前妻', -900, 160);
  // 第三代
  P('bro', 'M', '王兄', -300, 320, { substance: 'suspected' }); P('me', 'M', '王小明', -200, 320, { index: true, age: '42' });
  P('sis1', 'F', '王大妹', -100, 320); P('sis2', 'F', '王二妹', 0, 320); P('di', 'M', '王弟', 100, 320);
  P('wife', 'F', '陳怡君', -150, 320, { age: '40' }); P('sao', 'F', '嫂嫂', -350, 320); P('meifu', 'M', '孫強', -50, 320);
  P('half', 'M', '同父兄', -800, 320); P('tang', 'M', '堂哥', -650, 320); P('biao', 'F', '張小美', -480, 320);
  P('wf', 'M', '陳岳', 400, 160); P('wm', 'F', '周氏', 500, 160);
  P('other', 'F', '某某', 600, 320);
  // 第四、五代
  P('son1', 'M', '王長子', -250, 480, { age: '18' }); P('dau', 'F', '王女', -150, 480); P('son2', 'M', '王次子', -50, 480);
  P('xifu', 'F', '錢氏', -300, 480); P('nuxu', 'M', '趙剛', -100, 480);
  P('zhi', 'M', '姪子', -400, 480); P('waisheng', 'F', '孫小妹', 50, 480);
  P('sun', 'M', '孫子', -280, 640); P('waisun', 'F', '趙小妹', -120, 640);
  P('stranger', 'U', '路人', 2000, 2000);
  U('ug', id.gf, id.gm, 'Marriage', [id.uncle, id.aunt, id.fa, id.shu]);
  U('um', id.mgf, id.mgm, 'Marriage', [id.mo, id.jiu, id.yi]);
  U('up', id.fa, id.mo, 'Marriage', [id.bro, id.me, id.sis1, id.sis2, id.di]);
  U('uex', id.fa, id.exwife, 'Divorce', [id.half]);
  U('uu', id.uncle, id.bomu, 'Marriage', [id.tang]); U('ua', id.aunt, id.guzhang, 'Marriage', [id.biao]); U('uj', id.jiu, id.jiumu, 'Marriage', []);
  U('uw', id.me, id.wife, 'Marriage', [id.son1, id.dau, id.son2]); d.unions[id.uw].note = '2010 結婚';
  U('uwp', id.wf, id.wm, 'Marriage', [id.wife]);
  U('ub', id.bro, id.sao, 'Marriage', [id.zhi]); U('us', id.sis1, id.meifu, 'Marriage', [id.waisheng]);
  U('us1', id.son1, id.xifu, 'Marriage', [id.sun]); U('ud', id.dau, id.nuxu, 'Marriage', [id.waisun]);
  U('uo', id.me, id.other, 'Rape', []);
  id.hh = GT.addHousehold(d, [id.me, id.wife, id.son2, id.fa], '同住');
  id.r1 = GT.addRelation(d, id.me, id.fa, 'Discord'); id.r2 = GT.addRelation(d, id.fa, id.me, 'AbusePhysical');
  id.sys = GT.addSystem(d, { name: '市立醫院', x: 700, y: 0 }); id.sys2 = GT.addSystem(d, { name: '社福中心', x: 700, y: 300 }); id.sys3 = GT.addSystem(d, { name: '教會', x: 700, y: 600 });
  id.t1 = GT.addTie(d, id.me, id.sys); Object.assign(d.ties[id.t1], { strength: 'strong', dir: 'b2a', note: '每月回診' });
  id.t2 = GT.addTie(d, id.hh, id.sys2); d.ties[id.t2].stress = true;
  return { d, id };
}
const termsOf = (f) => { const T = GT.narrate.kinTerms(f.d, f.id.me); return (key) => T.get(f.id[key]); };

T.test('文字敘述：稱謂——服務使用者、父母、祖父母、父母的手足與他們的家人', () => {
  const t = termsOf(narrFamily());
  T.eq(t('me'), '服務使用者', '主述的人稱「服務使用者」（使用者 2026-11-11 決定）');
  T.eq([t('fa'), t('mo')], ['案父', '案母'], '父母');
  T.eq([t('gf'), t('gm'), t('mgf'), t('mgm')], ['案祖父', '案祖母', '案外祖父', '案外祖母'], '父親的父母＝祖父母，母親的父母＝外祖父母');
  T.eq([t('uncle'), t('shu'), t('aunt')], ['案伯父', '案叔父', '案姑母'], '父親的哥哥＝伯父、弟弟＝叔父（看左右順序）、姊妹＝姑母');
  T.eq([t('jiu'), t('yi')], ['案舅父', '案姨母'], '母親的兄弟＝舅父、姊妹＝姨母');
  T.eq([t('bomu'), t('guzhang'), t('jiumu')], ['案伯母', '案姑丈', '案舅母'], '他們的配偶');
  T.eq([t('tang'), t('biao')], ['案堂兄弟', '案表姊妹'], '伯叔的子女＝堂，其餘＝表');
  T.eq([t('exwife'), t('half')], ['案父之前妻', '案同父異母兄弟'], '父親另一段關係：前妻、同父異母的手足');
});

T.test('文字敘述：稱謂——手足（左邊是兄姊、右邊是弟妹）、伴侶、子女、孫子女與姻親', () => {
  const f = narrFamily(), t = termsOf(f);
  T.eq([t('bro'), t('sis1'), t('sis2'), t('di')], ['案兄', '案大妹', '案二妹', '案弟'], '只有一個哥哥＝案兄；兩個妹妹＝案大妹、案二妹');
  T.eq([t('sao'), t('meifu'), t('zhi'), t('waisheng')], ['案嫂', '案大妹夫', '案姪', '案外甥女'], '兄嫂、妹夫；兄弟的孩子＝姪，姊妹的孩子＝外甥');
  T.eq([t('wife'), t('wf'), t('wm')], ['案妻', '案岳父', '案岳母'], '妻子與岳父母');
  T.eq([t('son1'), t('dau'), t('son2')], ['案長子', '案女', '案次子'], '兩個兒子＝長子、次子；一個女兒＝案女');
  T.eq([t('xifu'), t('nuxu'), t('sun'), t('waisun')], ['案長媳', '案女婿', '案孫', '案外孫女'], '媳婦、女婿；兒子的孩子＝孫，女兒的孩子＝外孫');
  T.eq(t('stranger'), undefined, '判斷不出關係的人沒有稱謂');
  // 換成女性的服務使用者、同居、離婚
  const d = GT.newDoc(), a = GT.addPerson(d, { gender: 'F', x: 0, y: 0 });
  d.persons[a].index = true;
  const h = GT.addPartner(d, a), ex = GT.addPartner(d, a), co = GT.addPerson(d, { gender: 'M', x: 300, y: 0 });
  d.unions[ex.unionId].type = 'Divorce';
  const uc = GT.linkPartners(d, a, co, 'Cohabitation');
  const hp = GT.addParents(d, h.personId);
  const T2 = GT.narrate.kinTerms(d, a);
  T.eq([T2.get(h.personId), T2.get(ex.personId), T2.get(co)], ['案夫', '案前夫', '案同居人'], '丈夫、前夫、同居人');
  T.eq([T2.get(hp.fatherId), T2.get(hp.motherId)], ['案公公', '案婆婆'], '丈夫的父母');
  T.ok(!!uc, '同居關係建得起來');
  T.eq(GT.narrate.kinTerms(d, 'nobody').size, 0, '沒有這個人：空的');
});

T.test('文字敘述：不是伴侶的關係不可以寫成男友、女友或伴侶（強迫關係、臨時關係、非承諾關係、其他）', () => {
  const N = GT.narrate;
  T.eq(['Rape', 'TemporaryRelation', 'Liaison', 'Other'].map(N.unionKind), ['neutral', 'neutral', 'neutral', 'neutral'], '四種都算中性');
  T.eq(['Marriage', 'Separation', 'SeparationLegal', 'Divorce', 'Nullity', 'Widowed'].map(N.unionKind),
       ['married', 'separated', 'separated', 'divorced', 'divorced', 'widowed'], '婚姻類');
  T.eq(['Engagement', 'EngagementAndCohabitation', 'EngagementAndSeparation'].map(N.unionKind), ['engaged', 'engaged', 'exengaged'], '婚約類');
  T.eq(['Cohabitation', 'LegalCohabitation', 'NonSentimentalCohabitation', 'CohabitationAndSeparation', 'LegalCohabitationAndLegalSeparation'].map(N.unionKind),
       ['cohab', 'cohab', 'cohab', 'excohab', 'excohab'], '同居類');
  T.eq(['CommittedRelationship', 'LoveAffair', 'CasualRelationship', 'CommittedRelationshipAndSeparation', 'LoveAffairAndSeparation'].map(N.unionKind),
       ['dating', 'dating', 'dating', 'exdating', 'exdating'], '交往類');
  T.ok(GT.FAMILY_TYPES.every(t => typeof N.unionKind(t.key) === 'string' && N.phraseOf(t.key).length >= 2), '每一種關係類型都有對應的寫法');
  T.eq(N.phraseOf('NonSentimentalCohabitation'), '的關係為「沒有感情的同居」', '少見的類型直接寫類型名稱，不自己簡化');
  const f = narrFamily(), t = termsOf(f), text = N.build(f.d).text;
  T.eq(t('other'), '關係對象', '強迫關係的對方：中性的「關係對象」');
  T.ok(text.includes('服務使用者與關係對象（某某）的關係為「強迫關係」'), '句子直接寫類型名稱');
  T.ok(!/某某[^。]*(男友|女友|伴侶|交往)/.test(text) && !/(男友|女友|伴侶)（某某/.test(text), '那個人不會被寫成男友、女友或伴侶');
});

T.test('文字敘述：寫出來的內容——基本資料、原生家庭、手足、婚姻與子女、同住、情感關係、健康、外部資源', () => {
  const f = narrFamily(), r = GT.narrate.build(f.d), text = r.text;
  const sec = (k) => (r.sections.find(s => s.key === k) || { text: '' }).text;
  T.eq(r.index, f.id.me, '以勾了「服務使用者」的人為主');
  T.eq(r.sections.map(s => s.key), ['self', 'origin', 'siblings', 'marriage', 'household', 'relations', 'health', 'eco', 'others'], '九段都有，順序固定');
  T.eq(sec('self'), '服務使用者王小明，男性，42 歲。', '基本資料');
  T.ok(sec('origin').startsWith('案父（王父，70 歲）與案母（陳母，68 歲）已婚，育有 3 子 2 女，服務使用者排行第 2。'), '父母、手足人數、排行');
  T.ok(sec('origin').includes('案祖父（王祖，歿年 80 歲）') && sec('origin').includes('案祖母（李祖母，85 歲）'), '祖父母：已歿的寫歿年');
  T.ok(sec('origin').includes('案伯父（王伯），與案伯母（林氏）已婚，育有 1 子（案堂兄弟（堂哥））'), '父母的手足與他們的家人');
  T.ok(sec('origin').includes('案父另與案父之前妻（父前妻）已離婚，育有 1 子（案同父異母兄弟（同父兄））。'), '父親的另一段關係');
  T.ok(sec('siblings').startsWith('案兄（王兄），與案嫂（嫂嫂）已婚，育有 1 子（案姪（姪子））；案大妹（王大妹），與案大妹夫（孫強）已婚'), '手足照長幼列出，各自的家庭接在後面');
  T.ok(sec('siblings').includes('案二妹（王二妹）；案弟（王弟）。'), '沒畫伴侶的手足只列人');
  T.ok(sec('marriage').startsWith('服務使用者與案妻（陳怡君，40 歲）已婚（2010 結婚），育有 2 子 1 女：案長子（王長子，18 歲）、案女（王女）、案次子（王次子）。'), '婚姻、線旁說明、子女');
  T.ok(sec('marriage').includes('案妻的父母：案岳父（陳岳）、案岳母（周氏）。'), '岳父母');
  T.ok(sec('marriage').includes('案長子與案長媳（錢氏）已婚，育有 1 子（案孫（孫子））。') && sec('marriage').includes('案女與案女婿（趙剛）已婚，育有 1 女（案外孫女（趙小妹））。'), '子女各自的家庭');
  T.eq(sec('household'), '服務使用者與案父、案妻、案次子同住（同住）。', '同住：照世代列出');
  T.eq(sec('relations'), `服務使用者與案父：${GT.labelOf(GT.EMOTION_TYPES, 'Discord')}；案父對服務使用者：${GT.labelOf(GT.EMOTION_TYPES, 'AbusePhysical')}。`, '情感關係：有方向的用「對」');
  T.eq(sec('health'), '案父：身體或精神疾病（糖尿病）；案兄：疑似酒精或藥物濫用。', '健康狀況');
  T.eq(sec('eco'), '服務使用者與「市立醫院」：關係強，資源由「市立醫院」流向服務使用者（每月回診）；「同住」同住家庭與「社福中心」：關係普通，有壓力或衝突；圖上另有資源「教會」，尚未畫出連結。', '外部資源');
  T.eq(sec('others'), '圖上另有 1 人，判斷不出與服務使用者的稱謂，沒有寫進上面的敘述：路人。', '判斷不出稱謂的人列在最後，不靜默丟掉');
  T.eq(text.split('\n').length, 9, '每一段一行');
});

T.test('文字敘述：只寫圖上畫的；不用舊用詞；不含技術字眼', () => {
  const f = narrFamily(), text = GT.narrate.build(f.d).text;
  T.ok(!/未婚(?![夫妻伴])/.test(text), '圖上沒畫伴侶，不寫成未婚（未婚夫、未婚妻是訂婚的稱謂，不算）');
  T.ok(['案' + '主', '服務' + '對象'].every(w => !text.includes(w)), '不用舊用詞');
  T.ok(!T.TECH.test(text) && !/null|\[object/.test(text), '沒有技術字眼或壞掉的值');
  T.ok(Object.values(f.d.persons).every(p => text.includes(p.name)), '圖上每一個人都寫到了（沒有人被靜默丟掉）');
  // 沒填年齡就不寫年齡；沒填任何資料的服務使用者不硬寫
  const d = GT.newDoc(), a = GT.addPerson(d, { gender: 'U', x: 0, y: 0 });
  d.persons[a].index = true;
  T.eq(GT.narrate.build(d).text, '', '只有一個沒填資料的人：沒有可以寫的');
  d.persons[a].name = '阿明';
  T.eq(GT.narrate.build(d).text, '服務使用者阿明。', '只填了姓名：只寫姓名，不寫性別與年齡');
  const k = GT.addChildren(d, a, ['M']).ids[0];
  T.eq(GT.narrate.build(d).sections.map(s => s.key), ['self', 'marriage'], '單親：寫子女');
  T.ok(GT.narrate.build(d).text.includes('服務使用者育有 1 子：案子。') && !!k, '沒有伴侶就只寫育有子女');
});

T.test('文字敘述：選項——不寫姓名、不寫年齡、不寫其他資料、只要某幾段、指定以誰為主', () => {
  const f = narrFamily(), d = f.d, N = GT.narrate;
  d.persons[f.id.me].attrs = { occupation: '工人', economy: '低收入戶' };
  T.ok(N.build(d).sections[0].text.endsWith('職業：工人；經濟：低收入戶。'), '預設寫出服務使用者的其他資料');
  T.ok(!N.build(d, { attrs: false }).text.includes('工人'), '可以不寫其他資料');
  const noName = N.build(d, { names: false }).text;
  T.ok(Object.values(d.persons).every(p => !noName.includes(p.name)), '不寫姓名：一個名字都沒有');
  T.ok(noName.startsWith('服務使用者，男性，42 歲。') && noName.includes('案父（70 歲）與案母（68 歲）已婚'), '不寫姓名：稱謂與年齡照舊');
  T.ok(noName.includes('圖上另有 1 人') && noName.includes('親屬甲'), '沒有稱謂又不寫姓名的人：叫「親屬甲」');
  const noAge = N.build(d, { ages: false }).text;
  T.ok(!/\d+ 歲/.test(noAge) && noAge.includes('案祖父（王祖，已歿）'), '不寫年齡：已歿還是要寫');
  T.eq(N.build(d, { sections: ['self', 'household'] }).sections.map(s => s.key), ['self', 'household'], '只要兩段');
  T.eq(N.build(d, { sections: [] }).text, '', '一段都不要：空的');
  // 兩位服務使用者：預設第一位（上面、左邊的優先），可以指定另一位
  d.persons[f.id.wife].index = true;
  T.eq(N.indexPersons(d), [f.id.me, f.id.wife], '兩位候選人，照位置排');
  const asWife = N.build(d, { index: f.id.wife });
  T.eq(asWife.index, f.id.wife, '指定以妻子為主');
  T.ok(asWife.text.startsWith('服務使用者陳怡君，女性，40 歲。') && asWife.text.includes('服務使用者與案夫（王小明，42 歲）已婚'), '稱謂整個換成以她為中心');
  T.eq(N.build(d, { index: 'nobody' }).index, f.id.me, '指定的人不存在：用第一位');
  for (const p of Object.values(d.persons)) p.index = false;
  T.eq(N.build(d), { index: null, candidates: [], sections: [], text: '' }, '沒有人勾服務使用者：不產生文字（介面會請使用者先勾）');
});

T.test('文字敘述：收養與寄養、獨生子女、單親、獨居', () => {
  const N = GT.narrate, d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'F', x: 0, y: 0 });
  d.persons[a].index = true; d.persons[a].name = '小華';
  const pr = GT.addParents(d, a);
  T.ok(N.build(d).text.includes('案父與案母已婚，育有服務使用者 1 名子女。'), '獨生子女');
  d.unions[pr.unionId].children[0].link = 'adopted';
  T.ok(N.build(d).text.includes('育有服務使用者 1 名子女，為收養子女。'), '收養');
  d.unions[pr.unionId].children[0].link = 'foster';
  T.ok(N.build(d).text.includes('為寄養子女'), '寄養');
  GT.deleteItems(d, [pr.fatherId]);
  T.ok(N.build(d).text.includes('案母育有服務使用者 1 名子女'), '單親：只寫在圖上的那一位家長');
  GT.addHousehold(d, [a], '');
  T.ok(N.build(d).text.includes('服務使用者獨自居住。'), '生活圈只有本人：獨自居住');
  const sib = GT.addSibling(d, a, 'U').personId;
  T.eq(N.kinTerms(d, a).get(sib), '案手足', '性別未註明的手足');
  T.ok(N.build(d).text.includes('育有 1 女 1 名性別未註明的子女，服務使用者排行第 1'), '性別未註明的另外數');
});

T.test('文字敘述：使用者打的字原樣當成純文字（不轉成 HTML，也不會壞掉）', () => {
  const evil = '<img src=x onerror=alert(1)>', d = GT.newDoc();
  const a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  Object.assign(d.persons[a], { index: true, name: evil, attrs: { occupation: evil } });
  const r = GT.addPartner(d, a); d.persons[r.personId].name = evil; d.unions[r.unionId].note = evil.slice(0, 60);
  GT.addHousehold(d, [a, r.personId], evil.slice(0, 30));
  const s = GT.addSystem(d, { name: evil.slice(0, 30), x: 300, y: 0 }); d.ties[GT.addTie(d, a, s)].note = evil.slice(0, 60);
  d.relations[GT.addRelation(d, a, r.personId, 'Hate')].note = evil;
  const text = GT.narrate.build(d).text;
  T.ok(typeof text === 'string' && text.includes(evil), '原樣寫出來（介面用 textContent 放進畫面，不會被當成標籤）');
  T.ok(!text.includes('&lt;') && !text.includes('undefined'), '不做 HTML 跳脫（不然貼到 Word 會出現 &lt;）');
});

T.test('文字敘述：怪結構不當機（跨代伴侶、自己的子女當伴侶、三段關係、空文件）；隨機 30 個家族每個人都寫到', () => {
  const N = GT.narrate;
  T.eq(N.build(GT.newDoc()).text, '', '空文件');
  const d = GT.newDoc(), a = GT.addPerson(d, { gender: 'M', x: 0, y: 0 });
  d.persons[a].index = true; d.persons[a].name = '甲';
  const r = GT.addPartner(d, a), kid = GT.addChild(d, r.unionId, 'F');
  d.persons[kid].name = '乙'; d.persons[r.personId].name = '丙';
  GT.linkPartners(d, a, kid, 'Other');                                       // 自己的子女又是關係對象：兩種稱謂只取先判斷到的那一個
  GT.linkPartners(d, r.personId, kid, 'Marriage');
  const t1 = N.build(d).text;
  T.ok(t1.includes('甲') && t1.includes('乙') && t1.includes('丙') && !/undefined|NaN/.test(t1), '怪結構：寫得出來，每個人都在');
  let seed = 20261111, bad = [];
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let n = 0; n < 30; n++) {
    const doc = GT.newDoc();
    let c = 0;
    const add = (g, y) => { const id = GT.addPerson(doc, { gender: g, x: Math.round(rnd() * 2000), y }); doc.persons[id].name = `人${n}_${c++}_`; return id; };
    let unions = [GT.linkPartners(doc, add('M', 0), add('F', 0), GT.FAMILY_TYPES[Math.floor(rnd() * GT.FAMILY_TYPES.length)].key)];
    for (let gen = 1; gen <= 3; gen++) {
      const next = [];
      for (const uid of unions) {
        const kids = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => add(['M', 'F', 'U'][Math.floor(rnd() * 3)], gen * 160));
        doc.unions[uid].children = kids.map(id => ({ id, link: 'bio' }));
        for (const k of kids) if (rnd() < 0.5) {
          const p = GT.addPartner(doc, k);
          doc.persons[p.personId].name = `人${n}_${c++}_`;
          doc.unions[p.unionId].type = GT.FAMILY_TYPES[Math.floor(rnd() * GT.FAMILY_TYPES.length)].key;
          next.push(p.unionId);
        }
      }
      unions = next;
    }
    const all = Object.values(doc.persons), ix = all[Math.floor(rnd() * all.length)];
    ix.index = true;
    const text = N.build(doc).text;
    if (!all.every(p => text.includes(p.name)) || /undefined|NaN|null|\[object/.test(text) || /未婚(?![夫妻伴])/.test(text)) bad.push(n);
  }
  T.eq(bad, [], '30 個家族：每個人都寫到、沒有壞掉的值');
});
