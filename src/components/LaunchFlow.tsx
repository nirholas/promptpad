'use client';

import { useConnection as useSolanaConnection, useWallet } from '@solana/wallet-adapter-react';
import { Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseEther } from 'viem';
import { useConnection, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';

import { chainLabel, explorer, nativeSymbol, PAD_FACTORY, robinhoodChain, type ChainKey } from '@/lib/config';
import { base64ToBytes, bytesToBase64 } from '@/lib/bytes';
import { padFactoryAbi } from '@/lib/evm/abi';
import type { FeeSchedule } from '@/lib/fees';
import { formatBps, registryNumber } from '@/lib/format';
import type { Draft, Launch } from '@/lib/types';
import { ChainBadge } from './ChainBadge';
import { EvmWalletButton, SolanaWalletButton } from './WalletButtons';

type Phase = 'edit' | 'preparing' | 'ready' | 'signing' | 'confirming' | 'done';

type Form = {
	chain: ChainKey;
	name: string;
	symbol: string;
	image: string;
	description: string;
	feeWallet: string;
	initialBuy: string;
};

const EMPTY: Form = { chain: 'robinhood', name: '', symbol: '', image: '', description: '', feeWallet: '', initialBuy: '' };

const txKey = (draftId: string) => `promptpad:tx:${draftId}`;

function readStored(key: string) {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStored(key: string, value: string) {
	try {
		window.localStorage.setItem(key, value);
	} catch {
		// Storage can be unavailable (private mode); resume then relies on the registry sync instead.
	}
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
	const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
	const data = (await res.json().catch(() => ({}))) as T & { error?: string };
	if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status}).`), { status: res.status });
	return data;
}

/** Confirmation can briefly trail the chain (RPC lag); retry only the "not found yet" answer. */
async function confirmLaunch(draftId: string, body: { txHash?: string; signature?: string }) {
	for (let attempt = 0; ; attempt++) {
		try {
			return (await postJson<{ launch: Launch }>(`/api/drafts/${draftId}/confirm`, body)).launch;
		} catch (error) {
			const status = (error as { status?: number }).status;
			if (status !== 404 || attempt >= 7) throw error;
			await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
		}
	}
}

function walletError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	if (/user rejected|rejected the request|denied|cancel/i.test(message)) return 'You declined in your wallet. Nothing was sent.';
	if (/insufficient funds|insufficient lamports|custom program error: 0x1\b/i.test(message)) return 'Not enough balance to cover the launch fee, initial buy and gas.';
	return message.split('\n')[0].slice(0, 240);
}

export function LaunchFlow({
	draft: initialDraft,
	launch: initialLaunch,
	fees,
	enabled,
	expired = false,
}: {
	draft?: Draft;
	launch?: Launch | null;
	fees: Record<ChainKey, FeeSchedule | null>;
	enabled: Record<ChainKey, boolean>;
	/** Computed on the server when the checkout page renders. */
	expired?: boolean;
}) {
	const checkout = Boolean(initialDraft);
	const [form, setForm] = useState<Form>(() =>
		initialDraft
			? {
					chain: initialDraft.chain,
					name: initialDraft.name,
					symbol: initialDraft.symbol,
					image: initialDraft.image,
					description: initialDraft.description,
					feeWallet: initialDraft.feeWallet,
					initialBuy: Number(initialDraft.initialBuy) > 0 ? initialDraft.initialBuy : '',
				}
			: { ...EMPTY, chain: enabled.robinhood ? 'robinhood' : 'solana' },
	);
	const [draft, setDraft] = useState<Draft | null>(initialDraft ?? null);
	const [launch, setLaunch] = useState<Launch | null>(initialLaunch ?? null);
	const [phase, setPhase] = useState<Phase>(initialLaunch ? 'done' : initialDraft ? 'ready' : 'edit');
	const [error, setError] = useState<string | null>(null);
	const [imageState, setImageState] = useState<'idle' | 'ok' | 'bad'>('idle');
	const [txRef, setTxRef] = useState<string | null>(null);

	const evm = useConnection();
	const evmClient = usePublicClient({ chainId: robinhoodChain.id });
	const switchChain = useSwitchChain();
	const writeContract = useWriteContract();
	const solana = useWallet();
	const { connection: solanaConnection } = useSolanaConnection();

	const chain = form.chain;
	const schedule = fees[chain];
	const native = nativeSymbol(chain);
	const connectedAddress = chain === 'robinhood' ? evm.address : solana.publicKey?.toBase58();
	const locked = phase !== 'edit';
	// Until the user types a fee wallet, it follows whichever wallet is connected.
	const [feeWalletTouched, setFeeWalletTouched] = useState(checkout);
	const feeWallet = feeWalletTouched ? form.feeWallet : form.feeWallet || connectedAddress || '';

	// Resume: a checkout reopened after signing picks the launch back up instead of asking again.
	useEffect(() => {
		if (!initialDraft || initialLaunch) return;
		const stored = readStored(txKey(initialDraft.id));
		const body = initialDraft.chain === 'robinhood' ? (stored ? { txHash: stored } : null) : initialDraft.mint ? { signature: stored ?? undefined } : null;
		if (!body) return;
		let cancelled = false;
		postJson<{ launch: Launch }>(`/api/drafts/${initialDraft.id}/confirm`, body)
			.then(({ launch }) => {
				if (cancelled) return;
				setLaunch(launch);
				setPhase('done');
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [initialDraft, initialLaunch]);

	const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
		const value = key === 'symbol' ? e.target.value.replace(/^\$/, '').toUpperCase() : e.target.value;
		if (key === 'feeWallet') setFeeWalletTouched(true);
		setForm((f) => ({ ...f, [key]: value }));
		if (key === 'image') setImageState('idle');
	};

	const total = useMemo(() => {
		const buy = Number(form.initialBuy || 0);
		return schedule ? schedule.launchFee + (Number.isFinite(buy) ? buy : 0) : null;
	}, [form.initialBuy, schedule]);

	const prepare = useCallback(async () => {
		setError(null);
		setPhase('preparing');
		try {
			const { draft } = await postJson<{ draft: Draft }>('/api/drafts', { ...form, feeWallet, initialBuy: form.initialBuy || '0' });
			setDraft(draft);
			setPhase('ready');
			window.history.replaceState(null, '', `/launch/${draft.id}`);
		} catch (e) {
			setError((e as Error).message);
			setPhase('edit');
		}
	}, [form, feeWallet]);

	const signEvm = useCallback(
		async (d: Draft) => {
			if (!PAD_FACTORY || !evmClient) throw new Error('Robinhood Chain launches are not configured.');
			if (evm.chainId !== robinhoodChain.id) await switchChain.mutateAsync({ chainId: robinhoodChain.id });
			const launchFee = await evmClient.readContract({ address: PAD_FACTORY, abi: padFactoryAbi, functionName: 'launchFee' });
			if (!evm.address) throw new Error('Connect an EVM wallet first.');
			const origin = await postJson<{ channel: number; ref: `0x${string}`; deadline: string; signature: `0x${string}` }>(
				`/api/drafts/${d.id}/origin`,
				{ creator: evm.address },
			);
			const value = launchFee + parseEther(d.initialBuy || '0');
			const hash = await writeContract.mutateAsync({
				address: PAD_FACTORY,
				abi: padFactoryAbi,
				functionName: 'createToken',
				args: [{ name: d.name, symbol: d.symbol, image: d.image, description: d.description, feeRecipient: d.feeWallet as `0x${string}` }, BigInt(0), { ...origin, deadline: BigInt(origin.deadline) }],
				value,
				chainId: robinhoodChain.id,
			});
			writeStored(txKey(d.id), hash);
			setTxRef(hash);
			setPhase('confirming');
			const receipt = await evmClient.waitForTransactionReceipt({ hash });
			if (receipt.status !== 'success') throw new Error('The launch transaction reverted on-chain. No token was created.');
			return confirmLaunch(d.id, { txHash: hash });
		},
		[evm.address, evm.chainId, evmClient, switchChain, writeContract],
	);

	const signSolana = useCallback(
		async (d: Draft) => {
			if (!solana.publicKey || !solana.signAllTransactions) {
				throw new Error('Connect a Solana wallet that can sign multiple transactions (Phantom, Solflare, Backpack).');
			}
			const built = await postJson<{ transactions: string[]; lastValidBlockHeight: number }>(`/api/drafts/${d.id}/solana-tx`, {
				payer: solana.publicKey.toBase58(),
			});
			const unsigned = built.transactions.map((b) => Transaction.from(base64ToBytes(b)));
			const signed = await solana.signAllTransactions(unsigned);
			const last = signed[signed.length - 1];
			const signature = bs58.encode(last.signature!);
			writeStored(txKey(d.id), signature);
			setTxRef(signature);
			setPhase('confirming');

			const confirmOne = (sig: string) =>
				solanaConnection.confirmTransaction(
					{ signature: sig, blockhash: last.recentBlockhash!, lastValidBlockHeight: built.lastValidBlockHeight },
					'confirmed',
				);
			// Preferred path: one atomic Jito bundle, so the coin, the first buy and the fee split land
			// together. If the bundle does not land within ~25s, send the same signed transactions in
			// order through the RPC; a bundle that did land makes those sends no-ops.
			let landed = false;
			try {
				await postJson('/api/solana/bundle', { transactions: signed.map((t) => bytesToBase64(t.serialize())) });
				landed = await Promise.race([
					confirmOne(signature).then((r) => !r.value.err),
					new Promise<boolean>((r) => setTimeout(() => r(false), 25_000)),
				]);
			} catch {
				landed = false;
			}
			if (!landed) {
				for (const tx of signed) {
					const sig = bs58.encode(tx.signature!);
					await solanaConnection.sendRawTransaction(tx.serialize(), { maxRetries: 5 }).catch(() => undefined);
					const result = await confirmOne(sig);
					if (result.value.err) throw new Error('A launch transaction failed on-chain. Reopen this page to finish or retry.');
				}
			}
			return confirmLaunch(d.id, { signature });
		},
		[solana, solanaConnection],
	);

	const sign = useCallback(async () => {
		if (!draft) return;
		setError(null);
		setPhase('signing');
		try {
			const result = draft.chain === 'robinhood' ? await signEvm(draft) : await signSolana(draft);
			setLaunch(result);
			setPhase('done');
		} catch (e) {
			setError(walletError(e));
			setPhase('ready');
		}
	}, [draft, signEvm, signSolana]);

	if (phase === 'done' && launch) return <LaunchDone launch={launch} />;

	const stepIndex = { edit: 0, preparing: 0, ready: 1, signing: 2, confirming: 3, done: 4 }[phase];
	const walletReady = Boolean(connectedAddress);

	return (
		<div className="launch-layout">
			<form
				className="card card-pad form-grid"
				onSubmit={(e) => {
					e.preventDefault();
					if (phase === 'edit') prepare();
					else if (phase === 'ready') sign();
				}}
				aria-describedby={error ? 'launch-error' : undefined}
			>
				<div>
					<span className="eyebrow">{checkout ? (draft?.source === 'claude' ? 'prepared in claude' : 'your launch') : 'new launch'}</span>
					<h1 style={{ fontSize: 'clamp(30px, 5vw, 44px)', marginTop: 8 }}>{checkout ? 'review and sign' : 'launch a token'}</h1>
				</div>

				<div className="field">
					<span className="label" id="chain-label">chain</span>
					<div className="segmented" role="group" aria-labelledby="chain-label">
						{(['robinhood', 'solana'] as const).map((c) => (
							<button
								key={c}
								type="button"
								aria-pressed={chain === c}
								disabled={locked || !enabled[c]}
								onClick={() => {
									setForm((f) => ({ ...f, chain: c, feeWallet: '' }));
									setFeeWalletTouched(false);
								}}
								title={enabled[c] ? undefined : 'Not open on this deployment yet'}
							>
								<ChainBadge chain={c} />
							</button>
						))}
					</div>
				</div>

				<div className="form-row">
					<div className="field">
						<label htmlFor="name">name</label>
						<input id="name" className="input" value={form.name} onChange={set('name')} maxLength={32} required readOnly={locked} placeholder="Night Owl" autoComplete="off" />
					</div>
					<div className="field">
						<label htmlFor="symbol">ticker</label>
						<input id="symbol" className="input mono" value={form.symbol} onChange={set('symbol')} maxLength={10} required readOnly={locked} placeholder="OWL" pattern="[A-Z0-9]{1,10}" autoComplete="off" />
					</div>
				</div>

				<div className="field">
					<label htmlFor="image">logo link</label>
					<input id="image" className="input" type="url" value={form.image} onChange={set('image')} required readOnly={locked} placeholder="https://…/logo.png" aria-invalid={imageState === 'bad'} />
					{imageState === 'bad' ? <span className="err">that link did not load as an image in your browser.</span> : <span className="hint">a public https image. it is written on-chain and cannot be changed later.</span>}
				</div>

				<div className="field">
					<label htmlFor="description">description <span className="muted">(optional)</span></label>
					<textarea id="description" className="textarea" value={form.description} onChange={set('description')} maxLength={1000} readOnly={locked} placeholder="what is it, and why should anyone care?" />
				</div>

				<div className="field">
					<label htmlFor="feeWallet">fee wallet</label>
					<input id="feeWallet" className="input mono" value={feeWallet} onChange={set('feeWallet')} required readOnly={locked} placeholder={chain === 'robinhood' ? '0x…' : 'solana address'} autoComplete="off" spellCheck={false} />
					<span className="hint">earns the creator share of every trade, forever. it cannot be changed after launch.</span>
				</div>

				<div className="field">
					<label htmlFor="initialBuy">initial buy <span className="muted">(optional)</span></label>
					<div className="input-affix">
						<input id="initialBuy" className="input" inputMode="decimal" value={form.initialBuy} onChange={set('initialBuy')} readOnly={locked} placeholder="0" pattern="\d*(\.\d+)?" />
						<span>{native}</span>
					</div>
					<span className="hint">bought in the launch transaction itself, so nobody can buy before you.</span>
				</div>

				{error ? (
					<div className="notice bad" id="launch-error" role="alert">
						<span aria-hidden="true">!</span>
						<span>{error}</span>
					</div>
				) : null}

				{expired && phase !== 'edit' ? (
					<div className="notice warn" role="status">
						<span aria-hidden="true">!</span>
						<span>
							this preview expired. <Link href="/launch">prepare a new launch</Link> with the same details.
						</span>
					</div>
				) : null}

				<div className="cta-row" style={{ justifyContent: 'space-between' }}>
					{phase === 'edit' || phase === 'preparing' ? (
						<button type="submit" className="btn btn-primary btn-lg" disabled={phase === 'preparing' || !enabled[chain]}>
							{phase === 'preparing' ? <span className="spinner" /> : null}
							{phase === 'preparing' ? 'checking everything' : 'preview launch'}
						</button>
					) : (
						<button type="submit" className="btn btn-primary btn-lg" disabled={!walletReady || expired || phase !== 'ready'}>
							{phase === 'signing' || phase === 'confirming' ? <span className="spinner" /> : null}
							{phase === 'signing' ? 'confirm in your wallet' : phase === 'confirming' ? 'launching on-chain' : `sign and launch${total !== null ? ` for ${Number(total.toFixed(6))} ${native}` : ''}`}
						</button>
					)}
					{chain === 'robinhood' ? <EvmWalletButton /> : <SolanaWalletButton />}
				</div>
				{phase === 'ready' && !connectedAddress ? <p className="hint muted" style={{ fontSize: 13 }}>connect a {chainLabel(chain).toLowerCase()} wallet to sign.</p> : null}
				{phase === 'ready' && !checkout ? (
					<button type="button" className="btn btn-ghost btn-sm" style={{ justifySelf: 'start' }} onClick={() => { setPhase('edit'); setDraft(null); window.history.replaceState(null, '', '/launch'); }}>
						edit details
					</button>
				) : null}
				{txRef ? (
					<p className="muted" style={{ fontSize: 13 }}>
						transaction: <a href={explorer(chain, 'tx', txRef)} target="_blank" rel="noreferrer" className="mono">{txRef.slice(0, 18)}…</a>
					</p>
				) : null}
			</form>

			<aside className="launch-aside">
				<div className="card card-pad" style={{ display: 'grid', gap: 14 }}>
					<span className="eyebrow">preview</span>
					<div className="token-card-top" style={{ gridTemplateColumns: '64px 1fr' }}>
						{form.image ? (
							// eslint-disable-next-line @next/next/no-img-element
							<img
								src={form.image}
								alt=""
								className="token-logo"
								style={{ width: 64, height: 64, borderRadius: 16 }}
								onLoad={() => setImageState('ok')}
								onError={() => setImageState('bad')}
								referrerPolicy="no-referrer"
							/>
						) : (
							<div className="token-logo" style={{ width: 64, height: 64, borderRadius: 16 }} aria-hidden="true" />
						)}
						<div style={{ minWidth: 0 }}>
							<div className="token-name" style={{ fontSize: 20 }}>{form.name || 'your token'}</div>
							<div className="token-sym">${form.symbol || 'TICKER'}</div>
						</div>
					</div>
					<p className="token-desc" style={{ minHeight: 0 }}>{form.description || 'no description.'}</p>
					<ChainBadge chain={chain} />
				</div>

				<div className="card card-pad" style={{ display: 'grid', gap: 12 }}>
					<span className="eyebrow">what you pay</span>
					{schedule ? (
						<dl className="kv">
							<dt>launch fee</dt>
							<dd>{schedule.launchFee} {native}</dd>
							<dt>initial buy</dt>
							<dd>{Number(form.initialBuy || 0)} {native}</dd>
							<dt>network gas</dt>
							<dd>set by your wallet</dd>
							<dt>trade fee after launch</dt>
							<dd>{formatBps(schedule.tradeFeeBps)}, {formatBps(schedule.creatorShareBps)} of it to you</dd>
							<dt>graduates at</dt>
							<dd>{schedule.graduationTarget} {native} raised</dd>
						</dl>
					) : (
						<p className="muted">launches on {chainLabel(chain).toLowerCase()} are not open on this deployment yet.</p>
					)}
				</div>

				<div className="card card-pad">
					<ol className="steps-track">
						{['describe the token', 'preview checked', 'sign in your wallet', 'live on-chain'].map((label, i) => (
							<li key={label} className={i < stepIndex ? 'done' : i === stepIndex ? 'active' : ''}>
								<i>{i < stepIndex ? '✓' : i + 1}</i>
								{label}
							</li>
						))}
					</ol>
				</div>
			</aside>
		</div>
	);
}

function LaunchDone({ launch }: { launch: Launch }) {
	const page = `/t/${launch.chain}/${launch.address}`;
	return (
		<div className="wrap" style={{ maxWidth: 640, paddingTop: 56 }}>
			<div className="card card-pad success-burst">
				<span className="chip chip-good">live on {chainLabel(launch.chain).toLowerCase()}</span>
				{launch.image ? (
					// eslint-disable-next-line @next/next/no-img-element
					<img src={launch.image} alt="" className="token-logo lg" referrerPolicy="no-referrer" />
				) : null}
				<h1 style={{ fontSize: 40 }}>
					{launch.name} <span className="muted">${launch.symbol}</span>
				</h1>
				<p className="muted">registry {registryNumber(launch.number)}. it is trading on the curve right now.</p>
				<p className="mono" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{launch.address}</p>
				<div className="cta-row" style={{ justifyContent: 'center' }}>
					<Link href={page} className="btn btn-primary">open the token page</Link>
					{launch.tx ? (
						<a href={explorer(launch.chain, 'tx', launch.tx)} target="_blank" rel="noreferrer" className="btn">
							view transaction
						</a>
					) : null}
				</div>
			</div>
		</div>
	);
}
