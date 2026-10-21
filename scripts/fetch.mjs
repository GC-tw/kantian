// 看天爬山：從氣象署開放資料抓取預報，整理成網站使用的 forecast.json
// 執行：CWA_API_KEY=xxxx node scripts/fetch.mjs [--out dist/forecast.json] [--fixtures test/fixtures]
// 不需要安裝任何套件（Node 22 以上）。
import fs from 'node:fs';
import path from 'node:path';
import {beaufort} from '../site/beaufort.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i+1] && !arr[i+1].startsWith('--') ? arr[i+1] : true]] : a), []));
const OUT = path.resolve(ROOT, args.out || 'dist/forecast.json');
const FIXTURES = args.fixtures ? path.resolve(ROOT, args.fixtures) : null;   // 測試用：從檔案讀取，不連網
const KEY = process.env.CWA_API_KEY;
const API = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/';
const FILE_API = 'https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/';   // 部分資料集（例如登山預報）只提供檔案下載
const DATASETS_FILE = path.join(ROOT, 'data/datasets.json');                  // 自動探查到的資料集代碼
const SAMPLES_DIR = path.join(ROOT, 'data/samples');                          // 每種資料各存一小段樣本，方便核對格式
const MOUNTAINS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/mountains.json'), 'utf8'));
const warnings = [];
let summary = null, errCause = '';                      // 寫進 data/last-run.json
const warn = m => { warnings.push(m); console.warn('⚠ ' + m); };

// 鄉鎮預報：各縣市資料集（n 為 3 天逐 3 小時、n+2 為一週逐 12 小時）；F-D0047-089／091 只到縣市層級，不使用
const TOWN_COUNTY = {'宜蘭縣':1,'桃園市':5,'新竹縣':9,'苗栗縣':13,'彰化縣':17,'南投縣':21,'雲林縣':25,'嘉義縣':29,'屏東縣':33,'臺東縣':37,'花蓮縣':41,'澎湖縣':45,'基隆市':49,'新竹市':53,'嘉義市':57,'臺北市':61,'高雄市':65,'新北市':69,'臺中市':73,'臺南市':77,'連江縣':81,'金門縣':85};
const ALERT_ID = 'W-C0033-001';   // 天氣警特報：各縣市目前生效中的特報

// ---------- 連線 ----------
async function getDataset(id, params = {}, {tries = 3, timeout = 60000} = {}){
  if (FIXTURES){
    const f = path.join(FIXTURES, id + '.json');
    if (!fs.existsSync(f)) throw new Error('沒有測試檔 ' + id);
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  if (!KEY) throw new Error('缺少 CWA_API_KEY（請在 GitHub 的 Secrets 設定氣象署授權碼）');
  const q = new URLSearchParams({Authorization: KEY, format: 'JSON', ...params});
  try{ return await getUrl(API + id + '?' + q, id, tries, timeout); }
  catch(e){
    if (Object.keys(params).length || !/HTTP 404|回應失敗|resource/i.test(e.message)) throw e;
    try{ return await getUrl(FILE_API + id + '?' + q, id, tries, timeout); }   // datastore 沒有這個資料集 → 改試檔案下載
    catch(e2){ throw new Error(e.message + '；檔案下載：' + e2.message.replace(id + ' 連線失敗：', '')); }
  }
}
async function getUrl(url, id, tries, timeout){
  for (let i = 1; i <= tries; i++){
    try{
      const r = await fetch(url, {signal: AbortSignal.timeout(timeout)});
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.success === 'false' || j.success === false) throw new Error('氣象署回應失敗：' + JSON.stringify(j.result || j).slice(0, 200));
      return j;
    }catch(e){
      if (i === tries) throw new Error(id + ' 連線失敗：' + e.message + (e.cause ? '（' + (e.cause.code || e.cause.message) + '）' : ''));
      await new Promise(r => setTimeout(r, 3000 * i));
    }
  }
}

// ---------- 通用工具：同時支援氣象署新舊兩種 JSON 格式 ----------
const pick = (o, ...ks) => { if (!o) return undefined; for (const k of ks){ if (o[k] !== undefined) return o[k]; const f = Object.keys(o).find(x => x.toLowerCase() === k.toLowerCase()); if (f) return o[f]; } };
function findKey(obj, re, depth = 0){                     // 遞迴找第一個名稱符合的欄位
  if (!obj || typeof obj !== 'object' || depth > 6) return undefined;
  for (const [k, v] of Object.entries(obj)){ if (re.test(k) && typeof v !== 'object') return v; }
  for (const v of Object.values(obj)){ const r = findKey(v, re, depth+1); if (r !== undefined) return r; }
}
function findNode(obj, re, depth = 0){                    // 遞迴找第一個名稱符合的物件或陣列（相容 datastore 與檔案下載兩種包裝）
  if (!obj || typeof obj !== 'object' || depth > 5) return undefined;
  for (const [k, v] of Object.entries(obj)) if (re.test(k) && v && typeof v === 'object') return v;
  for (const v of Object.values(obj)){ const r = findNode(v, re, depth+1); if (r !== undefined) return r; }
}
// 時間字串沒有標時區（例如特報的 "2026-10-15 16:23:00"）時，視為台灣時間
const twTime = v => { if (!v) return null; const t = String(v).trim(); const n = Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(t) ? t : t.replace(' ', 'T') + '+08:00'); return Number.isNaN(n) ? null : n; };
const describe = j => String(findKey(j, /^datasetDescription$/i) || '');
const num = v => { if (v == null) return null; const c = String(v).replace(/[^\d.\-]/g, ''); const n = Number(c); return c === '' || c === '-' || Number.isNaN(n) ? null : n; };
const OLD_CODES = {T:'Temperature', AT:'ApparentTemperature', Td:'DewPoint', RH:'RelativeHumidity', WS:'WindSpeed', WD:'WindDirection', Wx:'Weather', PoP3h:'ProbabilityOfPrecipitation', PoP6h:'ProbabilityOfPrecipitation', PoP12h:'ProbabilityOfPrecipitation', MaxT:'MaxTemperature', MinT:'MinTemperature', MaxAT:'MaxApparentTemperature', MinAT:'MinApparentTemperature', WeatherDescription:'WeatherDescription'};

// 把一份資料集攤平成「地點 → 時間段 → 數值」
function locations(j){
  const out = [];
  let groups = findNode(j, /^locations$/i);
  if (!groups){ const l = findNode(j, /^location$/i); groups = l ? [{Location: l}] : []; }
  for (const g of [].concat(groups)){
    const county = pick(g, 'LocationsName', 'locationsName') || '';
    for (const loc of [].concat(pick(g, 'Location', 'location') || [])){
      const recs = [];
      for (const el of [].concat(pick(loc, 'WeatherElement', 'weatherElement') || [])){
        const code = pick(el, 'ElementName', 'elementName');
        for (const t of [].concat(pick(el, 'Time', 'time') || [])){
          const s = pick(t, 'StartTime', 'startTime', 'DataTime', 'dataTime');
          const e = pick(t, 'EndTime', 'endTime') || null;
          const vals = {};
          for (const ev of [].concat(pick(t, 'ElementValue', 'elementValue') || [])){
            if (ev && 'value' in ev){                        // 舊格式：{value, measures}
              const key = OLD_CODES[code] || code;
              if (key === 'WindSpeed' && /蒲福/.test(ev.measures || '')) vals.BeaufortScale = ev.value;
              else if (key === 'Weather' && vals.Weather !== undefined && /^\d+$/.test(String(ev.value))) vals.WeatherCode = ev.value;   // 舊格式：第二個值是天氣代碼
              else if (vals[key] === undefined) vals[key] = ev.value;
            } else Object.assign(vals, ev);                  // 新格式：{Temperature: "20"}
          }
          recs.push({s: twTime(s), e: e ? twTime(e) : null, vals});
        }
      }
      const ps = [].concat(pick(pick(loc, 'ParameterSet') || {}, 'Parameter') || []);   // 登山預報點代碼（例如 D001）
      const id = ps.find(x => /^id$/i.test(pick(x, 'ParameterName') || ''))?.ParameterValue || null;
      out.push({county, id, geo: pick(loc, 'Geocode', 'geocode') || null, name: pick(loc, 'LocationName', 'locationName'), lat: num(pick(loc, 'Latitude', 'lat')), lon: num(pick(loc, 'Longitude', 'lon')), recs});
    }
  }
  return out;
}

// 把某時段 [S, S+len) 內的各項數值合併：時段型資料取涵蓋 S 的那筆，時間點型資料取落在區間內的第一筆
function merge(recs, S, len){
  const v = {}; let hit = false;
  for (const r of recs){
    const ok = r.e != null ? (r.s <= S && S < r.e) : (r.s >= S && r.s < S + len);
    if (!ok) continue; hit = true;
    for (const [k, x] of Object.entries(r.vals)) if (v[k] === undefined && x !== '' && x != null && x !== ' ') v[k] = x;
  }
  return hit ? v : null;
}
function normalize(v, daily){
  if (!v) return null;
  const ws = num(v.WindSpeed);
  const out = {
    pop: num(v.ProbabilityOfPrecipitation),
    ws, bf: num(v.BeaufortScale) ?? (ws != null ? beaufort(ws) : null),
    t: num(daily ? (v.MaxTemperature ?? v.Temperature) : (v.Temperature ?? v.MaxTemperature)),
    at: num(daily ? (v.MaxApparentTemperature ?? v.ApparentTemperature) : (v.ApparentTemperature ?? v.MaxApparentTemperature)),
    wx: v.Weather ?? null
  };
  if (Object.values(out).every(x => x == null)) return null;
  out.wc = num(v.WeatherCode);                            // 天氣代碼：只在 compact() 用來找未收錄的用語，不放進網站資料
  return out;
}


// ---------- 時間格：台灣時間 ----------
const TZ = 8 * 3600e3, H = 3600e3;
const twMidnight = ms => Math.floor((ms + TZ) / (24*H)) * 24*H - TZ;
function slots3h(locs){                                  // 今天 00 時起 4 天（到大後天），每 3 小時；氣象署實際約提供 96 小時
  const start = twMidnight(Date.now()), out = [];
  for (let i = 0; i < 32; i++){ const S = start + i*3*H; const v = normalize(merge(locs.recs, S, 3*H), false); if (v) out.push({s: S, ...v}); }
  return out;
}
function periods12h(locs){                               // 前一天 18 時起，每 12 小時（白天 06–18、晚上 18–06），共 8 天
  const start = twMidnight(Date.now()) - 6*H, out = [];
  for (let i = 0; i < 16; i++){ const S = start + i*12*H; const v = normalize(merge(locs.recs, S, 12*H), true); if (v) out.push({s: S, ...v}); }
  return out;
}

// ---------- 資料集代碼：自動探查登山預報 ----------
async function mountainDatasets(){
  // 氣象署的「育樂區」預報分很多組（登山、森林遊樂區、國家公園…），說明文字都一樣，
  // 所以逐一下載，看哪一組的地點名稱和我們的山最吻合。結果存在 data/datasets.json，之後直接使用。
  const names = new Set(MOUNTAINS.filter(m => m.pid).flatMap(m => [m.cn, m.pid]));
  let known = !FIXTURES && fs.existsSync(DATASETS_FILE) ? JSON.parse(fs.readFileSync(DATASETS_FILE, 'utf8')) : {};
  if (known.mountainH3 && known.mountainWeek && known.version === 2) return known;
  console.log('探查登山預報資料集代碼（每個代碼最多等 20 秒）…');
  known = {version: 2, probes: {}, errors: {}};
  const want = {h3: /(三天|3天|72小時)/, week: /(一週|1週|七天|7天).*(12小時|日夜)/};
  const best = {h3: null, week: null};
  const deadline = Date.now() + 10*60e3;
  for (let n = 1; n <= 90; n++){
    if (Date.now() > deadline){ warn('探查超過 10 分鐘，先停止'); break; }
    const id = 'F-B0053-' + String(n).padStart(3, '0');
    try{
      const j = await getDataset(id, {}, {tries: 1, timeout: 20000});
      const d = describe(j), locs = locations(j);
      const match = locs.filter(l => names.has(l.id) || names.has(l.name)).length;
      known.probes[id] = {description: d, locations: locs.length, match, examples: locs.slice(0, 3).map(l => l.name)};
      console.log(`  ${id}：${d}（${locs.length} 個地點，吻合 ${match}）`);
      for (const k of ['h3', 'week']) if (want[k].test(d) && match > 0 && (!best[k] || match > best[k].match)) best[k] = {id, match};
    }catch(e){ const m = e.message.replace(id + ' 連線失敗：', ''); known.errors[id] = m; console.log(`  ${id}：${m}`); }
  }
  known.mountainH3 = best.h3?.id; known.mountainWeek = best.week?.id;
  if (!FIXTURES) fs.writeFileSync(DATASETS_FILE, JSON.stringify(known, null, 2));   // 失敗也存下來，方便檢查
  if (!known.mountainH3 || !known.mountainWeek) throw new Error('找不到登山預報資料集，探查結果已存在 data/datasets.json');
  console.log(`登山預報：3 天 ${known.mountainH3}（吻合 ${best.h3.match}）、一週 ${known.mountainWeek}（吻合 ${best.week.match}）`);
  return known;
}

// 格式樣本：只存第一個地點（檔案很小），而且只在氣象署的格式（欄位結構）改變時才存，
// 避免每次更新都因為天氣數值不同而重存（2026-10-20）
const shape = v => Array.isArray(v) ? '[' + (v.length ? shape(v[0]) : '') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => k + ':' + shape(v[k])).join(',') + '}' : typeof v;
function saveSample(name, j){
  if (FIXTURES) return;
  const c = JSON.parse(JSON.stringify(j));
  const g = findNode(c, /^locations$/i);
  if (Array.isArray(g)) g.splice(1);
  const loc = findNode(c, /^location$/i); if (Array.isArray(loc)) loc.splice(2);
  const f = path.join(SAMPLES_DIR, name + '.json');
  try{ if (shape(JSON.parse(fs.readFileSync(f, 'utf8'))) === shape(c)) return; }catch{}
  fs.mkdirSync(SAMPLES_DIR, {recursive: true});
  fs.writeFileSync(f, JSON.stringify(c, null, 2));
}

// ---------- 颱風 ----------
const TW_COAST = [[25.30,121.54],[25.01,122.00],[24.60,121.87],[23.97,121.62],[23.10,121.38],[22.40,120.95],[21.90,120.85],[22.37,120.59],[23.00,120.15],[23.60,120.20],[24.27,120.52],[24.83,120.92],[23.50,121.00]];   // 臺灣本島沿岸與中央的幾個點，用來估算颱風中心到陸地的距離
const kmTo = (la, lo) => Math.min(...TW_COAST.map(([a, b]) => { const r = Math.PI/180, d1 = (a-la)*r, d2 = (b-lo)*r; return 2*6371*Math.asin(Math.sqrt(Math.sin(d1/2)**2 + Math.cos(la*r)*Math.cos(a*r)*Math.sin(d2/2)**2)); }));
const TY_KM = 500;
const tyScale = ws => ws >= 51 ? '強烈颱風' : ws >= 32.7 ? '中度颱風' : ws >= 17.2 ? '輕度颱風' : '熱帶性低氣壓';   // 氣象署颱風強度分級（近中心最大風速，公尺／秒）
async function typhoons(){
  const out = [];
  const track = await getDataset('W-C0034-005', {}, {tries: 2, timeout: 30000});
  saveSample('typhoon-track', track);
  const tcs = [].concat(pick(pick(track.records || track, 'TropicalCyclones') || {}, 'TropicalCyclone') || []);
  let warns = [];
  try{
    const w = await getDataset('W-C0034-001', {}, {tries: 2, timeout: 30000}); saveSample('typhoon-warning', w);
    const infos = []; (function walk(o){ if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(walk); if ('headline' in o && 'expires' in o) infos.push(o); else Object.values(o).forEach(walk); })(w.records || w);
    const now = Date.now();
    warns = infos.filter(i => Date.parse(i.expires) > now && !/解除/.test(i.headline || '') && !JSON.stringify(i['typhoon-info'] || '').includes('"END"'))
      .map(i => ({headline: i.headline, expires: twTime(i.expires), name: (JSON.stringify(i).match(/"cwa_typhoon_name":"([^"]+)"/) || [])[1] || ''}));
  }catch(e){ warn('颱風警報抓取失敗：' + e.message); }
  for (const tc of tcs){
    const name = pick(tc, 'CwaTyphoonName') || '', en = pick(tc, 'TyphoonName') || '';
    const fixes = [].concat(pick(pick(tc, 'AnalysisData') || {}, 'Fix') || []);
    const last = fixes[fixes.length - 1];
    const pts = [];
    if (last) pts.push({t: twTime(pick(last, 'DateTime')), la: num(pick(last, 'CoordinateLatitude')), lo: num(pick(last, 'CoordinateLongitude')), ws: num(pick(last, 'MaxWindSpeed'))});
    for (const f of [].concat(pick(pick(tc, 'ForecastData') || {}, 'Fix') || [])){
      const t0 = twTime(pick(f, 'InitialTime')), h = num(pick(f, 'ForecastHour'));
      if (t0 != null && h != null) pts.push({t: t0 + h*H, la: num(pick(f, 'CoordinateLatitude')), lo: num(pick(f, 'CoordinateLongitude')), ws: num(pick(f, 'MaxWindSpeed'))});
    }
    const ok = pts.filter(p => p.la != null && p.lo != null).map(p => ({...p, km: Math.round(kmTo(p.la, p.lo))}));
    if (!ok.length) continue;
    const near = ok.reduce((a, b) => b.km < a.km ? b : a);
    const w = warns.find(x => x.name && x.name === name) || null;
    if (near.km > TY_KM && !w) continue;
    out.push({name, en, scale: tyScale(ok[0].ws ?? 0), near: {t: near.t, km: Math.round(near.km / 10) * 10}, warn: w});
  }
  for (const w of warns) if (!out.some(t => t.warn === w)) out.push({name: w.name, en: '', scale: '', near: null, warn: w});   // 有警報但路徑資料對不上：仍顯示
  return out;
}

// ---------- 主流程 ----------
async function main(){
  const result = {version: 2, fetchedAt: new Date().toISOString(), datasets: {}, issued: null, points: {}, alerts: [], typhoons: [], warnings};
  const nameToPid = new Map(MOUNTAINS.filter(m => m.pid).map(m => [m.cn, m.pid]));
  const pids = new Set(nameToPid.values());
  const townsNeeded = new Set(MOUNTAINS.flatMap(m => m.tw || []));

  // 0. 先確認授權碼可以用（36 小時縣市預報，資料量小）
  if (!FIXTURES){
    try{ await getDataset('F-C0032-001', {}, {tries: 2, timeout: 30000}); }
    catch(e){ throw new Error('無法用授權碼取得氣象署資料（' + e.message + '）。請確認 GitHub Secrets 裡的 CWA_API_KEY 是否正確。'); }
  }

  // 1. 登山預報
  const ds = await mountainDatasets();
  for (const [kind, id] of [['h3', ds.mountainH3], ['week', ds.mountainWeek]]){
    const j = await getDataset(id); saveSample('mountain-' + kind, j);
    result.datasets['mountain-' + kind] = {id, description: describe(j)};
    result.issued = result.issued || findKey(j, /^(issueTime|update)$/i) || null;
    for (const l of locations(j)){
      const pid = pids.has(l.id) ? l.id : nameToPid.get(l.name);     // 先比對預報點代碼，再比對名稱
      if (!pid) continue;
      const p = result.points[pid] ||= {name: l.name, lat: l.lat, lon: l.lon};
      p[kind] = kind === 'h3' ? slots3h(l) : periods12h(l);
    }
  }
  // 預報點座標存一份，用來核對每座山的縣市（只在有變動時才會存回 GitHub）
  if (!FIXTURES) fs.writeFileSync(path.join(ROOT, 'data/stations.json'), JSON.stringify(Object.fromEntries(Object.entries(result.points).sort().map(([k, p]) => [k, {name: p.name, lat: p.lat, lon: p.lon}])), null, 1));
  const missingPid = [...nameToPid.values()].filter(pid => !result.points[pid]);
  if (missingPid.length) warn('登山預報缺少以下預報點：' + missingPid.join('、'));

  // 2. 鄉鎮預報
  for (const kind of ['h3', 'week']){
    const sets = [], ids = [];
    for (const [county, n] of Object.entries(TOWN_COUNTY)){
      if (![...townsNeeded].some(t => t.startsWith(county))) continue;
      const id = 'F-D0047-' + String(kind === 'h3' ? n : n + 2).padStart(3, '0');
      try{ sets.push(await getDataset(id)); ids.push(id); }catch(e){ warn(e.message); }
    }
    result.datasets['town-' + kind] = {id: ids.join(','), description: describe(sets[0] || {})};
    if (sets[0]) saveSample('town-' + kind, sets[0]);
    for (const j of sets) for (const l of locations(j)){
      const key = (l.county + l.name).replace(/台/g, '臺');
      if (!townsNeeded.has(key)) continue;
      const p = result.points[key] ||= {name: key, lat: l.lat, lon: l.lon};
      if (l.geo) p.geo = String(l.geo);                       // 鄉鎮代碼：網頁做「氣象署原始預報」連結用
      p[kind] = kind === 'h3' ? slots3h(l) : periods12h(l);
    }
  }
  const missingTown = [...townsNeeded].filter(t => !result.points[t]);
  if (missingTown.length) warn('鄉鎮預報缺少：' + missingTown.join('、'));

  // 3. 天氣警特報：只保留颱風、豪雨、大雨（列入燈號）
  try{
    const j = await getDataset(ALERT_ID); saveSample('alerts', j);
    const LV = [[/颱風|豪雨|大雨/, 2]];   // 陸上強風、低溫、高溫、濃霧不收集（2026-10-20：只到縣市層級，改看各山預報）
    const locs = [].concat(pick(j.records || j, 'location', 'Location') || []);
    for (const loc of locs){
      const county = pick(loc, 'locationName', 'LocationName');
      const hz = pick(pick(loc, 'hazardConditions', 'HazardConditions') || {}, 'hazards', 'Hazards') || [];
      for (const h of [].concat(hz)){
        const info = pick(h, 'info', 'Info') || {}, vt = pick(h, 'validTime', 'ValidTime') || {};
        const ph = String(pick(info, 'phenomena', 'Phenomena') || ''), sig = String(pick(info, 'significance', 'Significance') || '');
        const lv = (LV.find(([re]) => re.test(ph)) || [])[1];
        if (!lv) continue;
        result.alerts.push({county, type: ph + sig, lv, start: twTime(pick(vt, 'startTime', 'StartTime')), end: twTime(pick(vt, 'endTime', 'EndTime'))});
      }
    }
  }catch(e){ warn('警特報抓取失敗：' + e.message); }

  // 4. 颱風：氣象署颱風路徑（W-C0034-005）與颱風警報（W-C0034-001）。
  // 一週預報常常還沒反映颱風，所以只要颱風預測路徑會到臺灣陸地 500 公里內、或氣象署已發布颱風警報，網頁最上方就顯示提示（燈號不變；2026-10-20 使用者決定）
  try{ result.typhoons = await typhoons(); }catch(e){ warn('颱風資料抓取失敗：' + e.message); }

  fs.mkdirSync(path.dirname(OUT), {recursive: true});
  fs.writeFileSync(OUT, JSON.stringify(compact(result)));
  const n = Object.values(result.points);
  console.log(`完成：${n.length} 個預報點（3 小時資料 ${n.filter(p=>p.h3?.length).length}、一週資料 ${n.filter(p=>p.week?.length).length}），特報 ${result.alerts.length} 則，警告 ${warnings.length} 則`);
  const d4 = twMidnight(Date.now()) + 3*24*H, wxCount = (pick) => Object.fromEntries(Object.entries(n.flatMap(p => (p.week || []).filter(pick).map(x => x.wx)).reduce((m, w) => (m[w] = (m[w] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]));
  summary = {typhoons: result.typhoons, wxWeekDay1to3: wxCount(x => x.s < d4), wxWeekDay4to7: wxCount(x => x.s >= d4), points: n.length, h3: n.filter(p => p.h3?.length).length, week: n.filter(p => p.week?.length).length, alerts: result.alerts, datasets: result.datasets, issued: result.issued,
    example: Object.fromEntries(Object.entries(result.points).slice(0, 2).map(([k, p]) => [k, {name: p.name, h3: p.h3?.slice(0, 3), week: p.week?.slice(0, 2)}]))};
  if (!n.some(p => p.h3?.length)) throw new Error('沒有任何可用的預報資料，停止更新網站');
  try{ logWx(n, result.alerts); }catch(e){ warn('天氣用語紀錄失敗：' + e.message); }
}
// 天氣代碼當備援（2026-10-21 使用者選「甲」）：燈號仍依天氣描述文字判斷；但如果氣象署代碼表示有雷、霧、雨、雪，
// 文字卻沒有對應的字（本站沒收錄的新用語），就把代碼的意思記在 wxHint，網頁取較嚴格的燈號，並記成警告（會寄通知信）。
// 代碼依氣象署天氣描述代碼表（Weather_Icon.pdf，代碼 1–42）：T 雷、F 霧、R 雨、S 雪（注意）、X 下雪／積冰／暴風雪（不建議）
const inR = (c, ...rs) => rs.some(r => Array.isArray(r) ? c >= r[0] && c <= r[1] : c === r);
const codeFlags = c => c == null ? '' : [
  inR(c, [15,18], 21, 22, [33,36], 41) ? 'T' : '',
  inR(c, [24,28], 31, 32, [35,39], 41) ? 'F' : '',
  inR(c, [8,22], [29,39], 41) ? 'R' : '',
  c === 42 ? 'X' : inR(c, 23, 37) ? 'S' : ''].join('');
const textFlags = w => (/雷/.test(w) ? 'T' : '') + (/霧/.test(w) ? 'F' : '') + (/雨/.test(w) ? 'R' : '') + (/下雪|積冰|暴風雪/.test(w) ? 'X' : /雪|冰/.test(w) ? 'S' : '');
function wxHints(points){
  const hint = {};
  for (const p of points) for (const r of [...(p.h3 || []), ...(p.week || [])]){
    if (!r.wx || r.wc == null) continue;
    const have = textFlags(r.wx), miss = [...codeFlags(r.wc)].filter(f => !have.includes(f) && !(f === 'S' && have.includes('X')));
    if (!miss.length) continue;
    const h = hint[r.wx] ||= {f: '', c: []};
    for (const f of miss) if (!h.f.includes(f)) h.f += f;
    if (!h.c.includes(r.wc)) h.c.push(r.wc);
  }
  for (const [w, h] of Object.entries(hint)) warn(`天氣描述「${w}」是本站沒收錄的用語，已改依氣象署天氣代碼 ${h.c.join('、')} 判斷，請檢查燈號規則`);
  return Object.fromEntries(Object.entries(hint).map(([w, h]) => [w, h.f]));
}
// 網站用的精簡格式（version 2，2026-10-20）：每筆是陣列 [時段序號, 降雨機率, 風速, 氣溫, 體感, 天氣描述序號, 風級]，
// 結尾沒有資料的項目省略；時段序號從 t0（今天 0 時）起算，逐 3 小時每格 3 小時、一週每格 12 小時（從 t0 − 6 小時起）；
// 天氣描述放在共用清單 wx；風級只在和風速換算結果不同時才寫。網頁的 useForecast() 會還原成原本的欄位
function compact(result){
  const t0 = twMidnight(Date.now()), wx = [], wi = new Map();
  const wxIdx = w => { if (w == null) return null; if (!wi.has(w)){ wi.set(w, wx.length); wx.push(w); } return wi.get(w); };
  const enc = (rows, base, step) => (rows || []).map(r => {
    const a = [(r.s - base) / step, r.pop, r.ws, r.t, r.at, wxIdx(r.wx)];
    if (r.bf != null && (r.ws == null || beaufort(r.ws) !== r.bf)) a.push(r.bf);
    while (a.length > 1 && a[a.length - 1] == null) a.pop();
    return a;
  });
  const points = Object.fromEntries(Object.entries(result.points).map(([k, p]) => [k, {h3: enc(p.h3, t0, 3*H), week: enc(p.week, t0 - 6*H, 12*H), ...(p.geo ? {geo: p.geo} : {})}]));
  return {...result, t0, wx, wxHint: wxHints(Object.values(result.points)), points};
}
// 天氣用語紀錄 data/wx-log.json：累積每次執行出現的天氣描述，搭配當時有效的特報，
// 用來觀察颱風、豪雨期間的用語，以及霧、雪、雨的燈號規則實際觸發的頻率（只紀錄，不影響燈號）
function logWx(points, alerts){
  if (FIXTURES) return;
  const file = path.join(ROOT, 'data/wx-log.json'), now = Date.now(), day = new Date(now + TZ).toISOString().slice(0, 10);
  let log = {}; try{ log = JSON.parse(fs.readFileSync(file, 'utf8')); }catch{}
  log.terms ||= {}; log.runs ||= [];
  const wx = {};
  for (const p of points) for (const x of [...(p.h3 || []), ...(p.week || [])]) if (x.wx) wx[x.wx] = (wx[x.wx] || 0) + 1;
  const active = [...new Set(alerts.filter(a => !(a.end < now)).map(a => a.type))];
  for (const [w, c] of Object.entries(wx)){
    const t = log.terms[w] ||= {n: 0, first: day, withAlerts: []};
    t.n += c; t.last = day;
    for (const a of active) if (!t.withAlerts.includes(a)) t.withAlerts.push(a);
  }
  log.runs.push({time: new Date(now).toISOString(), alerts: active, wx: Object.fromEntries(Object.entries(wx).sort((a, b) => b[1] - a[1]))});
  log.runs = log.runs.slice(-120);                         // 約 30 天（每天 4 次）
  log.watch = Object.keys(log.terms).filter(w => /大雨|豪雨|霧|雪|冰|雷/.test(w)).sort();
  fs.writeFileSync(file, JSON.stringify(log, null, 1));
}
// 每次執行結果寫進 data/last-run.json（會存回 GitHub），方便從專案直接看到成功或失敗原因
const record = (ok, error) => { if (FIXTURES) return; fs.writeFileSync(path.join(ROOT, 'data/last-run.json'), JSON.stringify({time: new Date().toISOString(), ok, error: error || null, cause: error ? String(errCause || '') : null, warnings, summary}, null, 2)); };
main().then(() => record(true)).catch(e => { errCause = e.cause?.code || e.cause?.message || ''; console.error('✖ ' + e.message, errCause); record(false, e.message); process.exit(1); });
