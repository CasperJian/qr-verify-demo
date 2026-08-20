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

function buildPartition(qr,count,token){
  const rng=mulberry32(parseInt(token.slice(0,8),16)>>>0);
  const isFunc=qrFunctionMask(count);
  const modules=[], wmodules=[];
  for(let r=0;r<count;r++)for(let c=0;c<count;c++){
    if(isFunc(r,c))continue;
    const m={r,c,g1:rng()<0.5?0:1,g2:rng()<0.5?0:1};
    if(qr.isDark(r,c))modules.push(m); else wmodules.push(m);
  }
  return{modules,wmodules};
}
