// 蒲福風級下限（公尺／秒）。抓資料（scripts/fetch.mjs）與網頁（site/app.js，由 build.mjs 放入）共用這一份
export const BF = [0,0.3,1.6,3.4,5.5,8.0,10.8,13.9,17.2,20.8,24.5];
export const beaufort = ws => BF.reduce((b, v, i) => ws >= v ? i : b, 0);
