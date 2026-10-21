// 看天爬山：組合網頁 → dist/index.html（forecast.json 由 fetch.mjs 另外產生）
// 執行：node scripts/build.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const mountains = JSON.parse(read('data/mountains.json'));
import {BF} from '../site/beaufort.mjs';
// 網頁只放用得到的欄位：cn（氣象署原始名稱，只給 fetch.mjs 比對用）不放；空白的鄉鎮、備註、別名，以及和山名相同的預報點名稱也省略
const slim = mountains.map(({cn, ...m}) => {
  if (m.pt === m.n) delete m.pt;
  if (!m.tw?.length) delete m.tw;
  if (!m.note) delete m.note;
  if (!m.al?.length) delete m.al;
  return m;
});
const js = read('site/app.js').replace('__DATA__', () => JSON.stringify(slim)).replace('__BF__', () => JSON.stringify(BF));
const tpl = read('site/template.html');
const cut = tpl.indexOf('<style>');                                  // 標題與字型連結放進 <head>
const head = tpl.slice(0, cut).replace(/<meta name="claude:[^>]*>\s*/g, '');
const page = tpl.slice(cut).replace('__JS__', () => js);
const html = `<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="description" content="看天氣，找出適合造訪的山。依交通部中央氣象署預報，比較百岳、小百岳的天氣。">${head}<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${page}</body></html>`;
fs.mkdirSync(path.join(ROOT, 'dist'), {recursive: true});
fs.writeFileSync(path.join(ROOT, 'dist/index.html'), html);
fs.writeFileSync(path.join(ROOT, 'dist/.nojekyll'), '');
fs.copyFileSync(path.join(ROOT, 'site/sw.js'), path.join(ROOT, 'dist/sw.js'));   // 離線查看（2026-10-21）
for (const f of fs.readdirSync(path.join(ROOT, 'site/icons')))     // 圖示（分頁縮圖、加到主畫面的 App 圖示）與 manifest
  fs.copyFileSync(path.join(ROOT, 'site/icons', f), path.join(ROOT, 'dist', f));
console.log('已產生 dist/index.html（' + Math.round(html.length / 1024) + ' KB）');
