// 網頁測試：用 jsdom 載入 dist/index.html，以 dist/forecast.json 模擬伺服器回應
// 執行：cd test && npm i jsdom@24.1.3 && TZ=Asia/Taipei node page.test.js
const {JSDOM, VirtualConsole} = require('jsdom');
const fs = require('fs'), path = require('path');
const dist = path.join(__dirname, '..', 'dist');
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const forecast = JSON.parse(fs.readFileSync(path.join(dist, 'forecast.json'), 'utf8'));
const tick = () => new Promise(r => setTimeout(r, 30));

async function open({data = forecast, fail = false, now = Date.now()} = {}){
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e.message || e)));
  const dom = new JSDOM(html, {url: 'https://example.org/', runScripts: 'dangerously', virtualConsole: vc, beforeParse(w){
    const RD = w.Date; class D extends RD{ constructor(...a){ a.length ? super(...a) : super(now); } static now(){ return now; } } w.Date = D;
    w.fetch = async () => { if (fail) throw new Error('offline'); return {ok: true, json: async () => JSON.parse(JSON.stringify(data))}; };
    w.HTMLElement.prototype.focus = function(){};
  }});
  await tick();
  return {w: dom.window, d: dom.window.document, errors};
}
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', {bubbles: true}));
let fails = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails++; };

(async () => {
  // 1. 正常載入
  let {w, d, errors} = await open();
  const lamps = () => [...d.querySelectorAll('#matrix tbody .lamp')].map(x => x.className.split(' ')[1]);
  ok(d.getElementById('status').hidden, '資料正常時不顯示提示');
  { const ty = d.getElementById('typhoon');
    ok(!ty.hidden && /強烈颱風測試/.test(ty.textContent) && /最接近臺灣/.test(ty.textContent) && !/遠方/.test(ty.textContent), '颱風接近臺灣時顯示提示（遠方的颱風不顯示）'); }
  ok(/資料更新/.test(d.getElementById('issued').textContent), '顯示資料更新時間');
  let plusTotal = 0;
  for (const m of ['today', 'tmr', 'd2', 'd3', 'week']){
    click(w, d.querySelector(`#seg [data-mode="${m}"]`));
    for (let i = 0; i < 30; i++) click(w, d.getElementById('more'));
    const body = d.body.innerHTML.replace(/<script>[\s\S]*<\/script>/, '');
    const L = lamps(), cnt = k => L.filter(x => x === k).length;
    ok(d.querySelectorAll('#matrix tbody tr').length === 235, `${m}：235 座都列出`);
    { // 計分排序（A 3、B 2、C 1、D 0；已過與無資料不計）：依畫面上的燈號重算，順序須為 總分 → A 數 → D 少 → 全日總分
      const peakCol = [...d.querySelectorAll('#matrix thead th')].slice(1).map(th => m === 'week' || th.classList.contains('peak'));
      const keys = [...d.querySelectorAll('#matrix tbody tr')].map(tr => { let s1 = 0, p1 = 0, c1 = 0, s2 = 0, has = 0;
        [...tr.querySelectorAll('.lamp')].forEach((l, i) => { if (l.classList.contains('past') || l.classList.contains('na')) return;
          const pt = l.classList.contains('p') ? 3 : l.classList.contains('g') ? 2 : l.classList.contains('y') ? 1 : 0;
          has = 1; s2 += pt; if (peakCol[i]){ s1 += pt; if (pt === 3) p1++; if (pt === 0) c1++; } });
        return [has, s1, p1, -c1, m === 'week' ? 0 : s2]; });
      const cmp = (a, b) => a[0]-b[0] || a[1]-b[1] || a[2]-b[2] || a[3]-b[3] || a[4]-b[4];
      ok(keys.every((k, i) => !i || cmp(keys[i-1], k) >= 0) && new Set(keys.map(String)).size > 1, `${m}：依計分排序（最前 ${keys[0]}、最後 ${keys[keys.length-1]}）`);
    }
    click(w, d.getElementById('pick-info-btn'));
    const info = d.getElementById('pick-info');
    ok(!info.hidden && /比較標準/.test(info.textContent) && /排序/.test(info.textContent) && (m === 'week' ? /7 天的總分/ : /登頂時段的總分/).test(info.textContent) && /燈號排序$/.test(d.getElementById('h-picks-t').textContent), `${m}：燈號排序旁的 i 顯示對應的比較標準與排序`);
    click(w, d.getElementById('pick-info-x'));
    ok(!/第\s*\d+\s*名|最推薦/.test(d.getElementById('h-matrix').textContent), `${m}：標題不顯示名次與「最推薦」`);
    ok(!d.getElementById('picks') && !d.getElementById('reroll'), `${m}：推薦區與「換一批」已移除`);
    ok(!/undefined|NaN|\[object/.test(body), `${m}：畫面沒有空值或錯誤數字`);
    const plus = d.querySelectorAll('#matrix tbody .lamp.g.p');
    plusTotal += plus.length;
    ok([...plus].every(x => x.textContent === 'A') && [...d.querySelectorAll('#matrix tbody .lamp.g:not(.p)')].every(x => x.textContent === 'B') && [...d.querySelectorAll('#matrix tbody .lamp.y')].every(x => x.textContent === 'C') && [...d.querySelectorAll('#matrix tbody .lamp.r')].every(x => x.textContent === 'D'), `${m}：A ${plus.length} 格、B、C、D 格都寫對應字母`);
    ok(!/\s\d{3}・|E\d\d・/.test(d.getElementById('matrix-cards').textContent), `${m}：卡片不顯示編號`);
    ok(cnt('g') + cnt('y') + cnt('r') > 0, `${m}：有實際燈號（適合 ${cnt('g')}、注意 ${cnt('y')}、不建議 ${cnt('r')}、無資料 ${cnt('na')}）`);
    // 打開每座山的詳情
    let bad = 0;
    d.querySelectorAll('#matrix tbody tr').forEach(tr => { click(w, tr.querySelector('td')); if (/undefined|NaN/.test(d.getElementById('drawer').innerHTML)) bad++; click(w, d.getElementById('d-close')); });
    ok(bad === 0, `${m}：235 座詳情都正常`);
  }
  { // 一週判定：各半天分別判斷；登頂時段都在 12 點前時，白天描述的「午後」不計
    const J = (halves, am) => w.judgeDay({halves}, false, null, false, am);
    const h = (wx, day) => ({wx, day, pop: 10, ws: 2});
    ok(J([h('晴', true), h('多雲有霧', false)], false).lv === 1, '一週：晚上有霧時，即使白天晴也判 B');
    ok(J([h('晴', true), h('雨或雪', false)], false).lv === 1 && J([h('下雪', false), h('晴', true)], false).lv === 2, '一週：另一個半天的雪也會判定');
    const pm = J([h('晴午後短暫雷陣雨', true)], true);
    ok(pm.lv === 0 && pm.plus && /午後/.test(pm.why.join()), '一週：登頂時段在 12 點前，「晴午後短暫雷陣雨」視為晴（A），原因註明');
    ok(J([h('晴午後短暫雷陣雨', true)], false).lv === 2, '一週：登頂時段有 12 點後，午後雷陣雨仍判 C');
    ok(J([h('晴', true), h('晴', false)], false).plus && !J([h('晴', true), h('晴時多雲', false)], false).plus, '一週：所有半天都是晴才算 A');
    const R = wx => w.judge({wx, pop: null, ws: 2}, false, null, true).lv;
    ok(['多雲短暫陣雨', '陰短暫雨', '午後局部雨', '多雲局部短暫陣雨', '短暫雨或雪'].every(x => R(x) === 1), '第 4–7 天：「局部」「短暫」的雨判 B');
    ok(['陰陣雨', '陰有雨', '雨天', '有雨或雪', '陰短暫雨或陣雨', '大雨'].every(x => R(x) === 2), '第 4–7 天：陣雨（不含短暫）、有雨等判 C');
    const P = pop => w.judge({wx: '多雲', pop, ws: 2}, false, null, false).lv;
    ok(P(29) === 0 && P(30) === 1 && P(59) === 1 && P(60) === 2, '降雨機率：未滿 30% 為 B、30–59% 為 C、60% 以上為 D');
    ok(R('多雲時晴') === 0 && w.judge({wx: '陰陣雨', pop: 10, ws: 2}, false, null, false).lv === 0, '前 3 天：雨的描述不影響燈號，只看降雨機率');
    ok(w.eval('amOnly([6, 9])') && !w.eval('amOnly([9, 12])'), '一週：12 點前的判斷（09–12 算，12–15 不算）');
  }
  ok(plusTotal > 0, `天氣描述為「晴」的時段顯示 A（共 ${plusTotal} 格）`);
  // 一週：第 4–7 天沒有降雨機率時，詳情列出原始天氣描述
  click(w, d.querySelector('#seg [data-mode="week"]'));
  ok(d.querySelectorAll('#matrix tbody .lamp.ref').length > 0, '一週：第 4–7 天有虛線燈號');
  let shown = false;
  for (const tr of [...d.querySelectorAll('#matrix tbody tr')].slice(0, 30)){
    click(w, tr.querySelector('td'));
    if (/陣雨（第 4–7 天無降雨機率）/.test(d.getElementById('drawer').innerHTML)) shown = true;
    click(w, d.getElementById('d-close'));
    if (shown) break;
  }
  ok(shown, '一週：詳情寫出「陰陣雨（第 4–7 天無降雨機率）」這類原因');
  // 缺資料的山（鹿山）應顯示無資料
  click(w, d.querySelector('#seg [data-mode="tmr"]'));
  const inp = d.getElementById('f-kw'); inp.value = '鹿山'; inp.dispatchEvent(new w.Event('input', {bubbles: true}));
  ok(lamps().length && lamps().every(x => x === 'na'), '缺少資料的預報點顯示「無資料」');
  inp.value = ''; inp.dispatchEvent(new w.Event('input', {bubbles: true}));
  { // 篩選防呆：選百岳後「1,000 m 以下」和沒有百岳的縣市不能選；取消後恢復
    const ht0 = d.querySelector('#f-ht [data-ht="0"]'), ph = d.querySelector('#f-county [data-co="澎湖縣"]'), hb = d.querySelector('#f-county [data-co="花蓮縣"]');
    click(w, d.querySelector('#f-cat [data-c="百岳"]'));
    ok(ht0.disabled && ph.disabled && !hb.disabled && !d.querySelector('#f-cat [data-c="百岳"]').disabled, '防呆：選百岳後，1,000 m 以下與澎湖縣不能選，花蓮縣可選');
    click(w, ht0); ok(!w.eval('state.hts.has(0)'), '防呆：被鎖住的選項點了也不會選上');
    click(w, d.querySelector('#f-ht [data-ht="3"]'));
    ok(d.querySelector('#f-cat [data-c="小百岳"]').disabled && d.querySelector('#f-county [data-co="新北市"]').disabled, '防呆：再選 3,000 m 以上，小百岳與新北市不能選');
    click(w, d.getElementById('ht-all')); click(w, d.getElementById('cat-all'));
    ok(![...d.querySelectorAll('#f-cat .chip, #f-ht .chip, #f-county .chip')].some(b => b.disabled), '防呆：全部取消後所有選項恢復可選');
    w.eval('saveFilters()');
  }
  { // 開始搜尋時，類別、標高、縣市篩選回到預設並記住；登頂時段不變
    click(w, d.querySelector('#f-cat [data-c="小百岳"]')); click(w, d.querySelector('#f-slots [data-h="12"]'));
    w.eval('saveFilters()');
    inp.value = '玉山東峰'; inp.dispatchEvent(new w.Event('input', {bubbles: true}));
    const found = [...d.querySelectorAll('#matrix tbody tr')].some(tr => /玉山東峰/.test(tr.textContent));
    const saved = JSON.parse(w.localStorage.getItem('filters') || '{}');
    ok(found && w.eval('state.cats.size') === 0 && !saved.cats?.length && d.getElementById('cat-all').getAttribute('aria-pressed') === 'true' && w.eval('state.slots.has(12)'),
      '開始搜尋時，類別篩選回到「全部」並記住，登頂時段保留，搜得到玉山東峰');
    // 搜尋中再改篩選：照常套用，不符合就顯示「沒有符合條件的山」；繼續打字也不會再重設
    click(w, d.querySelector('#f-cat [data-c="小百岳"]')); w.eval('refilter()');
    inp.value = '玉山東'; inp.dispatchEvent(new w.Event('input', {bubbles: true}));
    ok(w.eval('rows.length') === 0 && w.eval('state.cats.has("小百岳")') && /沒有符合條件的山/.test(d.getElementById('matrix-cards').textContent), '搜尋中改篩選照常套用：只選小百岳時搜尋玉山東峰顯示「沒有符合條件的山」');
    click(w, d.getElementById('cat-all')); w.eval('saveFilters()');
    inp.value = ''; inp.dispatchEvent(new w.Event('input', {bubbles: true}));
    click(w, d.querySelector('#f-slots [data-h="12"]')); w.eval('saveFilters()');
    ok(w.eval('rows.length') === 235, '清掉搜尋後列出全部 235 座');
    const el = d.getElementById('f-kw');
    ok(!/name/i.test(el.id + (el.name || '')) && el.getAttribute('autocomplete') === 'off', '搜尋框的 id、name 不含 name，關閉自動填寫（避免 iPhone 跳出聯絡人）');
  }
  // 特報：宜蘭縣今天陸上強風（不採用）
  click(w, d.querySelector('#seg [data-mode="today"]'));
  inp.value = '南湖北山'; inp.dispatchEvent(new w.Event('input', {bubbles: true}));
  click(w, d.querySelector('#matrix tbody tr td'));
  ok(!/陸上強風/.test(d.getElementById('drawer').innerHTML), '陸上強風特報不顯示，也不列入燈號');
  click(w, d.getElementById('d-close'));
  click(w, d.querySelector('#seg [data-mode="tmr"]'));
  inp.value = '玉山北峰'; inp.dispatchEvent(new w.Event('input', {bubbles: true}));
  click(w, d.querySelector('#matrix tbody tr td'));
  ok(!/低溫/.test(d.getElementById('drawer').innerHTML), '低溫特報不顯示，也不列入燈號');
  click(w, d.querySelector('#seg [data-mode="today"]'));
  click(w, d.getElementById('d-close'));
  // 豪雨特報：屏東縣的山今天未過的時段都是 C
  inp.value = '笠頂山'; inp.dispatchEvent(new w.Event('input', {bubbles: true}));
  ok([...d.querySelectorAll('#matrix tbody .lamp:not(.past)')].every(x => x.classList.contains('r')), '豪雨特報期間，涵蓋縣市的山判 C');
  click(w, d.querySelector('#matrix tbody tr td'));
  ok(/豪雨特報・D/.test(d.getElementById('drawer').innerHTML), '詳情顯示豪雨特報・D');
  { // 燈號名稱（2026-10-20 定案）：A 讚、B 可、C 注意、D 不建議；說明頁的字母換成小燈號方塊，°C 不上色
    const lg = d.querySelector('.legend').textContent;
    ok(/A讚/.test(lg) && /B可/.test(lg) && /C注意/.test(lg) && /D不建議/.test(lg) && !/A\+/.test(d.body.textContent), '圖例為 A 讚、B 可、C 注意、D 不建議，畫面上沒有 A+');
    const chips = [...d.querySelectorAll('article.doc .lamp.chip')];
    ok(chips.some(x => x.textContent === 'D' && x.classList.contains('r')) && chips.some(x => x.textContent === 'A' && x.classList.contains('p')) && /36°C/.test(d.querySelector('article.doc').textContent), '說明頁的 A–D 換成小燈號方塊，36°C 不受影響');
  }
  click(w, d.getElementById('d-close'));
  // 別名：搜「鳶山」找得到福德坑山，詳情顯示別名
  inp.value = '鳶山'; inp.dispatchEvent(new w.Event('input', {bubbles: true}));
  const rows = [...d.querySelectorAll('#matrix tbody tr')];
  ok(rows.length === 1 && /福德坑山/.test(rows[0].textContent), '用別名「鳶山」搜得到福德坑山');
  click(w, rows[0].querySelector('td'));
  ok(/別名：鳶山/.test(d.getElementById('drawer').innerHTML), '詳情顯示別名');
  click(w, d.getElementById('d-close'));
  ok(errors.length === 0, '沒有程式錯誤' + (errors.length ? '：' + errors[0] : ''));

  ({d} = await open({data: {...forecast, typhoons: []}}));
  ok(d.getElementById('typhoon').hidden, '沒有颱風時不顯示颱風提示');

  // 2. 資料過舊
  ({d} = await open({data: {...forecast, fetchedAt: new Date(Date.now() - 10*3600e3).toISOString()}}));
  ok(!d.getElementById('status').hidden && /可能不是最新/.test(d.getElementById('status').textContent), '超過 9 小時顯示「可能不是最新」');

  // 3. 抓取失敗
  ({d} = await open({fail: true}));
  ok(!d.getElementById('status').hidden && /暫時無法取得/.test(d.getElementById('status').textContent), '抓取失敗顯示提示');
  ok(d.querySelectorAll('#matrix tbody .lamp.na').length > 0, '抓取失敗時燈號顯示「無資料」而不是假燈號');

  console.log(fails ? `\n${fails} 項未通過` : '\n全部通過');
  process.exit(fails ? 1 : 0);
})();
