// Pays out accrued creator fees for every Solana launch in the registry. Payouts are permissionless
// and each one sends 70% to the coin's fee wallet and 30% to the platform treasury, so this is how
// the platform collects its Solana revenue. Any funded wallet can run it; it only pays network fees.
//
//   SITE=https://promptpad.fun SOLANA_RPC_URL=<rpc> SOLANA_KEYPAIR=~/.config/solana/id.json \
//   node scripts/solana-payout-all.ts            # report what is distributable
//   node scripts/solana-payout-all.ts --send     # send the payouts

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';

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
	const sol = Number(status.distributableFees.toString()) / 1e9;
	total += sol;
	console.log(`$${symbol.padEnd(10)} ${address}  distributable ${sol.toFixed(6)} SOL${status.canDistribute ? '' : '  (below minimum)'}`);
	if (!send || !status.canDistribute) continue;
	try {
		const { instructions } = await pump.buildDistributeCreatorFeesInstructions(mint, { payer: payer.publicKey });
		const sig = await sendAndConfirmTransaction(connection, new Transaction().add(...instructions), [payer], { commitment: 'confirmed' });
		console.log(`  paid out: ${sig}`);
	} catch (error) {
		console.log(`  failed: ${(error as Error).message.split('\n')[0]}`);
	}
}
console.log(`\ntotal distributable: ${total.toFixed(6)} SOL (platform share 30%: ${(total * 0.3).toFixed(6)} SOL)${send ? '' : '. Report only; add --send to pay out.'}`);
