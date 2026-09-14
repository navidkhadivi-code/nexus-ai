import { useEffect, useMemo, useState } from 'react';
import { useStore, RISK_DEFAULTS } from './state/store';
import { probeSources, getSourceOrder, setSourceOrder, type SourceProbe } from './state/store';
import { t, fmt, type Lang } from './i18n';
import Chart, { type ChartPrefs } from './components/Chart';
import { analyzeStructure } from './engine/structure';
import { TIMEFRAMES, type Timeframe } from './api/binance';
import { exportCsv } from './paper/engine';
import { adminApi } from './api/adminClient';
import { fetchCommodities } from './api/commodities';
import { fetchNews, NEWS_TOPICS, ago, type NewsItem } from './api/news';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'AVAXUSDT', 'LINKUSDT', 'SUIUSDT', 'DOTUSDT', 'LTCUSDT', 'BCHUSDT', 'NEARUSDT', 'APTUSDT', 'PAXGUSDT'];

function daysLeft(exp: number, lang: Lang): string {
  const ms = exp - Date.now();
  if (ms <= 0) return t('expiredWord', lang);
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}${t('dayUnit', lang)} ${h}${t('hourUnit', lang)}` : `${h}${t('hourUnit', lang)}`;
}

type Screen = 'dashboard' | 'guide' | 'commodities' | 'news' | 'orderflow' | 'liquidity' | 'ai' | 'signals' | 'positions' | 'backtest' | 'journal' | 'report' | 'settings' | 'admin' | 'users' | 'requests' | 'health';

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
  const [touched, setTouched] = useState(false);

  if (s.auth.error === 'backend-unavailable') {
    return <div className="boot-screen"><img src="./logo.png" className="logo-img" alt="" /><div className="brand-name">{t('appTitle', lang)}</div><div className="muted small">{t('authUnavailable', lang)}</div></div>;
  }

  const uErr = touched && !u.trim() ? t('reqUserErr', lang) : '';
  const pErr = touched && p.length < 8 ? t('reqPassErr', lang) : '';

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setTouched(true);
    if (!u.trim() || p.length < 8) return;
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
        <img src="./logo.png" className="logo-img big" alt="" />
        <div className="brand-name">{t(s.auth.reason === 'expired' ? 'expiredMsg' : 'disabledMsg', lang)}</div>
        <button className="btn" onClick={() => window.location.reload()}>{t('login', lang)}</button>
      </div>
    );
  }

  return (
    <div className="boot-screen">
      <form className="login-card" onSubmit={submit} noValidate>
        <img src="./logo.png" className="logo-img big" alt="" />
        <div className="brand-name">{t('appTitle', lang)}</div>
        <div className="muted small">{t('tagline', lang)}</div>
        <div className="lang-row">
          <button type="button" className={`chip ${lang === 'en' ? 'on' : ''}`} onClick={() => s.setLocale('en')}>English</button>
          <button type="button" className={`chip ${lang === 'fa' ? 'on' : ''}`} onClick={() => s.setLocale('fa')}>فارسی</button>
        </div>
        {s.auth.setupRequired && <div className="of-row warn">{t('createAdminFirst', lang)}</div>}
        <div className="field">
          <input className={`inp ${uErr ? 'err' : ''}`} placeholder={t('username', lang)} value={u} onChange={e => setU(e.target.value)} onBlur={() => setTouched(true)} autoComplete="username" autoFocus />
          {uErr && <div className="field-err">⛔ {uErr}</div>}
        </div>
        <div className="field">
          <input className={`inp ${pErr ? 'err' : ''}`} placeholder={t('password', lang)} type="password" value={p} onChange={e => setP(e.target.value)} onBlur={() => setTouched(true)} autoComplete={s.auth.setupRequired ? 'new-password' : 'current-password'} />
          {pErr && <div className="field-err">⛔ {pErr}</div>}
        </div>
        {err && <div className="field-err server">⛔ {err}</div>}
        <button className="btn primary" disabled={busy}>{busy ? '…' : s.auth.setupRequired ? t('createAdmin', lang) : t('login', lang)}</button>
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
  const [touched, setTouched] = useState(false);
  const [f, setF] = useState({ name: '', contact: '', type: 'buy', plan: '1m', username: '', note: '', hp: '' });
  const set = (k: string, v: string) => setF(x => ({ ...x, [k]: v }));

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.contact.trim());
  const nameErr = touched && f.name.trim().length < 2 ? t('reqNameErr', lang) : '';
  const mailErr = touched && !emailOk ? t('reqMailErr', lang) : '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setTouched(true);
    if (f.name.trim().length < 2 || !emailOk) return;
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
          <div className="brand-name" style={{ fontSize: 16, letterSpacing: 1 }}>{t('requestTitle', lang)}</div>
          <div className="field">
            <input className={`inp ${nameErr ? 'err' : ''}`} placeholder={t('reqName', lang)} value={f.name} onChange={e => set('name', e.target.value)} onBlur={() => setTouched(true)} />
            {nameErr && <div className="field-err">⛔ {nameErr}</div>}
          </div>
          <div className="field">
            <input className={`inp ${mailErr ? 'err' : ''}`} type="email" placeholder={t('reqContact', lang)} value={f.contact} onChange={e => set('contact', e.target.value)} onBlur={() => setTouched(true)} autoComplete="email" />
            {mailErr && <div className="field-err">⛔ {mailErr}</div>}
          </div>
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
          {err && <div className="field-err server">⛔ {err}</div>}
          <button className="btn primary" disabled={busy}>{busy ? '…' : t('reqSend', lang)}</button>
          <button type="button" className="btn" onClick={() => setOpen(false)}>{t('cancel', lang)}</button>
        </form>
      )}
    </div>
  );
}

function GeoNotice({ lang }: any) {
  const [country, setCountry] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const check = () => {
      fetch('/api/geo.php?_=' + Date.now(), { credentials: 'same-origin', cache: 'no-store' })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(j => { if (!stop) setCountry(String(j.ok ? j.country || 'X' : '').toUpperCase()); })
        .catch(() => {
          fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined })
            .then(r => r.ok ? r.json() : Promise.reject())
            .then(j => { if (!stop) setCountry(String(j.country_code || '').toUpperCase()); })
            .catch(() => { if (!stop) setCountry(''); });
        });
    };
    check();
    const id = window.setInterval(check, 60000); // silent IP re-check every minute
    return () => { stop = true; clearInterval(id); };
  }, []);

  const isIR = country === 'IR';
  const isForeign = !!country && !isIR;
  if (isForeign) {
    return (
      <div className="geo-bar ok">
        <span>{country} · {t('geoOk', lang)}</span>
      </div>
    );
  }
  return (
    <div className={`geo-bar ${isIR ? 'warn' : 'hint'}`}>
      <span>{isIR ? '🇮 IR · ' : ''}{isIR ? t('geoIranWarn', lang) : t('geoHint', lang)}</span>
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
    { id: 'backtest', key: 'backtest' }, { id: 'journal', key: 'journal' }, { id: 'report', key: 'report' }, { id: 'settings', key: 'settings' },
    ...(s.auth?.role === 'ADMIN' ? [
      { id: 'admin' as Screen, key: 'admin' },
      { id: 'users' as Screen, key: 'usersNav' },
      { id: 'requests' as Screen, key: 'requestsNav' },
    ] : []), { id: 'health', key: 'systemHealth' },
  ];

  return (
    <div className="app">
      <GeoNotice lang={lang} />
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
          <button className="lang-btn theme-btn" title={lang === 'fa' ? 'تم روشن/تاریک' : 'Light/Dark theme'} onClick={() => s.setTheme(s.theme === 'dark' ? 'light' : 'dark')}>{s.theme === 'dark' ? '☀️' : '🌙'}</button>
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
          {screen === 'report' && <ReportScreen s={s} lang={lang} />}
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
        <Chart candles={s.candles} prefs={prefs} consensus={cons} structure={structure} liquidity={s.liquidity} gann={s.gann} tf={s.timeframe} theme={s.theme}
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
    icon: '🎯', t: { en: 'What is PersianTrade?', fa: 'پرشین‌ترید چیست؟' },
    b: {
      en: [
        'A crypto ANALYSIS terminal. It answers three questions: What is the market doing right now? What do the specialists say? Is a trade worth taking at this moment?',
        'It does NOT trade for you and does NOT promise profit — it gives structured, data-driven insight so your own decisions are better informed.',
        'Every number comes from real exchange data (Binance / Bybit / OKX). If a feed dies you see DATA UNAVAILABLE — never a fake number.',
        '17 markets supported: BTC, ETH, SOL, BNB, XRP, DOGE, ADA, TRX, AVAX, LINK, SUI, DOT, LTC, BCH, NEAR, APT + Gold (PAXG).',
      ],
      fa: [
        'یک ترمینال «تحلیل» ارز دیجیتال. به سه سوال جواب میده: بازار الان چه‌کاری میکنه؟ نظر متخصص‌ها چیه؟ آیا همین الان معامله ارزش ورود داره؟',
        'به‌جای تو معامله نمیکنه و سود تضمین نمیکنه — بینش ساختارمند و داده‌محور میده تا «خودت» تصمیم بهتری بگیری.',
        'هر عددی از داده واقعی صرافی (بایننس/بای‌بیت/OKX) میاد؛ اگر فید قطع بشه «داده در دسترس نیست» می‌بینی — هرگز عدد جعلی.',
        '۱۷ بازار پشتیبانی میشه: بیت‌کوین، اتریوم، سولانا، بایننس‌کوین، ریپل، دوج، آدا، ترون، آوالانچ، لینک، سویی، دات، لایت‌کوین، بیت‌کوین‌کش، نیر، آپت + طلا (PAXG).',
      ],
    },
  },
  {
    icon: '🧭', t: { en: 'First steps (follow this order)', fa: 'قدم‌های اول (به همین ترتیب)' },
    b: {
      en: [
        '1) Pick your market from the top bar (any of the 17).',
        '2) Pick a timeframe — start with 15m or 1h (cleaner signals).',
        '3) Watch the right panel: AI CONSENSUS — the current market opinion with confidence, entry, stop and targets.',
        '4) The red badge on the Signals menu counts new signal events.',
        '5) Practice in PAPER mode (Positions) — real prices, fake money.',
        '6) Check News for 24h headlines, and read your Report Card weekly.',
      ],
      fa: [
        '۱) بازارت رو از نوار بالا انتخاب کن (هرکدام از ۱۷ تا).',
        '۲) تایم‌فریم — با ۱۵ دقیقه یا ۱ ساعت شروع کن (سیگنال‌ها تمیزترن).',
        '۳) پنل سمت راست: اجماع هوش مصنوعی — نظر فعلی بازار با اطمینان، ورود، حد ضرر و هدف‌ها.',
        '۴) بج قرمز روی منوی سیگنال‌ها رویدادهای جدید رو میشمره.',
        '۵) در حالت کاغذی (معاملات باز) تمرین کن — قیمت واقعی، پول الکی.',
        '۶) اخبار رو روزانه چک کن و کارنامه رو هفتگی بخون.',
      ],
    },
  },
  {
    icon: '🖥️', t: { en: 'Dashboard tour', fa: 'گشتی در داشبورد' },
    b: {
      en: [
        'Top bar: symbol selector, live price, data source + latency, subscription days badge, theme ☀️/🌙 and language buttons.',
        'Center: professional chart with 12 timeframes and toggleable overlays.',
        'Right: AI CONSENSUS — direction, confidence, agreement, setup quality, levels, ARES status and the paper-trade button.',
        'Below: the 8 agent cards (each with direction, confidence bar and accuracy) and the live order book with depth chart.',
        'Bottom: portfolio summary and the red emergency KILL SWITCH.',
      ],
      fa: [
        'نوار بالا: انتخاب نماد، قیمت زنده، منبع داده + تأخیر، بج روزهای اشتراک، دکمه تم ☀️/🌙 و زبان.',
        'وسط: چارت حرفه‌ای با ۱۲ تایم‌فریم و لایه‌های قابل روشن/خاموش.',
        'سمت راست: اجماع هوش مصنوعی — جهت، اطمینان، هم‌نظری، کیفیت ستاپ، سطوح، وضعیت ARES و دکمه معامله کاغذی.',
        'پایین‌تر: ۸ کارت ایجنت (جهت، نوار اطمینان، دقت) و دفتر سفارش زنده با نمودار عمق.',
        'انتها: خلاصه پرتفوی و کلید اضطراری قرمز.',
      ],
    },
  },
  {
    icon: '📡', t: { en: 'Where are the signals?', fa: 'سیگنال‌ها کجا هستند؟' },
    b: {
      en: [
        'Dashboard right panel "AI CONSENSUS" + the "Signals" menu (with full history table).',
        'Statuses: WAITING (price not at entry yet) → ACTIVE → TP1/TP2/TP3 or STOP.',
        'A signal is issued ONLY when every gate passes: direction, confidence, agreement, R/R ≥ 1.3, live data, ARES approval.',
        'When nothing qualifies the system honestly shows NO TRADE — that is a feature, not a bug.',
      ],
      fa: [
        'پنل سمت راست داشبورد «اجماع هوش مصنوعی» + منوی «سیگنال‌ها» (با جدول تاریخچه کامل).',
        'وضعیت‌ها: WAITING (قیمت هنوز به ورود نرسیده) ← ACTIVE ← TP1/TP2/TP3 یا STOP.',
        'سیگنال فقط وقتی صادر میشه که همه دروازه‌ها رد بشن: جهت، اطمینان، هم‌نظری، R/R ≥ 1.3، داده زنده، تأیید ARES.',
        'وقتی چیزی واجد شرایط نیست، صادقانه NO TRADE نشون داده میشه — این قابلیت‌ه نه باگ.',
      ],
    },
  },
  {
    icon: '🧠', t: { en: 'How to read a signal — example', fa: 'چطور سیگنال رو بخونیم — مثال' },
    b: {
      en: [
        'Example: BTCUSDT · LONG · Confidence 72% · Agreement 86% · Entry 95,400–95,600 · SL 94,700 · TP 96,900/98,300/100,500 · R/R 2.1',
        'LONG = buy · SHORT = sell · NEUTRAL = no position. Confidence is weighted agreement of the 7 agents — NOT a probability of profit.',
        'R/R 2.1: if the stop loses 1 unit, TP1 gains ~2.1. Below 1.3 nothing is ever issued.',
        'The "WHY?" list shows the real computed reasons; "Risks" shows what can invalidate the idea.',
        'Every closed signal updates each agent\'s accuracy — the numbers you see are earned, not claimed.',
      ],
      fa: [
        'مثال: BTCUSDT · LONG · اطمینان ۷۲٪ · هم‌نظری ۸۶٪ · ورود ۹۵,۴۰۰ تا ۹۵,۶۰۰ · حد ضرر ۹۴,۷۰۰ · هدف‌ها ۹۶,۹۰۰/۹۸,۳۰۰/۱۰۰,۵۰۰ · R/R برابر 2.1',
        'LONG = خرید · SHORT = فروش · NEUTRAL = بدون پوزیشن. اطمینان یعنی شدت هم‌نظری وزن‌دار ۷ ایجنت — نه احتمال سود.',
        'R/R برابر 2.1: اگه استاپ ۱ واحد ضرر بزنه، هدف اول حدود 2.1 واحد سود داره. زیر 1.3 هیچ‌چیز صادر نمیشه.',
        'لیست «چرا؟» دلایل واقعی محاسبه‌شده رو نشون میده؛ «ریسک‌ها» چیزهایی که ایده رو باطل میکنن.',
        'هر سیگنال بسته‌شده دقت ایجنت‌ها رو آپدیت میکنه — عددها به‌دست اومدن، نه ادعا.',
      ],
    },
  },
  {
    icon: '🤖', t: { en: 'The 8 agents — who votes', fa: 'ایجنت‌های ۸‌تانه — کی رأی میده' },
    b: {
      en: [
        'NOVA (15%) market structure: HH/HL/LH/LL, BOS/CHoCH, S/R, regime.',
        'ORION (15%) price action: RSI, MACD, EMA, candle patterns.',
        'LUMA (20%) order flow: delta, CVD, book imbalance, absorption, exhaustion.',
        'ATLAS (15%) liquidity: equal highs/lows, sweeps, order blocks, FVG, POC.',
        'GANN (5%) price/time geometry. · MACRO (10%) context: dominance, Fear&Greed, funding. · QUANT (20%) pure statistics: vol, z-score, historical probability.',
        'ARES — risk manager, never votes direction, checks every trade and holds absolute veto power.',
      ],
      fa: [
        'NOVA (۱۵٪) ساختار بازار: HH/HL/LH/LL، BOS/CHoCH، حمایت/مقاومت، رجیم.',
        'ORION (۱۵٪) پرایس اکشن: RSI، MACD، EMA، الگوهای کندلی.',
        'LUMA (۲۰٪) جریان سفارش: دلتا، CVD، عدم‌تعادل دفتر، جذب، خستگی.',
        'ATLAS (۱۵٪) نقدینگی: سقف/کف برابر، اسوئیپ، اوردر‌بلاک، FVG، POC.',
        'GANN (۵٪) هندسه قیمت/زمان · MACRO (۱۰٪) کانتکست: سلطه، ترس‌وطمع، فاندینگ · QUANT (۲۰٪) آمار خالص: نوسان، z-score، احتمال تاریخی.',
        'ARES — مدیر ریسک؛ هرگز جهت رأی نمیده ولی هر معامله رو چک میکنه و حق وتوی مطلق داره.',
      ],
    },
  },
  {
    icon: '🚫', t: { en: 'NO TRADE is a real signal', fa: '«بدون معامله» هم سیگنال واقعیه' },
    b: {
      en: [
        'The orange box lists exact reasons: stale data, low confidence, weak agreement, bad R/R, hostile regime…',
        'Statistically most hours of most markets are noise. A system that always speaks, lies most of the time.',
        'Forcing signals in unclear markets is what signal-selling channels do before accounts blow up.',
      ],
      fa: [
        'کادر نارنجی دلایل رو دقیق لیست میکنه: داده قدیمی، اطمینان پایین، هم‌نظری ضعیف، R/R بد، رجیم نامناسب…',
        'آماراً بیشتر ساعت‌های بازارها نویزه. سیستمی که همیشه حرف میزنه بیشتر اوقات دروغ میگه.',
        'سیگنال اجباری در بازار مبهم، کاریه که کانال‌های سیگنال‌فروش قبل از آتیش‌زدن حساب‌ها میکنن.',
      ],
    },
  },
  {
    icon: '📈', t: { en: 'Chart, timeframes & overlays', fa: 'چارت، تایم‌فریم و لایه‌ها' },
    b: {
      en: [
        '12 timeframes from 1m to 1w; MTF chips under the consensus show how timeframes align or conflict — conflicts are shown, not hidden.',
        'Indicator toggles: EMA20/50, Bollinger, VWAP.',
        'Smart overlays: BOS/CHoCH (structure breaks), Liquidity (EQH/EQL/POC), FVG zones, Order Blocks (full zones OB↑/OB↓, unmitigated only), Gann fan.',
        'STALE DATA on the top bar = feed is old → signals paused automatically. Wait for LIVE.',
      ],
      fa: [
        '۱۲ تایم‌فریم از ۱ دقیقه تا هفته؛ چیپ‌های MTF نشون میدن تایم‌ها چطور هم‌راستا یا در تضادن — تضادها پنهان نمیشن.',
        'اندیکاتورها: EMA20/50، بولینگر، VWAP.',
        'لایه‌های هوشمند: BOS/CHoCH (شکست ساختار)، نقدینگی (EQH/EQL/POC)، زون‌های FVG، اوردر‌بلاک‌ها (ناحیه کامل OB↑/OB↓ فقط دست‌نخورده)، پنکه گن.',
        'اگر STALE DATA دیدی یعنی فید قدیمیه ← سیگنال خودکار متوقفه. صبر تا LIVE بشه.',
      ],
    },
  },
  {
    icon: '🔍', t: { en: 'Order Flow screen', fa: 'صفحه جریان سفارشات' },
    b: {
      en: [
        'The full depth of book (18 levels both sides) + LUMA\'s live reading: delta, CVD trend, absorption (big volume without price movement), exhaustion (climax candles), book imbalance.',
        'Buy pressure ≠ price up: absorption shows when passive orders are eating aggressive flow — often before reversals.',
        'Spoof-like patterns are labeled POSSIBLE SPOOFING — never stated as fact.',
      ],
      fa: [
        'عمق کامل دفتر (۱۸ سطح هر طرف) + قرائت زنده LUMA: دلتا، روند CVD، جذب (حجم زیاد بدون حرکت قیمت)، خستگی (کندل‌های اوج)، عدم‌تعادل دفتر.',
        'فشار خرید ≠ قیمت بالا: جذب نشون میده کجا سفارشات منفعل جریان تهاجمی رو میخورن — معمولاً قبل از برگشت.',
        'الگوهای شبیه اسپوف فقط با برچسب «احتمال اسپوف» اعلام میشن — هرگز به‌عنوان واقعیت.',
      ],
    },
  },
  {
    icon: '💧', t: { en: 'Liquidity screen', fa: 'صفحه نقدینگی' },
    b: {
      en: [
        'Where the stop-losses are hiding: equal highs/lows, recent sweeps, unmitigated order blocks, open FVGs, volume POC and resting walls from the live book.',
        'Sweep probabilities are historical frequencies per candle — estimates, never guarantees.',
        'ATLAS uses all of this for its vote: e.g. a fresh downside sweep + bullish structure = long bias.',
      ],
      fa: [
        'استاپ‌ها کجا قایمن: سقف/کف‌های برابر، اسوئیپ‌های اخیر، اوردر‌بلاک‌های دست‌نخورده، FVGهای باز، POC حجم و دیوارهای دفتر زنده.',
        'احتمال اسوئیپ، فراوانی تاریخی در هر کندله — برآورد، هرگز تضمین.',
        'ATLAS از همه این‌ها برای رأیش استفاده میکنه: مثلاً اسوئیپ تازه از سمت پایین + ساختار صعودی = بایاس LONG.',
      ],
    },
  },
  {
    icon: '📰', t: { en: 'News & Commodities', fa: 'اخبار و کالاها' },
    b: {
      en: [
        'News: last-24h headlines per asset (BTC, ETH, SOL, XRP, DOGE, ADA, gold…) aggregated from major outlets via Google News — with source and time. Click to open the original.',
        'Commodities: live spot of Gold/Silver/Copper sampled every 30s from a public feed — the chart line shows only actually-collected samples.',
        'Gold on the full terminal (candles, book, signals): select PAXGUSDT — tokenized gold, 1 PAXG = 1 fine ounce.',
      ],
      fa: [
        'اخبار: تیترهای ۲۴ ساعت اخیر برای هر ارز از خبرگزاری‌های معتبر از طریق Google News با منبع و زمان؛ با کلیک خبر اصلی باز میشه.',
        'کالاها: قیمت لحظه‌ای واقعی طلا/نقره/مس با نمونه‌برداری هر ۳۰ ثانیه — نمودار فقط نمونه‌های واقعاً جمع‌شده رو نشون میده.',
        'طلا در ترمینال کامل (کندل، دفتر، سیگنال): نماد PAXGUSDT — طلای توکنیزه، هر واحد = ۱ اونس.',
      ],
    },
  },
  {
    icon: '🧪', t: { en: 'Paper trading — practice mode', fa: 'معامله کاغذی — حالت تمرین' },
    b: {
      en: [
        'Two ways to open: a) the "OPEN PAPER TRADE" button uses the current signal with ARES position sizing. b) Positions menu → manual panel: your own side/qty/SL/TP, with "FILL FROM SIGNAL" shortcut and live preview of margin, fee and max loss.',
        'Execution is realistic: buy pays the real ask, sell receives the real bid, + slippage + 0.1% taker fee. SL/TP watch live quotes and fire automatically.',
        'KILL SWITCH (red) closes everything and blocks new trades.',
        'Journal keeps every closed trade: P&L, R multiple, fees, origin (signal vs manual) — CSV export available.',
      ],
      fa: [
        'دو راه باز کردن: الف) دکمه «افتتاح معامله کاغذی» از سیگنال فعلی با حجم‌گذاری آرس استفاده میکنه. ب) منوی معاملات باز → پنل دستی: جهت/حجم/استاپ/هدف خودت، با شورت‌کات «پر کردن از سیگنال» و پیش‌نمایش زنده مارجین، کارمزد و حداکثر ضرر.',
        'اجرا واقع‌گرایانه: خرید روی ask واقعی، فروش روی bid واقعی + اسلیپیج + کارمزد ۰.۱٪. حد ضرر/هدف روی قیمت زنده پایش و خودکار اجرا میشن.',
        'کلید اضطراری (قرمز) همه رو میبنده و معامله جدید رو بلاک میکنه.',
        'ژورنال هر معامله بسته‌شده رو نگه میداره: سود/زیان، R، کارمزد، مبدأ (سیگنال یا دستی) — خروجی CSV هم داره.',
      ],
    },
  },
  {
    icon: '🧾', t: { en: 'Report Card — discipline mirror', fa: 'کارنامه — آینه انضباط' },
    b: {
      en: [
        'Grades YOUR closed paper trades A–E by fixed rules: signal-vs-manual edge, TP/SL ratio, overtrading, risk consistency, hold time.',
        'The key number: average R when you followed the system vs when you freelanced. Most traders discover the signal side wins.',
        'The Coach section gives concrete corrections from your own journal. Read it weekly — it is a mirror, not a profit promise.',
      ],
      fa: [
        'معاملات بسته‌شده کاغذی «خودت» رو با قواعد ثابت A تا E نمره میده: برتری سیگنال نسبت به دستی، نسبت TP/استاپ، پرمعامله‌ای، ثبات ریسک، زمان نگهداری.',
        'عدد کلیدی: میانگین R وقتی از سیستم پیروی کردی در برابر وقتی سلیقه‌ای زدی. بیشتر تریدرها کشف میکنن سمت سیگنال برنده‌ست.',
        'بخش مربی اصلاحات مشخص از همون ژورنال خودت رو میده. هفتگی بخونش — آینه‌ست، نه وعده سود.',
      ],
    },
  },
  {
    icon: '📊', t: { en: 'Backtesting — manual & automatic', fa: 'بک‌تست — دستی و خودکار' },
    b: {
      en: [
        'RUN BACKTEST: the strategy on ~2000 real candles of the current symbol/timeframe, fees + slippage included, decisions only on closed candles (no future peeking).',
        'AUTO: re-runs every 5 minutes and shows the last run time.',
        'Honest window: first 120 candles are warmup only and excluded from every metric — the "Evaluation window" line shows what was scored.',
        'Monte Carlo (2000 runs): P5–P95 range, probability of ruin, median drawdown. Walk-Forward: optimizes in-sample, scores only out-of-sample.',
        'If Monte Carlo P5 is a number you cannot afford — your risk settings are too high.',
      ],
      fa: [
        'اجرای بک‌تست: استراتژی روی ~۲۰۰۰ کندل واقعی نماد/تایم فعلی، با کارمزد و اسلیپیج، تصمیم فقط روی کندل بسته (بدون نگاه به آینده).',
        'AUTO: هر ۵ دقیقه خودکار اجرا میشه و ساعت آخرین اجرا نمایش داده میشه.',
        'پنجره صادقانه: ۱۲۰ کندل اول فقط warmupه و از همه متریک حذفه — خط «پنجره ارزیابی» نشون میده چی نمره گرفته.',
        'مونت‌کارلو (۲۰۰۰ اجرا): بازه P5 تا P95، احتمال ورشکستگی، میانه دراودان. Walk-Forward: بهینه‌سازی روی داده این‌نمونه، نمره‌دهی فقط روی داده ندیده.',
        'اگه P5 مونت‌کارلو عددی‌ه که تحملش رو نداری — ریسکت زیاده.',
      ],
    },
  },
  {
    icon: '⚙️', t: { en: 'Settings — every field explained', fa: 'تنظیمات — هر فیلد چیکار میکنه' },
    b: {
      en: [
        'Risk % per trade: what ARES risks on one trade (default 0.5%). Size = (balance × risk%) ÷ stop distance.',
        'Max risk / Max daily loss / Max exposure / Max leverage: hard caps — ARES vetoes when crossed.',
        'Min R/R (default 1.3) and Min confidence: floors for signal issuance.',
        'Data sources: AUTO tries Binance → Bybit → OKX; "TEST LATENCY" measures from YOUR device and ↑↓ reorders the chain.',
        '☀️/🌙 theme and فارسی/EN language persist per browser. Everything needs "SAVE SETTINGS".',
      ],
      fa: [
        'ریسک ٪ هر معامله: چیزی که آرس ریسک میکنه (پیش‌فرض ۰.۵٪). حجم = (سرمایه × ریسک٪) ÷ فاصله استاپ.',
        'حداکثر ریسک / ضرر روزانه / قرارگیری / اهرم: سقف‌های سخت — با عبور از هرکدام ARES وتو میکنه.',
        'حداقل R/R (پیش‌فرض 1.3) و حداقل اطمینان: کف‌های صدور سیگنال.',
        'منابع داده: AUTO اول بایننس، بعد بای‌بیت، OKX؛ «تست تأخیر» از دستگاه خودت میسنجه و با ↑↓ ترتیب رو عوض میکنه.',
        'تم ☀️/ و زبان فارسی/EN در همین مرورگر ذخیره میشن. هر تغییری با «ذخیره تنظیمات» موندگار میشه.',
      ],
    },
  },
  {
    icon: '👤', t: { en: 'Your subscription', fa: 'اشتراک شما' },
    b: {
      en: [
        'Plans: 1-MONTH = 13 USDT (Tether) · 3-MONTH = 29 USDT.',
        'How to buy: "REQUEST PURCHASE / RENEWAL" on the login page → fill name + email + plan → pay after instructions from Telegram @persiantrade2025 → credentials arrive by email (check Inbox AND Spam).',
        'The ⏳ badge in the top bar shows remaining days (orange under 3). At zero you are logged out automatically.',
        'Your paper account & journal live in YOUR browser — private to you, kept after renewal.',
      ],
      fa: [
        'پلن‌ها: ۱ ماهه = ۱۳ تتر (USDT) · ۳ ماهه = ۲۹ تتر.',
        'نحوه خرید: دکمه «درخواست خرید/تمدید» در صفحه ورود → نام + ایمیل + پلن → پرداخت طبق راهنمای تلگرام @persiantrade2025 → مشخصات ورود با ایمیل (هم Inbox هم Spam رو چک کن).',
        'بج ⏳ بالای صفحه روزهای باقی‌مانده رو نشون میده (زیر ۳ روز نارنجی). با صفر شدن خودکار خارج میشی.',
        'حساب کاغذی و ژورنال در مرورگر «خودت» میمونه — خصوصی و بعد از تمدید حفظ.',
      ],
    },
  },
  {
    icon: '🔞', t: { en: 'Honesty rules of this platform', fa: 'قوانین صداقت این پلتفرم' },
    b: {
      en: [
        'No fake win rates, no fabricated backtests, no invented AI numbers — everything is computed from real data or your own actions.',
        'Agent accuracy is earned from real closed signals over time.',
        'Live (real-money) trading is not connected here at all.',
        'The system will be wrong sometimes — markets are probabilistic. Its job: keep your risk structured when that happens.',
      ],
      fa: [
        'وین‌ریت جعلی، بک‌تست قلابی و عدد ساختگی وجود نداره — همه‌چیز از داده واقعی یا عمل خودت.',
        'دقت ایجنت‌ها از نتایج واقعی سیگنال‌های بسته‌شده در طول زمان ساخته میشه.',
        'اتصال به معامله پول‌واقعی روی این پلتفرم اصلاً وجود نداره.',
        'سیستم گاهی اشتباه میکنه — بازار احتمالاتیه؛ کارش اینه که ریسکت رو ساختارمند نگه داره.',
      ],
    },
  },
  {
    icon: '⚠️', t: { en: 'Important warnings', fa: 'هشدارهای مهم' },
    b: {
      en: [
        'Crypto trading involves substantial risk of loss. PersianTrade is an analysis terminal, not a profit machine. Never trade money you cannot afford to lose.',
        '★ If your monthly profit is 3–5%, YOU ARE A SUCCESSFUL TRADER. Greed turns winners into losers — protect capital first.',
        '★ Never remove a stop-loss because "this time is different". Most blown accounts are one emotional trade wide.',
        '★ Stay in paper mode until your own Report Card shows discipline for at least a month. The platform is the same for everyone — the difference is discipline.',
      ],
      fa: [
        'معامله ارز دیجیتال ریسک از دست دادن سرمایه داره. پرشین‌ترید ترمینال تحلیلیه نه ماشین سود. هرگز با پولی که توان از دست دادنش رو نداری معامله نکن.',
        '★ اگه سود ماهانه‌ات ۳ تا ۵ درصد باشه، تو یک تریدر موفقی. طمع برنده رو بازنده میکنه — اول سرمایه رو حفظ کن.',
        '★ هیچ‌وقت حد ضرر رو به بهانه «این بار فرق داره» حذف نکن. بیشتر حساب‌های آتیش‌زده فاصله یک معامله احساسی دارن.',
        '★ تا کارنامه‌ات حداقل یک ماه انضباط نشون نداده، در حالت کاغذی بمون. پلتفرم برای همه یکیه — تفاوت در نظمه.',
      ],
    },
  },
];

function GuideScreen({ lang }: any) {
  const L = lang as 'en' | 'fa';
  const [open, setOpen] = useState<number | null>(null);
  const nn = (i: number) => String(i + 1).padStart(2, '0');

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  const viewAll = () => {
    setOpen(null);
    setTimeout(() => document.getElementById('guide-all')?.scrollIntoView({ behavior: 'smooth' }), 60);
  };

  return (
    <div className="guide-wrap2">
      <div className="guide-toc">
        {GUIDE.map((g, i) => <button key={i} className="toc-chip" onClick={() => setOpen(i)}><b>{nn(i)}</b>{g.t[L]}</button>)}
        <button className="toc-chip all" onClick={viewAll}>📚 {L === 'fa' ? 'مشاهده کل آموزش' : 'VIEW FULL GUIDE'}</button>
      </div>

      {open != null && (
        <div className="g-modal-bg" onClick={() => setOpen(null)}>
          <div className="g-modal" onClick={e => e.stopPropagation()}>
            <div className="g-modal-h">
              <span className="g-num">{nn(open)}</span>
              <b>{GUIDE[open].icon} {GUIDE[open].t[L]}</b>
              <button className="g-close" onClick={() => setOpen(null)} aria-label="close">✕</button>
            </div>
            <ul className="g-modal-list">{GUIDE[open].b[L].map((line, j) => <li key={j}>{line}</li>)}</ul>
            <div className="g-modal-foot">
              <button className="btn sm" disabled={open === 0} onClick={() => setOpen(open - 1)}>← {L === 'fa' ? 'قبلی' : 'PREV'}</button>
              <button className="btn sm" onClick={viewAll}>📚 {L === 'fa' ? 'کل آموزش' : 'FULL GUIDE'}</button>
              <button className="btn sm" disabled={open >= GUIDE.length - 1} onClick={() => setOpen(open + 1)}>{L === 'fa' ? 'بعدی' : 'NEXT'} →</button>
            </div>
          </div>
        </div>
      )}

      <div id="guide-all" className="guide-grid">
        {GUIDE.map((g, i) => (
          <section key={i} className="panel guide-card" onClick={() => setOpen(i)} style={{ cursor: 'pointer' }}>
            <div className="panel-h"><span className="g-num">{nn(i)}</span>{g.icon} {g.t[L]}</div>
            <div className="panel-b"><ul className="guide-list">{g.b[L].map((line, j) => <li key={j}>{line}</li>)}</ul></div>
          </section>
        ))}
      </div>
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

// ---------------- REPORT CARD (کارنامه معاملاتی) ----------------
function ReportScreen({ s, lang }: any) {
  const j = s.paper.journal as any[];
  if (!j.length) {
    return <Panel title={t('report', lang)}><div className="empty">{t('reportEmpty', lang)}</div></Panel>;
  }
  const total = j.length;
  const wins = j.filter(x => x.pnlUsd > 0);
  const winRate = (wins.length / total) * 100;
  const pnl = j.reduce((a, x) => a + x.pnlUsd, 0);
  const avgR = j.reduce((a, x) => a + (x.rMultiple || 0), 0) / total;
  const best = j.reduce((a, x) => x.pnlUsd > (a?.pnlUsd ?? -Infinity) ? x : a, j[0]);
  const worst = j.reduce((a, x) => x.pnlUsd < (a?.pnlUsd ?? Infinity) ? x : a, j[0]);
  const byOrigin = (o: string) => j.filter(x => (x.origin || 'manual') === o);
  const sig = byOrigin('signal'), man = byOrigin('manual');
  const avgRof = (arr: any[]) => arr.length ? arr.reduce((a, x) => a + (x.rMultiple || 0), 0) / arr.length : null;
  const srR = avgRof(sig), mrR = avgRof(man);
  const stops = j.filter(x => x.consensusDir === 'SL').length;
  const tps = j.filter(x => x.consensusDir === 'TP').length;
  const holds = j.map(x => x.closedAt - x.openedAt).filter(t => t > 0);
  const avgHoldMin = holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length / 60000 : 0;
  const days = new Set(j.map(x => new Date(x.closedAt).toDateString())).size || 1;
  const perDay = total / days;
  const risks = j.map(x => x.riskUsd || 0).filter((x: number) => x > 0);
  const rMean = risks.length ? risks.reduce((a, b) => a + b, 0) / risks.length : 0;
  const rVar = risks.length > 1 ? Math.sqrt(risks.reduce((a, b) => a + (b - rMean) ** 2, 0) / risks.length) / (rMean || 1) : 0;
  let streak = 0, cur = 0;
  for (const x of [...j].sort((a, b) => a.closedAt - b.closedAt)) { cur = x.pnlUsd > 0 ? Math.max(0, cur) + (x.pnlUsd > 0 ? 1 : 0) : (x.pnlUsd < 0 ? -1 : 0); cur = x.pnlUsd > 0 ? (cur > 0 ? cur + 1 : 1) : (cur < 0 ? cur - 1 : -1); streak = Math.min(streak, cur); }

  // discipline score (deterministic, rule-based)
  let score = 50;
  if (srR != null && mrR != null) score += Math.max(-15, Math.min(15, Math.round((srR - mrR) * 10)));
  if (tps > stops) score += 10; else if (stops > tps * 1.5) score -= 10;
  if (perDay > 8) score -= 10; else if (perDay <= 4) score += 5;
  if (rVar < 0.35) score += 10; else if (rVar > 0.8) score -= 10;
  if (avgHoldMin < 5 && total > 10) score -= 10;
  score = Math.max(0, Math.min(100, score));
  const grade = score >= 80 ? { k: 'A', tone: 'up' } : score >= 65 ? { k: 'B', tone: 'up' } : score >= 50 ? { k: 'C', tone: '' } : score >= 35 ? { k: 'D', tone: 'down' } : { k: 'E', tone: 'down' };

  const tips: { en: string; fa: string }[] = [];
  if (srR != null && mrR != null && sig.length >= 3 && man.length >= 3 && mrR < srR) tips.push({ en: 'Your manual trades average lower R than signal-followed trades — follow the system more.', fa: 'میانگین R معاملات دستی‌ات از معاملاتی که با سیگنال گرفته‌ای پایین‌تر است — بیشتر به سیستم پایبند باش.' });
  if (perDay > 8) tips.push({ en: 'Overtrading detected (more than 8 trades/day). Quality setups are rare by design.', fa: 'معامله بیش از حد (بیش از ۸ در روز). ستاپ باکیفیت عملاً کم پیش می‌آید.' });
  if (rVar > 0.8) tips.push({ en: 'Inconsistent risk sizing — keep risk per trade fixed (Settings → risk %).', fa: 'ریسک نامتغییر در حجم‌ها — ریسک هر معامله را ثابت نگه دار (تنظیمات).' });
  if (stops > tps * 1.5) tips.push({ en: 'More stops than targets — consider trading only when consensus confidence is high.', fa: 'استاپ بیشتر از هدف — فقط در اطمینان بالای اجماع وارد شو.' });
  if (avgHoldMin < 5 && total > 10) tips.push({ en: 'Very short holds — you may be scalping against your own stop distances.', fa: 'مدت نگهداری خیلی کوتاه — شاید علیه فاصله استاپ خودت نوسان‌گیری می‌کنی.' });
  if (!tips.length) tips.push({ en: 'Solid discipline. Keep the journal as your source of truth.', fa: 'انضباط خوب. ژورنال را مرجع خودت نگه دار.' });

  return (
    <div>
      <Panel title={`${t('report', lang)} — ${total} ${t('closedTrades', lang)}`}>
        <div className="rep-head">
          <div className={`rep-grade ${grade.tone}`}>{grade.k}<span>{score}/100</span></div>
          <div className="rep-stats">
            <Metric label={t('pnl', lang)} value={`$${fmt(pnl, 2, lang)}`} tone={pnl >= 0 ? 'up' : 'down'} />
            <Metric label={t('winRate', lang)} value={`${fmt(winRate, 1, lang)}%`} />
            <Metric label="Avg R" value={fmt(avgR, 2, lang)} tone={avgR >= 0 ? 'up' : 'down'} />
            <Metric label={t('bestTrade', lang)} value={`$${fmt(best.pnlUsd, 2, lang)}`} tone="up" />
            <Metric label={t('worstTrade', lang)} value={`$${fmt(worst.pnlUsd, 2, lang)}`} tone="down" />
            <Metric label={t('avgHold', lang)} value={`${fmt(avgHoldMin, 0, lang)} ${t('minUnit', lang)}`} />
          </div>
        </div>
        <div className="rep-split">
          <div className="card">
            <h3>📡 {t('viaSignal', lang)} ({sig.length})</h3>
            <p>{t('avgR', lang)}: <b className={(srR ?? 0) >= 0 ? 'up' : 'down'}>{srR == null ? '—' : fmt(srR, 2, lang)}</b> · TP: {sig.filter(x => x.consensusDir === 'TP').length} · SL: {sig.filter(x => x.consensusDir === 'SL').length}</p>
          </div>
          <div className="card">
            <h3>✋ {t('viaManual', lang)} ({man.length})</h3>
            <p>{t('avgR', lang)}: <b className={(mrR ?? 0) >= 0 ? 'up' : 'down'}>{mrR == null ? '—' : fmt(mrR, 2, lang)}</b> · TP: {man.filter(x => x.consensusDir === 'TP').length} · SL: {man.filter(x => x.consensusDir === 'SL').length}</p>
          </div>
        </div>
        <div className="tips">
          <b>{t('coachTitle', lang)}</b>
          {tips.map((tp, i) => <div key={i} className="tip-row">▸ {(tp as any)[lang]}</div>)}
        </div>
        <div className="small muted note">{t('reportNote', lang)}</div>
      </Panel>
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
        <div>
          {bt.evalFrom && bt.evalTo ? (
            <div className="small muted" style={{ marginBottom: 8 }}>
              {t('evalWindow', lang)}: <b>{new Date(bt.evalFrom).toLocaleDateString()}</b> ← <b>{new Date(bt.evalTo).toLocaleDateString()}</b> · {t('warmupExcluded', lang)}
            </div>
          ) : null}
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

function SourcePanel({ lang }: any) {
  const [probes, setProbes] = useState<SourceProbe[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<string[]>(() => getSourceOrder());

  const test = async () => { setBusy(true); setProbes(await probeSources()); setBusy(false); };
  const move = (i: number, dir: -1 | 1) => {
    const n = [...order];
    const j = i + dir;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]];
    setOrder(n);
    setSourceOrder(n);
  };
  const NAME: Record<string, string> = { BINANCE: 'Binance', BYBIT: 'Bybit', OKX: 'OKX' };

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <h3>📶 {t('sourcesTitle', lang)}</h3>
      <p className="small muted" style={{ marginBottom: 10 }}>{t('sourceOrderHint', lang)}</p>
      {order.map((id, i) => {
        const pr = probes?.find(x => x.id === id);
        return (
          <div key={id} className="src-row">
            <b className="src-idx">{i + 1}</b>
            <span className="src-name">{NAME[id] ?? id}</span>
            <span className={`src-lat ${pr ? (pr.ok ? (pr.ms < 500 ? 'up' : '') : 'down') : ''}`}>
              {pr ? (pr.ok ? `${pr.ms} ms` : t('unreachable', lang)) : '—'}
            </span>
            <span className="src-btns">
              <button className="btn small" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button className="btn small" disabled={i === order.length - 1} onClick={() => move(i, 1)}>↓</button>
            </span>
          </div>
        );
      })}
      <button className="btn sm" disabled={busy} onClick={() => void test()} style={{ marginTop: 8 }}>⚡ {t('testLatency', lang)}</button>
    </div>
  );
}

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
      <SourcePanel lang={lang} />
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
