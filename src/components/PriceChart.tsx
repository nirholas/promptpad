'use client';

import { useEffect, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';

import { nativeSymbol, type ChainKey } from '@/lib/config';
import { formatNative } from '@/lib/format';

type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
type Interval = (typeof INTERVALS)[number];
type Source = 'native' | 'dexscreener' | 'dextools';

const TOTAL_SUPPLY = 1_000_000_000;
const POLL_MS = 15_000;

function cssVar(name: string) {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function usd(value: number) {
	const abs = Math.abs(value);
	if (abs >= 1000) return `$${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value)}`;
	if (abs >= 1) return `$${value.toFixed(2)}`;
	return `$${formatNative(value)}`;
}

/**
 * The token chart. Robinhood Chain tokens draw candles from the platform's own trade index with
 * TradingView's lightweight-charts; Solana tokens show DexScreener and DEXTools, which index
 * pump.fun curves and PumpSwap pools natively.
 */
export function PriceChart({
	chain,
	address,
	pool,
	usdRate,
}: {
	chain: ChainKey;
	address: string;
	pool: string | null;
	usdRate: number | null;
}) {
	const native = nativeSymbol(chain);
	const sources: Source[] = chain === 'robinhood' ? ['native'] : pool ? ['dexscreener', 'dextools'] : ['dexscreener'];
	const [source, setSource] = useState<Source>(sources[0]);
	const [interval, setInterval_] = useState<Interval>('5m');
	const [metric, setMetric] = useState<'price' | 'mcap'>('mcap');
	const [unit, setUnit] = useState<'native' | 'usd'>('usd');
	const [candles, setCandles] = useState<Candle[] | null>(null);
	const [failed, setFailed] = useState(false);
	const [theme, setTheme] = useState<'dark' | 'light'>('dark');

	const box = useRef<HTMLDivElement>(null);
	const chart = useRef<IChartApi | null>(null);
	const series = useRef<{ candles: ISeriesApi<'Candlestick'>; volume: ISeriesApi<'Histogram'> } | null>(null);

	const effectiveUnit = unit === 'usd' && usdRate ? 'usd' : 'native';

	// Follow the site theme so the chart never flashes the wrong palette.
	useEffect(() => {
		const read = () => setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
		read();
		const observer = new MutationObserver(read);
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		return () => observer.disconnect();
	}, []);

	// Candles for the native source, refreshed on a steady poll while the tab is visible.
	useEffect(() => {
		if (source !== 'native') return;
		let cancelled = false;
		const load = async () => {
			try {
				const res = await fetch(`/api/tokens/${chain}/${address}/candles?interval=${interval}`, { cache: 'no-store' });
				if (!res.ok) throw new Error(String(res.status));
				const body = (await res.json()) as { candles: Candle[] };
				if (!cancelled) {
					setCandles(body.candles);
					setFailed(false);
				}
			} catch {
				if (!cancelled) setFailed(true);
			}
		};
		load();
		const timer = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [chain, address, interval, source]);

	// Create the chart once per mount of the native source; the library loads on demand.
	useEffect(() => {
		if (source !== 'native' || !box.current) return;
		let disposed = false;
		(async () => {
			const lc = await import('lightweight-charts');
			if (disposed || !box.current) return;
			const instance = lc.createChart(box.current, {
				autoSize: true,
				layout: { background: { type: lc.ColorType.Solid, color: 'transparent' }, textColor: cssVar('--ink-3'), fontFamily: 'var(--font-code), monospace', attributionLogo: true },
				grid: { vertLines: { color: cssVar('--line') }, horzLines: { color: cssVar('--line') } },
				rightPriceScale: { borderColor: cssVar('--line-2') },
				timeScale: { borderColor: cssVar('--line-2'), timeVisible: true, secondsVisible: false },
				crosshair: { mode: lc.CrosshairMode.Normal },
			});
			const candleSeries = instance.addSeries(lc.CandlestickSeries, {
				upColor: cssVar('--up'),
				downColor: cssVar('--down'),
				wickUpColor: cssVar('--up'),
				wickDownColor: cssVar('--down'),
				borderVisible: false,
				priceFormat: { type: 'custom', minMove: 1e-12, formatter: (v: number) => String(v) },
			});
			const volumeSeries = instance.addSeries(lc.HistogramSeries, { priceScaleId: '', priceFormat: { type: 'volume' } });
			volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
			chart.current = instance;
			series.current = { candles: candleSeries, volume: volumeSeries };
			setCandles((c) => (c ? [...c] : c));
		})();
		return () => {
			disposed = true;
			chart.current?.remove();
			chart.current = null;
			series.current = null;
		};
	}, [source]);

	// Colors follow the theme.
	useEffect(() => {
		if (!chart.current || !series.current) return;
		chart.current.applyOptions({
			layout: { textColor: cssVar('--ink-3') },
			grid: { vertLines: { color: cssVar('--line') }, horzLines: { color: cssVar('--line') } },
			rightPriceScale: { borderColor: cssVar('--line-2') },
			timeScale: { borderColor: cssVar('--line-2') },
		});
		series.current.candles.applyOptions({ upColor: cssVar('--up'), downColor: cssVar('--down'), wickUpColor: cssVar('--up'), wickDownColor: cssVar('--down') });
	}, [theme]);

	// Data and axis formatting follow the metric and unit.
	useEffect(() => {
		if (!series.current || !candles) return;
		const scale = (metric === 'mcap' ? TOTAL_SUPPLY : 1) * (effectiveUnit === 'usd' ? usdRate! : 1);
		const fmt = (v: number) => (effectiveUnit === 'usd' ? usd(v) : formatNative(v));
		series.current.candles.applyOptions({ priceFormat: { type: 'custom', minMove: 1e-12, formatter: fmt } });
		series.current.candles.setData(
			candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open * scale, high: c.high * scale, low: c.low * scale, close: c.close * scale })),
		);
		const up = cssVar('--up');
		const down = cssVar('--down');
		series.current.volume.setData(
			candles.map((c) => ({
				time: c.time as UTCTimestamp,
				value: c.volume * (effectiveUnit === 'usd' ? usdRate! : 1),
				color: `${c.close >= c.open ? up : down}66`,
			})),
		);
	}, [candles, metric, effectiveUnit, usdRate, theme]);

	const embedTheme = theme === 'light' ? 'light' : 'dark';
	const hasTrades = Boolean(candles?.some((c) => c.volume > 0));

	return (
		<div className="card card-pad chart-card">
			<div className="chart-toolbar">
				{sources.length > 1 || source !== 'native' ? (
					<div className="segmented" role="group" aria-label="Chart source">
						{sources.map((s) => (
							<button key={s} type="button" aria-pressed={source === s} onClick={() => setSource(s)}>
								{s === 'native' ? 'chart' : s}
							</button>
						))}
					</div>
				) : (
					<div className="segmented" role="group" aria-label="Interval">
						{INTERVALS.map((i) => (
							<button key={i} type="button" aria-pressed={interval === i} onClick={() => setInterval_(i)}>
								{i}
							</button>
						))}
					</div>
				)}
				{source === 'native' ? (
					<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
						<div className="segmented" role="group" aria-label="Metric">
							<button type="button" aria-pressed={metric === 'mcap'} onClick={() => setMetric('mcap')}>mcap</button>
							<button type="button" aria-pressed={metric === 'price'} onClick={() => setMetric('price')}>price</button>
						</div>
						<div className="segmented" role="group" aria-label="Unit">
							<button type="button" aria-pressed={effectiveUnit === 'usd'} disabled={!usdRate} onClick={() => setUnit('usd')} title={usdRate ? undefined : 'USD rate unavailable right now'}>
								usd
							</button>
							<button type="button" aria-pressed={effectiveUnit === 'native'} onClick={() => setUnit('native')}>{native.toLowerCase()}</button>
						</div>
					</div>
				) : null}
			</div>
			<div className="chart-box">
				{source === 'native' ? (
					<>
						<div ref={box} style={{ position: 'absolute', inset: 0 }} />
						{candles === null && !failed ? <span className="skeleton" style={{ position: 'absolute', inset: 0 }} /> : null}
						{failed && !candles ? <div className="chart-empty">the chart could not load. retrying every 15 seconds.</div> : null}
						{candles && !hasTrades ? <div className="chart-empty">no trades yet. the first buy draws the first candle.</div> : null}
					</>
				) : source === 'dexscreener' ? (
					<iframe
						title="DexScreener chart"
						src={`https://dexscreener.com/solana/${address}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartTheme=${embedTheme}&theme=${embedTheme}&chartStyle=1&chartType=usd&interval=15`}
						loading="lazy"
					/>
				) : (
					<iframe
						title="DEXTools chart"
						src={`https://www.dextools.io/widget-chart/en/solana/pe-light/${pool}?theme=${embedTheme}&chartType=1&chartResolution=15&drawingToolbars=false`}
						loading="lazy"
					/>
				)}
			</div>
			{source === 'native' ? (
				<p className="muted" style={{ fontSize: 12, margin: 0 }}>
					candles from every on-chain trade, curve and pool, indexed by this site. {sources.length === 1 ? null : 'switch source above for third-party charts.'}
				</p>
			) : null}
		</div>
	);
}
