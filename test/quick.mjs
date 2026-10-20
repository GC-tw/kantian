// 快速檢查（只改文字、樣式時用，幾秒內完成）：組合網頁並確認程式沒有語法錯誤
// 改到燈號、排序、資料處理時，請改跑完整測試 test/page.test.js
// 執行：node test/quick.mjs
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
execFileSync('node', [path.join(ROOT, 'scripts/build.mjs')], {stdio: 'inherit'});
const html = fs.readFileSync(path.join(ROOT, 'dist/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
let fails = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails++; };
ok(scripts.length > 0, '網頁含有程式');
for (const s of scripts){ try{ new Function(s); ok(true, '程式沒有語法錯誤'); }catch(e){ ok(false, '程式語法錯誤：' + e.message); } }
ok(!/__DATA__|__JS__|__BF__/.test(html), '山岳資料與程式都已放進網頁');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
ok(dup.length === 0, '沒有重複的元素 id' + (dup.length ? '：' + dup.join('、') : ''));
const used = [...scripts.join('\n').matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]);
const missing = [...new Set(used)].filter(x => !ids.includes(x));
ok(missing.length === 0, '程式用到的元素都存在' + (missing.length ? '：缺少 ' + missing.join('、') : ''));
console.log(fails ? `\n${fails} 項未通過` : '\n快速檢查通過');
process.exit(fails ? 1 : 0);
