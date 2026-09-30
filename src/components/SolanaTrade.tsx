'use client';

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction } from '@solana/web3.js';
import { useCallback, useEffect, useState } from 'react';

import { base64ToBytes } from '@/lib/bytes';
import { explorer } from '@/lib/config';
import { formatNative, formatTokens } from '@/lib/format';
import type { TokenState } from '@/lib/types';
import { SolanaWalletButton } from './WalletButtons';

const SLIPPAGE_BPS = 200;

type Quote = { amountOut: number; minimumAmountOut: number; fee: number };

async function post<T>(url: string, body: unknown): Promise<T> {
	const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
	const data = (await res.json().catch(() => ({}))) as T & { error?: string };
	if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
	return data;
}

function friendly(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	if (/rejected|denied|cancel/i.test(message)) return 'You declined in your wallet.';
	if (/insufficient/i.test(message)) return 'Not enough SOL for this trade and network fees.';
	if (/slippage|ExceededSlippage|0x1771/i.test(message)) return 'The price moved past your limit. Try again.';
	return message.split('\n')[0].slice(0, 200);
}

/** Signs a server-built transaction with the connected wallet and waits for confirmation. */
function useSignAndSend() {
	const wallet = useWallet();
	const { connection } = useConnection();
	return useCallback(
		async (base64: string, lastValidBlockHeight: number) => {
			if (!wallet.signTransaction) throw new Error('Connect a wallet that can sign transactions.');
			const tx = Transaction.from(base64ToBytes(base64));
			const signed = await wallet.signTransaction(tx);
			const signature = await connection.sendRawTransaction(signed.serialize(), { maxRetries: 5 });
			const result = await connection.confirmTransaction(
				{ signature, blockhash: tx.recentBlockhash!, lastValidBlockHeight },
				'confirmed',
			);
			if (result.value.err) throw new Error(`The transaction failed on-chain: ${JSON.stringify(result.value.err)}`);
			return signature;
		},
		[connection, wallet],
	);
}

export function SolanaTrade({ mint, symbol, state, onSettled }: { mint: string; symbol: string; state: TokenState; onSettled: () => void }) {
	const wallet = useWallet();
	const { connection } = useConnection();
	const signAndSend = useSignAndSend();
	const [side, setSide] = useState<'buy' | 'sell'>('buy');
	const [amount, setAmount] = useState('');
	const [quoted, setQuoted] = useState<{ key: string; quote: Quote | null; error: string | null } | null>(null);
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<{ ok: boolean; text: string; tx?: string } | null>(null);
	const [loaded, setLoaded] = useState<{ owner: string; sol: number; token: number } | null>(null);

	const owner = wallet.publicKey?.toBase58();
	const balances = loaded && loaded.owner === owner ? loaded : null;

	const [balanceTick, setBalanceTick] = useState(0);
	const loadBalances = () => setBalanceTick((n) => n + 1);

	useEffect(() => {
		const key = wallet.publicKey;
		if (!key) return;
		let cancelled = false;
		Promise.all([connection.getBalance(key), connection.getParsedTokenAccountsByOwner(key, { mint: new PublicKey(mint) })])
			.then(([lamports, accounts]) => {
				if (cancelled) return;
				const token = accounts.value.reduce((sum, a) => sum + Number(a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
				setLoaded({ owner: key.toBase58(), sol: lamports / 1e9, token });
			})
			.catch(() => {
				if (!cancelled) setLoaded(null);
			});
		return () => {
			cancelled = true;
		};
	}, [connection, mint, wallet.publicKey, balanceTick]);

	const inputKey = `${side}:${amount}:${state.raisedNative}`;
	const quote = quoted?.key === inputKey ? quoted.quote : null;
	const quoteError = quoted?.key === inputKey ? quoted.error : null;

	useEffect(() => {
		const value = Number(amount);
		if (state.graduated || !amount || !Number.isFinite(value) || value <= 0) return;
		const key = inputKey;
		const controller = new AbortController();
		const handle = setTimeout(() => {
			fetch('/api/solana/swap', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ mint, side, amount: value, slippageBps: SLIPPAGE_BPS, quoteOnly: true }),
				signal: controller.signal,
			})
				.then(async (r) => {
					const body = (await r.json()) as { quote?: Quote; error?: string };
					if (!r.ok || !body.quote) throw new Error(body.error || 'Quote failed.');
					setQuoted({ key, quote: body.quote, error: null });
				})
				.catch((error: Error) => {
					if (error.name !== 'AbortError') setQuoted({ key, quote: null, error: error.message });
				});
		}, 300);
		return () => {
			clearTimeout(handle);
			controller.abort();
		};
	}, [amount, side, mint, state.graduated, inputKey]);

	const submit = async () => {
		if (!owner || !quote) return;
		setBusy(true);
		setResult(null);
		try {
			const built = await post<{ transaction: string; lastValidBlockHeight: number; quote: Quote }>('/api/solana/swap', {
				mint,
				owner,
				side,
				amount: Number(amount),
				slippageBps: SLIPPAGE_BPS,
			});
			const signature = await signAndSend(built.transaction, built.lastValidBlockHeight);
			setResult({
				ok: true,
				text: side === 'buy' ? `bought ${formatTokens(built.quote.amountOut)} $${symbol}` : `sold for ${formatNative(built.quote.amountOut, 'SOL')}`,
				tx: signature,
			});
			setAmount('');
			loadBalances();
			onSettled();
		} catch (error) {
			setResult({ ok: false, text: friendly(error) });
		} finally {
			setBusy(false);
		}
	};

	if (state.graduated) {
		return (
			<div className="card card-pad" style={{ display: 'grid', gap: 12 }}>
				<h2 style={{ fontSize: 20 }}>trade</h2>
				<p className="muted">${symbol} graduated to a Meteora DAMM v2 pool with permanently locked liquidity. any Solana aggregator routes to it.</p>
				<a className="btn" href={`https://jup.ag/swap/SOL-${mint}`} target="_blank" rel="noreferrer">
					trade on jupiter
				</a>
			</div>
		);
	}

	return (
		<div className="card card-pad">
			<div className="tabs" role="tablist" aria-label="Trade side">
				<button role="tab" type="button" className="buy" aria-selected={side === 'buy'} onClick={() => { setSide('buy'); setAmount(''); }}>buy</button>
				<button role="tab" type="button" className="sell" aria-selected={side === 'sell'} onClick={() => { setSide('sell'); setAmount(''); }}>sell</button>
			</div>
			<form
				className="form-grid"
				style={{ gap: 14 }}
				onSubmit={(e) => {
					e.preventDefault();
					submit();
				}}
			>
				<div className="field">
					<label htmlFor="sol-amount">{side === 'buy' ? 'you pay' : 'you sell'}</label>
					<div className="input-affix">
						<input id="sol-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} placeholder="0.0" autoComplete="off" />
						<span>{side === 'buy' ? 'SOL' : `$${symbol}`}</span>
					</div>
					<div className="quick">
						{side === 'buy'
							? ['0.1', '0.5', '1', '5'].map((v) => (
									<button key={v} type="button" onClick={() => setAmount(v)}>{v} SOL</button>
								))
							: [25, 50, 75, 100].map((pct) => (
									<button key={pct} type="button" disabled={!balances?.token} onClick={() => setAmount(String(((balances?.token ?? 0) * pct) / 100))}>
										{pct}%
									</button>
								))}
					</div>
					{balances ? (
						<span className="hint">
							balance: {side === 'buy' ? formatNative(balances.sol, 'SOL') : `${formatTokens(balances.token)} $${symbol}`}
						</span>
					) : null}
				</div>

				<dl className="kv">
					<dt>you receive</dt>
					<dd>{quote ? (side === 'buy' ? `${formatTokens(quote.amountOut)} $${symbol}` : formatNative(quote.amountOut, 'SOL')) : '-'}</dd>
					<dt>trade fee</dt>
					<dd>{quote ? formatNative(quote.fee, 'SOL') : '-'}</dd>
					<dt>max slippage</dt>
					<dd>2%</dd>
				</dl>
				{quoteError ? <div className="notice bad" role="alert"><span aria-hidden="true">!</span><span>{quoteError}</span></div> : null}
				{result ? (
					<div className={`notice ${result.ok ? 'good' : 'bad'}`} role="status">
						<span aria-hidden="true">{result.ok ? '✓' : '!'}</span>
						<span>
							{result.text}
							{result.tx ? (
								<>
									{' '}
									<a href={explorer('solana', 'tx', result.tx)} target="_blank" rel="noreferrer">view</a>
								</>
							) : null}
						</span>
					</div>
				) : null}
				{owner ? (
					<button type="submit" className="btn btn-primary btn-lg btn-block" disabled={!quote || busy}>
						{busy ? <span className="spinner" /> : null}
						{busy ? 'confirm in your wallet' : side === 'buy' ? `buy $${symbol}` : `sell $${symbol}`}
					</button>
				) : (
					<SolanaWalletButton />
				)}
			</form>
		</div>
	);
}

export function SolanaCreatorFees({ mint, state, onSettled }: { mint: string; state: TokenState; onSettled: () => void }) {
	const wallet = useWallet();
	const signAndSend = useSignAndSend();
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
	const owner = wallet.publicKey?.toBase58();
	const isFeeWallet = owner === state.feeWallet;

	const claim = async () => {
		if (!owner) return;
		setBusy(true);
		setMessage(null);
		try {
			const built = await post<{ transaction: string; lastValidBlockHeight: number }>('/api/solana/claim', { mint, creator: owner });
			await signAndSend(built.transaction, built.lastValidBlockHeight);
			setMessage({ ok: true, text: 'creator fees claimed to your wallet.' });
			onSettled();
		} catch (error) {
			setMessage({ ok: false, text: friendly(error) });
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="card card-pad" style={{ display: 'grid', gap: 12 }}>
			<h2 style={{ fontSize: 20 }}>creator fees</h2>
			<dl className="kv">
				<dt>claimable now</dt>
				<dd>{formatNative(state.creatorFeesClaimableNative, 'SOL')}</dd>
			</dl>
			<p className="muted" style={{ fontSize: 13.5 }}>
				only the fee wallet can claim.{state.graduated ? ' after graduation, its locked LP position keeps earning pool fees, claimable in Meteora.' : ''}
			</p>
			{!owner ? (
				<SolanaWalletButton />
			) : isFeeWallet ? (
				<button type="button" className="btn" disabled={busy || state.creatorFeesClaimableNative <= 0} onClick={claim}>
					{busy ? <span className="spinner" /> : null}
					claim creator fees
				</button>
			) : (
				<p className="muted" style={{ fontSize: 13.5 }}>the connected wallet is not this token&apos;s fee wallet.</p>
			)}
			{message ? (
				<div className={`notice ${message.ok ? 'good' : 'bad'}`} role="status">
					<span aria-hidden="true">{message.ok ? '✓' : '!'}</span>
					<span>{message.text}</span>
				</div>
			) : null}
		</div>
	);
}
