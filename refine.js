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
      /* 삼각대, 의자 다리처럼 가는 물건에 둘러싸여 떨어진 바닥 조각 되살리기
         둘레의 많은 부분(45퍼센트 이상)이 가는 선 하나 건너 남긴 바닥과 맞닿아 있고, 색도 남긴 바닥과 같으면 방 안 바닥
         베란다처럼 유리문 너머 바닥은 한쪽(문턱)만 닿아서 여기 안 걸림 */
      if (opt.enclosed !== false) {
        const dk = distance(keepBin, w, h, 0), rc = Math.max(3, Math.round(0.015 * big));
        const per = new Float64Array(L.n + 1), con = new Float64Array(L.n + 1);
        const cs = new Float64Array((L.n + 1) * 3), cnt = new Float64Array(L.n + 1), dir4 = new Float64Array((L.n + 1) * 4);
        for (let i = 0; i < n; i++) {
          const j = L.lab[i]; if (!j || keep[j]) continue;
          cs[j * 3] += rgba[i * 4]; cs[j * 3 + 1] += rgba[i * 4 + 1]; cs[j * 3 + 2] += rgba[i * 4 + 2]; cnt[j]++;
          const x = i % w;
          const eL = x === 0 || L.lab[i - 1] !== j, eR = x === w - 1 || L.lab[i + 1] !== j, eU = i < w || L.lab[i - w] !== j, eD = i >= n - w || L.lab[i + w] !== j;
          if (!(eL || eR || eU || eD)) continue;
          per[j]++;
          if (dk[i] <= rc) { con[j]++; if (eL) dir4[j * 4]++; if (eR) dir4[j * 4 + 1]++; if (eU) dir4[j * 4 + 2]++; if (eD) dir4[j * 4 + 3]++; }
        }
        /* 남긴 바닥 쪽 색: 조각 바로 바깥 띠에서 */
        const ks = new Float64Array((L.n + 1) * 3), kc = new Float64Array(L.n + 1);
        const dp = new Float32Array(n);
        { const pieceBin = new Uint8Array(n);
          for (let i = 0; i < n; i++) { const j = L.lab[i]; if (j && !keep[j]) pieceBin[i] = 1; }
          const d2 = distance(pieceBin, w, h, 0);
          const owner = new Int32Array(n);
          for (let i = 0; i < n; i++) if (pieceBin[i]) owner[i] = L.lab[i];
          /* 가까운 조각 번호를 바깥으로 퍼뜨림 (두 번 훑기) */
          for (let pass = 0; pass < 2; pass++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const i = pass ? (n - 1 - (y * w + x)) : y * w + x; if (owner[i]) continue;
            const xx = i % w, nb = pass ? [xx < w - 1 ? i + 1 : -1, i < n - w ? i + w : -1] : [xx > 0 ? i - 1 : -1, i >= w ? i - w : -1];
            for (const q of nb) if (q >= 0 && owner[q]) { owner[i] = owner[q]; break; }
          }
          for (let i = 0; i < n; i++) {
            if (!keepBin[i] || d2[i] > 3 * rc) continue; const j = owner[i]; if (!j) continue;
            ks[j * 3] += rgba[i * 4]; ks[j * 3 + 1] += rgba[i * 4 + 1]; ks[j * 3 + 2] += rgba[i * 4 + 2]; kc[j]++;
          }
        }
        for (let j = 1; j <= L.n; j++) {
          if (keep[j] || !per[j] || !cnt[j] || !kc[j]) continue;
          const a = [cs[j * 3] / cnt[j], cs[j * 3 + 1] / cnt[j], cs[j * 3 + 2] / cnt[j]];
          const b = [ks[j * 3] / kc[j], ks[j * 3 + 1] / kc[j], ks[j * 3 + 2] / kc[j]];
          const sa = a[0] + a[1] + a[2] + 1, sb = b[0] + b[1] + b[2] + 1;
          const dl = Math.abs(Math.log(sa / sb)), dc = Math.hypot(a[0] / sa - b[0] / sb, a[2] / sa - b[2] / sb);
          /* 맞닿은 쪽이 두 방향 이상(예: 왼쪽과 아래)이어야 함. 문턱 하나로만 닿은 베란다는 한 방향 */
          let ds = 0; for (let q = 0; q < 4; q++) ds += dir4[j * 4 + q];
          let sides = 0; for (let q = 0; q < 4; q++) if (ds && dir4[j * 4 + q] / ds >= 0.15) sides++;
          if (opt.debug && cnt[j] > 200) (opt.dbgOut = opt.dbgOut || []).push({ j, area: cnt[j], con: +(con[j] / per[j]).toFixed(2), sides, dl: +dl.toFixed(3), dc: +dc.toFixed(4) });
          if (con[j] / per[j] < (opt.enclosedFrac || 0.3) || sides < 2) continue;
          if (dl < 0.25 && dc < 0.025) keep[j] = 3;
        }
        for (let i = 0; i < n; i++) if (L.lab[i] && keep[L.lab[i]] === 3) keepBin[i] = 1;
      }
      // 잘라낸 경계선 자리는 바로 옆 남긴 바닥에 붙여서 되돌리기
      const near = dilate(keepBin, w, h, 3);
      for (let i = 0; i < n; i++) if (!keepBin[i] && m[i] && E[i] && near[i]) keepBin[i] = 1;
      const removed = new Uint8Array(n);
      for (let i = 0; i < n; i++) removed[i] = (m[i] && !keepBin[i]) ? 1 : 0;
      const remNear = dilate(removed, w, h, 2);
      for (let i = 0; i < n; i++) if (remNear[i] && !keepBin[i]) soft[i] = 0;
    }
    /* 5 가는 검은 물건(삼각대 다리, 의자 다리, 전선) 빼기: 둘레 바닥보다 아주 어두운 점은 바닥 아님 */
    /* 여기서 일부러 뺀 곳(걸레받이, 검은 다리)은 block 에 적어 두고, 뒤의 SAM 채우기가 다시 채우지 않게 함 */
    const before = Float32Array.from(soft);
    if (opt.dark !== false && !patterned) darkOut(lum, soft, w, h, big, opt.darkRatio || 0.36);
    /* 6 걸레받이: 바닥 먼 쪽 경계 바로 안쪽에 길게 뻗은 줄(걸레받이 아래 선)이 있으면 그 선까지만 바닥 */
    let skirt = null;
    const block = new Uint8Array(n);
    if (opt.skirt !== false) skirt = snapSkirt(rgba, lum, soft, w, h, opt, llrTab, idx, block);
    for (let i = 0; i < n; i++) if (before[i] > 0.5 && soft[i] < 0.5) block[i] = 1;
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
    return { soft, patterned, edgeFrac: floorPx ? edgeIn / floorPx : 0, skirt, block, dbg: opt.dbgOut };
  }

  function darkOut(lum, soft, w, h, big, ratio) {
    const n = w * h, fl = new Float32Array(n), fv = new Float32Array(n);
    for (let i = 0; i < n; i++) if (soft[i] > 0.5) { fl[i] = 1; fv[i] = lum[i]; }
    const r = Math.max(4, Math.round(0.03 * big));
    const mf = boxMean(fl, w, h, r), mv = boxMean(fv, w, h, r);
    const dark = new Uint8Array(n);
    let cnt = 0;
    for (let i = 0; i < n; i++) {
      if (soft[i] <= 0.5 || mf[i] < 0.05) continue;
      const loc = mv[i] / mf[i];
      if (loc > 0.08 && lum[i] < ratio * loc) { dark[i] = 1; cnt++; }
    }
    /* 어두운 점이 바닥의 6퍼센트를 넘으면 바닥 무늬(검은 타일, 줄눈)로 보고 안 뺌 */
    let fc = 0; for (let i = 0; i < n; i++) if (soft[i] > 0.5) fc++;
    if (!cnt || cnt > 0.06 * fc) return;
    /* 가장자리 섞인 픽셀까지 한 칸 넓혀서 빼고, 그 바깥 한 칸은 반쯤 */
    const d1 = dilate(dark, w, h, 1), d2 = dilate(d1, w, h, 1);
    for (let i = 0; i < n; i++) {
      if (d1[i]) {
        /* 넓힌 칸은 그 칸도 둘레보다 어두울 때만 (밝은 바닥까지 먹지 않게) */
        if (dark[i]) soft[i] = 0;
        else { const loc = mv[i] / Math.max(1e-3, mf[i]); if (lum[i] < 0.8 * loc) soft[i] = 0; else soft[i] = Math.min(soft[i], 0.5); }
      } else if (d2[i]) {
        const loc = mv[i] / Math.max(1e-3, mf[i]); if (lum[i] < 0.75 * loc) soft[i] = Math.min(soft[i], 0.5);
      }
    }
  }

  /* 걸레받이 맞추기
     열마다 바닥 위쪽 경계(ytop) 바로 아래 띠에서 세로로 밝기, 색이 확 바뀌는 줄을 찾고,
     그 점들이 길게 한 직선으로 이어지면(사진 폭의 6퍼센트 이상) 걸레받이 아래 선으로 봄
     선 위쪽 띠가 선 아래 바닥과 색이 다르거나 선 자체가 어두운 틈일 때만 잘라냄 (줄눈 같은 바닥 무늬는 안 자름) */
  function snapSkirt(rgba, lum, soft, w, h, opt, llrTab, idx, blk) {
    const n = w * h, B = Math.max(4, Math.round((opt.skirtFrac || 0.05) * h));
    const cb = new Float32Array(n), cg = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], s = r + g + b + 1;
      cb[i] = (b - r) / s; cg[i] = (g - (r + b) / 2) / s;
    }
    const ytop = new Int32Array(w).fill(-1);
    for (let x = 0; x < w; x++) {
      for (let y = 1; y < h - B; y++) {
        const i = y * w + x;
        if (soft[i] > 0.5 && soft[i - w] <= 0.5) {
          /* 아래로 B 이상 바닥이 이어지는 첫 경계 */
          let ok = true; for (let k = 1; k <= B; k += 2) if (soft[i + k * w] <= 0.5) { ok = false; break; }
          if (ok) { ytop[x] = y; break; }
        }
      }
    }
    const pts = [];
    const val = (i) => [lum[i], cb[i] * 3, cg[i] * 3];
    for (let x = 0; x < w; x++) {
      const y0 = ytop[x]; if (y0 < 0) continue;
      let best = 0, by = -1;
      for (let y = y0 + 4; y < y0 + B && y < h - 3; y++) {
        let d = 0;
        for (let c = 0; c < 3; c++) {
          const a = val((y - 2) * w + x)[c] + val((y - 1) * w + x)[c], b = val((y + 1) * w + x)[c] + val((y + 2) * w + x)[c];
          d += ((a - b) / 2) ** 2;
        }
        /* 어두운 틈(가운데가 위아래보다 어두움)도 강하게 봄 */
        const dip = Math.max(0, Math.min(lum[(y - 2) * w + x], lum[(y + 2) * w + x]) - lum[y * w + x]);
        d = Math.sqrt(d) + 1.5 * dip;
        if (d > best) { best = d; by = y; }
      }
      if (by > 0 && best > (opt.skirtEdge || 0.03)) pts.push([x, by, best]);
    }
    if (pts.length < 0.05 * w) return null;
    /* 허프: 기울기 -0.8..0.8 */
    const segs = [], used = new Uint8Array(pts.length);
    for (let round = 0; round < 6; round++) {
      let bestS = null;
      for (let si = -40; si <= 40; si++) {
        const sl = si * 0.02, acc = new Map();
        for (let k = 0; k < pts.length; k++) {
          if (used[k]) continue;
          const c = Math.round((pts[k][1] - sl * pts[k][0]) / 2);
          acc.set(c, (acc.get(c) || 0) + 1);
        }
        for (const [c, v] of acc) if (!bestS || v > bestS.v) bestS = { sl, c: c * 2, v };
      }
      if (!bestS || bestS.v < 0.05 * w) break;
      /* 직선 근처 점 모아서 다시 맞추고 끊긴 곳 나누기 */
      const inl = [];
      for (let k = 0; k < pts.length; k++) if (!used[k] && Math.abs(pts[k][1] - (bestS.sl * pts[k][0] + bestS.c)) <= 2.5) inl.push(k);
      inl.sort((a, b) => pts[a][0] - pts[b][0]);
      const gap = Math.max(4, 0.03 * w);
      let run = [];
      const flush = () => {
        if (run.length >= 0.06 * w) {
          let sx = 0, sy = 0, sxx = 0, sxy = 0;
          for (const k of run) { const [x, y] = pts[k]; sx += x; sy += y; sxx += x * x; sxy += x * y; }
          const m = run.length, den = m * sxx - sx * sx, a = den ? (m * sxy - sx * sy) / den : 0, b = (sy - a * sx) / m;
          segs.push({ x0: pts[run[0]][0], x1: pts[run[run.length - 1]][0], a, b, m });
        }
        for (const k of run) used[k] = 1;
        run = [];
      };
      for (const k of inl) { if (run.length && pts[k][0] - pts[run[run.length - 1]][0] > gap) flush(); run.push(k); }
      flush();
      for (const k of inl) used[k] = 1;
    }
    let cutPx = 0; const info = [];
    for (const s of segs) {
      /* 확인: 선 위 띠(걸레받이)와 선 아래 바닥 색 비교, 선이 어두운 틈인지 */
      let ua = [0, 0, 0], da = [0, 0, 0], uc = 0, dc = 0, line = 0, side = 0, lc = 0, hsum = 0, hc = 0, hsq = 0, ul = 0, dl2 = 0;
      for (let x = s.x0; x <= s.x1; x++) {
        const y0 = ytop[x]; if (y0 < 0) continue;
        const yl = Math.round(s.a * x + s.b); if (yl <= y0 + 1 || yl >= y0 + B + 2) continue;
        const hh = yl - y0; hsum += hh; hsq += hh * hh; hc++;
        for (let y = y0 + 1; y < yl - 1; y++) { const v = val(y * w + x); for (let c = 0; c < 3; c++) ua[c] += v[c]; ul += llrTab[idx[y * w + x]]; uc++; }
        for (let y = yl + 2; y < Math.min(h, yl + 2 + Math.max(3, hh)); y++) { const v = val(y * w + x); for (let c = 0; c < 3; c++) da[c] += v[c]; dl2 += llrTab[idx[y * w + x]]; dc++; }
        line += lum[yl * w + x]; side += (lum[Math.max(0, yl - 2) * w + x] + lum[Math.min(h - 1, yl + 2) * w + x]) / 2; lc++;
      }
      if (!uc || !dc || !hc) continue;
      for (let c = 0; c < 3; c++) { ua[c] /= uc; da[c] /= dc; }
      const diff = Math.hypot(ua[0] - da[0], ua[1] - da[1], ua[2] - da[2]);
      const dip = (side - line) / lc;
      /* 걸레받이는 위아래 테두리가 나란해서 띠 높이가 고르게 나옴. 들쭉날쭉하면 걸레받이가 아님 */
      const hm = hsum / hc, hs = Math.sqrt(Math.max(0, hsq / hc - hm * hm));
      /* 띠와 바닥 색 차이가 뚜렷해야 함 (나뭇결, 줄눈, 창가 반사 같은 바닥 무늬는 차이가 작아서 안 걸림), 띠 높이는 사진 높이의 3.5퍼센트까지 */
      const lu = ul / uc, ld = dl2 / dc;
      const ok = diff > (opt.skirtDiff || 0.1) && hs <= Math.max(1.5, 0.2 * hm) && hc >= 0.7 * (s.x1 - s.x0 + 1)
        && hm <= 0.035 * h;
      info.push({ x0: s.x0, x1: s.x1, hgt: +hm.toFixed(1), hs: +hs.toFixed(1), diff: +diff.toFixed(3), lu: +lu.toFixed(2), ld: +ld.toFixed(2), ok });
      if (!ok) continue;
      for (let x = s.x0; x <= s.x1; x++) {
        const y0 = ytop[x]; if (y0 < 0) continue;
        const yl = s.a * x + s.b; if (yl <= y0 + 1 || yl >= y0 + B + 2) continue;
        /* 걸레받이 위쪽(벽 쪽)도 SAM 이 다시 채우지 못하게 표시 */
        if (blk) for (let y = Math.max(0, y0 - 2 * B); y < Math.floor(yl); y++) blk[y * w + x] = 1;
        for (let y = Math.max(0, y0 - 2); y < Math.ceil(yl) + 1 && y < h; y++) {
          const i = y * w + x, t = Math.min(1, Math.max(0, y - yl)); /* 선 바로 아래 한 칸은 반쯤 */
          const v = y < yl ? 0 : t * soft[i];
          if (v < soft[i]) { soft[i] = v; cutPx++; }
        }
      }
    }
    return { segs: info, cutPx };
  }

  /* 마지막 단계: 다듬은 바닥 범위(작은 크기)를 원본 사진 크기로 키우면서 사진의 밝기 경계에 딱 붙임
     경계 근처 띠에서만 guided filter 를 돌리고, 경계를 조금 더 또렷하게 세움 */
  function upscale(rgba, W, H, low, lw, lh, opt) {
    opt = opt || {};
    const N = W * H, p = new Float32Array(N), I = new Float32Array(N);
    for (let y = 0; y < H; y++) {
      const sy = Math.max(0, Math.min(lh - 1, (y + 0.5) * lh / H - 0.5)), y0 = Math.floor(sy), y1 = Math.min(lh - 1, y0 + 1), fy = sy - y0;
      for (let x = 0; x < W; x++) {
        const sx = Math.max(0, Math.min(lw - 1, (x + 0.5) * lw / W - 0.5)), x0 = Math.floor(sx), x1 = Math.min(lw - 1, x0 + 1), fx = sx - x0;
        p[y * W + x] = (low[y0 * lw + x0] * (1 - fx) + low[y0 * lw + x1] * fx) * (1 - fy) + (low[y1 * lw + x0] * (1 - fx) + low[y1 * lw + x1] * fx) * fy;
      }
    }
    for (let i = 0; i < N; i++) I[i] = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) / 255;
    const big = Math.max(W, H), r = Math.max(2, Math.round((opt.rFrac || 0.004) * big));
    const q = guided(I, p, W, H, r, opt.eps || 4e-4);
    const out = new Float32Array(N), k = opt.sharp || 2.5;
    for (let i = 0; i < N; i++) {
      const v = p[i];
      if (v <= 0.01 || v >= 0.99) { out[i] = v < 0.5 ? 0 : 1; continue; }
      /* 경계 띠: 사진 경계를 따른 값으로, 너무 멀리 번지지는 않게 원래 값과 반반 섞은 뒤 또렷하게 */
      const g = Math.min(1, Math.max(0, q[i])) * 0.7 + v * 0.3;
      out[i] = Math.min(1, Math.max(0, (g - 0.5) * k + 0.5));
    }
    return out;
  }

  const api = { refine, guided, boxMean, label, upscale };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FloorRefine = api;
})(typeof window !== "undefined" ? window : this);
