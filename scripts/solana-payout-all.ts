// Pays out accrued creator fees for every Solana launch in the registry. Payouts are permissionless
// and each one sends 70% to the coin's fee wallet and 30% to the platform treasury, so this is how
// the platform collects its Solana revenue. Any funded wallet can run it; it only pays network fees.
// Creator fees from v3 curve trades and PumpSwap v2 trades wait on the curve and in the pool, so each
// payout transaction sweeps them (curve, then pool) before it distributes; this wallet signs the sweeps.
//
//   SITE=https://promptpad.fun SOLANA_RPC_URL=<rpc> SOLANA_KEYPAIR=~/.config/solana/id.json \
//   node scripts/solana-payout-all.ts            # report what is distributable
//   node scripts/solana-payout-all.ts --send     # send the payouts

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';

import { readPoolCreatorFees } from '../src/lib/solana/pool-fees.ts';

const site = (process.env.SITE || 'https://promptpad.fun').replace(/\/$/, '');
const rpc = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const keypairPath = (process.env.SOLANA_KEYPAIR || '~/.config/solana/id.json').replace(/^~/, homedir());
const send = process.argv.includes('--send');

const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf8'))));
const connection = new Connection(rpc, 'confirmed');
const pump = new OnlinePumpSdk(connection);

type Row = { address: string; symbol: string };
const mints: Row[] = [];
for (let offset = 0; ; offset += 100) {
	const res = await fetch(`${site}/api/launches?chain=solana&limit=100&offset=${offset}`);
	const body = (await res.json()) as { launches: Row[]; total: number };
	mints.push(...body.launches);
	if (mints.length >= body.total || !body.launches.length) break;
}
console.log(`${mints.length} Solana launches on ${site}`);

let total = 0;
for (const { address, symbol } of mints) {
	const mint = new PublicKey(address);
	const status = await pump.getMinimumDistributableFee(mint, payer.publicKey).catch(() => null);
	if (!status) continue;
	// Curve-side fees are already in the distributable figure; a graduated coin's pool bucket is not.
	const curve = status.isGraduated ? await pump.fetchBondingCurve(mint).catch(() => null) : null;
	const pooled = curve ? await readPoolCreatorFees(connection, mint, curve.quoteMint).catch(() => null) : null;
	const distributable = pooled ? status.distributableFees.add(pooled) : status.distributableFees;
	const canDistribute = status.canDistribute || distributable.gte(status.minimumRequired);
	const sol = Number(distributable.toString()) / 1e9;
	total += sol;
	console.log(`$${symbol.padEnd(10)} ${address}  distributable ${sol.toFixed(6)} SOL${canDistribute ? '' : '  (below minimum)'}`);
	if (!send || !canDistribute) continue;
	try {
		const { instructions } = await pump.buildDistributeCreatorFeesInstructions(mint, { payer: payer.publicKey });
		const sig = await sendAndConfirmTransaction(connection, new Transaction().add(...instructions), [payer], { commitment: 'confirmed' });
		console.log(`  paid out: ${sig}`);
	} catch (error) {
		console.log(`  failed: ${(error as Error).message.split('\n')[0]}`);
	}
}
console.log(`\ntotal distributable: ${total.toFixed(6)} SOL (platform share 30%: ${(total * 0.3).toFixed(6)} SOL)${send ? '' : '. Report only; add --send to pay out.'}`);
