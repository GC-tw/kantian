// 看天爬山：從氣象署開放資料抓取預報，整理成網站使用的 forecast.json
// 執行：CWA_API_KEY=xxxx node scripts/fetch.mjs [--out dist/forecast.json] [--fixtures test/fixtures]
// 不需要安裝任何套件（Node 20 以上）。
import fs from 'node:fs';
import path from 'node:path';

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
const warn = m => { warnings.push(m); console.warn('⚠ ' + m); };

// 鄉鎮預報：全臺一次取得（089 為 3 天逐 3 小時、091 為一週），失敗時改用各縣市資料集
const TOWN_ALL = {h3: 'F-D0047-089', week: 'F-D0047-091'};
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
              else if (vals[key] === undefined) vals[key] = ev.value;
            } else Object.assign(vals, ev);                  // 新格式：{Temperature: "20"}
          }
          recs.push({s: Date.parse(s), e: e ? Date.parse(e) : null, vals});
        }
      }
      out.push({county, name: pick(loc, 'LocationName', 'locationName'), lat: num(pick(loc, 'Latitude', 'lat')), lon: num(pick(loc, 'Longitude', 'lon')), recs});
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
const BF = [0,0.3,1.6,3.4,5.5,8.0,10.8,13.9,17.2,20.8,24.5];
const beaufort = ws => BF.reduce((b, x, i) => ws >= x ? i : b, 0);
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
  return Object.values(out).every(x => x == null) ? null : out;
}

// ---------- 時間格：台灣時間 ----------
const TZ = 8 * 3600e3, H = 3600e3;
const twMidnight = ms => Math.floor((ms + TZ) / (24*H)) * 24*H - TZ;
function slots3h(locs){                                  // 今天 00 時起 3 天，每 3 小時
  const start = twMidnight(Date.now()), out = [];
  for (let i = 0; i < 24; i++){ const S = start + i*3*H; const v = normalize(merge(locs.recs, S, 3*H), false); if (v) out.push({s: S, ...v}); }
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
  const names = new Set(MOUNTAINS.filter(m => m.pid).map(m => m.cn));
  let known = fs.existsSync(DATASETS_FILE) ? JSON.parse(fs.readFileSync(DATASETS_FILE, 'utf8')) : {};
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
      const match = locs.filter(l => names.has(l.name)).length;
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

function saveSample(name, j){                            // 只存第一個地點，檔案很小
  if (FIXTURES) return;
  fs.mkdirSync(SAMPLES_DIR, {recursive: true});
  const c = JSON.parse(JSON.stringify(j));
  const g = findNode(c, /^locations$/i);
  if (Array.isArray(g)) g.splice(1);
  const loc = findNode(c, /^location$/i); if (Array.isArray(loc)) loc.splice(2);
  fs.writeFileSync(path.join(SAMPLES_DIR, name + '.json'), JSON.stringify(c, null, 2));
}

// ---------- 主流程 ----------
async function main(){
  const result = {version: 1, fetchedAt: new Date().toISOString(), datasets: {}, issued: null, points: {}, alerts: [], warnings};
  const nameToPid = new Map(MOUNTAINS.filter(m => m.pid).map(m => [m.cn, m.pid]));
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
      const pid = nameToPid.get(l.name);
      if (!pid) continue;
      const p = result.points[pid] ||= {name: l.name, lat: l.lat, lon: l.lon};
      p[kind] = kind === 'h3' ? slots3h(l) : periods12h(l);
    }
  }
  const missingPid = [...nameToPid.values()].filter(pid => !result.points[pid]);
  if (missingPid.length) warn('登山預報缺少以下預報點：' + missingPid.join('、'));

  // 2. 鄉鎮預報
  for (const kind of ['h3', 'week']){
    let sets = [];
    try{
      const j = await getDataset(TOWN_ALL[kind]);
      const d = describe(j);
      if (!/鄉鎮/.test(d)) throw new Error('資料集說明不符：' + d);
      sets.push(j); result.datasets['town-' + kind] = {id: TOWN_ALL[kind], description: d};
    }catch(e){
      warn('全臺鄉鎮資料集無法使用（' + e.message + '），改用各縣市資料集');
      for (const [county, n] of Object.entries(TOWN_COUNTY)){
        if (![...townsNeeded].some(t => t.startsWith(county))) continue;
        const id = 'F-D0047-' + String(kind === 'h3' ? n : n + 2).padStart(3, '0');
        try{ sets.push(await getDataset(id)); }catch(e2){ warn(e2.message); }
      }
    }
    if (sets[0]) saveSample('town-' + kind, sets[0]);
    for (const j of sets) for (const l of locations(j)){
      const key = l.county + l.name;
      if (!townsNeeded.has(key)) continue;
      const p = result.points[key] ||= {name: key, lat: l.lat, lon: l.lon};
      p[kind] = kind === 'h3' ? slots3h(l) : periods12h(l);
    }
  }
  const missingTown = [...townsNeeded].filter(t => !result.points[t]);
  if (missingTown.length) warn('鄉鎮預報缺少：' + missingTown.join('、'));

  // 3. 天氣警特報（只保留會影響燈號的種類）
  try{
    const j = await getDataset(ALERT_ID); saveSample('alerts', j);
    const LV = [[/颱風|豪雨|大雨|陸上強風/, 2], [/低溫|濃霧/, 1]];
    const locs = [].concat(pick(j.records || j, 'location', 'Location') || []);
    for (const loc of locs){
      const county = pick(loc, 'locationName', 'LocationName');
      const hz = pick(pick(loc, 'hazardConditions', 'HazardConditions') || {}, 'hazards', 'Hazards') || [];
      for (const h of [].concat(hz)){
        const info = pick(h, 'info', 'Info') || {}, vt = pick(h, 'validTime', 'ValidTime') || {};
        const ph = String(pick(info, 'phenomena', 'Phenomena') || ''), sig = String(pick(info, 'significance', 'Significance') || '');
        const lv = (LV.find(([re]) => re.test(ph)) || [])[1];
        if (!lv) continue;
        result.alerts.push({county, type: ph + sig, lv, start: Date.parse(pick(vt, 'startTime', 'StartTime')) || null, end: Date.parse(pick(vt, 'endTime', 'EndTime')) || null});
      }
    }
  }catch(e){ warn('警特報抓取失敗：' + e.message); }

  fs.mkdirSync(path.dirname(OUT), {recursive: true});
  fs.writeFileSync(OUT, JSON.stringify(result));
  const n = Object.values(result.points);
  console.log(`完成：${n.length} 個預報點（3 小時資料 ${n.filter(p=>p.h3?.length).length}、一週資料 ${n.filter(p=>p.week?.length).length}），特報 ${result.alerts.length} 則，警告 ${warnings.length} 則`);
  if (!n.some(p => p.h3?.length)) throw new Error('沒有任何可用的預報資料，停止更新網站');
}
// 每次執行結果寫進 data/last-run.json（會存回 GitHub），方便從專案直接看到成功或失敗原因
const record = (ok, error) => { if (FIXTURES) return; fs.writeFileSync(path.join(ROOT, 'data/last-run.json'), JSON.stringify({time: new Date().toISOString(), ok, error: error || null, cause: error ? String(errCause || '') : null, warnings}, null, 2)); };
let errCause = '';
main().then(() => record(true)).catch(e => { errCause = e.cause?.code || e.cause?.message || ''; console.error('✖ ' + e.message, errCause); record(false, e.message); process.exit(1); });
