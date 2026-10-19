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
  ok(/資料更新/.test(d.getElementById('issued').textContent), '顯示資料更新時間');
  for (const m of ['today', 'tmr', 'd2', 'week']){
    click(w, d.querySelector(`#seg [data-mode="${m}"]`));
    for (let i = 0; i < 8; i++) click(w, d.getElementById('more'));
    const body = d.body.innerHTML.replace(/<script>[\s\S]*<\/script>/, '');
    const L = lamps(), cnt = k => L.filter(x => x === k).length;
    ok(d.querySelectorAll('#matrix tbody tr').length === 235, `${m}：235 座都列出`);
    const picks = [...d.querySelectorAll('#picks .pick')];
    ok(picks.length >= 1 && picks.length <= 6 && picks.every(p => p.querySelector('.lamp.g')), `${m}：推薦 ${picks.length} 座（最多 6 座，都有「適合」）`);
    ok(!/第\s*\d+\s*名|最推薦/.test(d.getElementById('picks').textContent + d.getElementById('h-picks').textContent), `${m}：推薦不顯示名次與「最推薦」`);
    ok(!/undefined|NaN|\[object/.test(body), `${m}：畫面沒有空值或錯誤數字`);
    ok(cnt('g') + cnt('y') + cnt('r') > 0, `${m}：有實際燈號（適合 ${cnt('g')}、注意 ${cnt('y')}、不建議 ${cnt('r')}、無資料 ${cnt('na')}）`);
    // 打開每座山的詳情
    let bad = 0;
    d.querySelectorAll('#matrix tbody tr').forEach(tr => { click(w, tr.querySelector('td')); if (/undefined|NaN/.test(d.getElementById('drawer').innerHTML)) bad++; click(w, d.getElementById('d-close')); });
    ok(bad === 0, `${m}：235 座詳情都正常`);
  }
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
  const inp = d.getElementById('f-name'); inp.value = '鹿山'; inp.dispatchEvent(new w.Event('input', {bubbles: true}));
  ok(lamps().length && lamps().every(x => x === 'na'), '缺少資料的預報點顯示「無資料」');
  inp.value = ''; inp.dispatchEvent(new w.Event('input', {bubbles: true}));
  // 特報：宜蘭縣今天陸上強風
  click(w, d.querySelector('#seg [data-mode="today"]'));
  inp.value = '南湖北山'; inp.dispatchEvent(new w.Event('input', {bubbles: true}));
  click(w, d.querySelector('#matrix tbody tr td'));
  ok(/陸上強風特報/.test(d.getElementById('drawer').innerHTML), '跨宜蘭縣的山顯示陸上強風特報');
  click(w, d.getElementById('d-close'));
  // 別名：搜「鳶山」找得到福德坑山，詳情顯示別名
  inp.value = '鳶山'; inp.dispatchEvent(new w.Event('input', {bubbles: true}));
  const rows = [...d.querySelectorAll('#matrix tbody tr')];
  ok(rows.length === 1 && /福德坑山/.test(rows[0].textContent), '用別名「鳶山」搜得到福德坑山');
  click(w, rows[0].querySelector('td'));
  ok(/別名：鳶山/.test(d.getElementById('drawer').innerHTML), '詳情顯示別名');
  click(w, d.getElementById('d-close'));
  ok(errors.length === 0, '沒有程式錯誤' + (errors.length ? '：' + errors[0] : ''));

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
