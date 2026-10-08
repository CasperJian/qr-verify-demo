/* 暗層分組重建（產生器與驗證頁共用同一份，保證兩端一致）
   由「QR 矩陣＋簽章 token」推導四條暗層的模塊分組：
     暗①＝黑模塊 a*（g1）  暗②＝黑模塊 b*（g2）
     暗③＝白模塊 b*（g1）  暗④＝白模塊 a*（g2）
   需先載入 crypto.js（用到 mulberry32）。 */
"use strict";

/* QR 功能圖樣位置（ISO/IEC 18004 標準表，與 qrlib.js 內的 PATTERN_POSITION_TABLE 同源）
   索引＝版本−1，值＝對位圖樣中心的座標清單（列與行共用同一組）。 */
const QR_AP_POS = [
  [],[6,18],[6,22],[6,26],[6,30],
  [6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],
  [6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],
  [6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],
  [6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],
  [6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],
  [6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],
  [6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]
];

/* 標出所有「不承載隱碼」的功能模塊：時序、定位＋格式資訊、版本資訊、對位圖樣。
   先前只處理到版本 6 的單一對位圖樣，版本 7 以上的多個對位圖樣與版本資訊區塊
   都被當成資料模塊取樣，會污染量測。這裡一次補齊，並預先算成查表以免逐點掃描。 */
function qrFunctionMask(count){
  const v = Math.floor((count - 17) / 4);
  const pos = QR_AP_POS[v - 1] || [];
  const last = pos.length - 1;
  const hasVer = v >= 7;                       // 版本 7 起才有版本資訊區塊
  const mask = new Uint8Array(count * count);
  const set = (r, c) => { if(r >= 0 && c >= 0 && r < count && c < count) mask[r * count + c] = 1; };

  for(let i = 0; i < count; i++){ set(6, i); set(i, 6); }          // 時序圖樣
  for(let r = 0; r < 9; r++)for(let c = 0; c < 9; c++)set(r, c);   // 左上定位＋格式資訊
  for(let r = 0; r < 9; r++)for(let c = count - 8; c < count; c++)set(r, c);   // 右上
  for(let r = count - 8; r < count; r++)for(let c = 0; c < 9; c++)set(r, c);   // 左下
  if(hasVer)for(let i = 0; i < 6; i++)for(let k = 0; k < 3; k++){
    set(i, count - 11 + k);                                        // 版本資訊（右上 6×3）
    set(count - 11 + k, i);                                        // 版本資訊（左下 3×6）
  }
  // 對位圖樣：pos × pos 的組合，但與三個定位圖樣重疊的那三組不會被畫出來
  for(let i = 0; i <= last; i++)for(let j = 0; j <= last; j++){
    if((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0))continue;
    for(let dr = -2; dr <= 2; dr++)for(let dc = -2; dc <= 2; dc++)set(pos[i] + dr, pos[j] + dc);
  }
  return (r, c) => mask[r * count + c] === 1;
}

function buildPartition(src,count,token){
  // src 可為 QR 物件（生成端）或 isDark(r,c) 函式（驗證端由照片亮度分類）。
  // 注意：g1/g2 只取決於模塊座標與 RNG 順序，與明暗分類無關；
  // 因此即使偶有模塊分錯明暗，也只是把該模塊放進另一條層，不會連鎖崩壞。
  const isDark=(typeof src==="function")?src:((r,c)=>src.isDark(r,c));
  const rng=mulberry32(parseInt(token.slice(0,8),16)>>>0);
  const isFunc=qrFunctionMask(count);
  const modules=[], wmodules=[];
  for(let r=0;r<count;r++)for(let c=0;c<count;c++){
    if(isFunc(r,c))continue;
    const m={r,c,g1:rng()<0.5?0:1,g2:rng()<0.5?0:1};
    if(isDark(r,c))modules.push(m); else wmodules.push(m);
  }
  return{modules,wmodules};
}

/* ============ 隱碼層遮罩（層配置的唯一真相）============
   四條層固定編號：① 深模塊 a*　② 深模塊 b*　③ 淺模塊 b*　④ 淺模塊 a*
   正規形式＝四字元字串（"1"開 "0"關），順序 ①②③④，例如 "1010"＝只開①③。
   舊字串 all/dark/light/none 仍可傳入，會被翻成對應遮罩，維持既有匯出檔相容。 */
const LAYER_DEFS=[
  {k:"DA",no:"①",carrier:"深",axis:"a*",name:"隱碼① 深模塊 a*"},
  {k:"DB",no:"②",carrier:"深",axis:"b*",name:"隱碼② 深模塊 b*"},
  {k:"WB",no:"③",carrier:"淺",axis:"b*",name:"隱碼③ 淺模塊 b*"},
  {k:"WA",no:"④",carrier:"淺",axis:"a*",name:"隱碼④ 淺模塊 a*"},
];
const LAYER_ALIAS={all:"1111",dark:"1100",light:"0011",none:"0000"};

function normLayerMask(v){
  if(v==null)return "1111";
  if(Array.isArray(v))                                   // ["DA","WB"] 或 [1,0,1,0]
    return (typeof v[0]==="number")
      ? v.slice(0,4).map(x=>x?"1":"0").join("").padEnd(4,"0")
      : LAYER_DEFS.map(L=>v.includes(L.k)?"1":"0").join("");
  if(typeof v==="object")return LAYER_DEFS.map(L=>v[L.k]?"1":"0").join("");
  let s=String(v).trim();
  if(LAYER_ALIAS[s])return LAYER_ALIAS[s];
  if(/^[01]{4}$/.test(s))return s;
  if(/^[①②③④]+$/.test(s))return LAYER_DEFS.map(L=>s.includes(L.no)?"1":"0").join("");
  if(/^[1-4]+$/.test(s))return LAYER_DEFS.map((L,i)=>s.includes(String(i+1))?"1":"0").join("");
  return "1111";                                          // 無法解讀時退回四層全開
}
function layerMaskOn(v){
  const m=normLayerMask(v), o={};
  LAYER_DEFS.forEach((L,i)=>o[L.k]=m[i]==="1");
  return o;
}
function layerMaskCount(v){return (normLayerMask(v).match(/1/g)||[]).length;}
/* 顯示用名稱：四個常用配置沿用原本說法，其餘列出實際開啟的層號 */
function layerMaskName(v){
  const m=normLayerMask(v);
  const std={"1111":"四層全開","1100":"僅深色層","0011":"僅淺色層","0000":"無隱碼（仿品對照）"}[m];
  if(std)return std;
  const on=LAYER_DEFS.filter((L,i)=>m[i]==="1");
  if(on.length===1)return `單層${on[0].no}（${on[0].carrier}模塊 ${on[0].axis}）`;
  const grp=on.every(L=>L.carrier==="深")?"深色 ":on.every(L=>L.carrier==="淺")?"淺色 ":"";
  return `${grp}${on.length} 層（${on.map(L=>L.no).join("")}）`;
}
