import { jget } from './types';

// Real commodity spot prices from gold-api (CORS-enabled, no key needed for /price).
// No history fabrication: chart points are only what we actually poll & store.

export interface CmdtyQuote { symbol: string; name: string; price: number; updatedAt: string; }

const META: Record<string, string> = { XAU: 'Gold', XAG: 'Silver', HG: 'Copper' };

export async function fetchCommodities(): Promise<Record<string, CmdtyQuote>> {
  const out: Record<string, CmdtyQuote> = {};
  await Promise.all(Object.entries(META).map(async ([s, name]) => {
    try {
      const j = await jget(`https://api.gold-api.com/price/${s}`, 8000);
      if (j && typeof j.price === 'number' && j.price > 0) {
        out[s] = { symbol: s, name, price: j.price, updatedAt: j.updatedAt || new Date().toISOString() };
      }
    } catch { /* honest: missing */ }
  }));
  return out;
}
