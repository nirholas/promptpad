// Collects the platform's Solana revenue from every pool under the partner config: accrued
// partner trading fees, the launch (pool creation) fees, and migration fees on graduated pools.
//
//   SOLANA_RPC_URL=<rpc> SOLANA_PARTNER_KEYPAIR=~/.config/solana/id.json NEXT_PUBLIC_DBC_CONFIG=<config> \
//   node scripts/solana-claim-partner-fees.ts           # report only
//   node scripts/solana-claim-partner-fees.ts --send    # claim
//
// The keypair must be the config's fee claimer. Each claim is its own transaction so one failure
// never blocks the rest.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
import BN from 'bn.js';
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, type Transaction } from '@solana/web3.js';

const rpc = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const keypairPath = (process.env.SOLANA_PARTNER_KEYPAIR || '~/.config/solana/id.json').replace(/^~/, homedir());
const configAddress = process.env.NEXT_PUBLIC_DBC_CONFIG;
const send = process.argv.includes('--send');
if (!configAddress) throw new Error('Set NEXT_PUBLIC_DBC_CONFIG to the partner config address.');

const claimer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf8'))));
const connection = new Connection(rpc, 'confirmed');
const client = new DynamicBondingCurveClient(connection, 'confirmed');
const config = new PublicKey(configAddress);
const u64Max = new BN('18446744073709551615');

const cfg = await client.state.getPoolConfig(config);
if (!cfg) throw new Error(`No DBC config at ${configAddress} on ${rpc}.`);
if (!cfg.feeClaimer.equals(claimer.publicKey)) {
	throw new Error(`The keypair ${claimer.publicKey.toBase58()} is not this config's fee claimer (${cfg.feeClaimer.toBase58()}).`);
}

const pools = await client.state.getPoolsByConfig(config);
let tradingTotal = 0;
console.log(`${pools.length} pools under ${configAddress}`);

async function run(label: string, build: () => Promise<Transaction>) {
	if (!send) return;
	try {
		const tx = await build();
		const sig = await sendAndConfirmTransaction(connection, tx, [claimer], { commitment: 'confirmed' });
		console.log(`  ${label}: ${sig}`);
	} catch (error) {
		console.log(`  ${label} failed: ${(error as Error).message.split('\n')[0]}`);
	}
}

for (const { publicKey, account } of pools) {
	const s = account.poolState;
	const trading = Number(s.partnerQuoteFee.toString()) / 1e9;
	tradingTotal += trading;
	console.log(`${publicKey.toBase58()}  mint ${s.baseMint.toBase58()}  trading fees ${trading.toFixed(6)} SOL${Number(s.isMigrated) === 1 ? '  (migrated)' : ''}`);
	if (trading > 0) {
		await run('trading fees', () =>
			client.partner.claimPartnerTradingFee({
				feeClaimer: claimer.publicKey,
				payer: claimer.publicKey,
				pool: publicKey,
				maxBaseAmount: u64Max,
				maxQuoteAmount: u64Max,
			}),
		);
	}
	await run('launch fee', () => client.partner.claimPartnerPoolCreationFee({ pool: publicKey, feeReceiver: claimer.publicKey }));
	if (Number(s.isMigrated) === 1) {
		await run('migration fee', () => client.partner.partnerWithdrawMigrationFee({ pool: publicKey, sender: claimer.publicKey }));
	}
}

console.log(`\nclaimable trading fees: ${tradingTotal.toFixed(6)} SOL${send ? '' : '  (report only; re-run with --send to claim)'}`);
