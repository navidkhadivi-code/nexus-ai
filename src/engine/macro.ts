// Macro engine — real public data where available; honest DATA_UNAVAILABLE otherwise.
// Macro NEVER places trades; it only adjusts analysis scores.

export interface MacroResult {
  available: boolean;
  btcDominance: number | null;
  ethBtc: number | null;
  totalMarketCap: number | null;
  mcapChange24h: number | null;
  fearGreed: number | null;
  fearGreedLabel: string | null;
  dxy: null;      // requires licensed data feed on this deployment
  nasdaq: null;   // requires licensed data feed on this deployment
  spx: null;      // requires licensed data feed on this deployment
  gold: null;     // requires licensed data feed on this deployment
  macroScore: number; // -1..1 risk-on/off tilt for analysis weighting
  ts: number;
}

async function jget(url: string, timeout = 9000): Promise<any> {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } finally { clearTimeout(to); }
}

export async function fetchMacro(): Promise<MacroResult> {
  const base: MacroResult = {
    available: false, btcDominance: null, ethBtc: null, totalMarketCap: null, mcapChange24h: null,
    fearGreed: null, fearGreedLabel: null, dxy: null, nasdaq: null, spx: null, gold: null, macroScore: 0, ts: Date.now(),
  };
  let out = { ...base };

  try {
    const g = await jget('https://api.coingecko.com/api/v3/global');
    const d = g.data;
    out.btcDominance = d.market_cap_percentage?.btc ?? null;
    out.totalMarketCap = d.total_market_cap?.usd ?? null;
    out.mcapChange24h = d.market_cap_change_percentage_24h_usd ?? null;
    out.available = true;
  } catch { /* coingecko unreachable */ }

  try {
    const t = await jget('https://api.alternative.me/fng/?limit=1');
    const v = +t?.data?.[0]?.value;
    if (!Number.isNaN(v)) {
      out.fearGreed = v;
      out.fearGreedLabel = t.data[0].value_classification ?? null;
      out.available = true;
    }
  } catch { /* fng unreachable */ }

  try {
    const eth = await jget('https://api.binance.com/api/v3/ticker/24hr?symbol=ETHBTC');
    out.ethBtc = +eth.lastPrice;
    out.available = true;
  } catch { /* ethbtc unreachable */ }

  // risk tilt score from real observable proxies only
  let score = 0;
  if (out.mcapChange24h != null) score += Math.max(-1, Math.min(1, out.mcapChange24h / 5));
  if (out.fearGreed != null) score += (out.fearGreed - 50) / 100;
  if (out.btcDominance != null) score += out.btcDominance > 58 ? 0.2 : out.btcDominance < 45 ? -0.2 : 0;
  out.macroScore = Math.max(-1, Math.min(1, score / 3));
  out.ts = Date.now();
  return out;
}
