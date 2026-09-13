import type { Candle } from '../api/binance';

// Deterministic technical indicators. All math, no fabrication.

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { prev += values[i]; continue; }
    if (i === period - 1) { prev = (prev + values[i]) / period; out[i] = prev; continue; }
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let ag = 0, al = 0;
  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= period) {
      ag += g / period; al += l / period;
      if (i === period) out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    } else {
      ag = (ag * (period - 1) + g) / period;
      al = (al * (period - 1) + l) / period;
      out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
  }
  return out;
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast).map(v => v ?? NaN);
  const es = ema(closes, slow).map(v => v ?? NaN);
  const line = closes.map((_, i) => (isFinite(ef[i]) && isFinite(es[i]) ? ef[i] - es[i] : NaN));
  const valid = line.map(v => (isFinite(v) ? v : 0));
  const sig = ema(valid, signal).map((v, i) => (isFinite(line[i]) ? v : null));
  const hist = line.map((v, i) => (isFinite(v) && sig[i] != null ? v - (sig[i] as number) : null));
  return { line, signal: sig, hist };
}

export function atr(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let prev = 0;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const tr = Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c));
    if (i <= period) {
      prev += tr / period;
      if (i === period) { out[i] = prev; prev = out[i]!; }
    } else {
      prev = (prev * (period - 1) + tr) / period;
      out[i] = prev;
    }
  }
  return out;
}

export function adx(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let sPlus = 0, sMinus = 0, sTr = 0, dxSum = 0, count = 0;
  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].h - candles[i - 1].h;
    const dn = candles[i - 1].l - candles[i].l;
    const plus = up > dn && up > 0 ? up : 0;
    const minus = dn > up && dn > 0 ? dn : 0;
    const tr = Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - candles[i - 1].c), Math.abs(candles[i].l - candles[i - 1].c));
    if (i <= period) {
      sPlus += plus; sMinus += minus; sTr += tr;
      if (i === period) {
        const pdi = sTr ? (100 * sPlus) / sTr : 0;
        const ndi = sTr ? (100 * sMinus) / sTr : 0;
        const dx = pdi + ndi ? (100 * Math.abs(pdi - ndi)) / (pdi + ndi) : 0;
        dxSum += dx; count = 1;
        sPlus *= (period - 1) / period; sMinus *= (period - 1) / period; sTr *= (period - 1) / period;
        out[i] = dxSum / count;
      }
    } else {
      sPlus = sPlus - sPlus / period + plus;
      sMinus = sMinus - sMinus / period + minus;
      sTr = sTr - sTr / period + tr;
      const pdi = sTr ? (100 * sPlus) / sTr : 0;
      const ndi = sTr ? (100 * sMinus) / sTr : 0;
      const dx = pdi + ndi ? (100 * Math.abs(pdi - ndi)) / (pdi + ndi) : 0;
      out[i] = ((out[i - 1] ?? dx) * (period - 1) + dx) / period;
    }
  }
  return out;
}

export function bollinger(closes: number[], period = 20, mult = 2) {
  const mid = sma(closes, period);
  const up: (number | null)[] = new Array(closes.length).fill(null);
  const lo: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += (closes[j] - (mid[i] as number)) ** 2;
    const sd = Math.sqrt(s / period);
    up[i] = (mid[i] as number) + mult * sd;
    lo[i] = (mid[i] as number) - mult * sd;
  }
  return { mid, upper: up, lower: lo };
}

// Session-anchored VWAP (anchored to UTC day of first candle in window)
export function vwap(candles: Candle[]): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let day = -1, pv = 0, vol = 0;
  for (let i = 0; i < candles.length; i++) {
    const d = Math.floor(candles[i].t / 86400000);
    if (d !== day) { day = d; pv = 0; vol = 0; }
    const tp = (candles[i].h + candles[i].l + candles[i].c) / 3;
    pv += tp * candles[i].v;
    vol += candles[i].v;
    out[i] = vol > 0 ? pv / vol : null;
  }
  return out;
}

export function volumeProfile(candles: Candle[], bins = 24) {
  if (!candles.length) return { bins: [] as { price: number; vol: number }[], poc: 0, hvn: [] as number[], lvn: [] as number[] };
  let min = Infinity, max = -Infinity;
  for (const c of candles) { if (c.l < min) min = c.l; if (c.h > max) max = c.h; }
  const step = (max - min) / bins || 1;
  const arr = new Array(bins).fill(0);
  for (const c of candles) {
    const tp = (c.h + c.l + c.c) / 3;
    const b = Math.min(bins - 1, Math.max(0, Math.floor((tp - min) / step)));
    arr[b] += c.v;
  }
  const total = arr.reduce((a, b) => a + b, 0) || 1;
  const pocIdx = arr.indexOf(Math.max(...arr));
  const sorted = [...arr].sort((a, b) => b - a);
  const hvCutoff = sorted[Math.floor(sorted.length * 0.3)];
  const lvCutoff = sorted[Math.floor(sorted.length * 0.7)];
  const binsOut = arr.map((v, i) => ({ price: min + (i + 0.5) * step, vol: v }));
  return {
    bins: binsOut,
    poc: min + (pocIdx + 0.5) * step,
    hvn: binsOut.filter((_, i) => arr[i] >= hvCutoff).map(b => b.price),
    lvn: binsOut.filter((_, i) => arr[i] <= lvCutoff).map(b => b.price),
  };
}

export function last<T>(a: (T | null)[]): T | null {
  for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i];
  return null;
}
