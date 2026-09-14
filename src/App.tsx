import { useEffect, useMemo, useState } from 'react';
import { useStore, RISK_DEFAULTS } from './state/store';
import { t, fmt, type Lang } from './i18n';
import Chart, { type ChartPrefs } from './components/Chart';
import { analyzeStructure } from './engine/structure';
import { TIMEFRAMES, type Timeframe } from './api/binance';
import { exportCsv } from './paper/engine';
import { adminApi } from './api/adminClient';
import { fetchCommodities } from './api/commodities';
import { fetchNews, NEWS_TOPICS, ago, type NewsItem } from './api/news';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'PAXGUSDT'];

function daysLeft(exp: number, lang: Lang): string {
  const ms = exp - Date.now();
  if (ms <= 0) return t('expiredWord', lang);
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}${t('dayUnit', lang)} ${h}${t('hourUnit', lang)}` : `${h}${t('hourUnit', lang)}`;
}

type Screen = 'dashboard' | 'guide' | 'commodities' | 'news' | 'orderflow' | 'liquidity' | 'ai' | 'signals' | 'positions' | 'backtest' | 'journal' | 'settings' | 'admin' | 'users' | 'requests' | 'health';

export default function App() {
  const s = useStore();
  const lang = s.locale as Lang;

  useEffect(() => { s.authInit(); }, []);

  if (!s.auth.checked) return <div className="boot-screen"><img src="./logo.png" className="logo-img" alt="" /><div className="brand-name">{t('appTitle', lang)}</div><div className="muted small">…</div></div>;
  if (!s.auth.authenticated) return <LoginScreen s={s} lang={lang} />;
  return <Terminal s={s} lang={lang} />;
}

function LoginScreen({ s, lang }: any) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (s.auth.error === 'backend-unavailable') {
    return <div className="boot-screen"><img src="./logo.png" className="logo-img" alt="" /><div className="brand-name">{t('appTitle', lang)}</div><div className="muted small">{t('authUnavailable', lang)}</div></div>;
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
        <img src="./logo.png" className="logo-img" alt="" />
        <div className="brand-name">{t(s.auth.reason === 'expired' ? 'expiredMsg' : 'disabledMsg', lang)}</div>
        <button className="btn" onClick={() => window.location.reload()}>{t('login', lang)}</button>
      </div>
    );
  }

  return (
    <div className="boot-screen">
      <form className="login-card" onSubmit={submit}>
        <img src="./logo.png" className="logo-img big" alt="" />
        <div className="brand-name">{t('appTitle', lang)}</div>
        <div className="muted small">{t('tagline', lang)}</div>
        <div className="lang-row">
          <button type="button" className={`chip ${lang === 'en' ? 'on' : ''}`} onClick={() => s.setLocale('en')}>English</button>
          <button type="button" className={`chip ${lang === 'fa' ? 'on' : ''}`} onClick={() => s.setLocale('fa')}>فارسی</button>
        </div>
        {s.auth.setupRequired && <div className="of-row warn">{t('createAdminFirst', lang)}</div>}
        <input className="inp" placeholder={t('username', lang)} value={u} onChange={e => setU(e.target.value)} autoComplete="username" autoFocus />
        <input className="inp" placeholder={t('password', lang)} type="password" value={p} onChange={e => setP(e.target.value)} autoComplete={s.auth.setupRequired ? 'new-password' : 'current-password'} />
        {err && <div className="of-row warn">{err}</div>}
        <button className="btn primary" disabled={busy || !u || p.length < 8}>{busy ? '…' : s.auth.setupRequired ? t('createAdmin', lang) : t('login', lang)}</button>
        <div className="small muted">{t('plansInfo', lang)}</div>
        <div className="row-gap" style={{ justifyContent: 'center', marginTop: 0 }}>
          <a className="tg-link" href="https://t.me/persiantrade2025" target="_blank" rel="noopener noreferrer"><img src="./telegram.svg" className="tg-ic" alt="" /> {t('adminContact', lang)}</a>
          <a className="tg-link" href="mailto:trade@ipeset.com">✉️ trade@ipeset.com</a>
        </div>
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
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.contact.trim());
    if (f.name.length < 2 || !emailOk) { setErr(t('reqFillErr', lang)); return; }
    setBusy(true);
    const r = await adminApi.contact({ ...f, contact: f.contact.trim().toLowerCase() });
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
          <input className="inp" type="email" placeholder={t('reqContact', lang)} value={f.contact} onChange={e => set('contact', e.target.value)} required autoComplete="email" />
          <div className="mt-side">
            <button type="button" className={`chip ${f.type === 'buy' ? 'on' : ''}`} onClick={() => set('type', 'buy')}>{t('reqBuy', lang)}</button>
            <button type="button" className={`chip ${f.type === 'renew' ? 'on' : ''}`} onClick={() => set('type', 'renew')}>{t('reqRenew', lang)}</button>
          </div>
          <div className="mt-side">
            <button type="button" className={`chip ${f.plan === '1m' ? 'on' : ''}`} onClick={() => set('plan', '1m')}>{t('plan1m', lang)} — {t('price1m', lang)}</button>
            <button type="button" className={`chip ${f.plan === '3m' ? 'on' : ''}`} onClick={() => set('plan', '3m')}>{t('plan3m', lang)} — {t('price3m', lang)}</button>
          </div>
          <div className="small muted">{t('payViaTg', lang)}</div>
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
  useEffect(() => { if (screen === 'signals') s.markSignalsSeen(); }, [screen]);

  const structure = useMemo(() => s.candles.length > 60 ? analyzeStructure(s.candles) : null, [s.candles.length]);

  const NAV: { id: Screen; key: string }[] = [
    { id: 'dashboard', key: 'dashboard' }, { id: 'guide', key: 'guide' }, { id: 'commodities', key: 'commodities' }, { id: 'news', key: 'news' }, { id: 'orderflow', key: 'orderFlow' }, { id: 'liquidity', key: 'liquidity' },
    { id: 'ai', key: 'aiIntelligence' }, { id: 'signals', key: 'signals' }, { id: 'positions', key: 'positions' },
    { id: 'backtest', key: 'backtest' }, { id: 'journal', key: 'journal' }, { id: 'settings', key: 'settings' },
    ...(s.auth?.role === 'ADMIN' ? [
      { id: 'admin' as Screen, key: 'admin' },
      { id: 'users' as Screen, key: 'usersNav' },
      { id: 'requests' as Screen, key: 'requestsNav' },
    ] : []), { id: 'health', key: 'systemHealth' },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="./logo.png" alt="" className="logo-img" />
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
          {s.auth?.expires ? (
            <span className={`mode-badge ${Math.ceil((s.auth.expires - Date.now() / 1000) / 86400) <= 3 ? 'plan warn' : 'plan'}`} title={`${t('expires', lang)}: ${new Date(s.auth.expires * 1000).toLocaleDateString()}`}>
              ⏳ {Math.max(0, Math.ceil((s.auth.expires - Date.now() / 1000) / 86400))} {t('daysLeftWord', lang)}
            </span>
          ) : s.auth?.role === 'ADMIN' ? (
            <span className="mode-badge admin">⚙ ADMIN · ∞</span>
          ) : null}
          <span className="user-badge">{s.auth?.user}{s.auth?.role === 'ADMIN' ? ' ⚙' : ''}</span>
          <button className="lang-btn" onClick={() => void s.authLogout()}>{t('logout', lang)}</button>
          <button className="lang-btn" onClick={() => s.setLocale(lang === 'en' ? 'fa' : 'en')}>{lang === 'en' ? 'فارسی' : 'EN'}</button>
        </div>
      </header>

      <div className="body">
        <nav className="sidebar">
          {NAV.map(n => (
            <button key={n.id} className={screen === n.id ? 'nav active' : 'nav'} onClick={() => setScreen(n.id)}>
              {t(n.key, lang)}
              {n.id === 'signals' && s.unreadSignals > 0 && <span className="nav-badge">{s.unreadSignals > 9 ? '+9' : s.unreadSignals}</span>}
            </button>
          ))}
          <div className="side-foot">
            <div className="stale-note">{s.conn === 'STALE' ? t('staleStop', lang) : ''}</div>
          </div>
        </nav>

        <main className="main">
          {s.error && <div className="err-banner">{s.error}</div>}
          {screen === 'dashboard' && <Dashboard s={s} lang={lang} prefs={prefs} setPrefs={setPrefs} structure={structure} />}
          {screen === 'guide' && <GuideScreen lang={lang} />}
          {screen === 'commodities' && <CommoditiesScreen lang={lang} />}
          {screen === 'news' && <NewsScreen lang={lang} />}
          {screen === 'orderflow' && <OrderFlowScreen s={s} lang={lang} />}
          {screen === 'liquidity' && <LiquidityScreen s={s} lang={lang} structure={structure} />}
          {screen === 'ai' && <AiScreen s={s} lang={lang} />}
          {screen === 'signals' && <SignalsScreen s={s} lang={lang} />}
          {screen === 'positions' && <PositionsScreen s={s} lang={lang} />}
          {screen === 'backtest' && <BacktestScreen s={s} lang={lang} />}
          {screen === 'journal' && <JournalScreen s={s} lang={lang} />}
          {screen === 'settings' && <SettingsScreen s={s} lang={lang} />}
          {screen === 'admin' && <AdminScreen s={s} lang={lang} />}
          {screen === 'users' && <UsersScreen lang={lang} />}
          {screen === 'requests' && <RequestsScreen lang={lang} />}
          {screen === 'health' && <HealthScreen s={s} lang={lang} />}
        </main>
      </div>
      <footer className="statusbar">
        <span className="sb-note">{t('paperNote', lang)}</span>
        <div className="sb-contacts">
          <a className="tg-link" href="https://t.me/persiantrade2025" target="_blank" rel="noopener noreferrer"><img src="./telegram.svg" className="tg-ic" alt="" />@persiantrade2025</a>
          <a className="tg-link" href="mailto:trade@ipeset.com">✉️ trade@ipeset.com</a>
        </div>
        <span className="mono sb-engine">engine {s.health.engineMs}ms · up {Math.floor(s.health.uptimeSec / 60)}m</span>
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
    icon: '🎯', t: { en: 'What is this platform?', fa: 'این پلتفرم چیست؟' },
    b: {
      en: [
        'PersianTrade is a crypto ANALYSIS terminal. It answers three questions for you: What is the market doing right now? What do the specialists say about it? Is a trade worth taking at this moment?',
        'It does NOT trade for you and does NOT promise profit. It gives you structured, data-driven insight so your own decisions are better informed.',
        'Every number you see comes from real exchange data (Binance / Bybit / OKX) — never invented. If a data feed dies, the panel says DATA UNAVAILABLE instead of showing fake numbers.',
        'You pay for a subscription (1 or 3 months), log in, and get the full terminal: charts, signals, AI consensus, risk engine, paper trading, backtesting and journal.',
      ],
      fa: [
        'پرشین‌ترید یک ترمینال «تحلیل» ارز دیجیتال است. به سه سوال جواب میدهد: بازار الان چه‌کار میکند؟ نظر متخصص‌ها چیست؟ آیا همین الان معامله ارزش ورود دارد؟',
        'این سیستم به‌جای شما معامله نمی‌کند و سود تضمین نمی‌کند. بینش ساختارمند و داده‌محور میدهد تا «خودت» تصمیم بهتری بگیری.',
        'هر عددی که می‌بینی از داده واقعی صرافی (بایننس/بای‌بیت/OKX) میاد — هرگز ساخته نمیشه. اگر فید قطع بشه، به‌جای عدد جعلی پیام «داده در دسترس نیست» می‌بینی.',
        'اشتراک می‌خری (۱ یا ۳ ماهه)، وارد میشی و کل ترمینال رو در اختیار داری: چارت، سیگنال، اجماع AI، موتور ریسک، معامله کاغذی، بک‌تست و ژورنال.',
      ],
    },
  },
  {
    icon: '🧭', t: { en: 'First steps (follow this order)', fa: 'قدم‌های اول (به همین ترتیب برو)' },
    b: {
      en: [
        '1) Pick your market from the top bar (BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT, DOGEUSDT, PAXGUSDT = gold).',
        '2) Pick a timeframe (1m to 1w). Start with 15m or 1h — cleaner signals.',
        '3) Watch the right panel: AI CONSENSUS. It always shows the current market opinion: LONG / SHORT / NO TRADE with confidence, entry, stop and targets.',
        '4) Check the red badge on the Signals menu — it counts new signal events. Open it to see the live signal and its full history.',
        '5) Before risking anything, open trades in PAPER mode (Positions menu) — real prices, fake money.',
      ],
      fa: [
        '۱) بازارت رو از نوار بالا انتخاب کن (BTCUSDT، ETHUSDT، SOLUSDT، XRPUSDT، DOGEUSDT، PAXGUSDT = طلا).',
        '۲) تایم‌فریم رو انتخاب کن (۱ دقیقه تا هفتگی). با ۱۵ دقیقه یا ۱ ساعت شروع کن — سیگنال‌ها تمیزترن.',
        '۳) پنل سمت راست رو ببین: «اجماع هوش مصنوعی». نظر فعلی بازار رو نشون میده: LONG / SHORT / بدون معامله، با اطمینان، ورود، حد ضرر و هدف‌ها.',
        '۴) بج قرمز روی منوی «سیگنال‌ها» رو چک کن — تعداد رویدادهای جدید رو میشمره. بازش کن تا سیگنال فعال و تاریخچه‌اش رو ببینی.',
        '۵) قبل از هر ریسکی، در حالت کاغذی (منوی معاملات باز) معامله بزن — قیمت واقعی، پول الکی.',
      ],
    },
  },
  {
    icon: '📡', t: { en: 'Where are the signals?', fa: 'سیگنال‌ها کجا هستند؟' },
    b: {
      en: [
        'On the Dashboard, the right panel "AI CONSENSUS" shows the live signal: direction, entry zone, stop-loss and TP1/TP2/TP3.',
        'The "Signals" menu shows the current signal status and its full history (time, symbol, status, confidence, R/R).',
        'Statuses: WAITING (price has not reached the entry zone yet) → ACTIVE (you are in the setup) → TP1/TP2/TP3 (targets hit one by one) or STOP (stop-loss hit).',
        'A new signal is issued ONLY when all gates pass. When nothing qualifies, the Signals panel honestly shows "NO TRADE — waiting for a high-quality setup" instead of forcing something.',
      ],
      fa: [
        'در داشبورد، پنل سمت راست «اجماع هوش مصنوعی» سیگنال زنده رو نشون میده: جهت، محدوده ورود، حد ضرر و هدف‌های ۱/۲/۳.',
        'منوی «سیگنال‌ها» وضعیت سیگنال فعلی و تاریخچه کاملش رو نشون میده (زمان، نماد، وضعیت، اطمینان، R/R).',
        'وضعیت‌ها: WAITING (قیمت هنوز به ناحیه ورود نرسیده) ← ACTIVE (داخل ستاپ هستی) ← TP1/TP2/TP3 (هدف‌ها یکی‌یکی زده میشن) یا STOP (حد ضرر خورده).',
        'سیگنال جدید فقط وقتی صادر میشه که «همه» دروازه‌ها رد بشن. وقتی چیزی واجد شرایط نیست، پنل صادقانه «بدون معامله — در انتظار ستاپ باکیفیت» نشون میده، نه یه چیز اجباری.',
      ],
    },
  },
  {
    icon: '🧠', t: { en: 'How to read a signal — example', fa: 'چطور یک سیگنال رو بخونیم — با مثال' },
    b: {
      en: [
        'Example: BTCUSDT · LONG · Confidence 72% · Agreement 86% · Entry 95,400–95,600 · SL 94,700 · TP1 96,900 / TP2 98,300 / TP3 100,500 · R/R 2.1',
        'LONG = buy signal. SHORT = sell signal. NEUTRAL = no position.',
        'Confidence = weighted agreement strength of the 7 agents (0-100). It is NOT a probability of profit — it measures how much the specialists agree.',
        'R/R 2.1 means: if the stop loses 1 unit, the first target gains ~2.1 units. Signals below R/R 1.3 are never issued.',
        '"WHY?" section lists the real computed reasons (e.g. "4H bullish structure", "sell-side sweep", "positive CVD"). "Risks" lists what can invalidate the idea.',
        'Every signal is tracked automatically: if TP1-3 hit, agents that agreed get +1 correct prediction in their accuracy score; if STOP hits, they get a miss. Accuracy you see in the AI panel is earned from real outcomes.',
      ],
      fa: [
        'مثال: BTCUSDT · LONG · اطمینان ۷۲٪ · هم‌نظری ۸۶٪ · ورود ۹۵۴۰۰ تا ۹۵۶۰۰ · حد ضرر ۹۴٬۷۰ · هدف‌ها ۹۶٬۹۰۰ / ۹۸٬۳۰ / ۱۰٬۵۰ · R/R برابر 2.1',
        'LONG = سیگنال خرید. SHORT = سیگنال فروش. NEUTRAL = بدون پوزیشن.',
        'Confidence (اطمینان) = شدت هم‌نظری وزن‌دار ۷ ایجنت (۰ تا ۱۰۰). این «احتمال سود» نیست؛ نشون میده متخصص‌ها چقدر هم‌راستان.',
        'R/R برابر 2.1 یعنی اگه حد ضرر ۱ واحد ضرر بزنه، هدف اول حدود 2.1 واحد سود داره. زیر 1.3 هیچ سیگنالی صادر نمیشه.',
        'بخش «چرا؟» دلایل واقعی محاسبه‌شده رو لیست میکنه (مثلاً «ساختار ۴ ساعته صعودی»، «اسوئیپ سمت فروش»، «CVD مثبت»). بخش «ریسک‌ها» چیزهایی که میتوانند ایده رو باطل کنن.',
        'هر سیگنال خودکار پیگیری میشه: اگر هدف‌ها بخورن، ایجنت‌های هم‌نظر +۱ پیش‌بینی درست می‌گیرن؛ اگر استاپ بخوره، خطا ثبت میشه. دقتی در پنل AI می‌بینی از نتایج واقعی ساخته شده.',
      ],
    },
  },
  {
    icon: '🤖', t: { en: 'The 8 agents — who votes', fa: 'ایجنت‌های ۸‌تانه — کی رأی میده' },
    b: {
      en: [
        'NOVA (15%) — market structure: HH/HL/LH/LL, BOS/CHoCH, support/resistance, regime.',
        'ORION (15%) — price action: RSI, MACD, EMAs, candle behavior, breakouts and rejections.',
        'LUMA (20%) — order flow: delta, CVD, book imbalance, absorption, exhaustion. Heaviest vote because tape does not lie.',
        'ATLAS (15%) — liquidity: equal highs/lows, sweeps, order blocks, FVGs, POC — where the stops are sitting.',
        'GANN (5%) — price/time geometry: angles, cycles, confluence zones. Small weight on purpose.',
        'MACRO (10%) — context: BTC dominance, Fear & Greed, total cap, funding. Never trades, only tilts the score.',
        'QUANT (20%) — pure statistics: volatility, z-score, historical probability of follow-through. No LLM, no opinions — math.',
        'ARES — the risk manager. It never votes on direction. It checks EVERY trade: size, stop, R/R, daily loss, exposure, leverage, stale data… and can VETO anything. A signal without ARES approval cannot be opened, even in paper.',
      ],
      fa: [
        'NOVA (۱۵٪) — ساختار بازار: HH/HL/LH/LL، BOS/CHoCH، حمایت/مقاومت، رجیم.',
        'ORION (۱۵٪) — پرایس اکشن: RSI، MACD، EMA، رفتار کندل، شکست و ریجکت.',
        'LUMA (۲۰٪) — جریان سفارش: دلتا، CVD، عدم‌تعادل دفتر، جذب، خستگی. سنگین‌ترین رأی، چون نوار معاملات دروغ نمیگه.',
        'ATLAS (۱۵٪) — نقدینگی: سقف/کف‌های برابر، اسوئیپ‌ها، اوردر‌بلاک، FVG، POC — استاپ‌ها کجا جمع‌اند.',
        'GANN (۵٪) — هندسه قیمت/زمان: زوایا، چرخه‌ها، زون‌های هم‌پوشانی. عمداً وزن کم.',
        'MACRO (۱۰٪) — کانتکست: سلطه BTC، ترس‌وطمع، کل ارزش بازار، فاندینگ. هرگز معامله نمیکنه، فقط نمره رو کمی کج میکنه.',
        'QUANT (۲۰٪) — آمار خالص: نوسان، z-score، احتمال تاریخی ادامه‌دار بودن حرکت. بدون زبان‌مدل، بدون نظر — فقط ریاضی.',
        'ARES — مدیر ریسک. هرگز جهت پیش‌بینی نمیکنه. «هر» معامله رو چک میکنه: حجم، استاپ، R/R، ضرر روزانه، قرارگیری، اهرم، داده قدیمی… و هر چیزی رو میتونه وتو کنه. بدون تأیید آرس حتی در حالت کاغذی هم معامله باز نمیشه.',
      ],
    },
  },
  {
    icon: '🚫', t: { en: 'NO TRADE is a real signal', fa: '«بدون معامله» هم یک سیگنال واقعیه' },
    b: {
      en: [
        'When you see NO TRADE, the orange box lists the exact reasons: stale data, low confidence, weak agreement, bad R/R, hostile regime…',
        'This is a feature, not a bug. Forcing signals in unclear markets is exactly what signal-selling channels do before they blow up accounts.',
        'Statistically, most hours of most markets are noise. A system that speaks all the time lies most of the time.',
      ],
      fa: [
        'وقتی NO TRADE می‌بینی، کادر نارنجی دلایل رو دقیق لیست میکنه: داده قدیمی، اطمینان پایین، هم‌نظری ضعیف، R/R بد، رجیم نامناسب…',
        'این قابلیت‌ه نه باگ. سیگنال اجباری دادن در بازار مبهم، دقیقاً همون کاریه که کانال‌های سیگنال‌فروش قبل از آتیش‌زدن حساب‌ها میکنن.',
        'از نظر آماری بیشتر ساعت‌های بیشتر بازارها نویزه. سیستمی که همیشه حرف میزنه، بیشتر اوقات داره دروغ میگه.',
      ],
    },
  },
  {
    icon: '📈', t: { en: 'Chart, timeframes, overlays', fa: 'چارت، تایم‌فریم، لایه‌ها' },
    b: {
      en: [
        '12 timeframes from 1m to 1w. The MTF chips under the consensus panel show how 5m/15m/1h/4h/1d currently align — conflicts are shown, not hidden.',
        'Toggles above the chart: EMA20/50, Bollinger, VWAP (indicators) and BOS/CHoCH, Liquidity (EQH/EQL/POC), FVG, Order Blocks, Gann (smart overlays).',
        'Order Blocks are drawn as full zones (top+bottom lines, OB↑ green / OB↓ red) — only unmitigated ones. FVG zones appear as FVG↑/FVG↓.',
        'The top bar shows the live price, the data source (BINANCE/BYBIT/OKX) and latency in ms. If you ever see STALE DATA: signals are paused automatically — wait for the feed to recover.',
      ],
      fa: [
        '۱۲ تایم‌فریم از ۱ دقیقه تا هفته. چیپ‌های MTF زیر پنل اجماع نشون میدن 5m/15m/1h/4h/1d الان چقدر هم‌راستان — تضادها نمایش داده میشن، پنهان نمیشن.',
        'کلیدهای بالای چارت: EMA20/50، بولینگر، VWAP (اندیکاتور) و BOS/CHoCH، نقدینگی (EQH/EQL/POC)، FVG، اوردر‌بلاک، گن (لایه‌های هوشمند).',
        'اوردر‌بلاک‌ها به‌صورت ناحیه کامل رسم میشن (خط بالا + پایین، OB↑ سبز / OB↓ قرمز) — فقط دست‌نخورده‌ها. FVG هم با FVG↑/FVG↓.',
        'نوار بالا قیمت زنده، منبع داده (Binance/Bybit/OKX) و تأخیر رو با میلی‌ثانیه نشون میده. اگر STALE DATA دیدی: سیگنال‌دهی خودکار متوقفه — صبر کن فید برگرده.',
      ],
    },
  },
  {
    icon: '🧪', t: { en: 'Paper trading — how to practice', fa: 'معامله کاغذی — چطور تمرین کنی' },
    b: {
      en: [
        'Two ways to open a paper trade:',
        'a) Dashboard → "OPEN PAPER TRADE" button: uses the current signal — ARES sizes the position for you (default: 0.5% of your balance at risk per trade).',
        'b) Positions menu → manual order panel: your own side, quantity, SL and TP1-3. Press "FILL FROM SIGNAL" to load the signal levels, or type your own. The panel previews notional, margin, fee and max loss before you click.',
        'Execution is realistic: you pay the real ask when buying and receive the real bid when selling, plus slippage and 0.1% taker fee — exactly like a real exchange, with $10,000 test money.',
        'SL/TP are watched on live quotes and execute automatically. The red KILL SWITCH closes everything and blocks new trades.',
        'Every closed trade lands in the Journal with P&L, R multiple, fees — exportable as CSV.',
      ],
      fa: [
        'دو راه برای باز کردن معامله کاغذی:',
        'الف) داشبورد → دکمه «افتتاح معامله کاغذی»: از سیگنال فعلی استفاده میکنه — آرس حجم رو برات تعیین میکنه (پیش‌فرض: ۰.۵٪ از موجودی ریسک در هر معامله).',
        'ب) منوی معاملات باز → پنل سفارش دستی: جهت، حجم، حد ضرر و TP1-3 خودت. با «پر کردن از سیگنال» سطوح لود میشه یا دستی بزن. قبل از کلیک، ارزش/مارجین/کارمزد/حداکثر ضرر رو زنده نشون میده.',
        'اجرا واقع‌گرایانه‌ست: موقع خرید روی ask واقعی می‌خری و موقع فروش روی bid واقعی می‌فروشی، به‌علاوه اسلیپیج و کارمزد ۰.۱٪ — دقیقاً مثل صرافی واقعی، با ۱۰٬۰۰ دلار پول آزمایشی.',
        'حد ضرر/هدف‌ها روی قیمت زنده پایش و خودکار اجرا میشن. «کلید اضطراری» قرمز همه رو می‌بنده و معامله جدید رو بلاک میکنه.',
        'هر معامله بسته‌شده با سود/زیان، R و کارمزد در «ژورنال» ثبت میشه — قابل خروجی CSV.',
      ],
    },
  },
  {
    icon: '📊', t: { en: 'Backtesting — manual & automatic', fa: 'بک‌تست — دستی و خودکار' },
    b: {
      en: [
        'Backtest menu: press "RUN BACKTEST" to test the strategy on ~2000 real historical candles of your current symbol/timeframe — with fees and slippage included, decisions made only on closed candles (no cheating with future data).',
        'Switch AUTO on: it re-runs every 5 minutes automatically and shows the last run time.',
        'You get: net profit, ROI, win rate, profit factor, expectancy, average R, Sharpe, Sortino, max drawdown, win/lose streaks.',
        'Monte Carlo (2000 simulations) shows the realistic range of outcomes: P5 to P95, probability of ruin, median drawdown. Walk-Forward checks whether the strategy survives unseen data.',
        'Read Monte Carlo honestly: if P5 (worst 5% of runs) is a number you cannot afford, the risk settings are too high — lower them in Settings.',
      ],
      fa: [
        'منوی بک‌تست: با «اجرای بک‌تست» استراتژی روی ~2000 کندل تاریخی واقعی همون نماد/تایم اجرا میشه — با کارمزد و اسلیپیج، تصمیم فقط روی کندل بسته‌شده (بدون تقلب با داده آینده).',
        'AUTO رو روشن کنی: هر ۵ دقیقه خودکار دوباره اجرا میشه و ساعت آخرین اجرا رو نشون میده.',
        'خروجی: سود خالص، ROI، وین‌ریت، ضریب سود، امید ریاضی، میانگین R، شارپ، سورتینو، بیشترین افت، رشته برد/باخت.',
        'مونت‌کارلو (۲۰۰۰ شبیه‌سازی) بازه واقع‌بینانه نتایج رو نشون میده: از P5 تا P95، احتمال ورشکستگی، میانه دراودان. Walk-Forward بررسی میکنه استراتژی روی داده ندیده‌شده هم دووم میاره یا نه.',
        'مونت‌کارلو رو صادقانه بخون: اگه P5 (بدترین ۵٪ حالت‌ها) عددی‌ه که تحملش رو نداری، ریسکت زیاده — از تنظیمات کمش کن.',
      ],
    },
  },
  {
    icon: '⚙️', t: { en: 'Settings — what each number does', fa: 'تنظیمات — هر عدد چیکار میکنه' },
    b: {
      en: [
        'Risk % per trade: the % of your balance ARES risks on one trade (default 0.5%). Position size is computed from it: size = (balance × risk%) ÷ stop distance.',
        'Max risk %: hard ceiling even if you change risk%. Max daily loss %: ARES vetoes new trades after this much is lost in a day. Max exposure %: total open size limit. Max leverage: implied leverage cap.',
        'Min R/R: setups with lower reward-to-risk are rejected (default 1.3). Min confidence: signals below this are vetoed by ARES — and it also lowers the NO-TRADE floor (never below 30%).',
        'Data source: AUTO tries Binance → Bybit → OKX; you can force one. Everything you change needs "SAVE SETTINGS" — it persists in this browser.',
        'Tip for subscribers: keep defaults for 2 weeks, read your journal, then adjust.',
      ],
      fa: [
        'ریسک ٪ هر معامله: درصدی از سرمایه که آرس در هر معامله ریسک میکنه (پیش‌فرض ۰.۵٪). حجم از همین حساب میشه: حجم = (سرمایه × درصد ریسک) ÷ فاصله حد ضرر.',
        'حداکثر ریسک ٪: سقفی که حتی با تغییر ریسک رد نمیشه. حداکثر ضرر روزانه: بعد از این مقدار ضرر در یک روز، آرس وتو میکنه. حداکثر قرارگیری ٪: سقف مجموع حجم باز. حداکثر اهرم: سقف اهرم ضمنی.',
        'حداقل R/R: ستاپ‌های پایین‌تر رد میشن (پیش‌فرض 1.3). حداقل اطمینان: سیگنال پایین‌تر از این رو آرس وتو میکنه — و کف موتور NO TRADE هم باهاش میاد پایین (هرگز زیر ۳۰٪ نمیره).',
        'منبع داده: AUTO اول بایننس، بعد بای‌بیت، بعد OKX؛ میتونی دستی یکی رو قفل کنی. هر تغییری با «ذخیره تنظیمات» در همین مرورگر موندگار میشه.',
        'نکته برای مشترکین: دو هفته با پیش‌فرض کار کن، ژورنالت رو بخون، بعد تنظیم رو عوض کن.',
      ],
    },
  },
  {
    icon: '👤', t: { en: 'Your subscription', fa: 'اشتراک شما' },
    b: {
      en: [
        'Plans: 1-MONTH = 30 USDT (Tether) · 3-MONTH = 70 USDT.',
        'How to buy: press "REQUEST PURCHASE / RENEWAL" on the login page, fill your name + email + plan, send it. Then message @persiantrade2025 on Telegram (or email trade@ipeset.com) — you will get the deposit address, pay, and your account + password arrive by email (check Inbox AND Spam).',
        'The badge in the top bar shows your remaining days — it turns orange under 3 days. When it hits zero you are logged out automatically and see the renewal message.',
        'Renewal: same request form with type RENEW + your username. Your paper account history stays in your own browser — it is yours, not tied to the subscription.',
      ],
      fa: [
        'پلن‌ها: ۱ ماهه = ۳۰ تتر (USDT) · ۳ ماهه = ۷۰ تتر.',
        'نحوه خرید: در صفحه ورود دکمه «درخواست خرید / تمدید» رو بزن، نام + ایمیل + پلنت رو بنویس و بفرست. بعد در تلگرام به @persiantrade2025 (یا ایمیل trade@ipeset.com) پیام بده — آدرس واریز رو میگیری، پرداخت میکنی و اکانت + رمز از طریق ایمیل برات میاد (هم Inbox و هم Spam رو چک کن).',
        'بج بالای صفحه روزهای باقی‌مانده رو نشون میده — زیر ۳ روز نارنجی میشه. با صفر شدن، خودکار خارج میشی و پیام تمدید می‌بینی.',
        'تمدید: همون فرم درخواست با نوع «تمدید» + نام‌کاربریت. تاریخچه حساب کاغذی در مرورگر خودت می‌مونه — مال توئه و به اشتراک وابسته نیست.',
      ],
    },
  },
  {
    icon: '🔞', t: { en: 'Honesty rules of this platform', fa: 'قوانین صداقت این پلتفرم' },
    b: {
      en: [
        'No fake win rates, no fake P&L, no fabricated backtests, no invented AI numbers — everything displayed is computed from real data or your own actions.',
        'Agent accuracy is earned from real closed signals — it starts empty and fills up honestly over time.',
        'Live (real-money) trading is not connected on this platform at all. What you see is analysis + paper execution.',
        'The system can and will be wrong sometimes — markets are probabilistic. Its job is to keep your risk structured when that happens.',
      ],
      fa: [
        'وین‌ریت جعلی، سود ساختگی، بک‌تست قلابی و عدد AI ساخته‌شده وجود نداره — همه‌چی از داده واقعی یا عمل خودت محاسبه میشه.',
        'دقت ایجنت‌ها از سیگنال‌های واقعی بسته‌شده به‌دست میاد — اول خالیه و با گذشت زمان صادقانه پر میشه.',
        'اتصال به معامله پول‌واقعی روی این پلتفرم اصلاً وجود نداره. چیزی که می‌بینی تحلیل + اجرای کاغذیه.',
        'سیستم ممکنه و باید گاهی اشتباه کنه — بازار احتمالاتیه. کارش اینه که وقتی اشتباه شد، ریسک تو ساختارمند بمونه.',
      ],
    },
  },
  {
    icon: '⚠️', t: { en: 'Important warning', fa: 'هشدار مهم' },
    b: {
      en: [
        'Crypto trading involves substantial risk of loss. PersianTrade is an analysis terminal, not a profit machine. Never trade money you cannot afford to lose. Live (real-money) trading is disabled on this platform.',
        '★ IMPORTANT: If your monthly profit is 3–5%, YOU ARE A SUCCESSFUL TRADER. Do not turn yourself into a loser with greed — protect your capital first.',
        '★ Never skip the stop-loss because "this time is different". Most blown accounts are one emotional trade wide.',
        '★ Use paper mode until your own journal shows you are profitable for at least a month. The platform is the same for everyone — the difference is discipline.',
      ],
      fa: [
        'معامله ارز دیجیتال ریسک از دست دادن سرمایه دارد. پرشین ترید یک ترمینال تحلیلی است، نه ماشین سود. هرگز با پولی که توان از دست دادنش را نداری معامله نکن. معامله واقعی (پول واقعی) در این پلتفرم غیرفعال است.',
        '★ نکته مهم: اگر سود ماهانه شما ۳ تا ۵ درصد باشد، شما یک تریدر موفق هستید — با طمع کردن خودتان را بازنده نکنید؛ اول سرمایه‌تان را حفظ کنید.',
        '★ هیچ‌وقت حد ضرر رو به این بهانه که «این بار فرق داره» حذف نکن. بیشتر حساب‌های آتیش‌زده، فاصله یک معامله احساسی دارن.',
        '★ تا ژورنال خودت نشون نداده حداقل یک ماه سوددهی، فقط در حالت کاغذی باش. پلتفرم برای همه یکیه — تفاوت در نظم شخصیه.',
      ],
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

function CommoditiesScreen({ lang }: any) {
  const [px, setPx] = useState<Record<string, any> | null>(null);
  const [hist, setHist] = useState<Record<string, { t: number; p: number }[]>>(() => {
    try { return JSON.parse(localStorage.getItem('nexus_cmdty') || '{}'); } catch { return {}; }
  });

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      const d = await fetchCommodities().catch(() => null);
      if (!d || stop) return;
      setPx(d);
      setHist(h => {
        const n = { ...h };
        for (const k of Object.keys(d)) {
          const arr = [...(n[k] || []), { t: Date.now(), p: d[k].price }];
          if (arr.length > 2000) arr.splice(0, arr.length - 2000);
          n[k] = arr;
        }
        try { localStorage.setItem('nexus_cmdty', JSON.stringify(n)); } catch { /* quota */ }
        return n;
      });
    };
    void poll();
    const id = window.setInterval(() => void poll(), 30000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  const cards = [
    { key: 'XAU', fa: 'طلا', en: 'Gold (XAU/USD)', unit: '/oz' },
    { key: 'XAG', fa: 'نقره', en: 'Silver (XAG/USD)', unit: '/oz' },
    { key: 'HG', fa: 'مس', en: 'Copper (HG/USD)', unit: '/lb' },
  ];

  return (
    <div>
      <div className="cmdty-grid">
        {cards.map(c => {
          const q = px?.[c.key];
          const pts = hist[c.key] || [];
          const first = pts[0]?.p, last = pts[pts.length - 1]?.p;
          const chg = first && last ? ((last - first) / first) * 100 : null;
          const min = Math.min(...pts.map(p => p.p), Infinity), max = Math.max(...pts.map(p => p.p), -Infinity);
          const spark = pts.length > 1 && isFinite(min) && max > min
            ? pts.map((p, i) => `${(i / (pts.length - 1)) * 100},${100 - ((p.p - min) / (max - min)) * 100}`).join(' ')
            : '';
          return (
            <div key={c.key} className="panel cmdty-card">
              <div className="cmdty-name">{lang === 'fa' ? c.fa : c.en}</div>
              <div className="cmdty-price">{q ? fmt(q.price, 2, lang) + ' $' + c.unit : (px ? t('dataUnavailable', lang) : '…')}</div>
              <div className={`cmdty-chg ${chg == null ? '' : chg >= 0 ? 'up' : 'down'}`}>
                {chg == null ? '—' : `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% · ${pts.length} ${t('samplesWord', lang)}`}
              </div>
              {spark && <svg className="cmdty-spark" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points={spark} fill="none" stroke={chg != null && chg < 0 ? '#f6465d' : '#0ecb81'} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>}
            </div>
          );
        })}
      </div>
      <div className="panel" style={{ marginTop: 12 }}>
        <div className="panel-h">{t('goldTerminal', lang)}</div>
        <div className="panel-b">
          <div className="small muted">{t('goldHowTo', lang)}</div>
        </div>
      </div>
      <div className="small muted note">{t('cmdtyPollNote', lang)}</div>
    </div>
  );
}

function NewsScreen({ lang }: any) {
  const [topic, setTopic] = useState('crypto');
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async (tKey: string) => {
    setBusy(true); setErr(false); setItems(null);
    try {
      const it = await fetchNews(tKey);
      setItems(it);
    } catch {
      setErr(true); setItems([]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void load(topic); }, [topic]);
  useEffect(() => {
    const id = window.setInterval(() => void load(topic), 10 * 60000); // cache TTL on server is 10 min too
    return () => clearInterval(id);
  }, [topic]);

  return (
    <div>
      <div className="bt-ctrl">
        {NEWS_TOPICS.map(tp => (
          <button key={tp.key} className={`chip ${topic === tp.key ? 'on' : ''}`} onClick={() => setTopic(tp.key)}>{lang === 'fa' ? tp.fa : tp.en}</button>
        ))}
        <button className="btn small" disabled={busy} onClick={() => void load(topic)}>⟳ {t('refresh', lang)}</button>
      </div>
      <Panel title={`${t('news', lang)} — ${(NEWS_TOPICS.find(x => x.key === topic) as any)[lang]}`}>
        {busy && <div className="empty">{t('newsLoading', lang)}</div>}
        {err && !busy && <div className="of-row warn">{t('newsFail', lang)}</div>}
        {!busy && !err && items && !items.length && <div className="empty">{t('noData', lang)}</div>}
        {!busy && items && items.map((n, i) => (
          <a key={i} className="news-row" href={n.link} target="_blank" rel="noopener noreferrer">
            <div className="news-meta"><span className="news-src">{n.source}</span><span>{ago(n.ts, lang)}</span></div>
            <div className="news-title">{n.title}</div>
          </a>
        ))}
      </Panel>
      <div className="small muted note">{t('newsNote', lang)}</div>
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

const RISK_FIELDS: [string, string][] = [
  ['riskPct', 'risk'], ['maxRiskPct', 'Max risk %'], ['maxDailyLossPct', 'Max daily loss %'],
  ['maxExposurePct', 'Max exposure %'], ['maxLeverage', 'Max leverage'], ['minRR', 'Min R/R'], ['minConfidence', 'conf % min'],
];

function SettingsScreen({ s, lang }: any) {
  const [draft, setDraft] = useState<Record<string, number>>(() => ({ ...s.risk }));
  const [saved, setSaved] = useState(false);
  const dirty = RISK_FIELDS.some(([k]) => Number(draft[k]) !== Number(s.risk[k]));
  const save = () => { s.saveRisk(draft); setSaved(true); setTimeout(() => setSaved(false), 2500); };
  const revert = () => setDraft({ ...s.risk });

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
        <span className="small muted">{t('autoSaved', lang)}</span>
      </div>
      <div className="set-grid">
        {RISK_FIELDS.map(([k, label]) => (
          <label key={k} className="set-row"><span>{k === 'riskPct' ? t('risk', lang) + ' %' : k === 'minConfidence' ? t('confidence', lang) + ' % ' + (lang === 'fa' ? 'حداقل' : 'min') : label}</span>
            <input type="number" step="0.1" value={draft[k] ?? ''} onChange={e => setDraft(d => ({ ...d, [k]: +e.target.value }))} />
          </label>
        ))}
      </div>
      <div className="save-row">
        <button className="btn primary" disabled={!dirty} onClick={save}>💾 {t('saveSettings', lang)}</button>
        {dirty && <button className="btn" onClick={revert}>{t('revert', lang)}</button>}
        {dirty && <span className="small" style={{ color: 'var(--amber)' }}>● {t('unsaved', lang)}</span>}
        {saved && <span className="small" style={{ color: 'var(--up)' }}>✓ {t('saved', lang)}</span>}
        <button className="btn" onClick={() => { if (confirm(lang === 'fa' ? 'تنظیمات به مقادیر پیش‌فرض سیستم برگردد؟' : 'Restore system default settings?')) { s.resetRiskDefaults(); setDraft({ ...RISK_DEFAULTS }); setSaved(false); } }}>⟲ {t('resetDefaults', lang)}</button>
      </div>
      <div className="small muted note">{t('settingsPersistNote', lang)}</div>
      <div className="save-row">
        <button className="btn danger" onClick={() => { if (confirm(lang === 'fa' ? 'حساب کاغذی، ژورنال و سیگنال‌ها پاک و ۱۰٬۰۰$ بازسازی شود؟' : 'Reset paper account, journal and signals to $10,000?')) { s.resetPaper(); setSaved(false); alert(lang === 'fa' ? '✓ حساب کاغذی ریست شد' : '✓ Paper account reset'); } }}>
          🗑 {t('resetPaper', lang)}
        </button>
      </div>
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

function UsersScreen({ lang }: any) {
  const auth = useStore.getState().auth;
  if (auth.role !== 'ADMIN') return <Panel title={t('users', lang)}><div className="of-row warn">{t('adminOnly', lang)}</div></Panel>;
  return <div><UsersPanel lang={lang} /></div>;
}

function RequestsScreen({ lang }: any) {
  const auth = useStore.getState().auth;
  if (auth.role !== 'ADMIN') return <Panel title={t('requests', lang)}><div className="of-row warn">{t('adminOnly', lang)}</div></Panel>;
  return <div><RequestsPanel lang={lang} /></div>;
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
    if (ne) alert(r.mailSent
      ? (lang === 'fa' ? '✅ اکانت ساخته شد و ایمیل فعال‌سازی ارسال شد.\nبه کاربر بگویید پوشه Inbox و Spam را چک کند.' : '✅ Account created, activation email sent.\nTell the user to check INBOX and SPAM folders.')
      : (lang === 'fa' ? 'اکانت ساخته شد ولی ایمیل ارسال نشد — مشخصات را دستی بفرستید.' : 'Account created but email was NOT sent — send credentials manually.'));
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
                    <button className="btn small" disabled={busy} onClick={() => { const d = prompt(lang === 'fa' ? 'تاریخ انقضا (YYYY-MM-DD):' : 'Expiry date (YYYY-MM-DD):', new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)); if (d) void act('setexp', r.user, { date: d }); }}>📅</button>
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
