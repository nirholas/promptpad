'use client';

import { useEffect, useId, useState } from 'react';

const PLUGIN_SRC = 'https://plugin.jup.ag/plugin-v1.js';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

type JupiterGlobal = { init: (options: Record<string, unknown>) => void };

let loading: Promise<JupiterGlobal> | null = null;

function loadPlugin(): Promise<JupiterGlobal> {
	const existing = (window as unknown as { Jupiter?: JupiterGlobal }).Jupiter;
	if (existing) return Promise.resolve(existing);
	loading ??= new Promise((resolve, reject) => {
		const script = document.createElement('script');
		script.src = PLUGIN_SRC;
		script.async = true;
		script.onload = () => {
			const jupiter = (window as unknown as { Jupiter?: JupiterGlobal }).Jupiter;
			if (jupiter) resolve(jupiter);
			else reject(new Error('Jupiter plugin loaded without its API.'));
		};
		script.onerror = () => {
			loading = null;
			reject(new Error('Jupiter plugin could not load.'));
		};
		document.head.appendChild(script);
	});
	return loading;
}

/**
 * On-site swap for a graduated Solana token: Jupiter's embeddable plugin, which routes across
 * PumpSwap and every other Solana venue, pinned to SOL and this mint.
 */
export function JupiterSwap({ mint, symbol }: { mint: string; symbol: string }) {
	const targetId = `jupiter-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
	const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

	useEffect(() => {
		let cancelled = false;
		loadPlugin()
			.then((jupiter) => {
				if (cancelled) return;
				jupiter.init({
					displayMode: 'integrated',
					integratedTargetId: targetId,
					formProps: { initialInputMint: SOL_MINT, initialOutputMint: mint, fixedMint: mint },
				});
				setStatus('ready');
			})
			.catch(() => !cancelled && setStatus('failed'));
		return () => {
			cancelled = true;
		};
	}, [mint, targetId]);

	return (
		<div className="card card-pad" style={{ display: 'grid', gap: 12 }}>
			<div className="trade-head">
				<h2 className="caps">trade</h2>
				<span className="chip mono">jupiter · best route</span>
			</div>
			<p className="muted" style={{ fontSize: 14 }}>
				${symbol} completed its curve and trades on PumpSwap. swaps here route through Jupiter for the best price across every Solana venue.
			</p>
			{status === 'failed' ? (
				<div className="notice warn" role="status">
					<span aria-hidden="true">!</span>
					<span>
						the swap widget did not load. <a href={`https://jup.ag/swap/SOL-${mint}`} target="_blank" rel="noreferrer">swap on jup.ag</a> or{' '}
						<a href={`https://pump.fun/coin/${mint}`} target="_blank" rel="noreferrer">pump.fun</a>.
					</span>
				</div>
			) : (
				<div id={targetId} style={{ minHeight: 420 }} aria-busy={status === 'loading'}>
					{status === 'loading' ? <span className="skeleton" style={{ display: 'block', height: 420 }} /> : null}
				</div>
			)}
		</div>
	);
}
