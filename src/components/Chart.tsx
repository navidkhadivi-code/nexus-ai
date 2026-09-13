import { useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, Time, ColorType, LineStyle } from 'lightweight-charts';
import type { Candle } from '../api/binance';
import { ema, rsi, macd, bollinger, vwap, atr } from '../engine/indicators';
import type { ConsensusResult } from '../agents/consensus';
import type { StructureResult } from '../engine/structure';
import type { LiquidityResult } from '../engine/liquidity';
import type { GannResult } from '../engine/gann';

export interface ChartPrefs {
  ema20: boolean; ema50: boolean; bb: boolean; vwap: boolean;
  bos: boolean; liquidity: boolean; fvg: boolean; ob: boolean; gann: boolean;
}

interface Props {
  candles: Candle[];
  prefs: ChartPrefs;
  consensus: ConsensusResult | null;
  structure: StructureResult | null;
  liquidity: LiquidityResult | null;
  gann: GannResult | null;
  tf: string;
  signalLine?: { entry: number; stop: number; targets: number[] } | null;
}

export default function Chart({ candles, prefs, consensus, structure, liquidity, gann, tf, signalLine }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeries = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volSeries = useRef<ISeriesApi<'Histogram'> | null>(null);
  const lineSeries = useRef<ISeriesApi<'Line'>[]>([]);
  const priceLines = useRef<any[]>([]);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: '#070b12' }, textColor: '#8b98ad', fontSize: 11 },
      grid: { vertLines: { color: '#0e1420' }, horzLines: { color: '#0e1420' } },
      timeScale: { borderColor: '#1a2436', timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: '#1a2436' },
      crosshair: { mode: 0 },
      autoSize: true,
    });
    chartRef.current = chart;
    candleSeries.current = chart.addCandlestickSeries({ upColor: '#0ecb81', downColor: '#f6465d', borderVisible: false, wickUpColor: '#0ecb81', wickDownColor: '#f6465d' });
    volSeries.current = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    return () => { chart.remove(); chartRef.current = null; };
  }, []);

  const datasetKey = candles.length ? candles[0].t : -1;
  useEffect(() => {
    const chart = chartRef.current, cs = candleSeries.current, vs = volSeries.current;
    if (!chart || !cs || !vs || !candles.length) return;
    cs.setData(candles.map(c => ({ time: c.t / 1000 as Time, open: c.o, high: c.h, low: c.l, close: c.c })));
    vs.setData(candles.map(c => ({ time: c.t / 1000 as Time, value: c.v, color: c.c >= c.o ? 'rgba(14,203,129,.35)' : 'rgba(246,70,93,.35)' })));
    chart.timeScale().fitContent();
  }, [datasetKey, tf]);

  // rebuild overlay line series on prefs / data change
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !candles.length) return;
    for (const s of lineSeries.current) { try { chart.removeSeries(s); } catch { /* gone */ } }
    lineSeries.current = [];
    for (const pl of priceLines.current) { try { candleSeries.current?.removePriceLine(pl); } catch { /* gone */ } }
    priceLines.current = [];
    const closes = candles.map(c => c.c);
    const addLine = (vals: (number | null)[], color: string, width: 1 | 2 | 3 | 4 = 2) => {
      const data = candles.map((c, i) => ({ time: c.t / 1000 as Time, value: vals[i] })).filter(d => d.value != null) as { time: Time; value: number }[];
      if (!data.length) return;
      const s = chart.addLineSeries({ color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(data);
      lineSeries.current.push(s);
    };
    if (prefs.ema20) addLine(ema(closes, 20), '#4f8cff');
    if (prefs.ema50) addLine(ema(closes, 50), '#b46bff');
    if (prefs.bb) { const b = bollinger(closes); addLine(b.upper, 'rgba(139,152,173,.55)', 1); addLine(b.lower, 'rgba(139,152,173,.55)', 1); addLine(b.mid, 'rgba(139,152,173,.35)', 1); }
    if (prefs.vwap) addLine(vwap(candles), '#ffb347');

    const cs = candleSeries.current!;
    const addPriceLine = (price: number, color: string, title: string, style = LineStyle.Dashed) => {
      if (!isFinite(price) || price <= 0) return;
      priceLines.current.push(cs.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
    };
    if (prefs.bos && structure) {
      for (const b of structure.bos.slice(-4)) addPriceLine(b.price, b.type.includes('BULL') ? '#0ecb81' : '#f6465d', b.type.replace('_', ' '));
      for (const b of structure.choch.slice(-3)) addPriceLine(b.price, '#ffd166', b.type.replace('_', ' '), LineStyle.Dotted);
    }
    if (prefs.liquidity && liquidity) {
      for (const h of liquidity.equalHighs.slice(0, 3)) addPriceLine(h, '#f6465d', 'EQH', LineStyle.Dashed);
      for (const l of liquidity.equalLows.slice(0, 3)) addPriceLine(l, '#0ecb81', 'EQL', LineStyle.Dashed);
      if (liquidity.poc) addPriceLine(liquidity.poc, '#5ac8fa', 'POC', LineStyle.Solid);
    }
    if (prefs.ob && liquidity) {
      for (const ob of liquidity.orderBlocks.slice(-5)) {
        const col = ob.type === 'BULL' ? 'rgba(14,203,129,.8)' : 'rgba(246,70,93,.8)';
        const tag = ob.type === 'BULL' ? 'OB↑' : 'OB↓';
        addPriceLine(ob.top, col, tag, LineStyle.Solid);
        addPriceLine(ob.bottom, col, '', LineStyle.Dotted);
      }
    }
    if (prefs.fvg && liquidity) {
      for (const f of liquidity.fvgs.slice(-6)) {
        const col = f.type === 'BULL' ? 'rgba(90,200,250,.65)' : 'rgba(255,140,90,.65)';
        addPriceLine(f.top, col, f.type === 'BULL' ? 'FVG↑' : 'FVG↓', LineStyle.Dotted);
        addPriceLine(f.bottom, col, '', LineStyle.Dotted);
      }
    }
    if (prefs.gann && gann) {
      for (const l of gann.levels.filter(x => x.strength > 0.2).slice(0, 6)) addPriceLine(l.price, 'rgba(255,179,71,.45)', `GANN ${l.angle}`, LineStyle.Dotted);
    }
    if (signalLine) {
      addPriceLine(signalLine.entry, '#4f8cff', 'ENTRY', LineStyle.Solid);
      addPriceLine(signalLine.stop, '#f6465d', 'SL', LineStyle.Solid);
      signalLine.targets.forEach((tp, i) => addPriceLine(tp, '#0ecb81', `TP${i + 1}`, LineStyle.Solid));
    }
  }, [candles.length, prefs, structure?.regime, liquidity?.poc, gann?.origin.price, signalLine?.entry, consensus?.direction]);

  // live candle update
  useEffect(() => {
    const last = candles[candles.length - 1];
    if (last && candleSeries.current) {
      candleSeries.current.update({ time: last.t / 1000 as Time, open: last.o, high: last.h, low: last.l, close: last.c });
      volSeries.current?.update({ time: last.t / 1000 as Time, value: last.v, color: last.c >= last.o ? 'rgba(14,203,129,.35)' : 'rgba(246,70,93,.35)' });
    }
  }, [candles]);

  return <div ref={ref} className="chart-host" />;
}
