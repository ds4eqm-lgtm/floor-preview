/* 사진 축척 맞추기
   1 사진 파일 속 촬영 정보(EXIF)에서 35mm 환산 초점거리를 읽어 화각을 맞춤 (광각 0.5배, 2배 줌 사진도 맞게)
   2 사진에 보이는 천장선(바닥에서 2.3m)과 문 윗선(2.1m)으로 카메라 높이를 거꾸로 계산
     벽 밑선에서 똑바로 위로 올라가다 천장을 만나는 높이 비율을 재면, 카메라 높이를 몰라도 축척이 정해짐
   천장도 문도 안 보이면 보통 사람이 들고 찍는 높이 1.4m로 둠 */
(function (root) {
  "use strict";

  /* ---------- EXIF 초점거리 ---------- */
  /* JPEG, HEIC 둘 다 파일 안에 "Exif\0\0" 다음에 TIFF 머리(II*\0 또는 MM\0*)가 들어 있어서 그걸 찾아 읽음 */
  function exifInfo(buf) {
    try {
      const b = new Uint8Array(buf), n = b.length;
      for (let i = 0; i + 14 < n; i++) {
        if (b[i] !== 0x45 || b[i + 1] !== 0x78 || b[i + 2] !== 0x69 || b[i + 3] !== 0x66 || b[i + 4] !== 0 || b[i + 5] !== 0) continue;
        const t = i + 6;
        const le = b[t] === 0x49 && b[t + 1] === 0x49 && b[t + 2] === 0x2a && b[t + 3] === 0;
        const be = b[t] === 0x4d && b[t + 1] === 0x4d && b[t + 2] === 0 && b[t + 3] === 0x2a;
        if (!le && !be) continue;
        const r = readTiff(b, t, le);
        if (r) return r;
      }
    } catch (e) { /* 읽을 수 없으면 정보 없음 */ }
    return null;
  }
  function readTiff(b, t, le) {
    const n = b.length;
    const u16 = o => (o < 0 || o + 2 > n) ? NaN : (le ? b[o] | b[o + 1] << 8 : b[o] << 8 | b[o + 1]);
    const u32 = o => (o < 0 || o + 4 > n) ? NaN : (le ? (b[o] | b[o + 1] << 8 | b[o + 2] << 16) + b[o + 3] * 16777216 : b[o] * 16777216 + (b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]));
    const ifd = off => {
      const p = t + off, cnt = u16(p), out = {};
      if (!(cnt > 0 && cnt < 500)) return out;
      for (let k = 0; k < cnt; k++) {
        const e = p + 2 + k * 12, tag = u16(e), type = u16(e + 2), c = u32(e + 4);
        if (Number.isNaN(tag)) break;
        let v = null;
        if (type === 3) v = u16(e + 8);
        else if (type === 4) v = u32(e + 8);
        else if (type === 5 || type === 10) { const o = t + u32(e + 8); const num = u32(o), den = u32(o + 4); v = den ? num / den : NaN; }
        else if ((type === 11 || type === 12) && c === 1) { const o = type === 11 ? e + 8 : t + u32(e + 8), len = type === 11 ? 4 : 8; if (o >= 0 && o + len <= n) { const dv = new DataView(b.buffer, b.byteOffset + o, len); v = type === 11 ? dv.getFloat32(0, le) : dv.getFloat64(0, le); } }
        else if (type === 2) { const o = c <= 4 ? e + 8 : t + u32(e + 8); let s = ""; for (let q = 0; q < Math.min(c, 64); q++) { const ch = b[o + q]; if (!ch) break; s += String.fromCharCode(ch); } v = s.trim(); }
        out[tag] = v;
      }
      return out;
    };
    const d0 = ifd(u32(t + 4));
    const exOff = d0[0x8769];
    const ex = exOff ? ifd(exOff) : {};
    const info = { make: d0[0x010f] || "", model: d0[0x0110] || "", f35: null, f: null };
    const f35 = ex[0xa405];
    if (f35 > 0) info.f35 = f35;
    const f = ex[0x920a];
    if (f > 0) info.f = f;
    /* 35mm 환산값이 없으면 센서 해상도 정보로 계산 */
    if (!info.f35 && info.f && ex[0xa20e] > 0 && ex[0xa002] > 0 && ex[0xa003] > 0) {
      const unit = { 2: 25.4, 3: 10, 4: 1, 5: 0.001 }[ex[0xa210] || 2] || 25.4;
      const sw = ex[0xa002] / ex[0xa20e] * unit, sh = ex[0xa003] / (ex[0xa20f] || ex[0xa20e]) * unit;
      const diag = Math.hypot(sw, sh);
      if (diag > 1 && diag < 60) info.f35 = info.f * 43.2666 / diag;
    }
    return (info.f35 || info.f || info.make) ? info : null;
  }
  /* 35mm 환산 초점거리 → (초점거리 픽셀 수 ÷ 사진 긴 변). 35mm 환산은 대각선 43.27mm 기준
     폰은 4:3 센서를 그대로 쓰거나 위아래만 잘라 16:9로 저장하는데, 환산값은 렌즈마다 고정으로 적힘
     그래서 4:3 ~ 16:9 사진은 긴 변 기준 4:3 대각선(긴 변의 1.25배)으로 계산 */
  function focalFactor(f35, W, H) {
    if (!(f35 >= 10 && f35 <= 300)) return null;
    const ar = Math.max(W, H) / Math.max(1, Math.min(W, H));
    const dl = ar >= 1.3 && ar <= 1.8 ? 1.25 : Math.hypot(W, H) / Math.max(W, H);
    return f35 / 43.2666 * dl;
  }

  /* ---------- 카메라 (index.html 의 homography 와 같은 식) ---------- */
  function camera(W, H, f, pitchDeg, rollDeg) {
    const cx = W / 2, cy = H / 2, th = pitchDeg * Math.PI / 180, ct = Math.cos(th), st = Math.sin(th);
    const r = (rollDeg || 0) * Math.PI / 180, cr = Math.cos(r), sr = Math.sin(r);
    return {
      /* 사진 한 점 → 바닥 위 위치 (카메라 높이를 1로 본 단위) */
      toFloor(u, v) {
        const du = u - cx, dv = v - cy, U = cr * du - sr * dv, V = sr * du + cr * dv;
        const down = V / f * ct + st, fwd = ct - V / f * st;
        if (down <= 1e-6) return null;
        return [(U / f) / down, fwd / down];
      },
      /* 바닥 위 (X, 높이 Y, Z) 점 → 사진 위치 (단위는 카메라 높이) */
      project(X, Y, Z) {
        const down = 1 - Y, yc = down * ct - Z * st, zc = down * st + Z * ct;
        if (zc <= 1e-6) return null;
        const U = f * X / zc, V = f * yc / zc;
        return [cx + cr * U + sr * V, cy - sr * U + cr * V];
      }
    };
  }

  function sampler(arr, w, h, W, H) {
    const kx = w / W, ky = h / H;
    return (u, v) => {
      const x = Math.max(0, Math.min(w - 1.001, u * kx - 0.5)), y = Math.max(0, Math.min(h - 1.001, v * ky - 0.5));
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
      return (arr[i] * (1 - fx) + arr[i + 1] * fx) * (1 - fy) + (arr[i + w] * (1 - fx) + arr[i + w + 1] * fx) * fy;
    };
  }

  /* ---------- 카메라 높이 ----------
     opts: mask(바닥 0~1, mw*mh), mw, mh, sem {ceil, wall, door, w, h} (AI가 본 천장, 벽, 문 확률),
           W, H (사진 크기), f (초점거리 픽셀), pitch, roll, prior (기본 높이 mm) */
  function cameraHeight(o) {
    const prior = o.prior || 1400, Hc = o.ceilingMM || 2300, Hd = o.doorMM || 2100;
    const out = { camH: prior, n: 0, ceil: 0, door: 0, raw: null, src: "기본" };
    const sem = o.sem;
    if (!sem || !sem.ceil || !sem.wall || !o.mask) return out;
    const { mask, mw, mh, W, H } = o;
    const cam = camera(W, H, o.f, o.pitch, o.roll);
    const ceil = sampler(sem.ceil, sem.w, sem.h, W, H), wall = sampler(sem.wall, sem.w, sem.h, W, H);
    const door = sem.door ? sampler(sem.door, sem.w, sem.h, W, H) : () => 0;
    let cand = [];
    const cols = Math.min(mw, 120), lift = H * 0.02, step = 0.005;
    for (let i = 0; i < cols; i++) {
      const x = Math.min(mw - 1, Math.floor((i + 0.5) * mw / cols));
      /* 위에서부터 처음 나오는 바닥 경계 (아래 몇 줄이 계속 바닥) */
      let yf = -1;
      for (let y = 1; y < mh - 3; y++) {
        if (mask[y * mw + x] > 0.5 && mask[(y - 1) * mw + x] <= 0.5 && mask[(y + 1) * mw + x] > 0.5 && mask[(y + 2) * mw + x] > 0.5) { yf = y; break; }
      }
      if (yf < 1) continue;
      const a = mask[(yf - 1) * mw + x], bb = mask[yf * mw + x];
      const yb = (yf - 1) + (0.5 - a) / Math.max(1e-6, bb - a) + 0.5;
      const u = (x + 0.5) * W / mw, v = yb * H / mh;
      if (v - lift < 0) continue;
      const fl = cam.toFloor(u, v);
      if (!fl || !(fl[1] > 0)) continue;
      /* 경계 바로 위가 벽이면 천장까지, 문이면 문 윗선까지 */
      const wA = wall(u, v - lift), dA = door(u, v - lift);
      const kind = wA > 0.5 ? 1 : (dA > 0.5 ? 2 : 0);
      if (!kind) continue;
      let prev = null, found = null, wsum = 0, wn = 0;
      /* 바닥(높이 0)에서 시작. 문은 아래쪽 경계가 흐릿해서 조금 위에서 시작 */
      for (let e = kind === 1 ? 0.02 : 0.15; e <= 4; e += step) {
        const pt = cam.project(fl[0], e, fl[1]);
        if (!pt) break;
        const pu = pt[0], pv = pt[1];
        if (pu < 0 || pu >= W || pv < 0 || pv >= H) break;
        if (kind === 1) {
          const cp = ceil(pu, pv);
          if (cp > 0.5) { const p0 = prev == null ? 0 : prev; found = e - step + step * (0.5 - p0) / Math.max(1e-6, cp - p0); break; }
          prev = cp; wsum += wall(pu, pv); wn++;
        } else {
          const dp = door(pu, pv);
          if (dp < 0.5) { const p0 = prev == null ? 1 : prev; found = e - step + step * (p0 - 0.5) / Math.max(1e-6, p0 - dp); break; }
          prev = dp;
        }
      }
      if (found == null) continue;
      if (kind === 1) {
        if (wn < 8 || wsum / wn < 0.55) continue;
        /* 진짜 천장이면 만난 점 위로도 계속 천장 (벽에 붙은 흰 에어컨 같은 건 위로 가면 다시 벽) */
        let cs = 0, cn = 0;
        for (let e = found + 0.02; e <= found + 0.4; e += 0.02) {
          const pt = cam.project(fl[0], e, fl[1]);
          if (!pt || pt[0] < 0 || pt[0] >= W || pt[1] < 0 || pt[1] >= H) break;
          cs += ceil(pt[0], pt[1]); cn++;
        }
        if (cn < 4 || cs / cn < 0.6) continue;
        const h = Hc / found;
        if (h > 600 && h < 2200) cand.push([h, 1]);
      } else {
        if (found < 1) continue;
        const h = Hd / found;
        if (h > 600 && h < 2000) cand.push([h, 0.6]);
      }
    }
    out.ceil = cand.filter(c => c[1] === 1).length;
    out.door = cand.length - out.ceil;
    out.n = cand.length;
    /* 천장이 충분히 보이면 천장만 씀 (천장 높이가 문보다 집마다 덜 다름, 베란다 문은 더 높기도 함) */
    if (out.ceil >= 4) cand = cand.filter(c => c[1] === 1);
    const tot = cand.reduce((s, c) => s + c[1], 0);
    if (tot < 4) return out;
    cand.sort((p, q) => p[0] - q[0]);
    const wmed = arr => { const tt = arr.reduce((s, c) => s + c[1], 0); let acc = 0; for (const c of arr) { acc += c[1]; if (acc >= tt / 2) return c[0]; } return arr[arr.length - 1][0]; };
    const med = wmed(cand);
    const mad = wmed(cand.map(c => [Math.abs(c[0] - med), c[1]]).sort((p, q) => p[0] - q[0]));
    /* 여러 군데서 잰 값이 서로 비슷할수록, 많을수록 믿음 */
    let w = Math.min(1, tot / 12);
    if (mad / med > 0.12) w *= 0.5;
    let h = Math.exp(w * Math.log(med) + (1 - w) * Math.log(prior));
    h = Math.max(950, Math.min(1850, h));
    out.camH = h; out.raw = med; out.src = out.ceil >= out.door ? "천장" : "문";
    return out;
  }

  root.FloorCamera = { exifInfo, focalFactor, camera, cameraHeight };
})(typeof window !== "undefined" ? window : globalThis);
