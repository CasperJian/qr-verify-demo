/* 共用密碼工具：純 JS SHA-256 / HMAC（跨裝置確定性，不依賴 WebCrypto 的安全環境限制）
   注意：DEMO_KEY 寫在前端僅供展示——量產時金鑰必須存伺服器端，驗證改走後端 API。 */
"use strict";

const DEMO_KEY = "DEMO-KEY-請換成伺服器端金鑰";

const SHA256 = (() => {
  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ]);
  const H0 = new Uint32Array([
    0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19
  ]);
  const rr = (x, n) => (x >>> n) | (x << (32 - n));
  return function digest(bytes) {
    const l = bytes.length, bl = l * 8;
    const padded = new Uint8Array(((l + 9 + 63) >> 6) << 6);
    padded.set(bytes); padded[l] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 4, bl >>> 0);
    dv.setUint32(padded.length - 8, Math.floor(bl / 4294967296));
    const H = H0.slice(), w = new Uint32Array(64);
    for (let off = 0; off < padded.length; off += 64) {
      for (let t = 0; t < 16; t++) w[t] = dv.getUint32(off + t * 4);
      for (let t = 16; t < 64; t++) {
        const s0 = rr(w[t-15],7) ^ rr(w[t-15],18) ^ (w[t-15] >>> 3);
        const s1 = rr(w[t-2],17) ^ rr(w[t-2],19) ^ (w[t-2] >>> 10);
        w[t] = (w[t-16] + s0 + w[t-7] + s1) >>> 0;
      }
      let a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
      for (let t = 0; t < 64; t++) {
        const S1 = rr(e,6) ^ rr(e,11) ^ rr(e,25), ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
        const S0 = rr(a,2) ^ rr(a,13) ^ rr(a,22), mj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + mj) >>> 0;
        h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
      }
      H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0;
      H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+h)>>>0;
    }
    const out = new Uint8Array(32), ov = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]);
    return out;
  };
})();

function hmacSha256Hex(key, msg) {
  const enc = new TextEncoder();
  let k = enc.encode(key);
  if (k.length > 64) k = SHA256(k);
  const msgB = enc.encode(msg);
  const inner = new Uint8Array(64 + msgB.length);
  const outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) { inner[i] = (k[i] || 0) ^ 0x36; outer[i] = (k[i] || 0) ^ 0x5c; }
  inner.set(msgB, 64);
  outer.set(SHA256(inner), 64);
  return [...SHA256(outer)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function randSerial(){
  const a = new Uint8Array(10);
  (typeof crypto !== "undefined" && crypto.getRandomValues)
    ? crypto.getRandomValues(a)
    : a.forEach((_, i) => a[i] = Math.floor(Math.random() * 256));
  let s = "";
  for (let i = 0; i < 10; i++) { s += B32[a[i] % 32]; if (i === 4) s += "-"; }
  return s;
}

/* node 自測支援 */
if (typeof module !== "undefined") module.exports = { SHA256, hmacSha256Hex };
