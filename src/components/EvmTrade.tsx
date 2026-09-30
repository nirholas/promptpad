'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatEther, formatUnits, parseEther, parseUnits, type Address } from 'viem';
import { useBalance, useConnection, usePublicClient, useReadContract, useSwitchChain, useWriteContract } from 'wagmi';

import { explorer, PAD_FACTORY, robinhoodChain } from '@/lib/config';
import { padFactoryAbi, padTokenAbi } from '@/lib/evm/abi';
import { formatNative, formatTokens } from '@/lib/format';
import type { TokenState } from '@/lib/types';
import { EvmWalletButton } from './WalletButtons';

const SLIPPAGE_BPS = BigInt(200);

type Quote = { out: bigint; fee: bigint; refund?: bigint } | null;

function friendly(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	if (/user rejected|denied/i.test(message)) return 'You declined in your wallet.';
	if (/Slippage/.test(message)) return 'The price moved past your limit. Try again.';
	if (/AlreadyGraduated/.test(message)) return 'This token just graduated. Trade it on the pool now.';
	if (/insufficient funds/i.test(message)) return 'Not enough ETH for this trade and gas.';
	return message.split('\n')[0].slice(0, 200);
}

export function EvmTrade({ token, symbol, state, onSettled }: { token: string; symbol: string; state: TokenState; onSettled: () => void }) {
	const [side, setSide] = useState<'buy' | 'sell'>('buy');
	const [amount, setAmount] = useState('');
	const [quoted, setQuoted] = useState<{ key: string; quote: Quote; error: string | null } | null>(null);
	const [busy, setBusy] = useState<'idle' | 'signing' | 'confirming'>('idle');
	const [result, setResult] = useState<{ ok: boolean; text: string; tx?: string } | null>(null);

	const account = useConnection();
	const client = usePublicClient({ chainId: robinhoodChain.id });
	const switchChain = useSwitchChain();
	const write = useWriteContract();
	const ethBalance = useBalance({ address: account.address, chainId: robinhoodChain.id });
	const tokenBalance = useReadContract({
		address: token as Address,
		abi: padTokenAbi,
		functionName: 'balanceOf',
		args: account.address ? [account.address] : undefined,
		chainId: robinhoodChain.id,
		query: { enabled: Boolean(account.address) },
	});

	// Quotes are keyed by the input they were computed for, so a stale answer never shows.
	const inputKey = `${side}:${amount}:${state.raisedNative}`;
	const quote = quoted?.key === inputKey ? quoted.quote : null;
	const quoteError = quoted?.key === inputKey ? quoted.error : null;

	useEffect(() => {
		if (!client || !PAD_FACTORY || state.graduated) return;
		const value = Number(amount);
		if (!amount || !Number.isFinite(value) || value <= 0) return;
		const key = inputKey;
		const handle = setTimeout(async () => {
			try {
				if (side === 'buy') {
					const [out, fee, refund] = await client.readContract({ address: PAD_FACTORY!, abi: padFactoryAbi, functionName: 'quoteBuy', args: [token as Address, parseEther(amount)] });
					setQuoted({ key, quote: { out, fee, refund }, error: null });
				} else {
					const [out, fee] = await client.readContract({ address: PAD_FACTORY!, abi: padFactoryAbi, functionName: 'quoteSell', args: [token as Address, parseUnits(amount, 18)] });
					setQuoted({ key, quote: { out, fee }, error: null });
				}
			} catch (error) {
				setQuoted({ key, quote: null, error: friendly(error) });
			}
		}, 300);
		return () => clearTimeout(handle);
	}, [amount, side, client, token, state.graduated, inputKey]);

	const submit = useCallback(async () => {
		if (!PAD_FACTORY || !client || !quote) return;
		setResult(null);
		setBusy('signing');
		try {
			if (account.chainId !== robinhoodChain.id) await switchChain.mutateAsync({ chainId: robinhoodChain.id });
			const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
			const minOut = (quote.out * (BigInt(10_000) - SLIPPAGE_BPS)) / BigInt(10_000);
			const hash =
				side === 'buy'
					? await write.mutateAsync({ address: PAD_FACTORY, abi: padFactoryAbi, functionName: 'buy', args: [token as Address, minOut, deadline], value: parseEther(amount), chainId: robinhoodChain.id })
					: await write.mutateAsync({ address: PAD_FACTORY, abi: padFactoryAbi, functionName: 'sell', args: [token as Address, parseUnits(amount, 18), minOut, deadline], chainId: robinhoodChain.id });
			setBusy('confirming');
			const receipt = await client.waitForTransactionReceipt({ hash });
			if (receipt.status !== 'success') throw new Error('The trade reverted on-chain.');
			setResult({ ok: true, text: side === 'buy' ? `bought ${formatTokens(Number(formatUnits(quote.out, 18)))} $${symbol}` : `sold for ${formatNative(Number(formatEther(quote.out)), 'ETH')}`, tx: hash });
			setAmount('');
			ethBalance.refetch();
			tokenBalance.refetch();
			onSettled();
		} catch (error) {
			setResult({ ok: false, text: friendly(error) });
		} finally {
			setBusy('idle');
		}
	}, [account.chainId, amount, client, ethBalance, onSettled, quote, side, switchChain, symbol, token, tokenBalance, write]);

	if (state.graduated) {
		return (
			<div className="card card-pad" style={{ display: 'grid', gap: 12 }}>
				<h2 style={{ fontSize: 20 }}>trade</h2>
				<p className="muted">
					${symbol} graduated. it now trades in its Uniswap v3 pool (1% fee tier, paired with WETH) on {robinhoodChain.name}, where the liquidity is locked forever.
				</p>
				{state.pool ? (
					<a className="btn" href={explorer('robinhood', 'address', state.pool)} target="_blank" rel="noreferrer">
						view the pool
					</a>
				) : null}
			</div>
		);
	}

	const balanceTokens = tokenBalance.data ?? BigInt(0);
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
					<label htmlFor="evm-amount">{side === 'buy' ? 'you pay' : 'you sell'}</label>
					<div className="input-affix">
						<input id="evm-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} placeholder="0.0" autoComplete="off" />
						<span>{side === 'buy' ? 'ETH' : `$${symbol}`}</span>
					</div>
					<div className="quick">
						{side === 'buy'
							? ['0.01', '0.05', '0.1', '0.5'].map((v) => (
									<button key={v} type="button" onClick={() => setAmount(v)}>{v} ETH</button>
								))
							: [25, 50, 75, 100].map((pct) => (
									<button key={pct} type="button" disabled={balanceTokens === BigInt(0)} onClick={() => setAmount(formatUnits((balanceTokens * BigInt(pct)) / BigInt(100), 18))}>
										{pct}%
									</button>
								))}
					</div>
					{account.address ? (
						<span className="hint">
							balance: {side === 'buy' ? formatNative(Number(ethBalance.data ? formatEther(ethBalance.data.value) : 0), 'ETH') : `${formatTokens(Number(formatUnits(balanceTokens, 18)))} $${symbol}`}
						</span>
					) : null}
				</div>

				<dl className="kv">
					<dt>you receive</dt>
					<dd>
						{quote
							? side === 'buy'
								? `${formatTokens(Number(formatUnits(quote.out, 18)))} $${symbol}`
								: formatNative(Number(formatEther(quote.out)), 'ETH')
							: '-'}
					</dd>
					<dt>trade fee</dt>
					<dd>{quote ? formatNative(Number(formatEther(quote.fee)), 'ETH') : '-'}</dd>
					<dt>max slippage</dt>
					<dd>2%</dd>
				</dl>
				{quote?.refund ? (
					<div className="notice good" role="status">
						<span aria-hidden="true">↑</span>
						<span>this buy completes the curve and graduates the token. {formatNative(Number(formatEther(quote.refund)), 'ETH')} is refunded.</span>
					</div>
				) : null}
				{quoteError ? <div className="notice bad" role="alert"><span aria-hidden="true">!</span><span>{quoteError}</span></div> : null}
				{result ? (
					<div className={`notice ${result.ok ? 'good' : 'bad'}`} role="status">
						<span aria-hidden="true">{result.ok ? '✓' : '!'}</span>
						<span>
							{result.text}
							{result.tx ? (
								<>
									{' '}
									<a href={explorer('robinhood', 'tx', result.tx)} target="_blank" rel="noreferrer">view</a>
								</>
							) : null}
						</span>
					</div>
				) : null}

				{account.address ? (
					<button type="submit" className="btn btn-primary btn-lg btn-block" disabled={!quote || busy !== 'idle'}>
						{busy !== 'idle' ? <span className="spinner" /> : null}
						{busy === 'signing' ? 'confirm in your wallet' : busy === 'confirming' ? 'confirming' : side === 'buy' ? `buy $${symbol}` : `sell $${symbol}`}
					</button>
				) : (
					<EvmWalletButton />
				)}
			</form>
		</div>
	);
}

export function EvmCreatorFees({ token, state, onSettled }: { token: string; state: TokenState; onSettled: () => void }) {
	const account = useConnection();
	const client = usePublicClient({ chainId: robinhoodChain.id });
	const write = useWriteContract();
	const [busy, setBusy] = useState<null | 'claim' | 'collect'>(null);
	const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

	const run = async (kind: 'claim' | 'collect') => {
		if (!PAD_FACTORY || !client) return;
		setBusy(kind);
		setMessage(null);
		try {
			const hash = await write.mutateAsync({
				address: PAD_FACTORY,
				abi: padFactoryAbi,
				functionName: kind === 'claim' ? 'claimCreatorFees' : 'collectLpFees',
				args: [token as Address],
				chainId: robinhoodChain.id,
			});
			const receipt = await client.waitForTransactionReceipt({ hash });
			if (receipt.status !== 'success') throw new Error('The transaction reverted.');
			setMessage({ ok: true, text: kind === 'claim' ? 'paid out to the fee wallet.' : 'pool fees collected and split.' });
			onSettled();
		} catch (error) {
			setMessage({ ok: false, text: friendly(error) });
		} finally {
			setBusy(null);
		}
	};

	return (
		<div className="card card-pad" style={{ display: 'grid', gap: 12 }}>
			<h2 style={{ fontSize: 20 }}>creator fees</h2>
			<dl className="kv">
				<dt>waiting on the curve</dt>
				<dd>{formatNative(state.creatorFeesClaimableNative, 'ETH')}</dd>
			</dl>
			<p className="muted" style={{ fontSize: 13.5 }}>
				anyone can trigger a payout. the ETH only ever goes to the fee wallet fixed at launch.
				{state.graduated ? ' after graduation, pool fees are collected from the locked position and split the same way.' : ''}
			</p>
			{account.address ? (
				<div className="cta-row">
					<button type="button" className="btn" disabled={state.creatorFeesClaimableNative <= 0 || busy !== null} onClick={() => run('claim')}>
						{busy === 'claim' ? <span className="spinner" /> : null}
						pay out curve fees
					</button>
					{state.graduated ? (
						<button type="button" className="btn" disabled={busy !== null} onClick={() => run('collect')}>
							{busy === 'collect' ? <span className="spinner" /> : null}
							collect pool fees
						</button>
					) : null}
				</div>
			) : (
				<EvmWalletButton />
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
