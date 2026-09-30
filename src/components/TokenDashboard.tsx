'use client';

import { useCallback, useEffect, useState } from 'react';

import { explorer, nativeSymbol, type ChainKey } from '@/lib/config';
import { formatBps, formatNative, formatPercent, shortAddress } from '@/lib/format';
import type { TokenState } from '@/lib/types';
import { CopyButton } from './CopyButton';
import { EvmCreatorFees, EvmTrade } from './EvmTrade';
import { SolanaCreatorFees, SolanaTrade } from './SolanaTrade';

const POLL_MS = 15_000;

export function TokenDashboard({
	chain,
	address,
	symbol,
	initial,
	description,
}: {
	chain: ChainKey;
	address: string;
	symbol: string;
	initial: TokenState | null;
	description: string;
}) {
	const [state, setState] = useState<TokenState | null>(initial);
	const [stale, setStale] = useState(false);

	const refresh = useCallback(async () => {
		try {
			const res = await fetch(`/api/tokens/${chain}/${address}`, { cache: 'no-store' });
			if (!res.ok) throw new Error(String(res.status));
			const body = (await res.json()) as { state: TokenState };
			setState(body.state);
			setStale(false);
		} catch {
			setStale(true);
		}
	}, [chain, address]);

	useEffect(() => {
		// Without a first read, retry quickly; after that, a steady poll keeps the numbers live.
		const timer = setInterval(
			() => {
				if (document.visibilityState === 'visible') refresh();
			},
			state ? POLL_MS : 4_000,
		);
		return () => clearInterval(timer);
	}, [refresh, state]);

	const native = nativeSymbol(chain);

	if (!state) {
		return (
			<div className="token-layout">
				<div className="card card-pad" style={{ display: 'grid', gap: 16 }}>
					<div className="notice warn" role="status">
						<span aria-hidden="true">!</span>
						<span>on-chain data is not reachable right now. retrying every few seconds; nothing is wrong with the token.</span>
					</div>
					<div className="stats">
						{[0, 1, 2].map((i) => (
							<div key={i} className="stat">
								<span className="skeleton" style={{ width: 70, height: 12 }} />
								<span className="skeleton" style={{ width: 120, height: 22 }} />
							</div>
						))}
					</div>
					<p style={{ color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{description || 'the creator did not add a description.'}</p>
				</div>
				<div className="card card-pad">
					<span className="skeleton" style={{ display: 'block', height: 220 }} />
				</div>
			</div>
		);
	}

	return (
		<div className="token-layout">
			<div style={{ display: 'grid', gap: 20, minWidth: 0 }}>
				<div className="card card-pad" style={{ display: 'grid', gap: 18 }}>
					<div className="stats">
						<div className="stat">
							<span>price</span>
							<strong title={`${state.priceNative} ${native}`}>{formatNative(state.priceNative, native)}</strong>
						</div>
						<div className="stat">
							<span>market cap</span>
							<strong>{formatNative(state.marketCapNative, native)}</strong>
						</div>
						<div className="stat">
							<span>{state.graduated ? 'raised on the curve' : 'raised'}</span>
							<strong>{formatNative(state.raisedNative, native)}</strong>
						</div>
					</div>
					<div>
						<div
							className={`progress ${state.graduated ? 'done' : ''}`}
							role="progressbar"
							aria-valuemin={0}
							aria-valuemax={100}
							aria-valuenow={Math.round(state.progress * 100)}
							aria-label="Bonding curve progress"
							style={{ height: 12 }}
						>
							<span style={{ width: `${Math.max(state.progress * 100, 1.5)}%` }} />
						</div>
						<div className="progress-label">
							<span>{state.graduated ? 'graduated. liquidity is locked in the pool.' : `${formatPercent(state.progress)} of the way to graduation`}</span>
							<span>
								{formatNative(state.raisedNative)} / {formatNative(state.targetNative)} {native}
							</span>
						</div>
					</div>
					{stale ? (
						<div className="notice warn" role="status">
							<span aria-hidden="true">!</span>
							<span>live numbers could not refresh. showing the last good read.</span>
						</div>
					) : null}
				</div>

				<div className="card card-pad" style={{ display: 'grid', gap: 12 }}>
					<h2 className="caps">about</h2>
					<p style={{ color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{description || 'the creator did not add a description.'}</p>
				</div>

				<div className="card card-pad">
					<h2 className="caps" style={{ marginBottom: 6 }}>on-chain</h2>
					<AddressRow chain={chain} label="token" value={address} kind="token" />
					<AddressRow chain={chain} label="fee wallet" value={state.feeWallet} kind="address" />
					{state.creator !== state.feeWallet ? <AddressRow chain={chain} label="launched by" value={state.creator} kind="address" /> : null}
					{state.pool ? <AddressRow chain={chain} label={chain === 'solana' ? 'curve pool' : 'uniswap pool'} value={state.pool} kind="address" /> : null}
					<div className="address-row">
						<span className="muted">trade fee</span>
						<span>
							{formatBps(state.tradeFeeBps)}, {formatBps(state.creatorShareBps)} of it to the fee wallet
						</span>
					</div>
				</div>
			</div>

			<div style={{ display: 'grid', gap: 20, minWidth: 0 }}>
				{chain === 'robinhood' ? (
					<>
						<EvmTrade token={address} symbol={symbol} state={state} onSettled={refresh} />
						<EvmCreatorFees token={address} state={state} onSettled={refresh} />
					</>
				) : (
					<>
						<SolanaTrade mint={address} symbol={symbol} state={state} onSettled={refresh} />
						<SolanaCreatorFees mint={address} state={state} onSettled={refresh} />
					</>
				)}
			</div>
		</div>
	);
}

function AddressRow({ chain, label, value, kind }: { chain: ChainKey; label: string; value: string; kind: 'token' | 'address' }) {
	return (
		<div className="address-row">
			<span className="muted">{label}</span>
			<span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
				<a href={explorer(chain, kind, value)} target="_blank" rel="noreferrer" className="mono">
					{shortAddress(value, 6, 6)}
				</a>
				<CopyButton value={value} className="btn btn-ghost btn-sm" />
			</span>
		</div>
	);
}
