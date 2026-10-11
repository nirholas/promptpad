import { ImageResponse } from 'next/og';

import { chainLabel, isChainKey, nativeSymbol, SITE_URL } from '@/lib/config';
import { readTokenState } from '@/lib/fees';
import { registryNumber } from '@/lib/format';
import { getLaunch } from '@/lib/launches';
import { usdPrices } from '@/lib/market';
import { CardLogo } from '@/lib/share-card';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Token share card';

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
	Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

function money(v: number) {
	if (v >= 1000) return `$${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v)}`;
	return `$${v.toFixed(v >= 1 ? 0 : 2)}`;
}

/** The card a token link unfurls into on X, Telegram and Discord: logo, ticker, provenance, live cap and curve. */
export default async function Image({ params }: { params: Promise<{ chain: string; address: string }> }) {
	const { chain, address } = await params;
	const launch = isChainKey(chain) ? await getLaunch(chain, address).catch(() => null) : null;
	const host = new URL(SITE_URL).host;

	if (!launch || !isChainKey(chain)) {
		return new ImageResponse(
			<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b0b0b', color: '#f4f4f4', fontSize: 64 }}>
				{host}
			</div>,
			size,
		);
	}

	const [state, usd] = await Promise.all([withTimeout(readTokenState(chain, launch.address).catch(() => null), 3_500), withTimeout(usdPrices(), 2_500)]);
	const native = nativeSymbol(chain);
	const rate = usd ? usd[native as 'ETH' | 'SOL'] : null;
	const prompt = launch.channel === 2 || launch.source === 'claude';
	const progress = state ? (state.graduated ? 1 : state.progress) : null;
	const cap = state ? (rate ? money(state.marketCapNative * rate) : `${state.marketCapNative.toPrecision(3)} ${native}`) : null;
	const logo = await CardLogo({ image: launch.image, symbol: launch.symbol, name: launch.name, size: 300 });

	return new ImageResponse(
		(
			<div style={{ width: '100%', height: '100%', display: 'flex', background: '#0b0b0b', color: '#f4f4f4', padding: 64, gap: 56 }}>
				<div style={{ width: 300, height: 300, display: 'flex', borderRadius: 28, overflow: 'hidden', border: '2px solid #2e2e2e' }}>{logo}</div>
				<div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
					<div style={{ display: 'flex', gap: 12, fontSize: 24, color: '#bdbdbd' }}>
						<span style={{ border: '1px solid #3d3d3d', borderRadius: 8, padding: '6px 14px' }}>{chainLabel(chain).toLowerCase()}</span>
						<span style={{ border: '1px solid #3d3d3d', borderRadius: 8, padding: '6px 14px' }}>{registryNumber(launch.number)}</span>
						{prompt ? (
							<span style={{ background: '#f4f4f4', color: '#0b0b0b', borderRadius: 8, padding: '6px 14px' }}>
								{launch.attested ? '✓ ' : ''}
								{launch.client === 'claude' ? 'born in claude' : 'born from a prompt'}
							</span>
						) : null}
					</div>
					<div style={{ fontSize: launch.symbol.length > 7 ? 96 : 128, fontWeight: 700, letterSpacing: -4, marginTop: 28, lineHeight: 1 }}>${launch.symbol}</div>
					<div style={{ fontSize: 40, color: '#bdbdbd', marginTop: 14, overflow: 'hidden', whiteSpace: 'nowrap' }}>{launch.name}</div>
					<div style={{ flex: 1 }} />
					{progress !== null ? (
						<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
							<div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 30 }}>
								<span>{cap ? `market cap ${cap}` : ''}</span>
								<span style={{ color: '#bdbdbd' }}>{state?.graduated ? 'graduated' : `${Math.round(progress * 100)}% to graduation`}</span>
							</div>
							<div style={{ display: 'flex', height: 16, background: '#212121', borderRadius: 999, overflow: 'hidden' }}>
								<div style={{ width: `${Math.max(progress * 100, 2)}%`, background: '#f4f4f4' }} />
							</div>
						</div>
					) : null}
					<div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28, fontSize: 26, color: '#8a8a8a' }}>
						<span>{host}</span>
						<span>launch a token from a prompt</span>
					</div>
				</div>
			</div>
		),
		size,
	);
}
