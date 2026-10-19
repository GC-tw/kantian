// 看天爬山：組合網頁 → dist/index.html（forecast.json 由 fetch.mjs 另外產生）
// 執行：node scripts/build.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const mountains = JSON.parse(read('data/mountains.json'));
const js = read('site/app.js').replace('__DATA__', () => JSON.stringify(mountains));
const tpl = read('site/template.html');
const cut = tpl.indexOf('<style>');                                  // 標題與字型連結放進 <head>
const head = tpl.slice(0, cut).replace(/<meta name="claude:[^>]*>\s*/g, '');
const page = tpl.slice(cut).replace('__JS__', () => js);
const html = `<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="description" content="看天氣，找出適合造訪的山。依交通部中央氣象署預報，比較百岳、小百岳的天氣。">${head}<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${page}</body></html>`;
fs.mkdirSync(path.join(ROOT, 'dist'), {recursive: true});
fs.writeFileSync(path.join(ROOT, 'dist/index.html'), html);
fs.writeFileSync(path.join(ROOT, 'dist/.nojekyll'), '');
console.log('已產生 dist/index.html（' + Math.round(html.length / 1024) + ' KB）');
