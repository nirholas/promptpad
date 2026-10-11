'use client';

import { useCallback, useEffect, useState } from 'react';
import { encodeFunctionData, formatEther, formatUnits, parseAbi, parseEther, parseUnits, type Address } from 'viem';
import { useBalance, useConnection, usePublicClient, useReadContract, useSwitchChain, useWriteContract } from 'wagmi';

import { explorer, GRADUATED_POOL_FEE, PAD_FACTORY, robinhoodChain, ROBINHOOD_UNISWAP, ROBINHOOD_WETH } from '@/lib/config';
import { padFactoryAbi, padTokenAbi } from '@/lib/evm/abi';
import { formatNative, formatTokens } from '@/lib/format';
import type { TokenState } from '@/lib/types';
import { SlippagePicker, useTradeIntent } from './useTradeIntent';
import { EvmWalletButton } from './WalletButtons';

type Quote = { out: bigint; fee: bigint; refund?: bigint } | null;

const quoterAbi = parseAbi([
	'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]);
const routerAbi = parseAbi([
	'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
	'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
	'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)',
]);
const erc20Abi = parseAbi([
	'function allowance(address owner, address spender) view returns (uint256)',
	'function approve(address spender, uint256 amount) returns (bool)',
]);
// SwapRouter02 reads recipient address(2) as "keep it in the router" so WETH can be unwrapped after.
const ROUTER_SELF = '0x0000000000000000000000000000000000000002';

function friendly(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	if (/user rejected|denied/i.test(message)) return 'You declined in your wallet.';
	if (/Slippage|Too little received|STF/.test(message)) return 'The price moved past your slippage limit. Try again or raise it.';
	if (/AlreadyGraduated/.test(message)) return 'This token just graduated. Reload to trade it in the pool.';
	if (/insufficient funds/i.test(message)) return 'Not enough ETH for this trade and gas.';
	return message.split('\n')[0].slice(0, 200);
}

export function EvmTrade({ token, symbol, state, onSettled }: { token: string; symbol: string; state: TokenState; onSettled: () => void }) {
	const intent = useTradeIntent();
	const [side, setSide] = useState<'buy' | 'sell'>(intent.side);
	const [amount, setAmount] = useState(intent.amount);
	const [slippageBps, setSlippageBps] = useState(200);
	const [quoted, setQuoted] = useState<{ key: string; quote: Quote; error: string | null } | null>(null);
	const [busy, setBusy] = useState<'idle' | 'approving' | 'signing' | 'confirming'>('idle');
	const [result, setResult] = useState<{ ok: boolean; text: string; tx?: string } | null>(null);

	// After graduation the token trades in its Uniswap v3 pool; before, on the factory's curve.
	const venue: 'curve' | 'pool' = state.graduated ? 'pool' : 'curve';
	const uniswap = ROBINHOOD_UNISWAP;

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
	const inputKey = `${venue}:${side}:${amount}:${state.raisedNative}:${state.priceNative}`;
	const quote = quoted?.key === inputKey ? quoted.quote : null;
	const quoteError = quoted?.key === inputKey ? quoted.error : null;

	useEffect(() => {
		if (!client || !PAD_FACTORY) return;
		if (venue === 'pool' && !uniswap) return;
		const value = Number(amount);
		if (!amount || !Number.isFinite(value) || value <= 0) return;
		const key = inputKey;
		const handle = setTimeout(async () => {
			try {
				if (venue === 'curve') {
					if (side === 'buy') {
						const [out, fee, refund] = await client.readContract({ address: PAD_FACTORY!, abi: padFactoryAbi, functionName: 'quoteBuy', args: [token as Address, parseEther(amount)] });
						setQuoted({ key, quote: { out, fee, refund }, error: null });
					} else {
						const [out, fee] = await client.readContract({ address: PAD_FACTORY!, abi: padFactoryAbi, functionName: 'quoteSell', args: [token as Address, parseUnits(amount, 18)] });
						setQuoted({ key, quote: { out, fee }, error: null });
					}
				} else {
					const amountIn = side === 'buy' ? parseEther(amount) : parseUnits(amount, 18);
					const { result } = await client.simulateContract({
						address: uniswap!.quoter,
						abi: quoterAbi,
						functionName: 'quoteExactInputSingle',
						args: [
							{
								tokenIn: side === 'buy' ? ROBINHOOD_WETH : (token as Address),
								tokenOut: side === 'buy' ? (token as Address) : ROBINHOOD_WETH,
								amountIn,
								fee: GRADUATED_POOL_FEE,
								sqrtPriceLimitX96: BigInt(0),
							},
						],
					});
					// The pool fee comes off the input; for a sell it is shown in ETH at the quoted rate.
					const out = result[0];
					const fee = side === 'buy' ? amountIn / BigInt(100) : out / BigInt(99);
					setQuoted({ key, quote: { out, fee }, error: null });
				}
			} catch (error) {
				setQuoted({ key, quote: null, error: friendly(error) });
			}
		}, 300);
		return () => clearTimeout(handle);
	}, [amount, side, client, token, venue, uniswap, inputKey]);

	const submit = useCallback(async () => {
		if (!PAD_FACTORY || !client || !quote || !account.address) return;
		setResult(null);
		setBusy('signing');
		try {
			if (account.chainId !== robinhoodChain.id) await switchChain.mutateAsync({ chainId: robinhoodChain.id });
			const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
			const minOut = (quote.out * BigInt(10_000 - slippageBps)) / BigInt(10_000);
			let hash: `0x${string}`;
			if (venue === 'curve') {
				hash =
					side === 'buy'
						? await write.mutateAsync({ address: PAD_FACTORY, abi: padFactoryAbi, functionName: 'buy', args: [token as Address, minOut, deadline], value: parseEther(amount), chainId: robinhoodChain.id })
						: await write.mutateAsync({ address: PAD_FACTORY, abi: padFactoryAbi, functionName: 'sell', args: [token as Address, parseUnits(amount, 18), minOut, deadline], chainId: robinhoodChain.id });
			} else if (side === 'buy') {
				const amountIn = parseEther(amount);
				const swap = encodeFunctionData({
					abi: routerAbi,
					functionName: 'exactInputSingle',
					args: [{ tokenIn: ROBINHOOD_WETH, tokenOut: token as Address, fee: GRADUATED_POOL_FEE, recipient: account.address, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: BigInt(0) }],
				});
				hash = await write.mutateAsync({ address: uniswap!.router, abi: routerAbi, functionName: 'multicall', args: [deadline, [swap]], value: amountIn, chainId: robinhoodChain.id });
			} else {
				const amountIn = parseUnits(amount, 18);
				const allowance = await client.readContract({ address: token as Address, abi: erc20Abi, functionName: 'allowance', args: [account.address, uniswap!.router] });
				if (allowance < amountIn) {
					setBusy('approving');
					const approval = await write.mutateAsync({ address: token as Address, abi: erc20Abi, functionName: 'approve', args: [uniswap!.router, amountIn], chainId: robinhoodChain.id });
					await client.waitForTransactionReceipt({ hash: approval });
					setBusy('signing');
				}
				const swap = encodeFunctionData({
					abi: routerAbi,
					functionName: 'exactInputSingle',
					args: [{ tokenIn: token as Address, tokenOut: ROBINHOOD_WETH, fee: GRADUATED_POOL_FEE, recipient: ROUTER_SELF, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: BigInt(0) }],
				});
				const unwrap = encodeFunctionData({ abi: routerAbi, functionName: 'unwrapWETH9', args: [minOut, account.address] });
				hash = await write.mutateAsync({ address: uniswap!.router, abi: routerAbi, functionName: 'multicall', args: [deadline, [swap, unwrap]], chainId: robinhoodChain.id });
			}
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
	}, [account.address, account.chainId, amount, client, ethBalance, onSettled, quote, side, slippageBps, switchChain, symbol, token, tokenBalance, uniswap, venue, write]);

	if (venue === 'pool' && !uniswap) {
		return (
			<div className="card card-pad" style={{ display: 'grid', gap: 12 }}>
				<h2 className="caps">trade</h2>
				<p className="muted">${symbol} graduated into its Uniswap v3 pool. this network has no router configured here, so trade it from the pool directly.</p>
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
			<div className="trade-head">
				<div className="tabs" role="tablist" aria-label="Trade side">
					<button role="tab" type="button" className="buy" aria-selected={side === 'buy'} onClick={() => { setSide('buy'); setAmount(''); }}>buy</button>
					<button role="tab" type="button" className="sell" aria-selected={side === 'sell'} onClick={() => { setSide('sell'); setAmount(''); }}>sell</button>
				</div>
				<span className="chip mono" title={venue === 'curve' ? 'trading against the bonding curve' : 'trading in the Uniswap v3 pool, 1% tier'}>
					{venue === 'curve' ? 'bonding curve' : 'uniswap v3 · 1%'}
				</span>
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
							? ['0.001', '0.01', '0.05', '0.1'].map((v) => (
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
					<dt>minimum after slippage</dt>
					<dd>
						{quote
							? side === 'buy'
								? `${formatTokens(Number(formatUnits((quote.out * BigInt(10_000 - slippageBps)) / BigInt(10_000), 18)))} $${symbol}`
								: formatNative(Number(formatEther((quote.out * BigInt(10_000 - slippageBps)) / BigInt(10_000))), 'ETH')
							: '-'}
					</dd>
					<dt>{venue === 'curve' ? 'trade fee' : 'pool fee (1%)'}</dt>
					<dd>{quote ? formatNative(Number(formatEther(quote.fee)), 'ETH') : '-'}</dd>
				</dl>
				<div className="field" style={{ gap: 6 }}>
					<span className="hint">max slippage</span>
					<SlippagePicker value={slippageBps} onChange={setSlippageBps} />
				</div>
				{quote?.refund ? (
					<div className="notice good" role="status">
						<span aria-hidden="true">↑</span>
						<span>this buy completes the curve and graduates the token. {formatNative(Number(formatEther(quote.refund)), 'ETH')} is refunded.</span>
					</div>
				) : null}
				{venue === 'curve' && quote && side === 'buy' && Number(amount) > 0 && Number(formatEther(quote.fee)) / Number(amount) > 0.02 ? (
					<div className="notice warn" role="status">
						<span aria-hidden="true">!</span>
						<span>anti-snipe tax is active. it falls to the normal 1% within 5 seconds of launch; waiting a moment saves most of this fee.</span>
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
						{busy === 'approving' ? `approve $${symbol} in your wallet` : busy === 'signing' ? 'confirm in your wallet' : busy === 'confirming' ? 'confirming' : side === 'buy' ? `buy $${symbol}` : `sell $${symbol}`}
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
			<h2 className="caps">creator fees</h2>
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
