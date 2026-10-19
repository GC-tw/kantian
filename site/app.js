/* 看天爬山
   結構：常數 → 工具 → 預報資料（讀取 forecast.json，由 GitHub Actions 在氣象署每次發布後更新）→ 判定規則 → 山岳模型 → 狀態 → 計算 → 畫面 → 事件 */

// ---------- 常數 ----------
const M = __DATA__;
const WD = ['日','一','二','三','四','五','六'];
const SLOTS = [0,3,6,9,12,15,18,21];                       // 每段 3 小時的開始時刻
const MODES = {today:{di:0,name:'今天'}, tmr:{di:1,name:'明天'}, d2:{di:2,name:'後天'}, week:{name:'一週'}};
const COUNTY_ORDER = ['基隆市','臺北市','新北市','桃園市','新竹市','新竹縣','苗栗縣','臺中市','彰化縣','南投縣','雲林縣','嘉義市','嘉義縣','臺南市','高雄市','屏東縣','宜蘭縣','花蓮縣','臺東縣','澎湖縣','金門縣','連江縣'];
const BF = [0,0.3,1.6,3.4,5.5,8.0,10.8,13.9,17.2,20.8,24.5];  // 蒲福風級下限（公尺／秒）
const SYM = ['○','△','✕','—'], CLS = ['g','y','r','na'], WORD = ['適合','注意','不建議','時間已過或無資料'];
const LV = lv => lv < 0 ? 3 : lv;                                // 燈號等級 -1 代表沒有資料
const REGIONS = [['全台', []],                              // 標題列的地區快速切換；選了地區＝勾選該地區所有縣市
  ['北部', ['基隆市','臺北市','新北市','桃園市','新竹市','新竹縣','宜蘭縣']],
  ['中部', ['苗栗縣','臺中市','彰化縣','南投縣','雲林縣']],
  ['南部', ['嘉義市','嘉義縣','臺南市','高雄市','屏東縣']],
  ['花東', ['花蓮縣','臺東縣']],
  ['離島', ['澎湖縣','金門縣','連江縣']]];
const PAGE = 10;                                           // 山岳列表一次顯示幾座
const H = 3600e3, STALE = 9*H;                              // 超過 9 小時沒更新就提醒

// ---------- 工具 ----------
const $ = id => document.getElementById(id);
const pad = h => String(h).padStart(2,'0');
const slotLabel = h => `${pad(h)}–${pad(h+3)}`;
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const fmt = d => `${d.getMonth()+1}/${d.getDate()}（${WD[d.getDay()]}）`;
const isWE = d => d.getDay() % 6 === 0;                      // 週六、週日
const fmtH = d => isWE(d) ? `<span class="we">${fmt(d)}</span>` : fmt(d);   // 週末上紅色（放進 innerHTML 用）
const dayAt = i => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+i); return d; };
const beaufort = ws => BF.reduce((b, v, i) => ws >= v ? i : b, 0);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));  // 外部資料（氣象署文字）放進畫面前先轉義
const sortedSlots = () => [...state.slots].sort((a,b)=>a-b);
const store = {                                             // 瀏覽器儲存：讀寫失敗時不影響畫面
  raw(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
  get(k, fb){ const v = this.raw(k); if (v == null) return fb; try{ return JSON.parse(v); }catch(e){ return v; } },
  set(k, v){ try{ localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); }catch(e){} }
};
const fmtTime = ms => { const d = new Date(ms); return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// ---------- 預報資料（forecast.json；格式見 scripts/fetch.mjs）----------
let FC = null, fcIndex = new Map(), loadError = '';
function useForecast(data){
  FC = data; fcIndex = new Map();
  for (const [key, p] of Object.entries(data.points || {}))
    fcIndex.set(key, {h3: new Map((p.h3 || []).map(r => [r.s, r])), week: new Map((p.week || []).map(r => [r.s, r]))});
  FC.alerts = (data.alerts || []).slice().sort((a, b) => b.lv - a.lv);
}
function slotForecast(p, di, hr){                           // 逐 3 小時：沒有資料時回傳 null
  return fcIndex.get(p.key)?.h3.get(dayAt(di).getTime() + hr*H) || null;
}
function dayForecast(p, di, slots){                         // 一週：把登頂時段對應到白天（06–18）或晚上（18–06），取最差情況
  const idx = fcIndex.get(p.key); if (!idx) return null;
  const D = dayAt(di).getTime();
  const s = [...new Set(slots.map(h => h>=6 && h<18 ? D+6*H : h>=18 ? D+18*H : D-6*H))].map(S => idx.week.get(S)).filter(Boolean);
  if (!s.length) return null;
  const wx = x => x.wx || '';
  const worst = s.find(x=>wx(x).includes('雷')) || s.find(x=>/大雨|豪雨/.test(wx(x))) || s.find(x=>wx(x).includes('雨')) || s[0];
  const max = k => { const v = s.map(x=>x[k]).filter(v=>v!=null); return v.length ? Math.max(...v) : null; };
  const ws = max('ws');
  return {pop: di<3 ? max('pop') : null, ws, bf: ws!=null ? beaufort(ws) : max('bf'), t: max('t'), at: max('at'), wx: worst.wx};
}
function alertFor(p, start, end){                           // 時段內生效、涵蓋這座山所在縣市的特報（取最嚴重）
  return (FC?.alerts || []).find(a => p.counties.includes(a.county) && (a.start == null || a.start < end) && (a.end == null || a.end > start)) || null;
}

// ---------- 判定規則（與「排序規則與說明」頁一致）----------
function judge(fc, lowHill, alert, noPop){
  const why = []; let lv = 0, heavy = false;
  const up = (n, w) => { if (n > lv) lv = n; if (n > 0 && !why.includes(w)) why.push(w); };
  if (alert) up(alert.lv, alert.type);
  if (!fc) return alert ? {lv, why, heavy} : {lv: -1, why: ['無資料'], heavy};
  const wx = fc.wx || '';
  if (wx.includes('雷')) up(2, '有雷');
  if (/大雨|豪雨/.test(wx)) up(2, '大雨');
  if (/下雪|積冰|暴風雪/.test(wx)) up(2, wx);             // 雪：下雪、積冰、暴風雪不建議；「雨或雪」等其他有「雪」的描述為注意
  else if (wx.includes('雪')) up(1, wx);
  if (wx.includes('霧')) up(1, '有霧');
  if (!noPop && fc.pop != null){ if (fc.pop>=60) up(2, '降雨機率 '+fc.pop+'%'); else if (fc.pop>=30) up(1, '降雨機率 '+fc.pop+'%'); }
  else if (wx.includes('雨')){                            // 沒有降雨機率（第 4–7 天）：寫出原始天氣描述，「短暫」以外的雨另外標記，排序時往後
    up(1, noPop ? wx + '（第 4–7 天無降雨機率）' : '可能下雨');
    heavy = noPop && !/短暫/.test(wx);
  }
  if (fc.ws != null){ if (fc.ws>=13.9) up(2, '風速 '+fc.ws+' m/s'); else if (fc.ws>=8) up(1, '風速 '+fc.ws+' m/s'); }
  if (lowHill && fc.at != null && fc.at>=36) up(1, '高溫 體感 '+fc.at+'°C');
  return {lv, why, heavy};
}

// ---------- 山岳模型（只在載入時建立一次）----------
const MOUNTAINS = M.map(m => {
  const counties = m.co.split('、');
  const pts = m.pid
    ? [{key:m.pid, label:'氣象署登山預報點「'+(m.pt||m.n)+'」', code:m.pid, county:counties[0], counties}]
    : m.tw.map(t => ({key:t, label:t+' 鄉鎮預報', code:'', county:t.slice(0,3), counties:[t.slice(0,3)]}));
  return {m, k:m.c+m.no, pts, counties, low: m.h!=null && m.h<1000, search: [m.n, ...(m.al||[]), m.note||''].join('\n')};
});

// ---------- 狀態 ----------
const state = {
  mode: MODES[store.get('mode')] ? store.get('mode') : 'today',
  slots: new Set((a => Array.isArray(a) && a.length ? a : [6,9])(store.get('slots'))),
  cats: new Set(), counties: new Set(), name: '', shown: PAGE
};
const favs = new Set((a => Array.isArray(a) ? a : [])(store.get('favs')));
let cols = [], all = [], rows = [], favRows = [], byKey = new Map();
let evalStamp = '', dataStamp = '';
// 燈號會隨時間改變的兩個時機：跨過 3 小時時段（今天的「已過」時段）與載入新的預報資料
const timeStamp = () => { const n = new Date(); return isoDate(n) + '|' + Math.floor(n.getHours()/3); };

// ---------- 計算 ----------
function buildCols(){
  if (state.mode === 'week') return [0,1,2,3,4,5,6].map(di => {
    const d = dayAt(di);
    return {di, date:d, ws:d.getTime(), we:d.getTime()+24*H, ref:di>=3, wkd:isWE(d), label:`${d.getMonth()+1}/${d.getDate()}`, sub:'週'+WD[d.getDay()]+(di>=3?'<span class="refx">・參考</span>':'')};
  });
  const di = MODES[state.mode].di, date = dayAt(di), now = new Date();
  return SLOTS.map(h => {
    const end = dayAt(di); end.setHours(h+3);
    const peak = state.slots.has(h);
    return {di, hr:h, date, ws:date.getTime()+h*H, we:date.getTime()+(h+3)*H, past: di===0 && end<=now, peak, label:slotLabel(h), head:`${pad(h)}<span class="hr-to">–${pad(h+3)}</span>`, sub: peak?'<span class="pk-sub">登頂時段</span>':''};
  });
}
const hash = t => { let h = 2166136261; for (const ch of t){ h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const fmtDayKey = () => { const d = new Date(Date.now() + 8*3600e3); return d.toISOString().slice(0, 10); };   // 台灣日期
function evaluate(){                                       // 依時段與登頂時段計算所有山的燈號並排序
  evalStamp = timeStamp(); dataStamp = FC?.fetchedAt || '';
  cols = buildCols();
  const week = state.mode === 'week', slots = sortedSlots();
  const day = fmtDayKey();                               // 燈號相同時的順序：每天換一次（同一天內固定），避免永遠是同幾座山在前面
  all = MOUNTAINS.map(x => {
    const cells = cols.map(c => {
      const per = x.pts.map(p => {
        const fc = week ? dayForecast(p, c.di, slots) : slotForecast(p, c.di, c.hr);
        const al = alertFor(p, c.ws, c.we);
        return {p, fc, al, j: judge(fc, x.low, al, week && c.di>=3)};
      });
      return {lv: Math.max(...per.map(y=>y.j.lv)), per, ref:!!c.ref, past:!!c.past};
    });
    let k1 = 0, k2 = 0, k3 = 0;                            // k3：「注意」的天數中，天氣描述是陣雨（非短暫）的天數
    cells.forEach((c, i) => {
      if (week){ if (c.lv===0) k1++; else if (c.lv===1){ k2++; if (c.per.some(y => y.j.heavy)) k3++; } }
      else if (!c.past && c.lv===0){ k2++; if (cols[i].peak) k1++; }
    });
    return {...x, cells, k1, k2, k3, mix: hash(day + '|' + x.k)};
  }).sort((a,b) => b.k1-a.k1 || b.k2-a.k2 || a.k3-b.k3 || a.mix-b.mix);
  byKey = new Map(all.map(r => [r.k, r]));
  applyFilters();
}
function applyFilters(){                                    // 篩選不需重算燈號
  const q = state.name.trim();
  rows = all.filter(r => (!state.cats.size || state.cats.has(r.m.c))
    && (!state.counties.size || r.counties.some(c => state.counties.has(c)))
    && (!q || r.search.includes(q)));
  favRows = all.filter(r => favs.has(r.k));
}

// ---------- 畫面 ----------
const star = k => { const on = favs.has(k), t = on ? '取消收藏' : '加入收藏';
  return `<button type="button" class="star" data-fav="${k}" aria-pressed="${on}" aria-label="${t}" title="${t}">${on?'♥':'♡'}</button>`; };
const lamp = (c, sm) => `<i class="lamp ${CLS[LV(c.lv)]}${c.ref?' ref':''}${c.past?' past':''}${sm?' sm':''}" title="${WORD[LV(c.lv)]}${c.ref?'（參考）':''}${c.past?'（已過）':''}">${SYM[LV(c.lv)]}</i>`;
const sub = m => `${m.c} ${m.no}・${m.h ? m.h.toLocaleString()+' m' : '標高待補'}・${esc(m.co)}`;
const peaksLeft = () => cols.filter(c => c.peak && !c.past).length;
function score(r){
  if (state.mode === 'week') return `適合 ${r.k1} 天`;
  if (!peaksLeft()) return `剩餘時段適合 ${r.k2} 段`;          // 推薦卡空間有限，只寫段數；各時段燈號看左邊的小燈
  return `登頂時段適合 ${r.k1}/${peaksLeft()} 段`;
}
function scoreCell(r){
  if (state.mode === 'week') return `${r.k1} / 7`;
  const pk = peaksLeft();
  return pk ? `${r.k1} / ${pk}` : `${r.k2} / ${cols.filter(c=>!c.past).length}`;
}
const headRow = () => `<tr><th class="mt">山岳</th>${cols.map(c=>`<th class="${c.ref?'ref ':''}${c.peak?'peak ':''}${c.wkd?'we':''}"><span class="dt">${c.head||c.label}</span>${c.sub}</th>`).join('')}<th class="cnt-h">${state.mode==='week'?'適合天數':'適合時段'}</th></tr>`;
const bodyRow = r => `<tr data-k="${r.k}" tabindex="0"><th class="mt" scope="row"><span class="nm">${star(r.k)}${esc(r.m.n)}</span><span class="sub">${sub(r.m)}</span></th>${r.cells.map(c=>`<td>${lamp(c)}</td>`).join('')}<td class="cnt">${scoreCell(r)}</td></tr>`;
// 推薦卡（精簡兩列）：山名＋資訊＋收藏／燈號＋比較結果
const pickCard = r => `<div class="pick" data-k="${r.k}" tabindex="0" role="button"><div class="p1"><span class="nm">${esc(r.m.n)}</span><span class="meta">${sub(r.m)}</span>${star(r.k)}</div><div class="p2"><span class="lights">${r.cells.map(c=>lamp(c,true)).join('')}</span><span class="rank">${score(r)}</span></div></div>`;

function render(){
  const week = state.mode === 'week', d0 = cols[0].date;
  const title = week ? `一週 ${fmtH(dayAt(0))} – ${fmtH(dayAt(6))}` : `${MODES[state.mode].name} ${fmtH(d0)} 逐 3 小時`;
  $('h-picks-t').textContent = (week ? '這週' : MODES[state.mode].name) + '推薦';
  $('pick-info-body').innerHTML = pickInfo(week);
  $('range-text').innerHTML = `${title}・${regionNow()?.[0] || state.counties.size + ' 個縣市'}・共 ${rows.length} 座`;
  document.querySelectorAll('#seg .sd').forEach((e, i) => { const d = dayAt(i); e.textContent = fmt(d); e.classList.toggle('we', isWE(d)); });
  ['matrix','fav-matrix'].forEach(id => $(id).style.setProperty('--n', cols.length));
  document.querySelectorAll('.lg-ref').forEach(e => e.hidden = !week);
  document.querySelectorAll('.lg-past').forEach(e => e.hidden = state.mode !== 'today');
  if (!week) setInfo(false);
  // 推薦：依燈號排序，只列有「適合」時段（或天數）的山，最多 3 座，不標名次
  const good = r => (week || peaksLeft() ? r.k1 : r.k2) > 0;
  $('picks').innerHTML = rows.filter(good).slice(0, 3).map(pickCard).join('')
    || `<div class="empty">${rows.length ? '這段期間沒有燈號為「適合」的山，可以參考下方列表。' : '沒有符合條件的山，請放寬類別或縣市。'}</div>`;
  const head = headRow();
  $('fav-tab-n').textContent = favRows.length || '';
  const rg = regionNow();
  document.querySelectorAll('#f-region [data-rg]').forEach(b => b.setAttribute('aria-pressed', !!rg && REGIONS[+b.dataset.rg] === rg));
  $('filter-n').textContent = (state.cats.size + (rg ? 0 : state.counties.size)) || '';   // 手機「進階篩選」按鈕：地區以外另外選了幾項
  $('fav-count').innerHTML = favRows.length ? `${title}・${favRows.length} 座，依燈號排序` : '';
  $('fav-box').hidden = !favRows.length; $('fav-empty').hidden = !!favRows.length;
  $('fav-matrix').tHead.innerHTML = head;
  $('fav-matrix').tBodies[0].innerHTML = favRows.map(bodyRow).join('');
  $('matrix').tHead.innerHTML = head;
  $('matrix').tBodies[0].innerHTML = rows.slice(0,state.shown).map(bodyRow).join('') || `<tr><td class="empty" colspan="${cols.length+2}">沒有符合條件的山。</td></tr>`;
  $('more-box').hidden = rows.length <= state.shown;
  $('more').textContent = `顯示更多（還有 ${rows.length-state.shown} 座）`;
}
const fresh = () => evalStamp === timeStamp() && dataStamp === (FC?.fetchedAt || '');
const refresh = () => { evaluate(); render(); };                                            // 時段或登頂時段改變：重算燈號
const refilter = () => { state.shown = PAGE; fresh() ? applyFilters() : evaluate(); render(); }; // 篩選改變：資料仍新就只重新篩選

function openDetail(k){
  const r = byKey.get(k); if (!r) return;
  const week = state.mode === 'week', pts = r.pts;
  const alerts = [...new Map(r.cells.flatMap(c => c.per.filter(x=>x.al).map(x=>[x.al.county+x.al.type, x.al]))).values()];
  const v = (x, f) => x == null ? '—' : f(x);
  const table = (p, k) => `<div class="pt"><h3>${esc(p.label)}・${week ? '一週逐日' : MODES[state.mode].name+'逐 3 小時'}</h3><div class="vt-box"><table class="vt"><thead><tr><th>${week?'日期':'時段'}</th><th>燈號</th><th>天氣現象</th><th>降雨機率</th><th>風速</th><th>氣溫</th><th>體感</th><th>原因</th></tr></thead><tbody>
      ${r.cells.map((c,j) => { const x = c.per[k], col = cols[j];
        return `<tr class="${c.ref||c.past?'ref':''}"><td>${week?fmtH(col.date):col.label}</td><td>${lamp({lv:x.j.lv,ref:c.ref,past:c.past},true)}</td><td>${v(x.fc?.wx, esc)}</td><td class="num">${v(x.fc?.pop, n=>n+'%')}</td><td class="num">${v(x.fc?.ws, n=>`${n} m/s（${x.fc.bf} 級）`)}</td><td class="num">${v(x.fc?.t, n=>n+'°C')}</td><td class="num">${v(x.fc?.at, n=>n+'°C')}</td><td class="why">${esc(x.j.why.join('、')||'—')}</td></tr>`; }).join('')}
      </tbody></table></div></div>`;
  const dr = $('drawer');
  dr.innerHTML = `
    <div class="d-head"><div><h2 id="d-title">${esc(r.m.n)}${star(r.k)}</h2><div class="sub">${sub(r.m)}</div></div><button class="close" type="button" id="d-close" aria-label="關閉">×</button></div>
    <div class="src"><span><b>採用預報</b>：${esc(pts.map(p=>p.label+(p.code?'（'+p.code+'）':'')).join('、'))}</span>
      <span>${pts.length>1?'跨多個鄉鎮，各自列出；燈號取最差的鄉鎮。':''}${r.low?'標高 1,000 公尺以下，另判斷高溫。':''}</span>
      <span class="issued">資料來源：交通部中央氣象署・本站更新 ${FC ? fmtTime(Date.parse(FC.fetchedAt)) : '—'}</span></div>
    ${alerts.map(a=>`<div class="alert"><b>${esc(a.type)}・${WORD[a.lv]}</b>　${esc(a.county)}${a.end?`，有效至 ${fmtTime(a.end)}`:''}</div>`).join('')}
    ${r.m.al?.length?`<div class="note">別名：${esc(r.m.al.join('、'))}</div>`:''}
    ${r.m.note?`<div class="note">備註：${esc(r.m.note)}</div>`:''}
    ${pts.map(table).join('')}
    <div class="note">${week ? '一週預報以你選的登頂時段（'+sortedSlots().map(slotLabel).join('、')+'）判定，取最差情況；第 4–7 天氣象署未提供降雨機率，以「—」表示，燈號最多只會到「注意」，請在出發前 3 天內再確認。' : '逐 3 小時預報；底色時段是你選的登頂時段，排序以此為準。'}</div>`;
  dr.hidden = false; $('scrim').hidden = false;
  $('d-close').focus();
}
function closeDetail(){ $('drawer').hidden = true; $('scrim').hidden = true; }
// 推薦旁的 i：依目前模式說明比較標準與排序
function pickInfo(week){
  const slots = sortedSlots().map(slotLabel).join('、');
  const base = '<li>燈號依氣象署預報判定：降雨機率、天氣描述（雷、大雨、豪雨）、平均風速、天氣特報；標高 1,000 公尺以下另看高溫。各項取最差的結果。</li><li>跨多個鄉鎮的山，取最差的鄉鎮。</li>';
  const li = a => '<ul>' + a.map(x => '<li>' + x + '</li>').join('') + '</ul>';
  if (week) return '<h4>比較標準</h4><ul>' + base + `<li>每天以你選的登頂時段（${esc(slots)}）中最差的情況作為當天燈號。</li><li>第 4–7 天氣象署沒有降雨機率，燈號最多只會到「注意」，僅供參考。</li></ul>`
    + '<h4>推薦條件</h4>' + li(['7 天中至少 1 天「適合」的山才會列入，最多 3 座，不標名次。'])
    + '<h4>排序</h4>' + li(['「適合」的天數多者在前', '再比「注意」的天數', '再比「注意」裡天氣描述為「陣雨」（非「短暫陣雨」）的天數，少者在前', '以上都相同時，順序每天輪換一次，不代表哪座比較好']);
  const today = state.mode === 'today';
  return '<h4>比較標準</h4><ul>' + base + `<li>逐 3 小時判定，每個時段一個燈號。</li>${today ? '<li>今天已過的時段不列入比較。</li>' : ''}</ul>`
    + '<h4>推薦條件</h4>' + li([`你選的登頂時段（${esc(slots)}）至少有 1 段「適合」的山才會列入，最多 3 座，不標名次。` + (today ? '登頂時段都已過時，改看今天剩餘的時段。' : '')])
    + '<h4>排序</h4>' + li(['登頂時段中「適合」的段數多者在前', '再比當天所有時段「適合」的段數', '以上都相同時，順序每天輪換一次，不代表哪座比較好']);
}
function setPickInfo(v){ $('pick-info').hidden = !v; $('pick-info-btn').setAttribute('aria-expanded', v); }
function setInfo(v){ $('info-ref').hidden = !v; $('info-btn').setAttribute('aria-expanded', v); }

// 讀取預報資料；失敗時保留已有資料並提示
async function loadForecast(){
  try{
    const r = await fetch('forecast.json?t=' + Date.now(), {cache: 'no-store'});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    loadError = '';
    if (data.fetchedAt !== FC?.fetchedAt){ useForecast(data); refresh(); }
  }catch(e){ loadError = '暫時無法取得天氣資料，請稍後重新整理。'; }
  showStatus();
}
function showStatus(){
  const s = $('status'), at = FC ? Date.parse(FC.fetchedAt) : 0;
  $('issued').textContent = FC ? '資料更新：' + fmtTime(at) : (loadError ? '' : '資料載入中…');
  const msg = loadError && !FC ? loadError
    : loadError ? `無法取得最新資料，以下是 ${fmtTime(at)} 的資料。`
    : FC && Date.now() - at > STALE ? `天氣資料可能不是最新：上次更新是 ${fmtTime(at)}，出發前請到氣象署網站確認。` : '';
  s.textContent = msg; s.hidden = !msg;
}

// 多選按鈕群組：有「全部」按鈕者未選＝全部；登頂時段至少保留一項
function chipGroup(box, attr, set, {allId, parse = v => v, keepOne, onChange}){
  const sync = () => {
    box.querySelectorAll(`[${attr}]`).forEach(b => b.setAttribute('aria-pressed', set.has(parse(b.getAttribute(attr)))));
    if (allId) $(allId).setAttribute('aria-pressed', !set.size);
  };
  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
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
const sameSet = (set, arr) => set.size === arr.length && arr.every(x => set.has(x));
const regionNow = () => REGIONS.find(([, cs]) => sameSet(state.counties, cs));   // 目前縣市剛好等於某個地區，就回傳那個地區

// ---------- 啟動與事件 ----------
(function init(){
  const counties = [...new Set(M.flatMap(m => m.co.split('、')))].filter(Boolean).sort((a,b) => COUNTY_ORDER.indexOf(a) - COUNTY_ORDER.indexOf(b));
  $('f-county').innerHTML = `<button type="button" class="chip reset" id="c-all" aria-pressed="true">全部</button>` + counties.map(c=>`<button type="button" class="chip" data-co="${esc(c)}" aria-pressed="false">${esc(c)}</button>`).join('');
  $('f-slots').innerHTML = SLOTS.map(h=>`<button type="button" class="chip mono" data-h="${h}">${slotLabel(h)}</button>`).join('');

  const syncCounty = chipGroup($('f-county'), 'data-co', state.counties, {allId:'c-all', onChange: refilter});
  $('f-region').innerHTML = REGIONS.map(([n], i) => `<button type="button" class="chip" data-rg="${i}" aria-pressed="false">${n}</button>`).join('');
  $('f-region').onclick = e => {
    const b = e.target.closest('[data-rg]'); if (!b) return;
    state.counties.clear(); REGIONS[+b.dataset.rg][1].forEach(c => state.counties.add(c));
    syncCounty();
    if ($('view-find').hidden) $('tab-find').click();
    refilter();
  };
  chipGroup($('f-cat'), 'data-c', state.cats, {allId:'cat-all', onChange: refilter});
  chipGroup($('f-slots'), 'data-h', state.slots, {parse: Number, keepOne: true, onChange(){ store.set('slots', [...state.slots]); refresh(); }});
  store.set('slots', [...state.slots]);

  const seg = document.querySelectorAll('#seg button');
  const syncSeg = () => seg.forEach(b => b.setAttribute('aria-selected', b.dataset.mode === state.mode));
  seg.forEach(b => b.onclick = () => { state.mode = b.dataset.mode; state.shown = PAGE; syncSeg(); store.set('mode', state.mode); refresh(); });
  syncSeg();

  $('f-name').oninput = e => { state.name = e.target.value; $('s-btn').classList.toggle('on', !!state.name.trim()); if ($('view-find').hidden) $('tab-find').click(); refilter(); };
  const setSearch = open => { $('search').classList.toggle('open', open); $('s-btn').setAttribute('aria-expanded', open); if (open) $('f-name').focus(); };
  $('s-btn').onclick = () => setSearch(!$('search').classList.contains('open'));
  $('s-x').onclick = () => { const f = $('f-name'); if (f.value){ f.value = ''; f.dispatchEvent(new Event('input')); } setSearch(false); $('s-btn').focus(); };
  $('f-name').addEventListener('blur', () => setTimeout(() => { if (!$('search').contains(document.activeElement)) setSearch(false); }, 150));   // 離開搜尋框就收起（已輸入的字保留，放大鏡會變深色）
  const setFilter = open => { $('q').classList.toggle('open', open); $('f-scrim').hidden = !open; $('filter-btn').setAttribute('aria-expanded', open); };
  $('filter-btn').onclick = () => { if ($('view-find').hidden) $('tab-find').click(); setFilter(true); };
  $('filter-done').onclick = $('f-scrim').onclick = () => setFilter(false);
  document.addEventListener('keydown', e => { if (e.key === 'Escape'){ setFilter(false); setSearch(false); } });
  $('q').onsubmit = e => e.preventDefault();
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
    $('shared').hidden = v === 'rules';
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
    const t = e.target.closest('[data-k]');
    if (t && !e.target.closest('#drawer')) openDetail(t.dataset.k);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') return closeDetail();
    if (e.key === 'Enter' && !e.target.closest('[data-fav]')){ const t = e.target.closest('[data-k]'); if (t) openDetail(t.dataset.k); }
  });

  refresh();                                                // 先顯示山岳清單，資料到了再補上燈號
  loadForecast();
  // 網頁開著時：每分鐘檢查是否跨時段；每 15 分鐘或回到網頁時，檢查是否有新資料
  let lastLoad = Date.now();
  const tick = () => { if (Date.now() - lastLoad > 15*60e3){ lastLoad = Date.now(); loadForecast(); } else if (!fresh()) refresh(); showStatus(); };
  setInterval(tick, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden){ lastLoad = 0; tick(); } });
})();
