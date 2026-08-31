/* 暗層分組重建（產生器與驗證頁共用同一份，保證兩端一致）
   由「QR 矩陣＋簽章 token」推導四條暗層的模塊分組：
     暗①＝黑模塊 a*（g1）  暗②＝黑模塊 b*（g2）
     暗③＝白模塊 b*（g1）  暗④＝白模塊 a*（g2）
   需先載入 crypto.js（用到 mulberry32）。 */
"use strict";

function qrFunctionMask(count){
  const v=Math.floor((count-17)/4);
  const ap=(v>=2&&v<=6)?4*v+10:null;   // 版本 2–6 的對位圖樣中心
  return (r,c)=>{
    if(r===6||c===6)return true;
    if(r<9&&c<9)return true;
    if(r<9&&c>=count-8)return true;
    if(r>=count-8&&c<9)return true;
    if(ap!==null&&Math.abs(r-ap)<=2&&Math.abs(c-ap)<=2)return true;
    return false;
  };
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
