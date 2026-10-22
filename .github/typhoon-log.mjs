// 颱風期間資料紀錄（2026-10-22 使用者要求；只做紀錄，不影響網站）
// 每小時存一份：網站當時的預報與特報（forecast.json）、氣象署實際觀測、特報與颱風原始資料。
// 存在 typhoon-log 分支的 log/日期/時間/ 底下（gzip 壓縮），之後用來對照燈號與實際天氣。
// 用法：node typhoon-log.mjs <輸出資料夾>；需要環境變數 CWA_API_KEY（不寫進任何檔案）
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import path from 'node:path';

const KEY = process.env.CWA_API_KEY;
const OUT = process.argv[2] || 'log';
const SITE = process.env.SITE_URL || 'https://gc-tw.github.io/kantian/';
const API = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/';

// 氣象署資料集：實際觀測＋特報＋颱風
const CWA = {
  'obs-auto': 'O-A0001-001',   // 自動氣象站（風速、陣風、氣溫、濕度、天氣）
  'obs-rain': 'O-A0002-001',   // 自動雨量站（過去 10 分鐘、1、3、6、12、24 小時雨量）
  'obs-staff': 'O-A0003-001',  // 有人氣象站（天氣現象、能見度）
  'alerts': 'W-C0033-001',     // 天氣警特報
  'ty-warn': 'W-C0034-001',    // 颱風警報
  'ty-track': 'W-C0034-005',   // 颱風路徑
};

const tw = new Date(Date.now() + 8 * 3600e3);
const stamp = tw.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '/');   // 20261022/2323
const dir = path.join(OUT, stamp);
fs.mkdirSync(dir, {recursive: true});

async function get(url, tries = 3){
  let err;
  for(let i = 0; i < tries; i++){
    try{
      const r = await fetch(url, {signal: AbortSignal.timeout(60e3)});
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return Buffer.from(await r.arrayBuffer());
    }catch(e){ err = e; await new Promise(s => setTimeout(s, 5e3 * (i + 1))); }
  }
  throw err;
}
const save = (name, buf) => fs.writeFileSync(path.join(dir, name + '.json.gz'), zlib.gzipSync(buf, {level: 9}));
const hash = buf => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);

// 同樣內容不重複存（網站預報約每 1–3 小時才換一次）
const lastFile = path.join(OUT, 'last-hash.json');
let last = {};
try{ last = JSON.parse(fs.readFileSync(lastFile, 'utf8')); }catch{}

const manifest = {time: new Date().toISOString(), tw: tw.toISOString().slice(0, 16).replace('T', ' '), saved: {}, same: {}, failed: {}};

async function one(name, url){
  try{
    const buf = await get(url);
    JSON.parse(buf.toString('utf8'));               // 確認是 JSON
    const h = hash(buf);
    if(last[name] && last[name].hash === h){ manifest.same[name] = last[name].at; return; }
    save(name, buf);
    last[name] = {hash: h, at: stamp};
    manifest.saved[name] = buf.length;
  }catch(e){ manifest.failed[name] = String(e.message || e).replace(KEY || '\u0000', '***'); }
}

const t = Math.floor(Date.now() / 1000);
const jobs = [
  one('site-forecast', SITE + 'forecast.json?t=' + t),   // 網站當時實際使用的資料（燈號由這份算出）
  one('site-version', SITE + 'version.json?t=' + t),     // 網頁版本（燈號規則版本）
];
if(KEY){
  for(const [name, id] of Object.entries(CWA)){
    const q = new URLSearchParams({Authorization: KEY, format: 'JSON'});
    jobs.push(one(name, API + id + '?' + q));
  }
}else manifest.failed.cwa = '沒有 CWA_API_KEY';
await Promise.all(jobs);

fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
fs.writeFileSync(lastFile, JSON.stringify(last, null, 1));
console.log(JSON.stringify(manifest, null, 1));
// 全部失敗才算失敗（避免每小時寄通知信）
if(Object.keys(manifest.saved).length + Object.keys(manifest.same).length === 0) process.exit(1);
