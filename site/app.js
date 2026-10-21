/* 看天爬山
   結構：常數 → 工具 → 預報資料（讀取 forecast.json，由 GitHub Actions 在氣象署每次發布後更新）→ 判定規則 → 山岳模型 → 狀態 → 計算 → 畫面 → 事件 */

// ---------- 常數 ----------
const M = __DATA__;
const WD = ['日','一','二','三','四','五','六'];
const SLOTS = [0,3,6,9,12,15,18,21];                       // 每段 3 小時的開始時刻
const MODES = {today:{di:0,name:'今天'}, tmr:{di:1,name:'明天'}, d2:{di:2,name:'後天'}, d3:{di:3,name:'大後天'}, week:{name:'一週'}};   // 「週末」2026-10-21 加入、同日使用者決定移除
const COUNTY_ORDER = ['基隆市','臺北市','新北市','桃園市','新竹市','新竹縣','苗栗縣','臺中市','彰化縣','南投縣','雲林縣','嘉義市','嘉義縣','臺南市','高雄市','屏東縣','宜蘭縣','花蓮縣','臺東縣','澎湖縣','金門縣','連江縣'];
const BF = __BF__;                                         // 蒲福風級下限（公尺／秒）；由 build.mjs 從 site/beaufort.mjs 放入
// 燈號名稱（2026-10-20 使用者定案）：A 佳（晴）、B 可、C 注意、D 不建議。內部等級 lv 仍是 0／1／2，plus 表示 A
const SYM = ['B','C','D','—'], CLS = ['g','y','r','na'], WORD = ['可','注意','不建議','無資料'];
const LV = lv => lv < 0 ? 3 : lv;                                // 燈號等級 -1 代表沒有資料
// A（佳）：等級 0 且天氣描述剛好是「晴」（plus）；畫面上寫 A，class 多加 p
const H = 3600e3, STALE = 9*H;                              // 超過 9 小時沒更新就提醒
const PAGE = 10;                                           // 山岳列表一次顯示幾座

// ---------- 工具 ----------
const $ = id => document.getElementById(id);
const pad = h => String(h).padStart(2,'0');
const slotLabel = h => `${pad(h)}–${pad(h+3)}`;
// 日期與時刻一律用台灣時間計算（2026-10-21 修正：手機時區不是台灣時，原本幾乎全部變成無資料）
const TW8 = 8*H, DAY = 24*H;
const twMid = (ms = Date.now()) => Math.floor((ms + TW8) / DAY) * DAY - TW8;   // 台灣時間當天 0 點（毫秒）
const dayAt = i => twMid() + i*DAY;                          // 今天起第 i 天的台灣 0 點（毫秒）
const tw = ms => { const d = new Date(ms + TW8); return {mo:d.getUTCMonth()+1, d:d.getUTCDate(), wd:d.getUTCDay(), h:d.getUTCHours(), mi:d.getUTCMinutes()}; };
const md = ms => { const t = tw(ms); return `${t.mo}/${t.d}`; };
const wdOf = ms => tw(ms).wd;
const isWE = ms => wdOf(ms) % 6 === 0;                       // 週六、週日
const beaufort = ws => BF.reduce((b, v, i) => ws >= v ? i : b, 0);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));  // 外部資料（氣象署文字）放進畫面前先轉義
const sortedSlots = () => [...state.slots].sort((a,b)=>a-b);
const DEF_SLOTS = [6, 9, 12, 15];                           // 預設登山時段 06–18（2026-10-21：登頂時段 09–12 → 登山時段 06–15 → 06–18）
const HT_BAND = h => h == null ? -1 : h < 1000 ? 0 : h < 2000 ? 1 : h < 3000 ? 2 : 3;   // 標高篩選：0＝1,000 m 以下、1＝1,000–2,000、2＝2,000–3,000、3＝3,000 m 以上（2026-10-20）
const store = {                                             // 瀏覽器儲存：讀寫失敗時不影響畫面
  raw(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
  get(k, fb){ const v = this.raw(k); if (v == null) return fb; try{ return JSON.parse(v); }catch(e){ return v; } },
  set(k, v){ try{ localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); }catch(e){} }
};
const fmtTime = ms => { const t = tw(ms); return `${t.mo}/${t.d} ${pad(t.h)}:${pad(t.mi)}`; };

// ---------- 預報資料（forecast.json；格式見 scripts/fetch.mjs）----------
let FC = null, fcIndex = new Map(), loadError = '', offline = false, WXH = {};   // WXH：未收錄用語的天氣代碼提示（fetch.mjs 的 wxHints）   // offline：沒有網路，正在用手機裡存的資料（sw.js）
// version 2 是精簡格式（每筆是陣列，見 fetch.mjs 的 compact()），還原成 {s, pop, ws, bf, t, at, wx}；舊格式直接使用
function decodeRows(rows, base, step, wx){
  return (rows || []).map(r => {
    if (!Array.isArray(r)) return r;
    const [i, pop = null, ws = null, t = null, at = null, w = null, bf] = r;
    return {s: base + i*step, pop, ws, bf: bf ?? (ws != null ? beaufort(ws) : null), t, at, wx: w == null ? null : wx[w]};
  });
}
function useForecast(data){
  FC = data; fcIndex = new Map(); WXH = data.wxHint || {};
  const t0 = data.t0, wx = data.wx || [];
  for (const [key, p] of Object.entries(data.points || {}))
    fcIndex.set(key, {geo: p.geo || '', h3: new Map(decodeRows(p.h3, t0, 3*H, wx).map(r => [r.s, r])), week: new Map(decodeRows(p.week, t0 - 6*H, 12*H, wx).map(r => [r.s, r]))});
  // 特報：只採用颱風、豪雨、大雨（列入燈號，D）。陸上強風、低溫、高溫、濃霧特報不採用、不顯示：
  // 氣象署資料只到縣市層級，無法對應到每座山；改看各山的風速、氣溫、天氣描述預報（2026-10-20 使用者決定）
  FC.alerts = (data.alerts || []).filter(a => ALERT_LV(a.type) > 0).map(a => ({...a, lv: ALERT_LV(a.type)})).sort((a, b) => b.lv - a.lv);
}
function slotForecast(p, di, hr){                           // 逐 3 小時：沒有資料時回傳 null
  return fcIndex.get(p.key)?.h3.get(dayAt(di) + hr*H) || null;
}
// 一週：把登山時段對應到白天（06–18）或晚上（18–06）。回傳對應到的各半天（判定時各半天分別判斷再取最差），
// 以及合併後給詳情顯示的數值（天氣描述列出各半天原文）
function dayForecast(p, di, slots){
  const idx = fcIndex.get(p.key); if (!idx) return null;
  const D = dayAt(di);
  const s = [...new Set(slots.map(h => h>=6 && h<18 ? D+6*H : h>=18 ? D+18*H : D-6*H))].sort((a,b)=>a-b).map(S => idx.week.get(S) && {...idx.week.get(S), day: S === D+6*H}).filter(Boolean);
  if (!s.length) return null;
  const max = k => { const v = s.map(x=>x[k]).filter(v=>v!=null); return v.length ? Math.max(...v) : null; };
  const ws = max('ws');
  return {halves: s.map(x => di<3 ? x : {...x, pop: null}), pop: di<3 ? max('pop') : null, ws, bf: ws!=null ? beaufort(ws) : max('bf'), t: max('t'), at: max('at'), wx: [...new Set(s.map(x => x.wx).filter(Boolean))].join('／') || null};
}
// 一週白天的描述：登山時段全部在 12 點前時，「午後」之後的部分不計（2026-10-20 使用者決定；降雨機率仍照 12 小時數值）
const amOnly = slots => slots.every(h => h + 3 <= 12);
const dropPM = wx => { const i = (wx || '').indexOf('午後'); return i > 0 ? wx.slice(0, i) : wx; };
function judgeDay(fc, lowHill, alert, noPop, am){
  if (!fc) return judge(null, lowHill, alert, noPop);
  const js = fc.halves.map(x => judge(am && x.day ? {...x, wx: dropPM(x.wx)} : x, lowHill, alert, noPop));
  const lv = Math.max(...js.map(j => j.lv)), why = [...new Set(js.flatMap(j => j.why))];
  if (am && fc.halves.some(x => x.day && dropPM(x.wx) !== x.wx)) why.push('登山時段在 12 點前，「午後」部分不計');
  return {lv, why, plus: lv === 0 && js.every(j => j.plus)};
}
const ALERT_LV = type => /颱風|豪雨|大雨/.test(type || '') ? 2 : 0;
const alertHits = (p, start, end) => (FC?.alerts || []).filter(a => p.counties.includes(a.county) && (a.start == null || a.start < end) && (a.end == null || a.end > start));
function alertFor(p, start, end){                           // 列入燈號的特報：時段內生效、涵蓋這座山所在縣市，取最嚴重
  return alertHits(p, start, end).find(a => a.lv > 0) || null;
}

// 第 4–7 天（沒有降雨機率）雨的分級（2026-10-20 使用者決定）：「局部」「短暫」的雨為 C（注意）；
// 其他的雨（陣雨、有雨、雨天、雨或雪等）為 D（不建議）。描述中每個「雨」分別判斷，取最重的。
const RAIN_RE = /(局部短暫陣|局部短暫|局部陣|局部|短暫陣|短暫|)雨/g;
const rainLv = wx => Math.max(0, ...[...(wx || '').matchAll(RAIN_RE)].map(m => m[1] ? 1 : 2));

// ---------- 判定規則（與「排序規則與說明」頁一致）----------
function judge(fc, lowHill, alert, noPop){
  const why = []; let lv = 0;
  const up = (n, w) => { if (n > lv) lv = n; if (n > 0 && !why.includes(w)) why.push(w); };
  if (alert) up(alert.lv, alert.type);
  if (!fc) return alert ? {lv, why} : {lv: -1, why: ['無資料']};
  const wx = fc.wx || '';
  if (wx.includes('雷')) up(2, '有雷');
  if (/下雪|積冰|暴風雪/.test(wx)) up(2, wx);             // 雪：下雪、積冰、暴風雪不建議；「雨或雪」等其他有「雪」的描述為注意
  else if (wx.includes('雪')) up(1, wx);
  if (wx.includes('霧')) up(1, '有霧');
  if (!noPop && fc.pop != null){ if (fc.pop>=60) up(2, '降雨機率 '+fc.pop+'%'); else if (fc.pop>=30) up(1, '降雨機率 '+fc.pop+'%'); }
  else if (noPop && wx.includes('雨')) up(rainLv(wx), wx + '（第 5–7 天無降雨機率）');   // 第 5–7 天（一週預報）：依雨的用語分級，寫出原始描述
  else if (wx.includes('雨')) up(1, '可能下雨');
  if (fc.ws != null){ if (fc.ws>=13.9) up(2, '風速 '+beaufort(fc.ws)+' 級'); else if (fc.ws>=8) up(1, '風速 '+beaufort(fc.ws)+' 級'); }   // 風速只顯示「級」（2026-10-20）
  if (lowHill && fc.at != null && fc.at>=36) up(1, '高溫 體感 '+fc.at+'°C');
  // 天氣代碼當備援（2026-10-21 使用者選「甲」）：描述是本站沒收錄的用語、但氣象署代碼表示有雷／雪／霧／雨時，依代碼取較嚴格的燈號
  const hint = WXH[wx] || '';
  if (hint.includes('T')) up(2, '天氣代碼：有雷');
  if (hint.includes('X')) up(2, '天氣代碼：下雪或積冰'); else if (hint.includes('S')) up(1, '天氣代碼：有雪');
  if (hint.includes('F')) up(1, '天氣代碼：有霧');
  if (hint.includes('R') && (noPop || fc.pop == null)) up(noPop ? 2 : 1, noPop ? '天氣代碼：有雨（第 5–7 天無降雨機率）' : '天氣代碼：可能下雨');
  return {lv, why, plus: lv === 0 && wx === '晴'};
}

// ---------- 山岳模型（只在載入時建立一次）----------
const MOUNTAINS = M.map(m => {
  const counties = m.co.split('、');
  const pts = m.pid
    ? [{key:m.pid, label:'氣象署登山預報點「'+(m.pt||m.n)+'」', code:m.pid, county:counties[0], counties}]
    : (m.tw || []).map(t => ({key:t, label:t+' 鄉鎮預報', code:'', county:t.slice(0,3), counties:[t.slice(0,3)]}));
  return {m, k:m.c+m.no, pts, counties, low: m.h!=null && m.h<1000, ht: HT_BAND(m.h), search: [m.n, ...(m.al||[]), m.note||'', m.co].join('\n')};   // 搜尋範圍：山名、別名、備註、縣市（縣市 2026-10-21 加入）
});

// ---------- 狀態 ----------
// 篩選條件會記住（2026-10-20 使用者決定）：使用者沒改就維持上次設定，重新整理也一樣；讀到不合法的值就略過
function loadFilters(){
  const f = (v => v && typeof v === 'object' ? v : {})(store.get('filters'));
  const ok = (a, test) => new Set(Array.isArray(a) ? a.filter(test) : []);
  return {cats: ok(f.cats, v => ['百岳','小百岳','其他山岳'].includes(v)),
    counties: ok(f.counties, v => typeof v === 'string' && M.some(m => m.co.split('、').includes(v))),
    hts: ok(f.hts, v => [0,1,2,3].includes(v))};
}
const state = {
  mode: (m => MODES[m] ? m : 'today')(store.get('mode')),
  slots: new Set((a => Array.isArray(a) && a.length ? a : DEF_SLOTS)(store.get('hike18'))),   // 儲存名稱 hike18：2026-10-21 預設改 06–18 時換名稱，讓舊的預設（06–15）一起換成新預設
  name: '', shown: PAGE,
  ...loadFilters()
};
const filterCount = () => state.cats.size + state.counties.size + state.hts.size + (sameSet(state.slots, DEF_SLOTS) ? 0 : 1);   // 「篩選」按鈕：改了幾項（登山時段不是預設算 1 項）
const saveFilters = () => { store.set('hike18', [...state.slots]); store.set('filters', {cats:[...state.cats], counties:[...state.counties], hts:[...state.hts]}); };
const favs = new Set((a => Array.isArray(a) ? a : [])(store.get('favs')));
let cols = [], all = [], rows = [], favRows = [], byKey = new Map();
let evalStamp = '', dataStamp = '';
// 燈號會隨時間改變的兩個時機：跨過 3 小時時段（今天的「已過」時段）與載入新的預報資料
const timeStamp = () => { const n = Date.now(); return twMid(n) + '|' + Math.floor(tw(n).h/3); };

// ---------- 計算 ----------
function buildCols(mode = state.mode){
  if (mode === 'week') return [0,1,2,3,4,5,6].map(di => {
    const D = dayAt(di), t = tw(D);
    // 前 4 天（今天～大後天）用逐 3 小時預報判定；第 5–7 天只有一週預報、沒有降雨機率，虛線僅供參考（2026-10-21）
    return {di, date:D, ws:D, we:D+DAY, ref:di>=4, wkd:isWE(D), label:md(D), short:`${t.d}<span class="wd">${WD[t.wd]}</span>`, sub:'週'+WD[t.wd]+(di>=4?'<span class="refx">・參考</span>':'')};
  });
  const di = MODES[mode].di;
  return SLOTS.map(h => {
    const D = dayAt(di), peak = state.slots.has(h);   // win：計分範圍＝使用者選的登山時段（2026-10-21 起不再加前後各一段）
    return {di, hr:h, date:D, ws:D+h*H, we:D+(h+3)*H, past: D+(h+3)*H <= Date.now(), peak, win:peak, label:slotLabel(h), short:pad(h), head:`${pad(h)}<span class="hr-to">–${pad(h+3)}</span>`, sub: peak?'<span class="pk-sub">登山時段</span>':''};
  });
}
// 逐 3 小時的一格
function slotPer(p, x, c){
  const al = alertFor(p, c.ws, c.we), fc = slotForecast(p, c.di, c.hr);
  return {p, fc, al, past: c.past, j: judge(fc, x.low, al, false)};
}
// 一週的一天。前 4 天：登山時段內的每個 3 小時各自判定，取最差（2026-10-21 使用者選「甲」，和今天～大後天用同一份資料）；
// 今天已過的時段不算，登山時段全部過了就整格淡化。逐 3 小時資料缺少時，改用一週預報（12 小時）。
function dayPer(p, x, c, slots, am){
  if (c.di <= 3){
    const list = slots.map(h => ({h, ws: c.ws+h*H, we: c.ws+(h+3)*H, fc: slotForecast(p, c.di, h)})).filter(s => s.fc);
    if (list.length){
      const live = list.filter(s => s.we > Date.now());
      if (!live.length) return {p, fc: null, al: null, past: true, j: {lv: -1, why: []}};
      const js = live.map(s => { const al = alertFor(p, s.ws, s.we); return {s, al, j: judge(s.fc, x.low, al, false)}; });
      const lv = Math.max(...js.map(o => o.j.lv));
      const why = [...new Set(js.filter(o => o.j.lv > 0).flatMap(o => o.j.why.map(w => slotLabel(o.s.h) + ' ' + w)))];
      const max = k => { const v = live.map(s => s.fc[k]).filter(v => v != null); return v.length ? Math.max(...v) : null; };
      const ws = max('ws');
      const fc = {pop: max('pop'), ws, bf: ws != null ? beaufort(ws) : max('bf'), t: max('t'), at: max('at'), wx: [...new Set(live.map(s => s.fc.wx).filter(Boolean))].join('／') || null};
      return {p, fc, al: js.find(o => o.al)?.al || null, j: {lv, why, plus: lv === 0 && js.every(o => o.j.plus)}};
    }
  }
  const fc = dayForecast(p, c.di, slots), al = alertFor(p, c.ws, c.we);
  return {p, fc, al, half: true, ref: c.di >= 3, j: judgeDay(fc, x.low, al, c.di>=3, am)};
}
// 一座山在某個模式下的所有格子（列表與詳情共用；詳情可自己切換日期）
function cellsFor(x, mode, cs){
  const week = mode === 'week', slots = sortedSlots(), am = week && amOnly(slots);
  return cs.map(c => {
    const per = x.pts.map(p => week ? dayPer(p, x, c, slots, am) : slotPer(p, x, c));
    const lv = Math.max(...per.map(y=>y.j.lv));
    return {lv, plus: lv === 0 && per.every(y => y.j.plus), per, ref: !!c.ref || per.some(y => y.ref), past: !!c.past || per.every(y => y.past)};   // 跨鄉鎮：每個鄉鎮都是 A 才算 A
  });
}
const hash = t => { let h = 2166136261; for (const ch of t){ h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const fmtDayKey = () => { const d = new Date(Date.now() + 8*3600e3); return d.toISOString().slice(0, 10); };   // 台灣日期
const SCORE = c => c.plus ? 3 : 2 - c.lv;                 // A 3、B 2、C 1、D 0
function evaluate(){                                       // 依時段與登山時段計算所有山的燈號並排序
  evalStamp = timeStamp(); dataStamp = FC?.fetchedAt || '';
  cols = buildCols();
  const week = state.mode === 'week';
  const day = fmtDayKey();                               // 燈號相同時的順序：每天換一次（同一天內固定），避免永遠是同幾座山在前面
  all = MOUNTAINS.map(x => {
    const cells = cellsFor(x, state.mode, cols);
    // 計分排序（2026-10-20 方案乙）：A 3、B 2、C 1、D 0；已過與無資料不計分
    // s1：計分範圍（登山時段）總分（一週為 7 天總分）；p1：其中 A 數；c1：其中 D 數（2026-10-20 加入，D 少的在前）；s2：所有時段總分（只用於逐 3 小時）
    // nd：沒有任何資料（2026-10-20 加入，一律排最後）
    let s1 = 0, p1 = 0, c1 = 0, s2 = 0, has = false;
    cells.forEach((c, i) => {
      if (c.past || c.lv < 0) return;
      has = true;
      const pt = SCORE(c);
      if (week){ s1 += pt; if (c.plus) p1++; if (c.lv===2) c1++; }
      else { s2 += pt; if (cols[i].win){ s1 += pt; if (c.plus) p1++; if (c.lv===2) c1++; } }
    });
    return {...x, cells, s1, p1, c1, s2, nd: has ? 0 : 1, mix: hash(day + '|' + x.k)};
  }).sort(week   // 逐 3 小時（2026-10-21 方案甲，安全優先）：D 少 → 總分 → A 數 → 所有時段總分；一週維持：總分 → A 數 → D 少
    ? (a,b) => a.nd-b.nd || b.s1-a.s1 || b.p1-a.p1 || a.c1-b.c1 || a.mix-b.mix
    : (a,b) => a.nd-b.nd || a.c1-b.c1 || b.s1-a.s1 || b.p1-a.p1 || b.s2-a.s2 || a.mix-b.mix);
  byKey = new Map(all.map(r => [r.k, r]));
  applyFilters();
}
// 搜尋：「台」當成「臺」；可搜山名、別名、縣市（2026-10-21）
const norm = s => String(s || '').trim().replace(/台/g, '臺');
function applyFilters(){                                    // 篩選不需重算燈號
  const q = norm(state.name);
  // 搜尋文字和篩選同時套用：開始搜尋時篩選已回到預設，之後再改篩選仍會生效，不符合就顯示「沒有符合條件的山」（2026-10-20）
  rows = all.filter(r => (!state.cats.size || state.cats.has(r.m.c))
    && (!state.counties.size || r.counties.some(c => state.counties.has(c)))
    && (!state.hts.size || state.hts.has(r.ht))
    && (!q || r.search.includes(q)));
  favRows = all.filter(r => favs.has(r.k));
}
// 搜尋提示（2026-10-21）：打字時在搜尋框下方列出山名或別名符合的山（名稱相同 → 開頭相同 → 包含），點了把山名填進搜尋框、列出搜尋結果（2026-10-21 改，不再直接開詳情）
function suggestions(q){
  q = norm(q); if (!q) return [];
  return MOUNTAINS.map((x, i) => {
    const ns = [x.m.n, ...(x.m.al || [])];
    const rank = ns.includes(q) ? 0 : ns.some(n => n.startsWith(q)) ? 1 : ns.some(n => n.includes(q)) ? 2 : 9;
    return {x, i, rank, alias: x.m.n.includes(q) ? '' : (x.m.al || []).find(n => n.includes(q)) || ''};
  }).filter(o => o.rank < 9).sort((a, b) => a.rank - b.rank || a.x.m.n.length - b.x.m.n.length || a.i - b.i).slice(0, 8);
}

// ---------- 畫面 ----------
const star = k => { const on = favs.has(k), t = on ? '取消收藏' : '加入收藏';
  return `<button type="button" class="star" data-fav="${k}" aria-pressed="${on}" aria-label="${t}" title="${t}">${on?'♥':'♡'}</button>`; };
const lamp = (c, sm) => { const t = c.plus ? 'A' : SYM[LV(c.lv)];
  return `<i class="lamp ${CLS[LV(c.lv)]}${c.plus?' p':''}${c.ref?' ref':''}${c.past?' past':''}${sm?' sm':''}" title="${c.plus ? 'A 佳（晴）' : SYM[LV(c.lv)] + ' ' + WORD[LV(c.lv)]}${c.ref?'（參考）':''}${c.past?'（已過）':''}">${t}</i>`; };
const sub = m => `${m.h ? m.h.toLocaleString()+' m' : '標高待補'}・${m.c}・${esc(m.co)}`;   // 標高、類別、縣市（不顯示編號）
const dayName = D => `週${WD[wdOf(D)]}`;
// 列表與卡片都不顯示比較結果（段數、A 天數；2026-10-20 拿掉），排序仍照規則
const thCls = c => `${c.ref?'ref ':''}${c.peak?'peak ':''}${c.wkd?'we wk':''}`;
const headRow = () => {
  return `<tr><th class="mt">山岳</th>${cols.map(c=>`<th class="${thCls(c)}" data-c><span class="dt"><span class="lg">${c.head||c.label}</span><span class="st">${c.short}</span></span>${c.sub}</th>`).join('')}</tr>`;
};
const nameCell = (r, span) => `<th class="mt" scope="row"${span > 1 ? ` rowspan="${span}"` : ''}><div class="mt-in"><span class="nm">${esc(r.m.n)}</span><span class="sub">${sub(r.m)}</span>${star(r.k)}</div></th>`;
const bodyRow = r => `<tr data-k="${r.k}" tabindex="0">${nameCell(r)}${r.cells.map((c, i)=>`<td${cols[i].wkd?' class="wk"':''}>${lamp(c)}</td>`).join('')}</tr>`;
// 山岳卡片（手機列表與收藏；精簡兩列）：山名＋資訊＋收藏／燈號（不顯示比較結果，一週也不寫 A 天數；2026-10-20）
// 小燈上方標出時段（逐 3 小時寫開始時刻，一週寫日期＋星期）；登山時段實心深色底、週末紅色
// 一週模式的週六、週日：整欄淡紅底（2026-10-21 使用者選「甲」）。底色是另外放在同一欄後面的方塊，所以時段標示與燈號都明確指定欄位
const gc = (i, row) => ` style="grid-column:${i+1};grid-row:${row}"`;
const pickHead = () => {
  return cols.map((c, i) => (c.wkd ? `<span class="wk-bg"${gc(i, '1 / 3')} aria-hidden="true"></span>` : '')
    + `<span class="ph${c.peak?' peak':''}${c.wkd?' we':''}${c.ref?' ref':''}"${gc(i, 1)} aria-hidden="true">${c.short}</span>`).join('');
};
const pickCard = (r, head) => `<div class="pick" data-k="${r.k}" tabindex="0" role="button"><div class="p1"><span class="nm">${esc(r.m.n)}</span><span class="meta">${sub(r.m)}</span>${star(r.k)}</div><div class="p2"><span class="lights" style="--n:${cols.length}">${head}${r.cells.map((c, i)=>lamp(c,true).replace('<i ', `<i${gc(i, 2)} `)).join('')}</span></div></div>`;

function render(){
  const week = state.mode === 'week';
  $('h-picks-t').textContent = (week ? '這週' : MODES[state.mode].name) + '燈號排序';
  $('pick-info-body').innerHTML = pickInfo(state.mode); gradeChips($('pick-info-body'));
  document.querySelectorAll('#seg .sd').forEach((e, i) => { const d = dayAt(i); e.innerHTML = `${md(d)}<span class="sw">${dayName(d)}</span>`; e.classList.toggle('we', isWE(d)); });
  $('seg-week').innerHTML = `${md(dayAt(0))}–<span class="sw">${md(dayAt(6))}</span>`;   // 一週按鈕下方寫日期區間：起始日、結束日各一行
  ['matrix','fav-matrix'].forEach(id => $(id).style.setProperty('--n', cols.length));
  const showRef = week || all.some(r => r.cells.some(c => c.ref));
  document.querySelectorAll('.lg-ref').forEach(e => e.hidden = !showRef);
  if (!showRef) setInfo(false);
  const ph = pickHead();
  const head = headRow();
  $('fav-tab-n').textContent = favRows.length || '';
  $('filter-n').textContent = filterCount() || '';
  $('fav-box').hidden = !favRows.length; $('fav-empty').hidden = !!favRows.length;
  $('fav-matrix').tHead.innerHTML = head;
  $('fav-matrix').tBodies[0].innerHTML = favRows.map(bodyRow).join('');
  $('fav-cards').innerHTML = favRows.map(r => pickCard(r, ph)).join('');
  $('matrix').tHead.innerHTML = head;
  const shown = rows.slice(0,state.shown);
  const nc = cols.length + 1;
  $('matrix').tBodies[0].innerHTML = shown.map(bodyRow).join('') || `<tr><td class="empty" colspan="${nc}">沒有符合條件的山。</td></tr>`;
  $('matrix-cards').innerHTML = shown.map(r => pickCard(r, ph)).join('') || '<div class="empty">沒有符合條件的山。</div>';
  $('more-box').hidden = rows.length <= state.shown;
  $('more').textContent = `顯示更多（還有 ${rows.length-state.shown} 座）`;
}
const fresh = () => evalStamp === timeStamp() && dataStamp === (FC?.fetchedAt || '');
const refresh = () => { evaluate(); render(); };                                            // 時段或登山時段改變：重算燈號
const refilter = () => { state.shown = PAGE; fresh() ? applyFilters() : evaluate(); render(); }; // 篩選改變：資料仍新就只重新篩選

// 詳情：可以自己切換日期（2026-10-21 使用者決定），不影響列表
const MBYK = new Map(MOUNTAINS.map(x => [x.k, x]));
let dState = null;
function openDetail(k, mode = state.mode){
  if (!MBYK.has(k)) return;
  dState = {k, mode}; $('drawer').scrollTop = 0; renderDetail(); $('d-close').focus();
}
function segLabel(mode){
  const rng = (a, b) => `${md(a)}–${tw(b).mo === tw(a).mo ? tw(b).d : md(b)}`;   // 例：10/24–25（詳情按鈕較窄）
  if (mode === 'week') return rng(dayAt(0), dayAt(6));
  return md(dayAt(MODES[mode].di));
}
function renderDetail(){
  const {k, mode} = dState, x = MBYK.get(k), week = mode === 'week', pts = x.pts;
  const dc = buildCols(mode), cells = cellsFor(x, mode, dc);
  const alerts = [...new Map(pts.flatMap(p => alertHits(p, dc[0].ws, dc[dc.length-1].we)).map(a => [a.county+a.type, a])).values()];   // 詳情列出所有生效中的特報（颱風、豪雨、大雨）
  const v = (y, f) => y == null ? '—' : f(y);
  // 詳情表格：時段橫排（tenki.jp 做法，2026-10-20 使用者選「選項 1」）。欄是時段、列是項目，手機也不需左右滑動；
  // C、D 的原因列在表格下方
  const table = (p, k, idx, title) => {
    const cl = (c, col) => [c.ref ? 'ref' : '', c.past ? 'past' : '', col.peak ? 'peak' : '', week && col.wkd ? 'we wk' : ''].filter(Boolean).join(' ');
    const head = idx.map(j => { const col = dc[j]; return `<th class="${cl(cells[j], col)}">${week ? `${md(col.date)}<span class="wd">${dayName(col.date)}</span>` : col.short}</th>`; }).join('');
    const row = (name, f, cls = '') => `<tr class="${cls}"><th scope="row">${name}</th>${idx.map(j => { const c = cells[j]; return `<td class="${cl(c, dc[j])}">${f(c.per[k], c)}</td>`; }).join('')}</tr>`;
    const whys = idx.map(j => { const c = cells[j], y = c.per[k]; return y.j.lv > 0 ? `<li><b>${dc[j].label}</b>${lamp({lv:y.j.lv, ref:c.ref, past:c.past}, true)}${esc(y.j.why.join('、'))}</li>` : ''; }).join('');
    return `<div class="pt"><h3>${esc(p.label)}・${title}</h3>
      <table class="vt" style="--n:${idx.length}"><thead><tr><th></th>${head}</tr></thead><tbody>
      ${row('燈號', (y, c) => lamp({lv:y.j.lv, plus:y.j.plus, ref:c.ref, past:c.past}, true), 'lr')}
      ${row('天氣', y => v(y.fc?.wx, esc), 'wx')}
      ${row('降雨<small>%</small>', y => v(y.fc?.pop, n => n))}
      ${row('風<small>級</small>', y => v(y.fc?.bf ?? (y.fc?.ws != null ? beaufort(y.fc.ws) : null), n => n))}
      ${row('氣溫<small>°C</small>', y => v(y.fc?.t, n => n))}
      ${row('體感<small>°C</small>', y => v(y.fc?.at, n => n))}
      </tbody></table>${whys ? `<div class="whys"><h4>C、D燈號原因</h4><ul>${whys}</ul></div>` : ''}</div>`;
  };
  const groups = week ? [{idx: dc.map((_, j) => j), title: '一週'}]
    : [{idx: dc.map((_, j) => j), title: `${MODES[mode].name} ${md(dc[0].date)}（${WD[wdOf(dc[0].date)]}）逐 3 小時預報`}];
  const town = pts.some(p => !p.code);
  const dr = $('drawer'), top = dr.scrollTop;
  dr.innerHTML = `
    <div class="d-head"><div><h2 id="d-title">${esc(x.m.n)}${star(x.k)}</h2><div class="sub">${sub(x.m)}</div></div><button class="close" type="button" id="d-close" aria-label="關閉">×</button></div>
    <div class="d-seg" role="tablist" aria-label="詳情日期">${Object.keys(MODES).map(m => `<button type="button" role="tab" data-dmode="${m}" aria-selected="${m === mode}">${MODES[m].name}<small>${segLabel(m)}</small></button>`).join('')}</div>
    <div class="src"><span><b>採用預報</b>：${esc(pts.map(p=>p.label+(p.code?'（'+p.code+'）':'')).join('、'))}</span>
      ${town ? '<span class="town">因氣象署無直接對應點位，此為鄉鎮預報，僅供參考。</span>' : ''}
      ${(() => { const ls = pts.map(p => [p, cwaUrl(p)]).filter(y => y[1]); return ls.length ? `<span class="cwa">${ls.map(([p, u]) => `<a href="${u}" target="_blank" rel="noopener">${ls.length > 1 ? esc(p.key.slice(3)) + ' ' : ''}氣象署原始預報 ↗</a>`).join('')}</span>` : ''; })()}
      <span>${pts.length>1?'跨多個鄉鎮，各自列出；燈號取最差的鄉鎮。':''}${x.low?'標高 1,000 公尺以下，另判斷高溫。':''}</span>
      <span class="issued">資料來源：交通部中央氣象署・本站更新 ${FC ? fmtTime(Date.parse(FC.fetchedAt)) : '—'}</span></div>
    ${alerts.map(a=>`<div class="alert"><b>${esc(a.type)}・${SYM[a.lv]}</b>　${esc(a.county)}${a.end?`，有效至 ${fmtTime(a.end)}`:''}</div>`).join('')}
    ${x.m.al?.length?`<div class="note">別名：${esc(x.m.al.join('、'))}</div>`:''}
    ${x.m.note?`<div class="note">備註：${esc(x.m.note)}</div>`:''}
    ${pts.map((p, k) => groups.map(g => table(p, k, g.idx, g.title)).join('')).join('')}
    <div class="note">${week ? '一週預報以你選的登山時段（'+sortedSlots().map(slotLabel).join('、')+'）判定，取最差情況。前 4 天用逐 3 小時預報，天氣、降雨等數值是登山時段內的最大值；第 5–7 天氣象署未提供降雨機率，以「—」表示，依天氣描述判定，請在出發前 3 天內再確認。'
      : '逐 3 小時預報；底色時段是你選的登山時段，排序依登山時段計算。'}</div>`;
  dr.hidden = false; $('scrim').hidden = false; dr.scrollTop = top;
}
// 氣象署原始預報（2026-10-21 使用者決定）：登山預報點用預報點代碼，鄉鎮用氣象署網頁的 7 碼鄉鎮代碼，讓使用者自己查核
// 資料裡的鄉鎮代碼是 8 碼＝縣市 5 碼＋鄉鎮序號 2 碼＋0。氣象署網頁：一般縣市＝縣市 5 碼＋序號 2 碼（宜蘭市 10002010 → 1000201）；
// 直轄市（63～68 開頭）＝前 2 碼＋序號 3 碼＋00（臺南市南化區 67000NN0 → 670NN00）。依氣象署網站地圖核對（2026-10-21）
const townTID = g => !/^\d{8}$/.test(g || '') ? '' : /^6[3-8]000/.test(g) ? g.slice(0, 2) + '0' + g.slice(5, 7) + '00' : g.slice(0, 7);
function cwaUrl(p){
  if (p.code) return 'https://www.cwa.gov.tw/V8/C/L/Mountain/Mountain.html?PID=' + encodeURIComponent(p.code);
  const t = townTID(fcIndex.get(p.key)?.geo);
  return t ? 'https://www.cwa.gov.tw/V8/C/W/Town/Town.html?TID=' + t : '';
}
function closeDetail(){ $('drawer').hidden = true; $('scrim').hidden = true; }
// 燈號排序旁的 i：依目前模式說明比較標準與排序，用字與「排序規則與說明」頁一致（2026-10-20）
function pickInfo(mode){
  const week = mode === 'week', slots = sortedSlots().map(slotLabel).join('、');
  const ul = a => '<ul>' + a.map(x => '<li>' + x + '</li>').join('') + '</ul>', ol = a => '<ol>' + a.map(x => '<li>' + x + '</li>').join('') + '</ol>';
  const std = ['A：佳，各項都適合，且天氣描述是「晴」；B：可，各項都適合；C：注意；D：不建議。',
    '依氣象署預報檢查降雨機率、天氣描述（霧、雪、雷）、平均風速，以及颱風、豪雨、大雨特報；標高 1,000 公尺以下另看高溫。以最差的一項作為燈號。',
    '跨多個鄉鎮的山，取最差的鄉鎮。'];
  const score = '計分：A 3 分、B 2 分、C 1 分、D 0 分。已過的時段和無資料不計分。';
  const tie = '以上所有條件都相同時：每天隨機排序一次同條件山岳。', nodata = '完全沒有資料的山排在最後。';
  if (week) return '<h4>比較標準</h4>' + ul([...std, `前 4 天（今天到大後天）用逐 3 小時預報：你選的登山時段（${esc(slots)}）中，取最差的一段作為當天燈號；今天已過的時段不算。`, `第 5–7 天用一週預報：登山時段對應到白天或晚上，取最差的；登山時段都在 12 點前時，白天描述的「午後」部分不計。氣象署沒有降雨機率，依天氣描述判定：「局部」「短暫」的雨為 C，其他的雨（例如「陣雨」「有雨」）為 D。僅供參考。`])
    + '<h4>排序</h4>' + ul([score]) + '<p class="ip">依序比較：</p>' + ol(['7 天的總分，高的在前', 'A 的天數，多的在前', 'D 的天數，少的在前']) + ul([nodata, tie]);
  return '<h4>比較標準</h4>' + ul([...std, '每 3 小時一格，每格一個燈號。', ...(mode === 'today' ? ['今天已過的時段不計分。'] : [])])
    + '<h4>排序</h4>' + ul([score]) + '<p class="ip">依序比較：</p>' + ol(['登山時段中 D 的數量，少的在前', '登山時段的總分，高的在前', '登山時段中 A 的數量，多的在前', '當天所有時段的總分，高的在前']) + ul(['登山時段都過了，就改看當天剩下的時段。', nodata, tie]);
}
// 說明文字中的燈號（A、B、C、D、—）換成小燈號方塊，顏色與列表一致（2026-10-20 使用者選「選項 1」）
const GRADE_RE = /—|(?<![A-Za-z0-9°])[ABCD](?![A-Za-z0-9+])/g,   // 「°C」的 C 不是燈號（2026-10-20）
 GRADE_CLS = {'A':'g p', 'B':'g', 'C':'y', 'D':'r', '—':'na'};
function gradeChips(root){
  if (!root) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
  while (w.nextNode()) if (!w.currentNode.parentElement.closest('.lamp,button,.kbd')) nodes.push(w.currentNode);
  for (const n of nodes){
    GRADE_RE.lastIndex = 0; if (!GRADE_RE.test(n.data)) continue;
    const t = document.createElement('template');
    t.innerHTML = esc(n.data).replace(GRADE_RE, m => `<i class="lamp sm chip ${GRADE_CLS[m]}">${m}</i>`);
    n.replaceWith(t.content);
  }
}
function setPickInfo(v){ $('pick-info').hidden = !v; $('pick-info-btn').setAttribute('aria-expanded', v); }
function setInfo(v){ $('info-ref').hidden = !v; $('info-btn').setAttribute('aria-expanded', v); }

// 讀取預報資料；失敗時保留已有資料並提示
async function loadForecast(){
  try{
    const r = await fetch('forecast.json?t=' + Date.now(), {cache: 'no-store'});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    loadError = ''; offline = r.headers?.get?.('x-kantian-offline') === '1';
    if (data.fetchedAt !== FC?.fetchedAt){ useForecast(data); refresh(); }
  }catch(e){ loadError = '暫時無法取得天氣資料，請稍後重新整理。'; }
  showStatus();
}
// 颱風提示：只轉述氣象署的颱風路徑與警報，燈號不變（2026-10-20 使用者決定）
function showTyphoon(){
  const box = $('typhoon'), ts = FC?.typhoons || [];
  box.hidden = !ts.length; if (!ts.length) return;
  const when = t => { const d = tw(t); return t <= Date.now() ? '目前' : `${d.mo}/${d.d}（${WD[d.wd]}）${d.h < 12 ? '上午' : d.h < 18 ? '下午' : '晚上'}前後`; };
  // 「第 5–7 天僅供參考」放在最前面（2026-10-21 使用者決定），收起時也看得到；文字接在同一段，不換行
  const nm = t => `${t.scale ? esc(t.scale) : '颱風'}${esc(t.name)}`;
  box.innerHTML = `<div class="ty-body"><p><b>⚠ ${ts.map(nm).join('、')}</b>：一週預報的第 5–7 天僅供參考，燈號可能偏樂觀。`
    + ts.map(t => `${ts.length > 1 ? nm(t) + '：' : ''}${t.warn ? `氣象署已發布「${esc(t.warn.headline)}」。` : ''}${t.near ? `氣象署預測${when(t.near.t)}最接近臺灣，中心距臺灣陸地約 ${t.near.km} 公里。` : ''}`).join('')
    + `出發前請看<a href="https://www.cwa.gov.tw/V8/C/P/Typhoon/TY_NEWS.html" target="_blank" rel="noopener">氣象署颱風消息</a>。</p></div>`
    + '<svg class="ty-more" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  fitTyphoon();
}
// 颱風提示只顯示前兩行，點擊展開／收起（2026-10-20 使用者決定）；內容本來就在兩行內時不需要展開
function fitTyphoon(){
  const box = $('typhoon'), body = box.querySelector('.ty-body'); if (!body || box.hidden) return;
  const more = box.classList.contains('open') || body.scrollHeight > body.clientHeight + 1;
  box.classList.toggle('more', more);
  if (more){ box.tabIndex = 0; box.setAttribute('aria-expanded', box.classList.contains('open')); }
  else { box.removeAttribute('tabindex'); box.removeAttribute('aria-expanded'); }
}
function showStatus(){
  showTyphoon();
  const s = $('status'), at = FC ? Date.parse(FC.fetchedAt) : 0;
  $('issued').textContent = FC ? '資料更新：' + fmtTime(at) : (loadError ? '' : '資料載入中…');
  const msg = loadError && !FC ? loadError
    : offline ? `目前沒有網路，顯示的是手機裡存的資料（資料更新 ${fmtTime(at)}）。`
    : loadError ? `無法取得最新資料，以下是 ${fmtTime(at)} 的資料。`
    : FC && Date.now() - at > STALE ? `天氣資料可能不是最新：上次更新是 ${fmtTime(at)}，出發前請到氣象署網站確認。` : '';
  s.textContent = msg; s.hidden = !msg;
}

// 多選按鈕群組：有「全部」按鈕者未選＝全部；登山時段至少保留一項
function chipGroup(box, attr, set, {allId, parse = v => v, keepOne, onChange}){
  const sync = () => {
    box.querySelectorAll(`[${attr}]`).forEach(b => b.setAttribute('aria-pressed', set.has(parse(b.getAttribute(attr)))));
    if (allId) $(allId).setAttribute('aria-pressed', !set.size);
  };
  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;   // 防呆：鎖住的選項不能選
    if (allId && b.id === allId) set.clear();
    else if (b.hasAttribute(attr)){
      const v = parse(b.getAttribute(attr));
      if (set.has(v)){ if (keepOne && set.size === 1) return; set.delete(v); } else set.add(v);
    } else return;
    sync(); onChange();
  });
  sync();
  return sync;
}
// 篩選防呆（2026-10-20 使用者決定）：類別、標高、縣市三組互相檢查，某個選項和另外兩組目前的選擇組合起來沒有任何山，
// 就鎖住不給選（例如選了百岳，「1,000 m 以下」不能選）。同一組內是「或」，只會擴大範圍，所以不互相鎖。已選的選項一律可以取消。
function lockChips(){
  const G = [
    {box:'f-cat', attr:'data-c', set:state.cats, parse:v => v, has:(x, v) => x.m.c === v},
    {box:'f-county', attr:'data-co', set:state.counties, parse:v => v, has:(x, v) => x.counties.includes(v)},
    {box:'f-ht', attr:'data-ht', set:state.hts, parse:Number, has:(x, v) => x.ht === v}];
  G.forEach(g => {
    const pool = MOUNTAINS.filter(x => G.every(o => o === g || !o.set.size || [...o.set].some(v => o.has(x, v))));
    $(g.box).querySelectorAll(`[${g.attr}]`).forEach(b => {
      const v = g.parse(b.getAttribute(g.attr)), off = !g.set.has(v) && !pool.some(x => g.has(x, v));
      b.disabled = off; b.title = off ? '和目前其他篩選條件組合起來沒有山' : '';
    });
  });
}
const sameSet = (set, arr) => set.size === arr.length && arr.every(x => set.has(x));

// ---------- 啟動與事件 ----------
(function init(){
  const counties = [...new Set(M.flatMap(m => m.co.split('、')))].filter(Boolean).sort((a,b) => COUNTY_ORDER.indexOf(a) - COUNTY_ORDER.indexOf(b));
  $('f-county').innerHTML = `<button type="button" class="chip reset" id="c-all" aria-pressed="true">全部</button>` + counties.map(c=>`<button type="button" class="chip" data-co="${esc(c)}" aria-pressed="false">${esc(c)}</button>`).join('');
  $('f-slots').innerHTML = SLOTS.map(h=>`<button type="button" class="chip mono" data-h="${h}">${slotLabel(h)}</button>`).join('');

  // 篩選面板裡的選擇先記下，按「完成」（或關閉面板）時才一次重新計算、排序，並回到列表最上面
  let pending = false;
  const isDef = () => !state.cats.size && !state.counties.size && !state.hts.size && sameSet(state.slots, DEF_SLOTS);
  const syncReset = () => { $('filter-reset').disabled = isDef(); };
  const onPick = () => { pending = true; $('filter-n').textContent = filterCount() || ''; lockChips(); syncReset(); };
  const syncs = [chipGroup($('f-county'), 'data-co', state.counties, {allId:'c-all', onChange: onPick}),
    chipGroup($('f-cat'), 'data-c', state.cats, {allId:'cat-all', onChange: onPick}),
    chipGroup($('f-ht'), 'data-ht', state.hts, {allId:'ht-all', parse: Number, onChange: onPick})];
  // 開始搜尋（搜尋框從空白變成有字）時，類別、標高、縣市篩選回到預設（全部）並記住；登山時段不變（2026-10-20 使用者決定）
  const resetForSearch = () => { if (!state.cats.size && !state.counties.size && !state.hts.size) return;
    state.cats.clear(); state.counties.clear(); state.hts.clear(); syncs.forEach(f => f()); lockChips(); saveFilters(); syncReset(); };
  const syncSlots = chipGroup($('f-slots'), 'data-h', state.slots, {parse: Number, keepOne: true, onChange: onPick});
  // 「恢復預設條件」（2026-10-21）：登山時段回到 06–18，類別、標高、縣市回到全部；和其他選項一樣按「完成」才套用
  $('filter-reset').onclick = () => { if (isDef()) return;
    state.cats.clear(); state.counties.clear(); state.hts.clear(); state.slots.clear(); DEF_SLOTS.forEach(h => state.slots.add(h));
    syncs.forEach(f => f()); syncSlots(); onPick(); };
  lockChips(); saveFilters(); syncReset();

  const seg = document.querySelectorAll('#seg button');
  const syncSeg = () => seg.forEach(b => b.setAttribute('aria-selected', b.dataset.mode === state.mode));
  seg.forEach(b => b.onclick = () => { state.mode = b.dataset.mode; state.shown = PAGE; syncSeg(); store.set('mode', state.mode); refresh(); });
  syncSeg();

  $('f-kw').oninput = e => { const was = state.name.trim(); state.name = e.target.value; if (!was && state.name.trim()) resetForSearch();   // 從空白開始輸入時才重設篩選，搜尋中改篩選照常套用
 $('search').classList.toggle('has', !!state.name.trim()); if ($('view-find').hidden) $('tab-find').click(); refilter(); };
  // 搜尋框一直展開（2026-10-21 使用者決定）；× 只清除文字
  // 手機上搜尋框較窄，提示文字縮短（完整說明仍在 aria-label）
  const kwPh = () => { $('f-kw').placeholder = matchMedia('(max-width:640px)').matches ? '搜尋山名或縣市' : '搜尋山名、別名或縣市'; };
  kwPh(); addEventListener('resize', kwPh);
  $('s-x').onclick = () => { const f = $('f-kw'); f.value = ''; f.dispatchEvent(new Event('input')); f.focus(); };
  // 搜尋提示（2026-10-21）：搜尋框下方列出符合的山，點了把山名填進搜尋框、列出搜尋結果（不開詳情）
  const sg = $('suggest');
  const showSuggest = () => { const list = document.activeElement === $('f-kw') ? suggestions(state.name) : [];
    sg.innerHTML = list.map(o => `<button type="button" class="sg" data-sg="${esc(o.x.m.n)}" role="option"><span class="nm">${esc(o.x.m.n)}</span>${o.alias ? `<span class="al">${esc(o.alias)}</span>` : ''}<span class="meta">${sub(o.x.m)}</span></button>`).join('');
    sg.hidden = !list.length; };
  const hideSuggest = () => { sg.hidden = true; };
  sg.addEventListener('pointerdown', e => e.preventDefault());   // 點提示時搜尋框不先失去焦點
  sg.addEventListener('click', e => { const b = e.target.closest('[data-sg]'); if (!b) return;
    const f = $('f-kw'); f.value = b.dataset.sg; f.dispatchEvent(new Event('input')); hideSuggest(); f.blur(); window.scrollTo(0, 0); });
  $('f-kw').addEventListener('input', showSuggest);
  $('f-kw').addEventListener('focus', showSuggest);
  $('f-kw').addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); hideSuggest(); e.target.blur(); } });   // 按「搜尋」／Enter：收起手機鍵盤（搜尋框有字所以維持展開）
  $('f-kw').addEventListener('blur', () => setTimeout(hideSuggest, 150));
  const setFilter = open => {
    $('q').classList.toggle('open', open); $('f-scrim').hidden = !open; $('filter-btn').setAttribute('aria-expanded', open);
    if (!open && pending){ pending = false; saveFilters(); state.shown = PAGE; refresh(); window.scrollTo(0, 0); }   // 按「完成」才套用並記住
  };
  $('filter-btn').onclick = () => { if (!$('view-find').hidden || !$('view-fav').hidden) setFilter(!$('q').classList.contains('open')); else { $('tab-find').click(); setFilter(true); } };
  $('filter-done').onclick = $('f-scrim').onclick = () => setFilter(false);
  const tyToggle = () => { const box = $('typhoon'); if (!box.classList.contains('more')) return; box.classList.toggle('open'); box.setAttribute('aria-expanded', box.classList.contains('open')); };
  $('typhoon').addEventListener('click', e => { if (!e.target.closest('a')) tyToggle(); });
  $('typhoon').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('a')){ e.preventDefault(); tyToggle(); } });
  addEventListener('resize', fitTyphoon);
  document.addEventListener('keydown', e => { if (e.key === 'Escape'){ setFilter(false); hideSuggest(); if (document.activeElement === $('f-kw')) $('f-kw').blur(); } });
  $('q').onsubmit = e => e.preventDefault();
  $('brand').onclick = e => { e.preventDefault(); window.scrollTo({top: 0, behavior: 'smooth'}); };   // 點標題：回到最上方（不重新整理）
  $('reload-btn').onclick = () => location.reload();   // 「○○燈號排序」旁、篩選右側的重新整理圖示：重新整理網頁（篩選與登山時段會保留）
  $('more').onclick = () => { state.shown += PAGE; if (!fresh()) evaluate(); render(); };
  $('info-btn').onclick = () => setInfo($('info-ref').hidden);
  $('info-x').onclick = () => { setInfo(false); $('info-btn').focus(); };
  $('pick-info-btn').onclick = () => setPickInfo($('pick-info').hidden);
  $('pick-info-x').onclick = () => { setPickInfo(false); $('pick-info-btn').focus(); };
  $('pick-info-more').onclick = () => { setPickInfo(false); $('tab-rules').click(); window.scrollTo(0, 0); };
  $('scrim').onclick = closeDetail;
  const tabs = document.querySelectorAll('.tabs button');
  tabs.forEach(b => b.onclick = () => {
    const v = b.dataset.view;
    tabs.forEach(o => o.setAttribute('aria-selected', o === b));
    ['find','fav','rules'].forEach(x => $('view-'+x).hidden = v !== x);
    document.body.dataset.view = v;
    if (v === 'rules') setFilter(false);                       // 排序規則頁隱藏登山時段與預報時段
    window.scrollTo(0, 0);                                // 切換分頁時回到頁面頂端
  });

  document.addEventListener('click', e => {
    const dr = $('drawer'), s = e.target.closest('[data-fav]');
    if (s){                                                 // 收藏／取消收藏
      e.stopPropagation();
      const k = s.dataset.fav;
      favs.has(k) ? favs.delete(k) : favs.add(k);
      store.set('favs', [...favs]);
      fresh() ? applyFilters() : evaluate(); render();
      const ds = dr.querySelector('[data-fav]');
      if (!dr.hidden && ds) ds.outerHTML = star(k);
      return;
    }
    if (e.target.closest('#d-close')) return closeDetail();
    const dm = e.target.closest('[data-dmode]');
    if (dm && dState){ dState.mode = dm.dataset.dmode; renderDetail(); return; }   // 詳情裡切換日期（不影響列表）
    const t = e.target.closest('[data-k]');
    if (t && !e.target.closest('#drawer')) openDetail(t.dataset.k);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') return closeDetail();
    if (e.key === 'Enter' && !e.target.closest('[data-fav]')){ const t = e.target.closest('[data-k]'); if (t) openDetail(t.dataset.k); }
  });

  gradeChips(document.querySelector('article.doc')); gradeChips($('info-ref'));
  // 離線查看（2026-10-21）：sw.js 把最近一次的網頁與預報存在手機裡，沒有網路時改用存著的版本
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
  refresh();                                                // 先顯示山岳清單，資料到了再補上燈號
  loadForecast();
  // 網頁開著時：每分鐘檢查是否跨時段；每 15 分鐘或回到網頁時，檢查是否有新資料
  let lastLoad = Date.now();
  const tick = () => { if (Date.now() - lastLoad > 15*60e3){ lastLoad = Date.now(); loadForecast(); } else if (!fresh()) refresh(); showStatus(); };
  setInterval(tick, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden){ lastLoad = 0; tick(); } });
})();
