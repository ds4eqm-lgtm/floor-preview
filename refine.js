/* 바닥 누끼 다듬기
   AI가 낮은 해상도로 찾은 바닥 확률(prior)을 원본 사진에 맞춰 다듬는다.
   1 경계 근처에서는 바닥 색과 벽, 문 색을 비교해서 다시 판단
   2 사진의 밝기 경계에 맞춰 붙이는 guided filter
   3 유리문 너머 베란다처럼 굵은 경계선 건너편에 따로 떨어진 바닥 제거
     (opt.open 이 있으면 AI가 본 창문, 문, 바깥 풍경 확률로 방 안 바닥 조각은 지켜줌)
   4 자잘한 구멍 메우기
   입력 rgba: Uint8ClampedArray (w*h*4), prior: Float32Array (w*h, 0..1)
   출력: Float32Array (w*h, 0..1) */
(function (root) {
  "use strict";

  function boxMean(src, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    const line = new Float64Array(Math.max(w, h) + 1);
    for (let y = 0; y < h; y++) {
      const o = y * w;
      line[0] = 0;
      for (let x = 0; x < w; x++) line[x + 1] = line[x] + src[o + x];
      for (let x = 0; x < w; x++) {
        const a = Math.max(0, x - r), b = Math.min(w - 1, x + r);
        tmp[o + x] = (line[b + 1] - line[a]) / (b - a + 1);
      }
    }
    for (let x = 0; x < w; x++) {
      line[0] = 0;
      for (let y = 0; y < h; y++) line[y + 1] = line[y] + tmp[y * w + x];
      for (let y = 0; y < h; y++) {
        const a = Math.max(0, y - r), b = Math.min(h - 1, y + r);
        out[y * w + x] = (line[b + 1] - line[a]) / (b - a + 1);
      }
    }
    return out;
  }

  function guided(I, p, w, h, r, eps) {
    const n = w * h, Ip = new Float32Array(n), II = new Float32Array(n);
    for (let i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
    const mI = boxMean(I, w, h, r), mp = boxMean(p, w, h, r);
    const mIp = boxMean(Ip, w, h, r), mII = boxMean(II, w, h, r);
    const a = new Float32Array(n), b = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const cov = mIp[i] - mI[i] * mp[i], v = mII[i] - mI[i] * mI[i];
      a[i] = cov / (v + eps); b[i] = mp[i] - a[i] * mI[i];
    }
    const ma = boxMean(a, w, h, r), mb = boxMean(b, w, h, r);
    const q = new Float32Array(n);
    for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
    return q;
  }

  /* 두 번 훑는 chamfer 거리 (픽셀 단위 근사) */
  function distance(mask, w, h, inside) {
    const INF = 1e9, d = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) d[i] = (mask[i] === inside) ? INF : 0;
    const A = 1, B = 1.4142;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; let v = d[i]; if (!v) continue;
      if (x > 0) v = Math.min(v, d[i - 1] + A);
      if (y > 0) {
        v = Math.min(v, d[i - w] + A);
        if (x > 0) v = Math.min(v, d[i - w - 1] + B);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + B);
      }
      d[i] = v;
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x; let v = d[i]; if (!v) continue;
      if (x < w - 1) v = Math.min(v, d[i + 1] + A);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + A);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + B);
        if (x > 0) v = Math.min(v, d[i + w - 1] + B);
      }
      d[i] = v;
    }
    return d;
  }

  function smoothHist(hst) {
    const N = 16, out = new Float64Array(hst.length), t = new Float64Array(hst.length);
    const pass = (src, dst, stride) => {
      for (let i = 0; i < src.length; i++) {
        const c = Math.floor(i / stride) % N;
        let s = src[i], k = 1;
        if (c > 0) { s += src[i - stride]; k++; }
        if (c < N - 1) { s += src[i + stride]; k++; }
        dst[i] = s / k;
      }
    };
    pass(hst, t, 1); pass(t, out, N); pass(out, t, N * N);
    return t;
  }

  /* 4방향 연결 영역 번호 매기기 */
  function label(bin, w, h) {
    const lab = new Int32Array(w * h), stack = new Int32Array(w * h), areas = [0];
    let n = 0;
    for (let s = 0; s < w * h; s++) {
      if (!bin[s] || lab[s]) continue;
      n++; let top = 0, area = 0; stack[top++] = s; lab[s] = n;
      while (top) {
        const i = stack[--top]; area++;
        const x = i % w;
        if (x > 0 && bin[i - 1] && !lab[i - 1]) { lab[i - 1] = n; stack[top++] = i - 1; }
        if (x < w - 1 && bin[i + 1] && !lab[i + 1]) { lab[i + 1] = n; stack[top++] = i + 1; }
        if (i >= w && bin[i - w] && !lab[i - w]) { lab[i - w] = n; stack[top++] = i - w; }
        if (i < w * (h - 1) && bin[i + w] && !lab[i + w]) { lab[i + w] = n; stack[top++] = i + w; }
      }
      areas.push(area);
    }
    return { lab, n, areas };
  }

  function dilate(bin, w, h, it) {
    let a = bin;
    for (let k = 0; k < it; k++) {
      const b = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        if (a[i]) { b[i] = 1; continue; }
        const x = i % w;
        if ((x > 0 && a[i - 1]) || (x < w - 1 && a[i + 1]) || (i >= w && a[i - w]) || (i < w * (h - 1) && a[i + w])) b[i] = 1;
      }
      a = b;
    }
    return a;
  }

  function refine(rgba, w, h, prior, opt) {
    opt = opt || {};
    const n = w * h, big = Math.max(w, h);
    const lum = new Float32Array(n), idx = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
      lum[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      idx[i] = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    }
    /* 1 색 비교: 확실한 바닥과 확실한 바닥 아닌 곳의 색 분포 */
    let hf = new Float64Array(4096), hb = new Float64Array(4096);
    for (let i = 0; i < n; i++) {
      if (prior[i] > 0.85) hf[idx[i]]++; else if (prior[i] < 0.15) hb[idx[i]]++;
    }
    hf = smoothHist(hf); hb = smoothHist(hb);
    let sf = 0, sb = 0;
    for (let i = 0; i < 4096; i++) { sf += hf[i]; sb += hb[i]; }
    const llrTab = new Float32Array(4096);
    for (let i = 0; i < 4096; i++) {
      const v = Math.log(((hf[i] + 0.5) / (sf + 2048)) / ((hb[i] + 0.5) / (sb + 2048)));
      llrTab[i] = Math.max(-6, Math.min(6, v));
    }
    const hard = new Uint8Array(n);
    for (let i = 0; i < n; i++) hard[i] = prior[i] > 0.5 ? 1 : 0;
    const dIn = distance(hard, w, h, 1), dOut = distance(hard, w, h, 0);
    const bandW = (opt.bandFrac || 0.06) * big, k = opt.k == null ? 0.8 : opt.k;
    const post = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const dist = hard[i] ? dIn[i] : dOut[i];
      const band = Math.max(0, 1 - dist / bandW);
      const p = Math.min(0.98, Math.max(0.02, prior[i]));
      const lg = Math.log(p / (1 - p)) + k * band * llrTab[idx[i]];
      post[i] = 1 / (1 + Math.exp(-lg));
    }
    /* 2 사진 경계에 맞추기 */
    const r = Math.max(2, Math.round((opt.rFrac || 0.012) * big)), eps = opt.eps || 1e-3;
    let q = guided(lum, post, w, h, r, eps);
    for (let i = 0; i < n; i++) q[i] = Math.min(1, Math.max(0, q[i]));
    q = guided(lum, q, w, h, Math.max(1, r >> 1), eps);
    const soft = new Float32Array(n);
    for (let i = 0; i < n; i++) soft[i] = Math.min(1, Math.max(0, (q[i] - 0.4) / 0.2));

    /* 3 따로 떨어진 바닥 정리 */
    const m = new Uint8Array(n);
    for (let i = 0; i < n; i++) m[i] = soft[i] > 0.5 ? 1 : 0;
    // 밝기 경계(sobel)
    const sm = new Float32Array(n), t1 = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, l = x > 0 ? lum[i - 1] : lum[i], rr = x < w - 1 ? lum[i + 1] : lum[i];
      t1[i] = (l + 2 * lum[i] + rr) / 4;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, u = y > 0 ? t1[i - w] : t1[i], d = y < h - 1 ? t1[i + w] : t1[i];
      sm[i] = (u + 2 * t1[i] + d) / 4;
    }
    const thr = opt.edgeThr || 0.10, E0 = new Uint8Array(n);
    let edgeIn = 0, floorPx = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const xm = x > 0 ? -1 : 0, xp = x < w - 1 ? 1 : 0, ym = y > 0 ? -w : 0, yp = y < h - 1 ? w : 0;
      const gx = (sm[i + ym + xp] + 2 * sm[i + xp] + sm[i + yp + xp]) - (sm[i + ym + xm] + 2 * sm[i + xm] + sm[i + yp + xm]);
      const gy = (sm[i + yp + xm] + 2 * sm[i + yp] + sm[i + yp + xp]) - (sm[i + ym + xm] + 2 * sm[i + ym] + sm[i + ym + xp]);
      if (Math.hypot(gx, gy) / 8 > thr) { E0[i] = 1; if (m[i]) edgeIn++; }
      if (m[i]) floorPx++;
    }
    const patterned = floorPx > 0 && edgeIn / floorPx > (opt.patternFrac || 0.05);
    const keepBin = new Uint8Array(n);
    const bottomY = Math.floor(h * 0.88);
    const E = dilate(E0, w, h, 1);
    const cut = new Uint8Array(n);
    for (let i = 0; i < n; i++) cut[i] = (m[i] && !(patterned ? 0 : E[i])) ? 1 : 0;
    const L = label(cut, w, h);
    if (L.n) {
      let maxA = 0;
      for (let j = 1; j <= L.n; j++) maxA = Math.max(maxA, L.areas[j]);
      const keep = new Uint8Array(L.n + 1);
      for (let i = bottomY * w; i < n; i++) if (L.lab[i]) keep[L.lab[i]] = 1;
      for (let j = 1; j <= L.n; j++) if (L.areas[j] >= 0.3 * maxA) keep[j] = 1;
      /* 안전장치: AI가 창문, 문, 바깥 풍경이 둘레에 거의 없다고 본 중간 크기 조각은 방 안 바닥(햇빛 든 자리 등)이라 남김 */
      if (opt.open) {
        const x0 = new Int32Array(L.n + 1).fill(w), x1 = new Int32Array(L.n + 1).fill(-1);
        const y0 = new Int32Array(L.n + 1).fill(h), y1 = new Int32Array(L.n + 1).fill(-1);
        for (let i = 0; i < n; i++) {
          const j = L.lab[i]; if (!j) continue;
          const x = i % w, y = (i / w) | 0;
          if (x < x0[j]) x0[j] = x; if (x > x1[j]) x1[j] = x; if (y < y0[j]) y0[j] = y; if (y > y1[j]) y1[j] = y;
        }
        const rr = Math.max(3, Math.round(0.02 * big));
        for (let j = 1; j <= L.n; j++) {
          if (keep[j] || L.areas[j] < 0.05 * maxA) continue;
          let sum = 0, cnt = 0;
          const X0 = Math.max(0, x0[j] - rr), X1 = Math.min(w - 1, x1[j] + rr), Y0 = Math.max(0, y0[j] - rr), Y1 = Math.min(h - 1, y1[j] + rr);
          for (let y = Y0; y <= Y1; y += 2) for (let x = X0; x <= X1; x += 2) {
            const i = y * w + x; if (L.lab[i] === j) continue;
            let near = false;
            for (let dy = -rr; dy <= rr && !near; dy += rr) for (let dx = -rr; dx <= rr; dx += rr) {
              const yy = y + dy, xx = x + dx;
              if (yy >= 0 && yy < h && xx >= 0 && xx < w && L.lab[yy * w + xx] === j) { near = true; break; }
            }
            if (near) { sum += opt.open[i]; cnt++; }
          }
          if (cnt && sum / cnt < (opt.openKeep || 0.1)) keep[j] = 1;
        }
      }
      for (let i = 0; i < n; i++) if (keep[L.lab[i]] && L.lab[i]) keepBin[i] = 1;
      // 바닥 안쪽 조각(무늬, 그림자, 햇빛 경계 때문에 끊긴 것)은 되살리기
      // 조각 가운데서 상하좌우로 나가 봤을 때 3방향 이상에서 남긴 바닥을 만나면 바닥 안쪽 조각
      const reach0 = Math.round(0.06 * big);
      const sx = new Float64Array(L.n + 1), sy = new Float64Array(L.n + 1);
      for (let i = 0; i < n; i++) { const j = L.lab[i]; if (j) { sx[j] += i % w; sy[j] += (i / w) | 0; } }
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (let j = 1; j <= L.n; j++) {
        if (keep[j]) continue;
        /* 크기와 상관없이 3방향 이상이 남긴 바닥에 막혀 있으면 방 안 조각 (햇빛 든 자리, 그림자 경계로 잘린 곳) */
        const reach = Math.max(reach0, Math.round(Math.sqrt(L.areas[j]) * 1.2));
        const cx = Math.round(sx[j] / L.areas[j]), cy = Math.round(sy[j] / L.areas[j]);
        let hits = 0;
        for (const [dx, dy] of dirs) {
          let x = cx, y = cy;
          for (let s = 0; s < reach; s++) {
            x += dx; y += dy;
            if (x < 0 || y < 0 || x >= w || y >= h) break;
            const i = y * w + x;
            if (keepBin[i]) { hits++; break; }
            if (!m[i] && !E[i]) break;
          }
        }
        if (hits >= 3) keep[j] = 2;
      }
      for (let i = 0; i < n; i++) if (L.lab[i] && keep[L.lab[i]] === 2) keepBin[i] = 1;
      // 잘라낸 경계선 자리는 바로 옆 남긴 바닥에 붙여서 되돌리기
      const near = dilate(keepBin, w, h, 3);
      for (let i = 0; i < n; i++) if (!keepBin[i] && m[i] && E[i] && near[i]) keepBin[i] = 1;
      const removed = new Uint8Array(n);
      for (let i = 0; i < n; i++) removed[i] = (m[i] && !keepBin[i]) ? 1 : 0;
      const remNear = dilate(removed, w, h, 2);
      for (let i = 0; i < n; i++) if (remNear[i] && !keepBin[i]) soft[i] = 0;
    }
    /* 4 작은 구멍 메우기 */
    const holes = new Uint8Array(n);
    for (let i = 0; i < n; i++) holes[i] = soft[i] > 0.5 ? 0 : 1;
    const H2 = label(holes, w, h);
    if (H2.n) {
      const border = new Uint8Array(H2.n + 1);
      for (let x = 0; x < w; x++) { border[H2.lab[x]] = 1; border[H2.lab[(h - 1) * w + x]] = 1; }
      for (let y = 0; y < h; y++) { border[H2.lab[y * w]] = 1; border[H2.lab[y * w + w - 1]] = 1; }
      const lim = (opt.holeFrac || 0.0015) * n;
      for (let i = 0; i < n; i++) {
        const j = H2.lab[i];
        if (j && !border[j] && H2.areas[j] < lim) soft[i] = 1;
      }
    }
    return { soft, patterned, edgeFrac: floorPx ? edgeIn / floorPx : 0 };
  }

  const api = { refine, guided, boxMean, label };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FloorRefine = api;
})(typeof window !== "undefined" ? window : this);
