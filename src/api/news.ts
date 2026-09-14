export interface NewsItem { title: string; link: string; source: string; ts: number; }

export const NEWS_TOPICS: { key: string; en: string; fa: string }[] = [
  { key: 'crypto', en: 'All Crypto', fa: 'عمومی' },
  { key: 'bitcoin', en: 'BTC', fa: 'بیت‌کوین' },
  { key: 'ethereum', en: 'ETH', fa: 'اتریوم' },
  { key: 'solana', en: 'SOL', fa: 'سولانا' },
  { key: 'bnb', en: 'BNB', fa: 'بایننس‌کوین' },
  { key: 'xrp', en: 'XRP', fa: 'ریپل' },
  { key: 'doge', en: 'DOGE', fa: 'دوج' },
  { key: 'gold', en: 'GOLD', fa: 'طلا' },
];

export async function fetchNews(topic: string): Promise<NewsItem[]> {
  const r = await fetch(`/api/news.php?t=${encodeURIComponent(topic)}`, { credentials: 'same-origin' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (!j.ok) throw new Error('feed-unavailable');
  return Array.isArray(j.items) ? j.items : [];
}

export function ago(ts: number, lang: 'en' | 'fa'): string {
  const min = Math.max(0, Math.floor((Date.now() / 1000 - ts) / 60));
  const fa = (n: number, u: string) => new Intl.NumberFormat('fa-IR').format(n) + ' ' + u;
  if (lang === 'fa') {
    if (min < 60) return fa(min, min === 1 ? 'دقیقه پیش' : 'دقیقه پیش');
    if (min < 1440) return fa(Math.floor(min / 60), 'ساعت پیش');
    return fa(Math.floor(min / 1440), 'روز پیش');
  }
  if (min < 60) return min + 'm ago';
  if (min < 1440) return Math.floor(min / 60) + 'h ago';
  return Math.floor(min / 1440) + 'd ago';
}
