// Creates the Meteora DBC partner config that every Solana launch on this site uses.
//
//   SOLANA_RPC_URL=https://api.devnet.solana.com \
//   SOLANA_PARTNER_KEYPAIR=~/.config/solana/id.json \
//   node scripts/solana-create-config.ts            # prints the plan, sends nothing
//   node scripts/solana-create-config.ts --send     # signs and sends
//
// The dry run simulates against the live program without verifying signatures, so it works before
// the partner wallet is funded. SIMULATE_PAYER=<funded address> lets it pay rent in the simulation.
//
// The partner keypair pays rent for the config account and becomes its fee claimer. Put the printed
// config address in NEXT_PUBLIC_DBC_CONFIG.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { NATIVE_MINT } from '@solana/spl-token';
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, VersionedTransaction } from '@solana/web3.js';

import { buildPartnerConfig, SOLANA_ECONOMICS } from '../src/lib/solana/curve-config.ts';

const rpc = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const keypairPath = (process.env.SOLANA_PARTNER_KEYPAIR || '~/.config/solana/id.json').replace(/^~/, homedir());
const send = process.argv.includes('--send');

const partner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf8'))));
const feeClaimer = new PublicKey(process.env.SOLANA_FEE_CLAIMER || partner.publicKey);
const connection = new Connection(rpc, 'confirmed');
const client = new DynamicBondingCurveClient(connection, 'confirmed');
const config = Keypair.generate();

const payer = !send && process.env.SIMULATE_PAYER ? new PublicKey(process.env.SIMULATE_PAYER) : partner.publicKey;
const tx = await client.partner.createConfig({
	...buildPartnerConfig(),
	config: config.publicKey,
	feeClaimer,
	leftoverReceiver: feeClaimer,
	quoteMint: NATIVE_MINT,
	payer,
});

console.log(`rpc              ${rpc}`);
console.log(`partner (payer)  ${partner.publicKey.toBase58()}`);
console.log(`fee claimer      ${feeClaimer.toBase58()}`);
console.log(`config           ${config.publicKey.toBase58()}`);
console.log(`economics        ${JSON.stringify(SOLANA_ECONOMICS)}`);

if (!send) {
	tx.feePayer = payer;
	tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
	const sim = await connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), {
		sigVerify: false,
		replaceRecentBlockhash: true,
	});
	console.log(`simulation       ${sim.value.err ? `FAILED ${JSON.stringify(sim.value.err)}` : 'ok'}`);
	for (const line of sim.value.logs?.slice(-6) ?? []) console.log(`  ${line}`);
	console.log('\nDry run only. Re-run with --send to create the config.');
	process.exit(sim.value.err ? 1 : 0);
}

const signature = await sendAndConfirmTransaction(connection, tx, [partner, config], { commitment: 'confirmed' });
console.log(`signature        ${signature}`);
console.log(`\nNEXT_PUBLIC_DBC_CONFIG=${config.publicKey.toBase58()}`);
