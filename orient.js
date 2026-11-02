/* 바닥 방향 찾기
   바닥 경계선(벽 밑, 문턱)과 원래 바닥의 줄눈, 마루 이음선을 바닥 평면으로 옮겨서
   방의 가로세로 방향과 카메라 기울기(앞뒤, 좌우)를 찾는다.
   방은 대부분 직각이라 바닥 위 선들은 서로 나란하거나 직각이어야 한다는 점을 이용.
   화면이나 다른 파일에 기대지 않는 순수 계산이라 따로 시험할 수 있음. */
(function (root) {
  "use strict";

  /* 앱의 homography()와 같은 카메라 모형: 사진 좌표 (x, y, 1) 을 바닥 좌표 (X 옆, Z 앞, mm) 로 */
  function camRows(W, H, pitchDeg, rollDeg, fovAdj) {
    const cx = W / 2, cy = H / 2, f = Math.max(W, H) * 0.728 * Math.pow(2, (fovAdj || 0) / 100);
    const th = pitchDeg * Math.PI / 180, ct = Math.cos(th), st = Math.sin(th);
    const r = (rollDeg || 0) * Math.PI / 180, cr = Math.cos(r), sr = Math.sin(r);
    const hc = 1400;
    const U0 = [cr, -sr, -cr * cx + sr * cy], V0 = [sr, cr, -sr * cx - cr * cy];
    const R0 = U0.map(v => v * hc / f);
    const R1 = V0.map(v => -v * hc * st / f); R1[2] += hc * ct;
    const R2 = V0.map(v => v * ct / f); R2[2] += st;
    return [R0, R1, R2];
  }

  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h), line = new Float64Array(Math.max(w, h) + 1);
    for (let y = 0; y < h; y++) {
      const o = y * w; line[0] = 0;
      for (let x = 0; x < w; x++) line[x + 1] = line[x] + src[o + x];
      for (let x = 0; x < w; x++) { const a = Math.max(0, x - r), b = Math.min(w - 1, x + r); tmp[o + x] = (line[b + 1] - line[a]) / (b - a + 1); }
    }
    for (let x = 0; x < w; x++) {
      line[0] = 0;
      for (let y = 0; y < h; y++) line[y + 1] = line[y] + tmp[y * w + x];
      for (let y = 0; y < h; y++) { const a = Math.max(0, y - r), b = Math.min(h - 1, y + r); out[y * w + x] = (line[b + 1] - line[a]) / (b - a + 1); }
    }
    return out;
  }

  /* 방향을 알려주는 선 조각 모으기
     mask: 0~1 바닥 정도 (w*h), lum: 0~1 밝기 (w*h)
     결과: 위치, 선 방향, 무게 */
  function collect(mask, lum, w, h) {
    const n = w * h, xs = [], ys = [], txs = [], tys = [], ws = [], src = [];
    const margin = Math.max(3, Math.round(Math.max(w, h) * 0.008));
    /* 1 바닥 경계선: 반듯한 부분만 */
    const ms = boxBlur(mask, w, h, 2);
    const gx = new Float32Array(n), gy = new Float32Array(n);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x; gx[i] = (ms[i + 1] - ms[i - 1]) / 2; gy[i] = (ms[i + w] - ms[i - w]) / 2;
    }
    const jxx = new Float32Array(n), jxy = new Float32Array(n), jyy = new Float32Array(n);
    for (let i = 0; i < n; i++) { jxx[i] = gx[i] * gx[i]; jxy[i] = gx[i] * gy[i]; jyy[i] = gy[i] * gy[i]; }
    const R = Math.max(3, Math.round(Math.max(w, h) * 0.012));
    const Bxx = boxBlur(jxx, w, h, R), Bxy = boxBlur(jxy, w, h, R), Byy = boxBlur(jyy, w, h, R);
    let bSum = 0;
    for (let y = margin; y < h - margin; y++) for (let x = margin; x < w - margin; x++) {
      const i = y * w + x, v = ms[i];
      if (v < 0.3 || v > 0.7) continue;
      const g = Math.hypot(gx[i], gy[i]); if (g < 0.02) continue;
      const tr = Bxx[i] + Byy[i]; if (tr <= 0) continue;
      const coh = Math.sqrt((Bxx[i] - Byy[i]) ** 2 + 4 * Bxy[i] ** 2) / tr;
      if (coh < 0.75) continue;
      /* 이 부분 경계의 대표 방향(구조 텐서) 으로 선 방향을 잡음 */
      const phi = 0.5 * Math.atan2(2 * Bxy[i], Bxx[i] - Byy[i]) + Math.PI / 2;
      /* 사진에서 거의 세로로 선 경계는 대부분 문짝, 가구 다리 같은 물건 옆면이라 바닥 선이 아님 */
      const fromVert = Math.abs(Math.atan2(Math.abs(Math.cos(phi)), Math.abs(Math.sin(phi)))) * 180 / Math.PI;
      const vk = fromVert < 15 ? 0.1 : fromVert < 25 ? 0.1 + 0.9 * (fromVert - 15) / 10 : 1;
      const wgt = coh * coh * vk;
      xs.push(x); ys.push(y); txs.push(Math.cos(phi)); tys.push(Math.sin(phi)); ws.push(wgt); src.push(0); bSum += wgt;
    }
    /* 2 원래 바닥의 줄눈, 마루 이음선: 바닥 안쪽에서 길게 이어지는 선만 */
    const L = boxBlur(lum, w, h, 1);
    const ex = new Float32Array(n), ey = new Float32Array(n);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      ex[i] = (L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1]) - (L[i - w - 1] + 2 * L[i - 1] + L[i + w - 1]);
      ey[i] = (L[i + w - 1] + 2 * L[i + w] + L[i + w + 1]) - (L[i - w - 1] + 2 * L[i - w] + L[i - w + 1]);
    }
    for (let i = 0; i < n; i++) { jxx[i] = ex[i] * ex[i]; jxy[i] = ex[i] * ey[i]; jyy[i] = ey[i] * ey[i]; }
    const r2 = Math.max(2, Math.round(Math.max(w, h) * 0.006));
    const Cxx = boxBlur(jxx, w, h, r2), Cxy = boxBlur(jxy, w, h, r2), Cyy = boxBlur(jyy, w, h, r2);
    const inner = boxBlur(mask, w, h, margin);
    const en = [];
    for (let y = margin; y < h - margin; y += 2) for (let x = margin; x < w - margin; x += 2) {
      const i = y * w + x; if (inner[i] < 0.98) continue; en.push(Cxx[i] + Cyy[i]);
    }
    let tSum = 0;
    if (en.length > 50) {
      en.sort((a, b) => a - b);
      const thr = Math.max(en[Math.floor(en.length * 0.8)], 0.004);
      for (let y = margin; y < h - margin; y += 2) for (let x = margin; x < w - margin; x += 2) {
        const i = y * w + x; if (inner[i] < 0.98) continue;
        const tr = Cxx[i] + Cyy[i]; if (tr < thr) continue;
        const coh = Math.sqrt((Cxx[i] - Cyy[i]) ** 2 + 4 * Cxy[i] ** 2) / tr;
        if (coh < 0.6) continue;
        const phi = 0.5 * Math.atan2(2 * Cxy[i], Cxx[i] - Cyy[i]) + Math.PI / 2;
        const wgt = coh * coh;
        xs.push(x); ys.push(y); txs.push(Math.cos(phi)); tys.push(Math.sin(phi)); ws.push(wgt); src.push(1); tSum += wgt;
      }
    }
    /* 경계선과 바닥 무늬가 서로 비슷한 힘을 갖도록 맞춤 (무늬 없는 바닥이면 경계선 위주) */
    if (bSum > 0 && tSum > 0) {
      const k = bSum / tSum;
      for (let j = 0; j < ws.length; j++) if (src[j] === 1) ws[j] *= k;
    }
    return { xs, ys, txs, tys, ws, src, nBoundary: src.filter(s => s === 0).length, nTexture: src.filter(s => s === 1).length };
  }

  const BINS = 180; /* 0.5도 간격, 0~90도 (직각으로 접어서 봄) */
  function histogram(S, sx, W, H, pitch, roll, fovAdj) {
    const [A, B, C] = camRows(W, H, pitch, roll, fovAdj);
    const hist = new Float64Array(BINS);
    const d = 2 * sx;
    let total = 0;
    for (let j = 0; j < S.ws.length; j++) {
      const x = S.xs[j] * sx, y = S.ys[j] * sx, tx = S.txs[j] * d, ty = S.tys[j] * d;
      const xa = x - tx, ya = y - ty, xb = x + tx, yb = y + ty;
      const da = C[0] * xa + C[1] * ya + C[2], db = C[0] * xb + C[1] * yb + C[2];
      if (da <= 1e-6 || db <= 1e-6) continue;
      const Xa = (A[0] * xa + A[1] * ya + A[2]) / da, Za = (B[0] * xa + B[1] * ya + B[2]) / da;
      const Xb = (A[0] * xb + A[1] * yb + A[2]) / db, Zb = (B[0] * xb + B[1] * yb + B[2]) / db;
      if (Za > 25000 || Zb > 25000) continue;
      let a = Math.atan2(Zb - Za, Xb - Xa) * 180 / Math.PI;
      a = ((a % 90) + 90) % 90;
      const k = Math.min(BINS - 1, Math.floor(a * 2));
      hist[k] += S.ws[j]; total += S.ws[j];
    }
    /* 1.5도 정도로 부드럽게 (둥글게 이어서) */
    const sm = new Float64Array(BINS), K = [0.05, 0.12, 0.2, 0.26, 0.2, 0.12, 0.05];
    for (let i = 0; i < BINS; i++) { let s = 0; for (let k = -3; k <= 3; k++) s += hist[(i + k + BINS) % BINS] * K[k + 3]; sm[i] = s; }
    let pk = 0;
    for (let i = 1; i < BINS; i++) if (sm[i] > sm[pk]) pk = i;
    const l = sm[(pk - 1 + BINS) % BINS], c = sm[pk], r = sm[(pk + 1) % BINS];
    const off = (l - 2 * c + r) !== 0 ? 0.5 * (l - r) / (l - 2 * c + r) : 0;
    const beta = ((pk + 0.5 + off) / 2 + 90) % 90;
    return { score: total > 0 ? c / total : 0, beta, total };
  }

  /*
    opts: mask, lum (w*h), w, h, W, H (원본 사진 크기), pitch0 (지금 짐작한 앞뒤 기울기), fovAdj
    결과: pitch, roll, beta (바닥 선 방향, 0~90도), score, used (기울기를 바꿨는지)
  */
  function estimate(opts) {
    const { mask, lum, w, h, W, H } = opts;
    const fov = opts.fovAdj || 0, sx = W / w;
    const S = collect(mask, lum, w, h);
    const res = { pitch: opts.pitch0, roll: 0, beta: null, score: 0, used: false, nBoundary: S.nBoundary, nTexture: S.nTexture };
    if (S.ws.length < 30) return res;
    const base = histogram(S, sx, W, H, opts.pitch0, 0, fov);
    res.score = base.score; res.beta = base.beta;
    let best = { pitch: opts.pitch0, roll: 0, h: base };
    const tryP = (p, r) => { const hh = histogram(S, sx, W, H, p, r, fov); if (hh.score > best.h.score) best = { pitch: p, roll: r, h: hh }; };
    const lo = Math.max(4, opts.pitch0 - 25), hi = Math.min(75, opts.pitch0 + 25);
    for (let p = lo; p <= hi; p += 1) tryP(p, 0);
    for (let p = best.pitch - 1; p <= best.pitch + 1; p += 0.25) tryP(p, 0);
    const p1 = best.pitch;
    for (let r = -8; r <= 8; r += 0.5) tryP(p1, r);
    const r1 = best.roll;
    for (let p = p1 - 2; p <= p1 + 2; p += 0.25) tryP(p, r1);
    /* 증거가 충분할 때만 기울기를 바꿈 */
    const minScore = 0.03;
    if (best.h.score >= minScore && best.h.score >= base.score * 1.1) {
      res.pitch = Math.max(4, Math.min(75, best.pitch)); res.roll = best.roll; res.beta = best.h.beta; res.score = best.h.score; res.used = true;
    } else if (base.score < minScore) {
      res.beta = null;
    }
    return res;
  }

  const api = { estimate, collect, histogram, camRows };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FloorOrient = api;
})(typeof window !== "undefined" ? window : this);
