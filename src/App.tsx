import { useEffect, useMemo, useState } from 'react';
import { useStore } from './state/store';
import { t, fmt, type Lang } from './i18n';
import Chart, { type ChartPrefs } from './components/Chart';
import { analyzeStructure } from './engine/structure';
import { TIMEFRAMES, type Timeframe } from './api/binance';
import { exportCsv } from './paper/engine';
import { adminApi } from './api/adminClient';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];

function daysLeft(exp: number, lang: Lang): string {
  const ms = exp - Date.now();
  if (ms <= 0) return t('expiredWord', lang);
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}${t('dayUnit', lang)} ${h}${t('hourUnit', lang)}` : `${h}${t('hourUnit', lang)}`;
}

type Screen = 'dashboard' | 'guide' | 'orderflow' | 'liquidity' | 'ai' | 'signals' | 'positions' | 'backtest' | 'journal' | 'settings' | 'admin' | 'health';

export default function App() {
  const s = useStore();
  const lang = s.locale as Lang;

  useEffect(() => { s.authInit(); }, []);

  if (!s.auth.checked) return <div className="boot-screen"><div className="logo">◈</div><div className="brand-name">{t('appTitle', lang)}</div><div className="muted small">…</div></div>;
  if (!s.auth.authenticated) return <LoginScreen s={s} lang={lang} />;
  return <Terminal s={s} lang={lang} />;
}

function LoginScreen({ s, lang }: any) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (s.auth.error === 'backend-unavailable') {
    return <div className="boot-screen"><div className="logo">◈</div><div className="brand-name">{t('appTitle', lang)}</div><div className="muted small">{t('authUnavailable', lang)}</div></div>;
  }

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!u || !p) return;
    setBusy(true); setErr('');
    const r = s.auth.setupRequired ? await s.authSetup(u, p) : await s.authLogin(u, p);
    setBusy(false);
    if (!r.ok) {
      if (r.error === 'setup-required') setErr(t('createAdminFirst', lang));
      else if (r.error === 'expired') setErr(t('expiredMsg', lang));
      else if (r.error === 'disabled') setErr(t('disabledMsg', lang));
      else setErr(r.message ?? r.error ?? 'Failed');
    }
  };

  if (s.auth.reason) {
    return (
      <div className="boot-screen">
        <div className="logo">◈</div>
        <div className="brand-name">{t(s.auth.reason === 'expired' ? 'expiredMsg' : 'disabledMsg', lang)}</div>
        <button className="btn" onClick={() => window.location.reload()}>{t('login', lang)}</button>
      </div>
    );
  }

  return (
    <div className="boot-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="logo big">◈</div>
        <div className="brand-name">{t('appTitle', lang)}</div>
        <div className="muted small">{t('tagline', lang)}</div>
        {s.auth.setupRequired && <div className="of-row warn">{t('createAdminFirst', lang)}</div>}
        <input className="inp" placeholder={t('username', lang)} value={u} onChange={e => setU(e.target.value)} autoComplete="username" autoFocus />
        <input className="inp" placeholder={t('password', lang)} type="password" value={p} onChange={e => setP(e.target.value)} autoComplete={s.auth.setupRequired ? 'new-password' : 'current-password'} />
        {err && <div className="of-row warn">{err}</div>}
        <button className="btn primary" disabled={busy || !u || p.length < 8}>{busy ? '…' : s.auth.setupRequired ? t('createAdmin', lang) : t('login', lang)}</button>
        <div className="small muted">{t('plansInfo', lang)}</div>
        <a className="tg-link" href="https://t.me/persiannetco1" target="_blank" rel="noopener noreferrer">✈️ {t('adminContact', lang)}: @persiannetco1</a>
      </form>
      <RequestPanel lang={lang} />
    </div>
  );
}

function RequestPanel({ lang }: any) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ name: '', contact: '', type: 'buy', plan: '1m', username: '', note: '', hp: '' });
  const set = (k: string, v: string) => setF(x => ({ ...x, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    if (f.name.length < 2 || f.contact.length < 5) { setErr(t('reqFillErr', lang)); return; }
    setBusy(true);
    const r = await adminApi.contact(f);
    setBusy(false);
    if (r.ok) setDone(true); else setErr(r.error ?? 'failed');
  };

  if (done) return <div className="login-card"><div style={{ fontSize: 34 }}>✅</div><div>{t('reqSent', lang)}</div></div>;

  return (
    <div className="req-wrap">
      {!open ? (
        <button className="btn primary" onClick={() => setOpen(true)}>🛒 {t('requestBtn', lang)}</button>
      ) : (
        <form className="login-card" onSubmit={submit}>
          <div className="brand-name" style={{ fontSize: 14, letterSpacing: 1 }}>{t('requestTitle', lang)}</div>
          <input className="inp" placeholder={t('reqName', lang)} value={f.name} onChange={e => set('name', e.target.value)} />
          <input className="inp" placeholder={t('reqContact', lang)} value={f.contact} onChange={e => set('contact', e.target.value)} />
          <div className="mt-side">
            <button type="button" className={`chip ${f.type === 'buy' ? 'on' : ''}`} onClick={() => set('type', 'buy')}>{t('reqBuy', lang)}</button>
            <button type="button" className={`chip ${f.type === 'renew' ? 'on' : ''}`} onClick={() => set('type', 'renew')}>{t('reqRenew', lang)}</button>
          </div>
          <div className="mt-side">
            <button type="button" className={`chip ${f.plan === '1m' ? 'on' : ''}`} onClick={() => set('plan', '1m')}>{t('plan1m', lang)}</button>
            <button type="button" className={`chip ${f.plan === '3m' ? 'on' : ''}`} onClick={() => set('plan', '3m')}>{t('plan3m', lang)}</button>
          </div>
          {f.type === 'renew' && <input className="inp" placeholder={t('reqUsername', lang)} value={f.username} onChange={e => set('username', e.target.value)} />}
          <textarea className="inp" rows={2} placeholder={t('reqNote', lang)} value={f.note} onChange={e => set('note', e.target.value)} />
          <input type="text" name="hp" tabIndex={-1} autoComplete="off" value={f.hp} onChange={e => set('hp', e.target.value)} style={{ display: 'none' }} />
          {err && <div className="of-row warn">{err}</div>}
          <button className="btn primary" disabled={busy}>{busy ? '…' : t('reqSend', lang)}</button>
          <button type="button" className="btn" onClick={() => setOpen(false)}>{t('cancel', lang)}</button>
        </form>
      )}
    </div>
  );
}

function Terminal({ s, lang }: any) {
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [prefs, setPrefs] = useState<ChartPrefs>({ ema20: true, ema50: true, bb: false, vwap: true, bos: true, liquidity: true, fvg: true, ob: true, gann: false });

  useEffect(() => { s.init(); }, []);

  const structure = useMemo(() => s.candles.length > 60 ? analyzeStructure(s.candles) : null, [s.candles.length]);

  const NAV: { id: Screen; key: string }[] = [
    { id: 'dashboard', key: 'dashboard' }, { id: 'guide', key: 'guide' }, { id: 'orderflow', key: 'orderFlow' }, { id: 'liquidity', key: 'liquidity' },
    { id: 'ai', key: 'aiIntelligence' }, { id: 'signals', key: 'signals' }, { id: 'positions', key: 'positions' },
    { id: 'backtest', key: 'backtest' }, { id: 'journal', key: 'journal' }, { id: 'settings', key: 'settings' },
    ...(s.auth?.role === 'ADMIN' ? [{ id: 'admin' as Screen, key: 'admin' }] : []), { id: 'health', key: 'systemHealth' },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo">◈</div>
          <div>
            <div className="brand-name">{t('appTitle', lang)}</div>
            <div className="brand-sub">{t('tagline', lang)}</div>
          </div>
        </div>
        <div className="ticker">
          <select className="sym-sel" value={s.symbol} onChange={e => s.setSymbol(e.target.value)}>
            {SYMBOLS.map(x => <option key={x}>{x}</option>)}
          </select>
          <span className={`conn ${s.conn.toLowerCase()}`}>{connLabel(s.conn, lang)}</span>
          <span className="big-price">{s.tick ? fmt(s.tick.price, 2, lang) : '—'}</span>
          {s.candles.length > 1 && s.tick && (
            <span className={s.tick.price >= s.candles[s.candles.length - 2].c ? 'chg up' : 'chg down'}>
              {(((s.tick.price - s.candles[s.candles.length - 2].c) / s.candles[s.candles.length - 2].c) * 100).toFixed(2)}%
            </span>
          )}
          <span className="meta">{s.tick?.source ?? '—'} · {fmt(s.health.marketLatencyMs, 0, lang)} ms</span>
        </div>
        <div className="top-right">
          {s.auth?.role === 'USER' && s.auth?.expires && (
            <span className="mode-badge plan" title={t('expires', lang)}>{t('plan', lang)}: {daysLeft(s.auth.expires, lang)}</span>
          )}
          <span className="user-badge">{s.auth?.user}{s.auth?.role === 'ADMIN' ? ' ⚙' : ''}</span>
          <button className="lang-btn" onClick={() => void s.authLogout()}>{t('logout', lang)}</button>
          <button className="lang-btn" onClick={() => s.setLocale(lang === 'en' ? 'fa' : 'en')}>{lang === 'en' ? 'فارسی' : 'EN'}</button>
        </div>
      </header>

      <div className="body">
        <nav className="sidebar">
          {NAV.map(n => (
            <button key={n.id} className={screen === n.id ? 'nav active' : 'nav'} onClick={() => setScreen(n.id)}>{t(n.key, lang)}</button>
          ))}
          <div className="side-foot">
            <div className="stale-note">{s.conn === 'STALE' ? t('staleStop', lang) : ''}</div>
          </div>
        </nav>

        <main className="main">
          {s.error && <div className="err-banner">{s.error}</div>}
          {screen === 'dashboard' && <Dashboard s={s} lang={lang} prefs={prefs} setPrefs={setPrefs} structure={structure} />}
          {screen === 'guide' && <GuideScreen lang={lang} />}
          {screen === 'orderflow' && <OrderFlowScreen s={s} lang={lang} />}
          {screen === 'liquidity' && <LiquidityScreen s={s} lang={lang} structure={structure} />}
          {screen === 'ai' && <AiScreen s={s} lang={lang} />}
          {screen === 'signals' && <SignalsScreen s={s} lang={lang} />}
          {screen === 'positions' && <PositionsScreen s={s} lang={lang} />}
          {screen === 'backtest' && <BacktestScreen s={s} lang={lang} />}
          {screen === 'journal' && <JournalScreen s={s} lang={lang} />}
          {screen === 'settings' && <SettingsScreen s={s} lang={lang} />}
          {screen === 'admin' && <AdminScreen s={s} lang={lang} />}
          {screen === 'health' && <HealthScreen s={s} lang={lang} />}
        </main>
      </div>
      <footer className="statusbar">
        <span>{t('paperNote', lang)}</span>
        <span>{t('welcome', lang)}</span>
        <a className="tg-link" href="https://t.me/persiannetco1" target="_blank" rel="noopener noreferrer">✈️ @persiannetco1</a>
        <span className="mono">engine {s.health.engineMs}ms · up {Math.floor(s.health.uptimeSec / 60)}m</span>
      </footer>
    </div>
  );
}

function connLabel(c: string, lang: Lang) {
  const map: Record<string, string> = { LIVE: t('live', lang), STALE: t('stale', lang), OFFLINE: t('offline', lang), CONNECTING: t('connecting', lang), ERROR: t('error', lang) };
  return map[c] ?? c;
}

function Panel({ title, children, cls }: { title: string; children: React.ReactNode; cls?: string }) {
  return <section className={`panel ${cls ?? ''}`}><div className="panel-h">{title}</div><div className="panel-b">{children}</div></section>;
}

// ---------------- DASHBOARD ----------------
function Dashboard({ s, lang, prefs, setPrefs, structure }: any) {
  const cons = s.consensus as ReturnType<typeof useStore.getState>['consensus'];
  return (
    <div className="grid-dash">
      <Panel title={`${s.symbol} · ${s.timeframe} · ${s.activeSource}`} cls="g-chart">
        <div className="tf-row">
          {TIMEFRAMES.map(tf => (
            <button key={tf} className={s.timeframe === tf ? 'chip on' : 'chip'} onClick={() => s.setTimeframe(tf as Timeframe)}>{tf.toUpperCase()}</button>
          ))}
        </div>
        <div className="pref-row">
          {(['ema20', 'ema50', 'bb', 'vwap', 'bos', 'liquidity', 'fvg', 'ob', 'gann'] as (keyof ChartPrefs)[]).map(k => (
            <label key={k} className="pref"><input type="checkbox" checked={(prefs as any)[k]} onChange={() => setPrefs({ ...prefs, [k]: !(prefs as any)[k] })} />{({ ema20: 'EMA20', ema50: 'EMA50', bb: 'Bollinger', vwap: 'VWAP', bos: 'BOS/CHoCH', liquidity: 'Liquidity', fvg: 'FVG', ob: 'Order Blocks', gann: 'Gann' } as Record<string, string>)[k]}</label>
          ))}
        </div>
        <Chart candles={s.candles} prefs={prefs} consensus={cons} structure={structure} liquidity={s.liquidity} gann={s.gann} tf={s.timeframe}
          signalLine={s.signal ? { entry: s.signal.entry, stop: s.signal.stop, targets: s.signal.targets } : null} />
      </Panel>

      <Panel title={t('consensus', lang)} cls="g-consensus">
        <ConsensusBox s={s} lang={lang} />
      </Panel>

      <Panel title={t('aiEngine', lang)} cls="g-agents">
        <AgentGrid s={s} lang={lang} />
      </Panel>

      <Panel title={t('orderBook', lang)} cls="g-book">
        <BookMini s={s} lang={lang} />
      </Panel>

      <Panel title={t('portfolio', lang)} cls="g-port">
        <PortfolioBox s={s} lang={lang} />
      </Panel>
    </div>
  );
}

function ConsensusBox({ s, lang }: any) {
  const c = s.consensus, a = s.ares;
  if (!c) return <div className="empty">{t('noData', lang)}</div>;
  const dirColor = c.direction === 'LONG' ? 'up' : c.direction === 'SHORT' ? 'down' : 'flat';
  return (
    <div className="cons-box">
      <div className={`cons-dir ${dirColor}`}>{c.direction}</div>
      <div className="cons-stats">
        <div><b>{c.confidence.toFixed(0)}%</b><span>{t('confidence', lang)}</span></div>
        <div><b>{c.agreement.toFixed(0)}%</b><span>{t('agreement', lang)}</span></div>
        <div><b>{c.setupQuality.toFixed(0)}</b><span>{t('setupQuality', lang)}</span></div>
        <div><b>{c.directionalScore.toFixed(0)}</b><span>Score</span></div>
      </div>
      {c.noTrade ? (
        <div className="no-trade">{t('noTrade', lang)}<ul>{c.noTradeReasons.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul></div>
      ) : (
        <div className="cons-levels">
          <div className="row"><span>{t('entry', lang)}</span><b>{c.entryZone ? `${fmt(c.entryZone.min, 2, lang)} – ${fmt(c.entryZone.max, 2, lang)}` : '—'}</b></div>
          <div className="row down"><span>{t('stop', lang)}</span><b>{fmt(c.stop, 2, lang)}</b></div>
          <div className="row up"><span>{t('targets', lang)}</span><b>{c.targets.map((x: number) => fmt(x, 2, lang)).join(' / ')}</b></div>
          <div className="row"><span>{t('riskReward', lang)}</span><b>{a ? a.rr.toFixed(2) : '—'}</b></div>
        </div>
      )}
      {a && (
        <div className={`ares ${a.allowed ? 'ok' : 'veto'}`}>
          {a.allowed ? `✓ ${t('aresApproves', lang)}` : `⛔ ${t('aresVeto', lang)}`}
          {!a.allowed && <ul>{a.vetoReasons.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>}
        </div>
      )}
      <button className="btn primary" disabled={c.noTrade || !a?.allowed} onClick={() => { const r = s.openPaperTrade(); if (!r.ok) alert(r.reason); }}>{t('openPaper', lang)}</button>
      <div className="mtf">
        {Object.entries(c.mtf).map(([tf, v]: [string, any]) => (
          <span key={tf} className={`mtf-chip ${v.direction === 'LONG' ? 'up' : v.direction === 'SHORT' ? 'down' : ''}`}>{tf.toUpperCase()} {v.direction}</span>
        ))}
      </div>
    </div>
  );
}

function AgentGrid({ s, lang }: any) {
  const c = s.consensus;
  if (!c) return <div className="empty">{t('noData', lang)}</div>;
  const perf = s.agentPerf as any[];
  return (
    <div className="agent-grid">
      {c.agents.map((a: any) => {
        const p = perf.find(x => x.agent === a.agent);
        return (
          <div key={a.agent} className={`agent ${a.direction === 'LONG' ? 'long' : a.direction === 'SHORT' ? 'short' : ''}`}>
            <div className="agent-head"><b>{a.agent}</b><span className={`dot ${a.confidence > 0 ? 'on' : 'idle'}`} /></div>
            <div className="agent-dir">{a.direction}</div>
            <div className="bar"><i style={{ width: `${a.confidence}%` }} /></div>
            <div className="agent-foot">{a.confidence.toFixed(0)}% · {t('accuracy', lang)}: {p ? `${p.accuracy.toFixed(0)}% (${p.preds})` : '—'}</div>
          </div>
        );
      })}
      <div className={`agent ares ${s.ares?.allowed ? 'long' : s.ares ? 'short' : ''}`}>
        <div className="agent-head"><b>ARES</b><span className={`dot ${s.ares ? 'on' : 'idle'}`} /></div>
        <div className="agent-dir">{s.ares ? (s.ares.allowed ? 'APPROVE' : 'VETO') : '—'}</div>
        <div className="bar"><i style={{ width: s.ares ? `${Math.min(100, s.ares.checks.filter((x: any) => x.passed).length / s.ares.checks.length * 100)}%` : '0%' }} /></div>
        <div className="agent-foot">risk veto · {s.ares?.checks.filter((x: any) => x.passed).length ?? 0}/{s.ares?.checks.length ?? 0} checks</div>
      </div>
    </div>
  );
}

function BookMini({ s, lang }: any) {
  const bm = s.bookMetrics;
  if (!bm) return <div className="empty">{t('noData', lang)}</div>;
  const maxCum = Math.max(bm.cumBid[bm.cumBid.length - 1] ?? 1, bm.cumAsk[bm.cumAsk.length - 1] ?? 1);
  const pts = (cum: number[]) => cum.map((v, i) => `${(i / Math.max(cum.length - 1, 1)) * 100},${100 - (v / maxCum) * 100}`).join(' ');
  return (
    <div className="book">
      <div className="book-head">
        <span>{t('spread', lang)}: <b>{fmt(bm.spreadPct, 3, lang)}%</b></span>
        <span>{t('mid', lang)}: <b>{fmt(bm.mid, 2, lang)}</b></span>
        <span>{t('imbalance', lang)}: <b className={bm.depthImbalance >= 0 ? 'up' : 'down'}>{(bm.depthImbalance * 100).toFixed(1)}%</b></span>
      </div>
      <div className="depth">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon points={`0,100 ${pts(bm.cumBid)} 100,100`} fill="rgba(14,203,129,.25)" stroke="#0ecb81" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <polygon points={`100,0 ${pts(bm.cumAsk.slice().reverse()).split(' ').reverse().join(' ')} 0,0`} fill="rgba(246,70,93,.25)" stroke="#f6465d" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="ob-rows">
        <div className="ob-col">{s.book?.asks.slice(0, 8).reverse().map((l: any, i: number) => <div key={i} className="ob-row ask"><span>{fmt(l.price, 2, lang)}</span><span>{l.qty.toFixed(2)}</span></div>)}</div>
        <div className="ob-col">{s.book?.bids.slice(0, 8).map((l: any, i: number) => <div key={i} className="ob-row bid"><span>{fmt(l.price, 2, lang)}</span><span>{l.qty.toFixed(2)}</span></div>)}</div>
      </div>
    </div>
  );
}

function PortfolioBox({ s, lang }: any) {
  const stats = portfolio(s.paper);
  return (
    <div className="port-grid">
      <Metric label={t('balance', lang)} value={`$${fmt(stats.cash, 2, lang)}`} />
      <Metric label={t('equity', lang)} value={`$${fmt(stats.equity, 2, lang)}`} strong />
      <Metric label={t('unrealized', lang)} value={`$${fmt(stats.unrealized, 2, lang)}`} tone={stats.unrealized >= 0 ? 'up' : 'down'} />
      <Metric label={t('realized', lang)} value={`$${fmt(stats.realized, 2, lang)}`} tone={stats.realized >= 0 ? 'up' : 'down'} />
      <Metric label={t('exposure', lang)} value={`$${fmt(stats.exposure, 2, lang)}`} />
      <Metric label={t('drawdown', lang)} value={`${fmt(stats.maxDrawdownPct, 2, lang)}%`} tone="down" />
      <div className="kill">
        <button className={`btn ${s.paper.killSwitch ? 'danger on' : 'danger'}`} onClick={() => { if (confirm(`${t('killSwitch', lang)}?`)) s.killSwitch(!s.paper.killSwitch); }}>
          {t('stopAll', lang)}
        </button>
        {s.paper.killSwitch && <div className="down small">{t('killSwitch', lang)}: ACTIVE</div>}
      </div>
    </div>
  );
}

function portfolio(p: any) {
  const unreal = p.positions.reduce((a: number, x: any) => a + (x.side === 'LONG' ? (x.mark - x.entry) : (x.entry - x.mark)) * x.qty, 0);
  const exposure = p.positions.reduce((a: number, x: any) => a + x.mark * x.qty, 0);
  const realized = p.journal.reduce((a: number, x: any) => a + x.pnlUsd, 0);
  let peak = p.startBalance, mdd = 0;
  for (const e of p.equityCurve) { peak = Math.max(peak, e.v); mdd = Math.max(mdd, (peak - e.v) / (peak || 1)); }
  return { cash: p.cash, equity: p.startBalance + realized + unreal, unrealized: unreal, realized, exposure, maxDrawdownPct: mdd * 100 };
}

function Metric({ label, value, tone, strong }: any) {
  return <div className={`metric ${tone ?? ''}`}><span>{label}</span><b className={strong ? 'big' : ''}>{value}</b></div>;
}

// ---------------- GUIDE (آموزش) ----------------
const GUIDE: { icon: string; t: { en: string; fa: string }; b: { en: string[]; fa: string[] } }[] = [
  {
    icon: '📡', t: { en: 'Where are the signals?', fa: 'سیگنال‌ها کجا هستند؟' },
    b: {
      en: ['On the Dashboard, the right panel "AI CONSENSUS" shows the live signal: direction, entry zone, stop-loss and TP1/TP2/TP3.', 'The "Signals" menu shows the current signal status and its full history.', 'Statuses: WAITING (price has not reached entry yet) → ACTIVE → TP1/TP2/TP3 (targets hit) or STOP (stop-loss hit).'],
      fa: ['در داشبورد، پنل سمت راست «اجماع هوش مصنوعی» سیگنال زنده را نشان می‌دهد: جهت، محدوده ورود، حد ضرر و هدف‌های ۱/۲/۳.', 'منوی «سیگنال‌ها» وضعیت سیگنال فعلی و تاریخچه کامل آن را نشان می‌دهد.', 'وضعیت‌ها: WAITING (قیمت هنوز به ورود نرسیده) ← ACTIVE ← TP1/TP2/TP3 (هدف‌ها زده شد) یا STOP (حد ضرر خورد).'],
    },
  },
  {
    icon: '🧠', t: { en: 'How to read a signal', fa: 'چطور سیگنال را بخوانیم' },
    b: {
      en: ['LONG = buy signal, SHORT = sell signal, NEUTRAL = no position.', 'Confidence: agreement strength of the 7 analysis agents (weighted).', 'R/R: reward-to-risk ratio — signals below 1.3 are never issued.', '"WHY?" section: every reason is computed from real data (structure, order flow, liquidity…), never invented.', 'Risks: what can invalidate the setup.'],
      fa: ['LONG = سیگنال خرید، SHORT = سیگنال فروش، NEUTRAL = بدون پوزیشن.', 'Confidence: قدرت هم‌نظری ۷ ایجنت تحلیلی (وزن‌دار).', 'R/R: نسبت سود به ریسک — سیگنال زیر ۱.۳ هرگز صادر نمی‌شود.', 'بخش «چرا؟»: هر دلیل از داده واقعی محاسبه شده (ساختار، جریان سفارش، نقدینگی…)، هرگز ساخته نمی‌شود.', 'ریسک‌ها: چیزهایی که می‌توانند ستاپ را باطل کنند.'],
    },
  },
  {
    icon: '🚫', t: { en: 'NO TRADE is a real signal', fa: '«عدم معامله» هم یک سیگنال واقعی است' },
    b: {
      en: ['When data is stale, agents disagree, R/R is bad or volatility is extreme, the system shows NO TRADE and stops issuing signals.', 'This is a feature, not a bug: forcing low-quality signals is exactly what fake signal channels do.'],
      fa: ['وقتی داده قدیمی باشد، ایجنت‌ها اختلاف نظر داشته باشند، R/R بد باشد یا نوسان شدید، سیستم NO TRADE نشان می‌دهد و صدور سیگنال متوقف می‌شود.', 'این یک قابلیت است نه نقص: سیگنال بی‌کیفیت دادن کاری است که کانال‌های جعلی انجام می‌دهند.'],
    },
  },
  {
    icon: '🤖', t: { en: 'The 8 agents', fa: 'ایجنت‌های هشت‌گانه' },
    b: {
      en: ['NOVA (structure) · ORION (price action) · LUMA (order flow) · ATLAS (liquidity) · GANN (price/time) · MACRO (market sentiment) · QUANT (statistics) — each votes with a weight.', 'ARES is the risk manager: it never predicts direction, but can VETO any trade (position size, daily loss, exposure, leverage limits).', 'The AI screen shows each agent\'s accuracy from real past signal outcomes.'],
      fa: ['NOVA (ساختار) · ORION (پرایس اکشن) · LUMA (جریان سفارش) · ATLAS (نقدینگی) · GANN (قیمت/زمان) · MACRO (ماكرو) · QUANT (آمار) — هرکدام با وزن رأی می‌دهند.', 'ARES مدیر ریسک است: هرگز جهت پیش‌بینی نمی‌کند ولی می‌تواند هر معامله را وتو کند (حجم، ضرر روزانه، قرارگیری، اهرم).', 'صفحه هوش مصنوعی دقت هر ایجنت را از نتایج واقعی سیگنال‌های قبلی نشان می‌دهد.'],
    },
  },
  {
    icon: '🧪', t: { en: 'Paper trading (practice with real prices)', fa: 'معامله کاغذی (تمرین با قیمت واقعی)' },
    b: {
      en: ['The button "OPEN PAPER TRADE" on the dashboard becomes active only when consensus AND ARES approve.', 'Want your own setup? The "Positions" menu has a full manual order panel: LONG/SHORT, quantity, stop, TP1-3 — or press "FILL FROM SIGNAL" to load the current signal levels. Live preview of margin, fee and max loss before you open.', 'Fills use the real bid/ask + slippage + 0.1% fee — like a real exchange, but with fake money ($10,000 test account).', 'Track open trades in "Positions", closed ones in "Journal" (CSV export available).', 'The red KILL SWITCH button closes everything and blocks new trades.'],
      fa: ['دکمه «افتتاح معامله کاغذی» در داشبورد فقط وقتی فعال می‌شود که اجماع و ARES هر دو تأیید کنند.', 'ستاپ خودت را می‌خواهی؟ منوی «معاملات باز» پنل کامل سفارش دستی دارد: LONG/SHORT، حجم، حد ضرر، TP1-3 — یا دکمه «پر کردن از سیگنال» سطوح سیگنال فعلی را بارگذاری می‌کند. قبل از باز کردن، مارجین، کارمزد و حداکثر ضرر را زنده ببین.', 'اجرا با bid/ask واقعی + اسلیپیج + کارمزد ۰.۱٪ — مثل صرافی واقعی ولی با پول آزمایشی (حساب ۱۰ هزار دلاری).', 'معاملات باز در «معاملات باز» و بسته‌شده‌ها در «ژورنال» (خروجی CSV دارد).', 'دکمه قرمز «کلید اضطراری» همه را می‌بندد و معامله جدید را بلاک می‌کند.'],
    },
  },
  {
    icon: '📈', t: { en: 'Chart & timeframes', fa: 'چارت و تایم‌فریم‌ها' },
    b: {
      en: ['12 timeframes from 1m to 1w. Toggle overlays: EMA/BB/VWAP, BOS/CHOCH, liquidity levels, order blocks, Gann.', 'The top bar shows the live price, data source and latency. If it says STALE DATA — wait, signals are paused for your safety.'],
      fa: ['۱۲ تایم‌فریم از ۱m تا ۱w. لایه‌ها قابل روشن/خاموش کردن: EMA/BB/VWAP، BOS/CHOCH، سطوح نقدینگی، اوردر بلاک، گن.', 'نوار بالا قیمت زنده، منبع داده و تأخیر را نشان می‌دهد. اگر STALE DATA دیدی — صبر کن، سیگنال‌ها برای امنیت تو متوقف شده‌اند.'],
    },
  },
  {
    icon: '🧾', t: { en: 'Backtest', fa: 'بک‌تست' },
    b: {
      en: ['The Backtest menu runs the strategy on thousands of real historical candles with fees and slippage, plus Monte Carlo and Walk-Forward tests.', 'Manual: press RUN BACKTEST anytime. Automatic: switch AUTO on and it re-runs every 5 minutes on the current symbol/timeframe.', 'Past results NEVER guarantee future profit — this tool measures risk, it does not promise income.'],
      fa: ['منوی بک‌تست استراتژی را روی هزاران کندل تاریخی واقعی با کارمزد و اسلیپیج اجرا می‌کند به‌علاوه مونت‌کارلو و Walk-Forward.', 'دستی: هر وقت خواستی RUN BACKTEST را بزن. خودکار: AUTO را روشن کن تا هر ۵ دقیقه روی نماد/تایم فعلی دوباره اجرا شود.', 'نتایج گذشته هرگز سود آینده را تضمین نمی‌کند — این ابزار ریسک را می‌سنجد، وعده درآمد نمی‌دهد.'],
    },
  },
  {
    icon: '👤', t: { en: 'Your subscription', fa: 'اشتراک شما' },
    b: {
      en: ['Plans: 1-month and 3-month. The badge in the top bar shows your remaining time.', 'When it expires (or the admin disables the account) you are logged out automatically and see the renewal message.', 'Purchase, renewal and support via Telegram: @persiannetco1', 'You can change your data source (Binance/Bybit/OKX) and risk settings from the Settings menu.'],
      fa: ['پلن‌ها: ۱ ماهه و ۳ ماهه. بج نوار بالا زمان باقی‌مانده را نشان می‌دهد.', 'با پایان مهلت (یا غیرفعال‌سازی توسط مدیر) خودکار خارج شده و پیام تمدید را می‌بینی.', 'خرید، تمدید و پشتیبانی از طریق تلگرام: @persiannetco1', 'منبع داده (Binance/Bybit/OKX) و تنظیمات ریسک از منوی تنظیمات قابل تغییر است.'],
    },
  },
  {
    icon: '⚠️', t: { en: 'Important warning', fa: 'هشدار مهم' },
    b: {
      en: ['Crypto trading involves substantial risk of loss. Persian Trade is an analysis terminal, not a profit machine. Never trade money you cannot afford to lose. Live (real-money) trading is disabled on this platform.'],
      fa: ['معامله ارز دیجیتال ریسک از دست دادن سرمایه دارد. نکسوس یک ترمینال تحلیلی است، نه ماشین سود. هرگز با پولی که توان از دست دادنش را نداری معامله نکن. معامله واقعی (پول واقعی) در این پلتفرم غیرفعال است.'],
    },
  },
];

function GuideScreen({ lang }: any) {
  return (
    <div className="guide-wrap">
      {GUIDE.map((g, i) => (
        <Panel key={i} title={`${g.icon} ${g.t[lang as 'en' | 'fa']}`}>
          <ul className="guide-list">
            {g.b[lang as 'en' | 'fa'].map((line, j) => <li key={j}>{line}</li>)}
          </ul>
        </Panel>
      ))}
    </div>
  );
}

// ---------------- OTHER SCREENS ----------------
function OrderFlowScreen({ s, lang }: any) {
  const c = s.consensus;
  const of = c?.agents.find((a: any) => a.agent === 'LUMA');
  return (
    <div className="grid-two">
      <Panel title={t('orderFlow', lang)}>
        <FullBook s={s} lang={lang} />
      </Panel>
      <Panel title="CVD / DELTA (LUMA)">
        {!of ? <div className="empty">{t('noData', lang)}</div> : (
          <div className="of-list">
            {of.reasons.map((r: string, i: number) => <div key={i} className="of-row">◆ {r}</div>)}
            {of.risks.map((r: string, i: number) => <div key={'r' + i} className="of-row warn">⚠ {r}</div>)}
          </div>
        )}
      </Panel>
    </div>
  );
}

function FullBook({ s, lang }: any) {
  if (!s.book) return <div className="empty">{t('noData', lang)}</div>;
  return (
    <div className="ob-rows full">
      <div className="ob-col">{s.book.asks.slice(0, 18).reverse().map((l: any, i: number) => <div key={i} className="ob-row ask"><span>{fmt(l.price, 2, lang)}</span><span>{l.qty.toFixed(3)}</span></div>)}</div>
      <div className="ob-col">{s.book.bids.slice(0, 18).map((l: any, i: number) => <div key={i} className="ob-row bid"><span>{fmt(l.price, 2, lang)}</span><span>{l.qty.toFixed(3)}</span></div>)}</div>
    </div>
  );
}

function LiquidityScreen({ s, lang }: any) {
  const c = s.consensus;
  const at = c?.agents.find((a: any) => a.agent === 'ATLAS');
  const g = c?.agents.find((a: any) => a.agent === 'GANN');
  return (
    <div className="grid-two">
      <Panel title={t('liquidity', lang)}>
        {!at ? <div className="empty">{t('noData', lang)}</div> : (
          <div className="liq-list">
            {at.reasons.map((r: string, i: number) => <div key={i} className="of-row">◆ {r}</div>)}
            {at.risks.map((r: string, i: number) => <div key={'r' + i} className="of-row">{r}</div>)}
          </div>
        )}
      </Panel>
      <Panel title="GANN / PRICE-TIME">
        {!g ? <div className="empty">{t('noData', lang)}</div> : (
          <div className="liq-list">
            {g.reasons.map((r: string, i: number) => <div key={i} className="of-row">◆ {r}</div>)}
            {g.risks.map((r: string, i: number) => <div key={'r' + i} className="of-row warn">⚠ {r}</div>)}
          </div>
        )}
      </Panel>
    </div>
  );
}

function AiScreen({ s, lang }: any) {
  const c = s.consensus;
  if (!c) return <div className="empty">{t('noData', lang)}</div>;
  return (
    <div className="ai-screen">
      <div className="reasons-col">
        <Panel title={`${t('reasons', lang)} — ${c.direction} @ ${c.confidence.toFixed(0)}%`}>
          {c.summaryReasons.slice(0, 30).map((r: string, i: number) => <div key={i} className="why-row">▸ {r}</div>)}
        </Panel>
      </div>
      <div className="reasons-col">
        <Panel title={t('risks', lang)}>
          {c.summaryRisks.slice(0, 25).map((r: string, i: number) => <div key={i} className="why-row warn">▸ {r}</div>)}
          {c.noTrade && c.noTradeReasons.map((r: string, i: number) => <div key={'n' + i} className="why-row danger">▸ {r}</div>)}
        </Panel>
        <Panel title={t('aiEngine', lang)}>
          <AgentGrid s={s} lang={lang} />
        </Panel>
      </div>
    </div>
  );
}

function SignalsScreen({ s, lang }: any) {
  return (
    <div>
      <Panel title={t('signals', lang)}>
        {s.signal ? (
          <div className="sig-live">
            <div className={`sig-dir ${s.signal.direction === 'LONG' ? 'up' : 'down'}`}>{s.signal.symbol} {s.signal.direction}</div>
            <div className="sig-status">{s.signal.status} · conf {s.signal.confidence.toFixed(0)}% · R/R {s.signal.rr.toFixed(2)} · {t('source', lang)}: {s.signal.dataSource}</div>
            <div className="sig-levels">
              <span>{t('entry', lang)} {fmt(s.signal.entry, 2, lang)}</span>
              <span className="down">{t('stop', lang)} {fmt(s.signal.stop, 2, lang)}</span>
              {s.signal.targets.map((tp: number, i: number) => <span key={i} className="up">TP{i + 1} {fmt(tp, 2, lang)}</span>)}
            </div>
          </div>
        ) : <div className="empty">{t('noTrade', lang)}</div>}
      </Panel>
      <Panel title="History">
        <table className="tbl">
          <thead><tr><th>{t('time', lang)}</th><th>{t('symbol', lang)}</th><th>{t('status', lang)}</th><th>{t('confidence', lang)}</th><th>R/R</th></tr></thead>
          <tbody>
            {(s.signalHistory as any[]).map((h, i) => (
              <tr key={i}><td>{new Date(h.createdAt).toLocaleString()}</td><td>{h.symbol} {h.direction}</td><td>{h.status}</td><td>{h.confidence.toFixed(0)}%</td><td>{h.rr.toFixed(2)}</td></tr>
            ))}
            {!s.signalHistory.length && <tr><td colSpan={5} className="empty">{t('noData', lang)}</td></tr>}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function PositionsScreen({ s, lang }: any) {
  const st = portfolio(s.paper);
  const [side, setSide] = useState<'LONG' | 'SHORT'>('LONG');
  const [qty, setQty] = useState('');
  const [sl, setSl] = useState('');
  const [tp1, setTp1] = useState('');
  const [tp2, setTp2] = useState('');
  const [tp3, setTp3] = useState('');
  const tick = s.tick;
  const entry = tick ? (side === 'LONG' ? tick.ask : tick.bid) : 0;
  const qn = parseFloat(qty) || 0;
  const sln = parseFloat(sl) || 0;
  const notional = qn * entry;
  const margin = notional / 5;
  const fee = notional * 0.001;
  const maxLoss = sln > 0 ? Math.abs(entry - sln) * qn : 0;
  const rr = sln > 0 && tp1 ? Math.abs(parseFloat(tp1) - entry) / Math.abs(entry - sln) : 0;

  const fillFromSignal = () => {
    const c = s.consensus; const a = s.ares;
    if (!c || !a) return;
    if (c.direction !== 'NEUTRAL') setSide(c.direction);
    if (c.stop) setSl(String(c.stop));
    (c.targets || []).slice(0, 3).forEach((t: number, i: number) => { const v = String(t); [setTp1, setTp2, setTp3][i](v); });
    if (a.quantity > 0) setQty(a.quantity.toFixed(6));
  };

  const open = () => {
    const r = s.openManualTrade(side, qn, sln, [parseFloat(tp1) || 0, parseFloat(tp2) || 0, parseFloat(tp3) || 0]);
    if (!r.ok) alert(r.reason); else { setQty(''); setSl(''); setTp1(''); setTp2(''); setTp3(''); }
  };

  return (
    <div>
      <Panel title={`${t('newPaperTrade', lang)} — ${s.symbol}`}>
        <div className="mt-row">
          <div className="mt-side">
            <button className={`chip ${side === 'LONG' ? 'on' : ''}`} style={{ color: side === 'LONG' ? 'var(--up)' : undefined }} onClick={() => setSide('LONG')}>LONG ▲</button>
            <button className={`chip ${side === 'SHORT' ? 'on' : ''}`} style={{ color: side === 'SHORT' ? 'var(--down)' : undefined }} onClick={() => setSide('SHORT')}>SHORT ▼</button>
          </div>
          <label className="mt-f"><span>{t('qty', lang)}</span><input className="inp" type="number" step="any" min="0" value={qty} onChange={e => setQty(e.target.value)} placeholder="0.01" /></label>
          <label className="mt-f"><span>{t('stop', lang)}</span><input className="inp" type="number" step="any" value={sl} onChange={e => setSl(e.target.value)} placeholder={entry ? (side === 'LONG' ? (entry * 0.98).toFixed(1) : (entry * 1.02).toFixed(1)) : ''} /></label>
          <label className="mt-f"><span>TP1</span><input className="inp" type="number" step="any" value={tp1} onChange={e => setTp1(e.target.value)} /></label>
          <label className="mt-f"><span>TP2</span><input className="inp" type="number" step="any" value={tp2} onChange={e => setTp2(e.target.value)} /></label>
          <label className="mt-f"><span>TP3</span><input className="inp" type="number" step="any" value={tp3} onChange={e => setTp3(e.target.value)} /></label>
          <button className="btn" onClick={fillFromSignal} disabled={!s.consensus}>⚡ {t('fromSignal', lang)}</button>
          <button className="btn primary" onClick={open} disabled={!tick || qn <= 0}>{t('openTrade', lang)}</button>
        </div>
        <div className="mt-info">
          <span>{t('price', lang)}: <b>{entry ? fmt(entry, 2, lang) : '—'}</b></span>
          <span>{t('notional', lang)}: <b>${fmt(notional, 2, lang)}</b></span>
          <span>{t('margin', lang)}: <b>${fmt(margin, 2, lang)}</b></span>
          <span>{t('fee', lang)}: <b>${fmt(fee, 2, lang)}</b></span>
          <span>{t('maxLoss', lang)}: <b className="down">${fmt(maxLoss, 2, lang)}</b></span>
          {rr > 0 && <span>R/R: <b className={rr >= 1.3 ? 'up' : 'down'}>{rr.toFixed(2)}</b></span>}
        </div>
        <div className="small muted note">{t('paperNote', lang)} · {t('manualSlTpNote', lang)}</div>
      </Panel>
      <PortfolioBox s={s} lang={lang} />
      <Panel title={t('positions', lang)}>
        <table className="tbl">
          <thead><tr><th>{t('symbol', lang)}</th><th>{t('status', lang)}</th><th>{t('qty', lang)}</th><th>Entry</th><th>Mark</th><th>SL</th><th>{t('pnl', lang)}</th><th></th></tr></thead>
          <tbody>
            {s.paper.positions.map((p: any) => {
              const pnl = (p.side === 'LONG' ? p.mark - p.entry : p.entry - p.mark) * p.qty;
              return (
                <tr key={p.id}>
                  <td>{p.symbol}</td><td className={p.side === 'LONG' ? 'up' : 'down'}>{p.side}</td><td>{p.qty.toFixed(5)}</td>
                  <td>{fmt(p.entry, 2, lang)}</td><td>{fmt(p.mark, 2, lang)}</td><td>{fmt(p.sl, 2, lang)}</td>
                  <td className={pnl >= 0 ? 'up' : 'down'}>${fmt(pnl, 2, lang)}</td>
                  <td><button className="btn small" onClick={() => s.closePaperTrade(p.id)}>{t('close', lang) ?? 'CLOSE'}</button></td>
                </tr>
              );
            })}
            {!s.paper.positions.length && <tr><td colSpan={8} className="empty">{t('noData', lang)}</td></tr>}
          </tbody>
        </table>
      </Panel>
      <Panel title={t('orders', lang)}>
        <table className="tbl">
          <thead><tr><th>{t('time', lang)}</th><th>{t('symbol', lang)}</th><th>Side</th><th>{t('price', lang)}</th><th>{t('qty', lang)}</th><th>Fee</th><th>{t('status', lang)}</th></tr></thead>
          <tbody>
            {s.paper.orders.slice(0, 30).map((o: any) => <tr key={o.id}><td>{new Date(o.createdAt).toLocaleTimeString()}</td><td>{o.symbol}</td><td>{o.side}</td><td>{fmt(o.fillPrice ?? 0, 2, lang)}</td><td>{o.qty.toFixed(5)}</td><td>${o.feePaid.toFixed(2)}</td><td>{o.status}</td></tr>)}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function BacktestScreen({ s, lang }: any) {
  const bt = s.bt;
  const [auto, setAuto] = useState(() => localStorage.getItem('nexus_bt_auto') === '1');

  useEffect(() => {
    try { localStorage.setItem('nexus_bt_auto', auto ? '1' : '0'); } catch { /* noop */ }
    if (!auto) return;
    s.runBacktest();
    const id = window.setInterval(() => s.runBacktest(), 5 * 60000);
    return () => clearInterval(id);
  }, [auto]);

  const last = localStorage.getItem('nexus_bt_last');
  return (
    <div>
      <div className="bt-ctrl">
        <button className="btn primary" disabled={bt?.running} onClick={() => s.runBacktest()}>{bt?.running ? '…' : t('runBacktest', lang)}</button>
        <button className={`btn ${auto ? 'on' : ''}`} style={auto ? { background: '#0ecb81', borderColor: '#0ecb81', color: '#05080e' } : undefined} onClick={() => setAuto(!auto)}>
          {auto ? `⏱ ${t('autoOn', lang)}` : t('autoRun', lang)}
        </button>
        <span className="small muted">{t('backtesting', lang)} — {s.symbol} {s.timeframe} · {fmt(s.candles.length, 0, lang)} + 2000 {t('candlesWord', lang)}</span>
        {last && <span className="small muted">· {t('lastRun', lang)}: {new Date(+last).toLocaleTimeString()}</span>}
      </div>
      {auto && <div className="small muted note" style={{ marginTop: -4, marginBottom: 10 }}>{t('autoBtNote', lang)}</div>}
      {bt?.metrics && (
        <div className="grid-metrics">
          <Metric label={t('netProfit', lang)} value={`$${fmt(bt.metrics.netProfit, 2, lang)}`} tone={bt.metrics.netProfit >= 0 ? 'up' : 'down'} />
          <Metric label={t('winRate', lang)} value={`${bt.metrics.winRate.toFixed(1)}%`} />
          <Metric label={t('profitFactor', lang)} value={bt.metrics.profitFactor === Infinity ? '∞' : bt.metrics.profitFactor.toFixed(2)} />
          <Metric label={t('sharpe', lang)} value={bt.metrics.sharpe.toFixed(2)} />
          <Metric label={t('sortino', lang)} value={bt.metrics.sortino.toFixed(2)} />
          <Metric label={t('drawdown', lang)} value={`${bt.metrics.maxDrawdownPct.toFixed(1)}%`} tone="down" />
          <Metric label="Avg R" value={bt.metrics.avgR.toFixed(3)} />
          <Metric label={t('tradesCount', lang)} value={String(bt.metrics.trades)} />
        </div>
      )}
      {bt?.mc && (
        <Panel title={t('monteCarlo', lang)}>
          <div className="grid-metrics">
            <Metric label="P5" value={`$${fmt(bt.mc.p5, 0, lang)}`} />
            <Metric label="P50" value={`$${fmt(bt.mc.p50, 0, lang)}`} />
            <Metric label="P95" value={`$${fmt(bt.mc.p95, 0, lang)}`} />
            <Metric label={t('expRuin', lang)} value={`${bt.mc.probRuin.toFixed(1)}%`} tone="down" />
            <Metric label="P(loss)" value={`${bt.mc.probNegative.toFixed(1)}%`} />
            <Metric label="Median MaxDD" value={`${bt.mc.medianMaxDD.toFixed(1)}%`} />
          </div>
        </Panel>
      )}
      {bt?.wf?.length > 0 && (
        <Panel title={t('walkForward', lang)}>
          <table className="tbl"><thead><tr><th>#</th><th>IS ROI</th><th>OOS ROI</th><th>OOS Trades</th><th>Params</th></tr></thead>
            <tbody>{bt.wf.map((w: any, i: number) => <tr key={i}><td>{w.window}</td><td className={w.isRoi >= 0 ? 'up' : 'down'}>{w.isRoi.toFixed(1)}%</td><td className={w.oosRoi >= 0 ? 'up' : 'down'}>{w.oosRoi.toFixed(1)}%</td><td>{w.oosTrades}</td><td>stop {w.params.stop}×ATR · tp {w.params.target}×ATR</td></tr>)}</tbody>
          </table>
        </Panel>
      )}
      <div className="small muted note">Backtest = historical simulation with fees/slippage. Past results never guarantee future outcomes.</div>
    </div>
  );
}

function JournalScreen({ s, lang }: any) {
  return (
    <Panel title={t('journal', lang)}>
      <div className="row-end">
        <button className="btn" onClick={() => {
          const csv = exportCsv(s.paper);
          const blob = new Blob([csv], { type: 'text/csv' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = 'nexus_journal.csv'; a.click();
        }}>{t('exportCsv', lang)}</button>
      </div>
      <table className="tbl">
        <thead><tr><th>{t('symbol', lang)}</th><th>Side</th><th>Entry</th><th>Exit</th><th>{t('pnl', lang)}</th><th>R</th><th>Fees</th><th>{t('time', lang)}</th></tr></thead>
        <tbody>
          {s.paper.journal.map((j: any) => (
            <tr key={j.tradeId}><td>{j.symbol}</td><td>{j.side}</td><td>{fmt(j.entry, 2, lang)}</td><td>{fmt(j.exit, 2, lang)}</td>
              <td className={j.pnlUsd >= 0 ? 'up' : 'down'}>${fmt(j.pnlUsd, 2, lang)}</td><td>{j.rMultiple.toFixed(2)}</td><td>${j.fees.toFixed(2)}</td><td>{new Date(j.closedAt).toLocaleString()}</td></tr>
          ))}
          {!s.paper.journal.length && <tr><td colSpan={8} className="empty">{t('noData', lang)}</td></tr>}
        </tbody>
      </table>
    </Panel>
  );
}

function SettingsScreen({ s, lang }: any) {
  return (
    <Panel title={t('settings', lang)}>
      <div className="set-row" style={{ marginBottom: 12 }}>
        <span>{t('source', lang)} — {t('marketData', lang)}</span>
        <select value={s.exchange} onChange={e => s.setExchange(e.target.value)} style={{ background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--line2)', borderRadius: 5, padding: '5px 8px' }}>
          <option value="AUTO">AUTO (Binance → Bybit → OKX)</option>
          <option value="BINANCE">BINANCE</option>
          <option value="BYBIT">BYBIT</option>
          <option value="OKX">OKX</option>
        </select>
        <b className="up">{s.activeSource}</b>
      </div>
      <div className="set-grid">
        {([
          ['riskPct', t('risk', lang) + ' %'], ['maxRiskPct', 'Max risk %'], ['maxDailyLossPct', 'Max daily loss %'],
          ['maxExposurePct', 'Max exposure %'], ['maxLeverage', 'Max leverage'], ['minRR', 'Min R/R'], ['minConfidence', t('confidence', lang) + ' % min'],
        ] as [string, string][]).map(([k, label]) => (
          <label key={k} className="set-row"><span>{label}</span>
            <input type="number" step="0.1" value={(s.risk as any)[k]} onChange={e => s.setRisk({ [k]: +e.target.value })} />
          </label>
        ))}
      </div>
      <div className="small muted note">Stored locally (this browser). Server-side multi-user auth requires the VPS deployment (see README).</div>
      <button className="btn danger" onClick={() => { if (confirm('Reset paper account?')) s.resetPaper(); }}>Reset Paper Account</button>
    </Panel>
  );
}

function AdminScreen({ s, lang }: any) {
  const [audit, setAudit] = useState<any[]>([]);
  const isAdmin = s.auth?.role === 'ADMIN';
  useEffect(() => { if (isAdmin) adminApi.audit().then(r => setAudit(Array.isArray(r.lines) ? r.lines : [])); }, [isAdmin]);

  if (!isAdmin) return <Panel title={t('admin', lang)}><div className="of-row warn">{t('adminOnly', lang)}</div></Panel>;

  return (
    <div>
      <RequestsPanel lang={lang} />
      <UsersPanel lang={lang} />
      <Panel title={`${t('admin', lang)} — ${s.auth.user}`}>
        <div className="admin-grid">
          <div><b>{t('agentCards', lang)} ({t('settings', lang)})</b>
            <div className="small">NOVA 15% · ORION 15% · LUMA 20% · ATLAS 15% · GANN 5% · MACRO 10% · QUANT 20% · ARES = VETO</div>
          </div>
          <div><b>{t('liveTradeDisabled', lang)}</b><div className="small">{t('liveWarn', lang)}</div></div>
        </div>
      </Panel>
      <Panel title={t('auditLog', lang)}>
        <div className="of-list">
          {audit.map((l, i) => <div key={i} className="of-row mono">{l.ts} · {l.ip} · {l.action} · {l.user} {l.detail ? `· ${l.detail}` : ''}</div>)}
          {!audit.length && <div className="empty">{t('noData', lang)}</div>}
        </div>
      </Panel>
    </div>
  );
}

function RequestsPanel({ lang }: any) {
  const [rows, setRows] = useState<any[]>([]);
  const refresh = () => adminApi.requests('list').then(r => setRows(Array.isArray(r.requests) ? r.requests : []));
  useEffect(() => { void refresh(); }, []);
  const act = async (action: string, id: string) => {
    const r = await adminApi.requests(action, { id });
    if (Array.isArray(r.requests)) setRows(r.requests); else void refresh();
  };
  const newCount = rows.filter(r => r.status === 'new').length;
  return (
    <Panel title={`${t('requests', lang)} — ${newCount} ${t('newWord', lang)}`}>
      <table className="tbl">
        <thead><tr><th>{t('time', lang)}</th><th>{t('type', lang)}</th><th>{t('plan', lang)}</th><th>{t('reqName', lang)}</th><th>{t('reqContact', lang)}</th><th>Note</th><th>{t('status', lang)}</th><th></th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td>{new Date(r.ts * 1000).toLocaleString()}</td>
              <td className={r.type === 'buy' ? 'up' : ''}>{r.type === 'buy' ? t('reqBuy', lang) : t('reqRenew', lang)}{r.username ? ` (${r.username})` : ''}</td>
              <td>{r.plan === '1m' ? t('plan1m', lang) : t('plan3m', lang)}</td>
              <td>{r.name}</td><td className="mono">{r.contact}</td>
              <td className="small">{r.note || '—'}</td>
              <td className={r.status === 'new' ? 'up' : 'muted'}>{r.status === 'new' ? t('newWord', lang) : '✓'}</td>
              <td className="btns">
                {r.status === 'new' && <button className="btn small" onClick={() => void act('done', r.id)}>✓</button>}
                <button className="btn small danger" onClick={() => { if (confirm('delete request?')) void act('delete', r.id); }}>✕</button>
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={8} className="empty">{t('noData', lang)}</td></tr>}
        </tbody>
      </table>
    </Panel>
  );
}

function UsersPanel({ lang }: any) {
  const [rows, setRows] = useState<any[]>([]);
  const [nu, setNu] = useState('');
  const [np, setNp] = useState('');
  const [ne, setNe] = useState('');
  const [plan, setPlan] = useState('1m');
  const [busy, setBusy] = useState(false);

  const refresh = () => adminApi.users('list').then(r => setRows(Array.isArray(r.users) ? r.users : []));
  useEffect(() => { void refresh(); }, []);

  const act = async (action: string, username: string, extra?: Record<string, unknown>) => {
    setBusy(true);
    const r = await adminApi.users(action, { username, ...extra });
    setBusy(false);
    if (!r.ok) alert(r.message ?? r.error ?? 'failed');
    if (Array.isArray(r.users)) setRows(r.users);
    else void refresh();
  };

  const createUser = async () => {
    setBusy(true);
    const r = await adminApi.users('create', { username: nu, password: np, plan, email: ne });
    setBusy(false);
    if (!r.ok) { alert(r.error ?? 'failed'); return; }
    setRows(Array.isArray(r.users) ? r.users : []);
    if (ne && !r.mailSent) alert(lang === 'fa' ? 'اکانت ساخته شد ولی ایمیل ارسال نشد — مشخصات را دستی بفرستید.' : 'Account created but email was NOT sent — send credentials manually.');
    setNu(''); setNp(''); setNe('');
  };

  return (
    <Panel title={`${t('users', lang)} (${rows.length})`}>
      <div className="set-grid" style={{ maxWidth: 720, marginBottom: 12 }}>
        <input className="inp" placeholder={t('username', lang)} value={nu} onChange={e => setNu(e.target.value)} />
        <input className="inp" placeholder={t('password', lang) + ' (min 8)'} value={np} onChange={e => setNp(e.target.value)} />
        <input className="inp" placeholder={t('emailOpt', lang)} value={ne} onChange={e => setNe(e.target.value)} />
        <select className="inp" value={plan} onChange={e => setPlan(e.target.value)}>
          <option value="1m">{t('plan1m', lang)}</option>
          <option value="3m">{t('plan3m', lang)}</option>
        </select>
        <button className="btn primary" disabled={busy || nu.length < 3 || np.length < 8} onClick={() => void createUser()}>{t('createUser', lang)}</button>
      </div>
      <table className="tbl">
        <thead><tr><th>{t('username', lang)}</th><th>{t('plan', lang)}</th><th>{t('expires', lang)}</th><th>{t('status', lang)}</th><th>Email</th><th></th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.user}>
              <td><b>{r.user}</b>{r.role === 'ADMIN' ? ' ⚙' : ''}</td>
              <td>{r.plan ?? '—'}</td>
              <td>{r.expires ? daysLeft(r.expires, lang) : '∞'}</td>
              <td className={r.disabled ? 'down' : 'up'}>{r.disabled ? t('disabledWord', lang) : t('active', lang)}</td>
              <td className="small mono">{r.email || '—'}</td>
              <td className="btns">
                {r.role !== 'ADMIN' && r.role !== 'SUPER_ADMIN' && (
                  <>
                    {r.disabled
                      ? <button className="btn small" disabled={busy} onClick={() => void act('enable', r.user)}>{t('enable', lang)}</button>
                      : <button className="btn small danger" disabled={busy} onClick={() => void act('disable', r.user)}>{t('disable', lang)}</button>}
                    <button className="btn small" disabled={busy} onClick={() => { const pw = prompt(t('newPassPrompt', lang)); if (pw && pw.length >= 8) void act('pass', r.user, { password: pw }); }}>{t('resetPass', lang)}</button>
                    <button className="btn small" disabled={busy} onClick={() => void act('extend', r.user, { plan: '1m' })}>+{t('plan1m', lang)}</button>
                    <button className="btn small" disabled={busy} onClick={() => void act('extend', r.user, { plan: '3m' })}>+{t('plan3m', lang)}</button>
                    <button className="btn small danger" disabled={busy} onClick={() => { if (confirm(`DELETE ${r.user}?`)) void act('delete', r.user); }}>{t('del', lang)}</button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={6} className="empty">{t('noData', lang)}</td></tr>}
        </tbody>
      </table>
      <div className="small muted note">{t('paymentNote', lang)}</div>
    </Panel>
  );
}

function HealthScreen({ s, lang }: any) {
  return (
    <Panel title={t('systemHealth', lang)}>
      <div className="health-grid">
        <Health label={t('marketData', lang)} value={s.conn} ok={s.conn === 'LIVE'} />
        <Health label={t('storageEngine', lang)} value="FILE-STORE (PHP/JSON) ONLINE" ok={true} />
        <Health label={t('cacheLayer', lang)} value="BROWSER IN-MEMORY" na={true} />
        <Health label={t('aiEngine', lang)} value={s.consensus ? 'ONLINE' : 'PROCESSING'} ok={!!s.consensus} />
        <Health label={t('execution', lang)} value="PAPER READY" ok={true} />
        <Health label="Binance WS" value={s.conn === 'LIVE' ? 'CONNECTED' : s.conn} ok={s.conn === 'LIVE'} />
        <Health label="Macro feeds" value={s.health.macroOk ? 'LIVE' : t('dataUnavailable', lang)} ok={s.health.macroOk} />
        <Health label={t('latency', lang)} value={`${s.health.marketLatencyMs} ms / eng ${s.health.engineMs} ms`} ok={s.health.marketLatencyMs < 1000} />
      </div>
      <div className="small muted note">{t('staticNote', lang)}</div>
    </Panel>
  );
}

function Health({ label, value, ok, na }: any) {
  return <div className={`health-row ${na ? 'na' : ok ? 'ok' : 'warn'}`}><span>{label}</span><b>{value}</b></div>;
}
