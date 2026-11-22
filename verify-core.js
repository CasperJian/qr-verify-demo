/* 驗證核心：量測與判定。
   驗證頁、生成端的翻印模擬、攻擊模擬與自動測試都載入這一份，判定規則只有這裡一處。
   本檔不碰 DOM，也不保存任何狀態；需先載入 crypto.js 與 layers.js。 */
"use strict";

/* ===== 色彩數學（sRGB ↔ CIELAB，D65）===== */
function s2l(v){v/=255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);}
function l2s(v){v=v<=0.0031308?v*12.92:1.055*Math.pow(v,1/2.4)-0.055;return Math.max(0,Math.min(255,Math.round(v*255)));}
function rgb2lab(r,g,b){
  const R=s2l(r),G=s2l(g),B=s2l(b);
  let X=R*0.4124+G*0.3576+B*0.1805, Y=R*0.2126+G*0.7152+B*0.0722, Z=R*0.0193+G*0.1192+B*0.9505;
  X/=0.95047;Z/=1.08883;
  const f=t=>t>0.008856?Math.cbrt(t):(7.787*t+16/116);
  const fx=f(X),fy=f(Y),fz=f(Z);
  return[116*fy-16,500*(fx-fy),200*(fy-fz)];
}
function lab2rgb(L,a,b){
  const fy=(L+16)/116, fx=fy+a/500, fz=fy-b/200;
  const inv=t=>(t*t*t>0.008856)?t*t*t:(t-16/116)/7.787;
  const X=inv(fx)*0.95047, Y=inv(fy), Z=inv(fz)*1.08883;
  const R=X*3.2406+Y*-1.5372+Z*-0.4986, G=X*-0.9689+Y*1.8758+Z*0.0415, B=X*0.0557+Y*-0.2040+Z*1.0570;
  return[l2s(R),l2s(G),l2s(B)];
}

/* ===== 透視對應：單位方格→影像四邊形 ===== */
function squareToQuad(p0,p1,p2,p3){
  const sx=p0.x-p1.x+p2.x-p3.x, sy=p0.y-p1.y+p2.y-p3.y;
  let a,b,c,d,e,f,g,h;
  if(Math.abs(sx)<1e-9&&Math.abs(sy)<1e-9){
    a=p1.x-p0.x; b=p3.x-p0.x; c=p0.x; d=p1.y-p0.y; e=p3.y-p0.y; f=p0.y; g=0; h=0;
  }else{
    const dx1=p1.x-p2.x, dx2=p3.x-p2.x, dy1=p1.y-p2.y, dy2=p3.y-p2.y;
    const den=dx1*dy2-dx2*dy1;
    g=(sx*dy2-dx2*sy)/den; h=(dx1*sy-sx*dy1)/den;
    a=p1.x-p0.x+g*p1.x; b=p3.x-p0.x+h*p3.x; c=p0.x;
    d=p1.y-p0.y+g*p1.y; e=p3.y-p0.y+h*p3.y; f=p0.y;
  }
  return (u,v)=>{const w=g*u+h*v+1;return{x:(a*u+b*v+c)/w,y:(d*u+e*v+f)/w};};
}

/* ===== 判定參數 ===== */
const GRID=4, MIN_PER_GROUP=5, MAX_CHROMA=14;   // 4x4 分格；每格每組至少 5 個模塊；色度超過 14 視為非我方模塊
const FRAMES_NEED=3;                            // 一次驗證平均幾幀
const MIN_MODULE_PX=7;                          // 每模塊少於這麼多像素就不採計（太遠）
const DEF_T={DA:1.2,DB:1.0,WB:0.8,WA:0.6};      // 各層強度門檻的預設值，須由實印資料校定
const LAYERS=LAYER_DEFS.map(L=>({k:L.k,name:L.name,defT:DEF_T[L.k]}));
const AGREE_PASS=0.85, AGREE_FAIL=0.65, AGREE_STRONG=0.95;
// 低強度底線：符號雖是主判定，但仍要求訊號有最低可量測強度。
// 理由①量到 0.1 Lab 級的差值已在真實拍攝雜訊之下，符號不可信；
// 理由②純看符號會對「高保真翻印」過度寬容（對方只要保留微量正確符號即可），
// 這道底線把那條路擋回去。實際值須由實印資料校定。
const MAG_FLOOR=0.3;

function defaultThresholds(){const o={};for(const L of LAYERS)o[L.k]=L.defT;return o;}
/* 納入判定的層。正式驗證一律四層（"1111"）；只有層組合實驗才會縮減。 */
function activeLayers(mask){
  const m=normLayerMask(mask);
  return LAYERS.filter((L,i)=>m[i]==="1");
}

/* ===== 單幀量測 =====
   三項設計：
   ① 明暗分類直接由照片亮度判定，不再重新編碼 QR 還原矩陣
      → 移除「換 QR 編碼器版本可能選到不同遮罩圖樣」的系統性失效模式
   ② 功能圖樣（定位／對時／對位）保證是純墨與純紙，其內部離散即為純雜訊
      → 免費取得每次拍攝的 σ 估計值，可回報訊噪比而非未校準的原始強度
   ③ 鄰域純度加權：明暗交界處的模塊受墨暈污染最重，依同類鄰居數降權
   img 只需要 {data}（RGBA 位元組），W/H 為其寬高；corners 為 QR 四角在影像上的座標。 */
function measureFrame(img,W,H,corners,count,token){
  const map=squareToQuad(corners.tl,corners.tr,corners.br,corners.bl);
  const mpx=Math.hypot(corners.tr.x-corners.tl.x,corners.tr.y-corners.tl.y)/count;
  const rb=Math.max(1,Math.round(mpx*0.22));
  const d=img.data;
  function sampleLab(r,c){
    const p=map((c+0.5)/count,(r+0.5)/count);
    const cx=Math.round(p.x), cy=Math.round(p.y);
    let R=0,G=0,B=0,n=0;
    for(let y=cy-rb;y<=cy+rb;y++)for(let x=cx-rb;x<=cx+rb;x++){
      if(x<0||y<0||x>=W||y>=H)continue;
      const i=(y*W+x)*4; R+=d[i];G+=d[i+1];B+=d[i+2];n++;
    }
    return n?rgb2lab(R/n,G/n,B/n):null;
  }
  // ── 取樣全部模塊 ──
  const isFunc=qrFunctionMask(count);
  const lab=new Array(count*count), Ls=[];
  for(let r=0;r<count;r++)for(let c=0;c<count;c++){
    const v=sampleLab(r,c); lab[r*count+c]=v;
    if(v)Ls.push(v[0]);
  }
  if(Ls.length<count)return null;
  // ── 由亮度分佈定明暗門檻（近黑與近白差距極大，分類穩健）──
  const sorted=Ls.slice().sort((a,b)=>a-b);
  const q=Math.max(1,Math.floor(sorted.length*0.3));
  const loMean=sorted.slice(0,q).reduce((s,v)=>s+v,0)/q;
  const hiMean=sorted.slice(-q).reduce((s,v)=>s+v,0)/q;
  const thr=(loMean+hiMean)/2;
  const dark=(r,c)=>{const v=lab[r*count+c];return v?v[0]<thr:false;};
  // 有效模塊判定：本設計的模塊只會落在近黑或近白兩群；
  // 亮度離群者不是我們的模塊 —— 中央客製圖、反光、髒污、刮傷皆自動排除。
  const band=Math.max(6,(hiMean-loMean)*0.35);
  // 色度上限：本設計的模塊在色度上近乎中性，加上印刷與拍攝雜訊仍遠低於 MAX_CHROMA；
  // 彩色圖案／彩色污損則明顯超出。僅靠亮度不足以排除高亮度的彩色圖（例如金色），故兩條件並用。
  const valid=(r,c)=>{
    const v=lab[r*count+c]; if(!v)return false;
    if(Math.hypot(v[1],v[2])>MAX_CHROMA)return false;
    return Math.abs(v[0]-loMean)<band || Math.abs(v[0]-hiMean)<band;
  };
  // ── 功能圖樣 → 雜訊 σ 估計與黑白參考 ──
  const fD=[],fW=[];
  for(let r=0;r<count;r++)for(let c=0;c<count;c++){
    if(!isFunc(r,c))continue;
    const v=lab[r*count+c]; if(!v)continue;
    if(Math.abs(v[0]-loMean)>=band&&Math.abs(v[0]-hiMean)>=band)continue;
    (v[0]<thr?fD:fW).push(v);
  }
  const spread=(arr,ax)=>{
    if(arr.length<4)return null;
    const m=arr.reduce((s,v)=>s+v[ax],0)/arr.length;
    return Math.sqrt(arr.reduce((s,v)=>s+(v[ax]-m)*(v[ax]-m),0)/(arr.length-1));
  };
  const sigmaD=Math.max(spread(fD,1)||0,spread(fD,2)||0);
  const sigmaW=Math.max(spread(fW,1)||0,spread(fW,2)||0);
  const sigma=Math.max(sigmaD,sigmaW,0.01);
  const refs={darkL:fD.length?fD.reduce((s,v)=>s+v[0],0)/fD.length:null,
              whiteL:fW.length?fW.reduce((s,v)=>s+v[0],0)/fW.length:null,
              sigmaDark:sigmaD,sigmaWhite:sigmaW,nFunc:fD.length+fW.length};
  // ── 分組（由照片分類，非重新編碼 QR）──
  const part=buildPartition(dark,count,token);
  // ── 鄰域純度權重：同類鄰居越多越乾淨 ──
  function purity(r,c){
    const me=dark(r,c); let opp=0;
    for(const[dr,dc]of[[-1,0],[1,0],[0,-1],[0,1]]){
      const rr=r+dr,cc=c+dc;
      if(rr<0||cc<0||rr>=count||cc>=count)continue;
      if(dark(rr,cc)!==me)opp++;
    }
    return 1/(1+0.6*opp);
  }
  const cellOf=(r,c)=>Math.min(GRID-1,Math.floor(r*GRID/count))*GRID+Math.min(GRID-1,Math.floor(c*GRID/count));
  const seps=(list,gk,axis)=>{
    const NC=GRID*GRID;
    const s1=new Float64Array(NC),n1=new Float64Array(NC),s0=new Float64Array(NC),n0=new Float64Array(NC);
    const c1=new Int32Array(NC),c0=new Int32Array(NC);
    let gs1=0,gn1=0,gs0=0,gn0=0;
    for(const md of list){
      const v=lab[md.r*count+md.c]; if(!v)continue;
      if(!valid(md.r,md.c))continue;          // 略過圖形／污損區，但 RNG 順序不受影響
      const w=purity(md.r,md.c), k=cellOf(md.r,md.c), x=v[axis];
      if(md[gk]===1){s1[k]+=w*x;n1[k]+=w;c1[k]++;gs1+=w*x;gn1+=w;}
      else{s0[k]+=w*x;n0[k]+=w;c0[k]++;gs0+=w*x;gn0+=w;}
    }
    const cells=[];
    for(let k=0;k<NC;k++)cells.push((c1[k]>=MIN_PER_GROUP&&c0[k]>=MIN_PER_GROUP)?(s1[k]/n1[k]-s0[k]/n0[k]):null);
    return{mean:(gn1&&gn0)?(gs1/gn1-gs0/gn0):NaN,cells};
  };
  const dA=seps(part.modules,"g1",1), dB=seps(part.modules,"g2",2);
  const wB=seps(part.wmodules,"g1",2), wA=seps(part.wmodules,"g2",1);
  let nEx=0;
  for(const md of part.modules.concat(part.wmodules))if(!valid(md.r,md.c))nEx++;
  return{DA:dA.mean,DB:dB.mean,WB:wB.mean,WA:wA.mean,mpx,sigma,refs,excluded:nEx,
         nDark:part.modules.length,nLight:part.wmodules.length,
         snr:Math.abs(dA.mean)/sigma,
         cells:{DA:dA.cells,DB:dB.cells,WB:wB.cells,WA:wA.cells}};
}

/* ===== 多幀平均 =====
   各層分離量、分格值、σ 都先跨幀平均再判定：分格值平均後才判符號，可降低單幀雜訊。 */
function averageFrames(samples){
  const n=samples.length, avg={frames:n};
  const mean=f=>samples.reduce((s,m)=>s+(f(m)||0),0)/n;
  for(const L of LAYERS)avg[L.k]=samples.reduce((s,m)=>s+m[L.k],0)/n;
  avg.mpx=mean(m=>m.mpx);
  avg.sigma=mean(m=>m.sigma);
  avg.snr=mean(m=>m.snr);
  avg.excluded=mean(m=>m.excluded);
  const refAvg=k=>{
    const vs=samples.map(m=>m.refs&&m.refs[k]).filter(Number.isFinite);
    return vs.length?vs.reduce((s,v)=>s+v,0)/vs.length:null;
  };
  avg.darkL=refAvg("darkL"); avg.whiteL=refAvg("whiteL");
  avg.cells={};
  for(const L of LAYERS){
    const NC=GRID*GRID, acc=new Float64Array(NC), cnt=new Int32Array(NC);
    for(const m of samples){
      const cs=m.cells&&m.cells[L.k]; if(!cs)continue;
      for(let k=0;k<NC;k++){const v=cs[k];if(v!=null&&Number.isFinite(v)){acc[k]+=v;cnt[k]++;}}
    }
    avg.cells[L.k]=Array.from({length:NC},(_,k)=>cnt[k]?acc[k]/cnt[k]:null);
  }
  return avg;
}

/* ===== 符號一致率 =====
   所有有效格中，符號正確（>0）的比例。
   仿品訊號被抹除後只能亂猜 → 期望值 0.5；正品即使強度衰減大半仍接近 1。
   四層一律全部分析並回報；mask 只決定哪幾層計入總一致率。 */
function agreement(m,mask){
  if(!m||!m.cells)return null;
  const act=activeLayers(mask).map(L=>L.k);
  let valid=0,correct=0;const per={};
  for(const L of LAYERS){
    const cs=m.cells[L.k]||[];
    let v=0,c=0;
    for(const x of cs){if(x==null||!Number.isFinite(x))continue;v++;if(x>0)c++;}
    const counted=act.includes(L.k);
    per[L.k]={valid:v,correct:c,rate:v?c/v:null,counted};
    if(counted){valid+=v;correct+=c;}
  }
  return valid?{valid,correct,rate:correct/valid,per}:null;
}

/* ===== 判定 =====
   主判定＝符號一致率（不受強度變異影響）；強度只能把 PASS 降級為 HOLD，不能單獨造成 PASS。
   52 格全對若靠瞎猜的機率是 2^-52（約 2e-16）→ 一致率極高時本身就是壓倒性證據，
   不需要再要求強度達標，否則印刷偏淡的正品會被誤殺（這正是委外印刷的主要風險）。
   T＝各層強度門檻；mask＝納入判定的層（預設四層）。 */
function decide(avg,T,mask){
  const ACT=activeLayers(mask);
  const need=Math.max(1,ACT.length-1);     // 允許一層未達門檻；四層時＝3
  let signOK=true,passCnt=0;
  for(const L of ACT){
    const v=avg[L.k];
    if(!(v>0))signOK=false;
    if(v>=T[L.k])passCnt++;
  }
  const ag=agreement(avg,mask);
  const rate=ag?ag.rate:null;
  const mags=ACT.map(L=>Math.abs(avg[L.k])).filter(Number.isFinite).sort((a,b)=>a-b);
  const magMed=mags.length?mags[Math.floor(mags.length/2)]:0;
  const magOK=magMed>=MAG_FLOOR;
  let pass,cls;
  if(rate!=null){
    if(rate<=AGREE_FAIL){pass=false;cls="fail";}
    else if(rate>=AGREE_STRONG&&magOK){pass=true;cls="pass";}   // 符號證據壓倒性且過底線
    else if(rate>=AGREE_PASS&&passCnt>=need){pass=true;cls="pass";} // 中段才需要強度佐證
    else{pass=false;cls="hold";}
  }else{                                   // 無分格資料時退回舊規則
    pass=signOK&&passCnt>=need;cls=pass?"pass":(passCnt===0?"fail":"hold");
  }
  return{pass,cls,signOK,passCnt,nAct:ACT.length,agree:rate,agreeInfo:ag,magMed,magOK};
}
