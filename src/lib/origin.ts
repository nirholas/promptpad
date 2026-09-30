import 'server-only';

import { Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import { keccak256, stringToBytes, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { PAD_FACTORY, robinhoodChain, SITE_NAME } from './config';
import type { Draft } from './types';

/**
 * Launch provenance. The platform holds an attester key per chain and signs every launch it
 * prepares, so "this token was born from a prompt" is provable from chain data alone:
 *
 * - Robinhood Chain: an EIP-712 signature the factory verifies; it emits
 *   `LaunchOrigin(token, channel, ref)` with channel 2 for prompt launches.
 * - Solana: an SPL Memo instruction `<tag>:v1:<channel>:<draftId>` whose required signer is the
 *   attester, inside the same transaction that creates the pool.
 *
 * Without keys configured, launches still work and are recorded as direct on-chain.
 */

export const CHANNELS = { direct: 0, site: 1, prompt: 2 } as const;
export type ChannelName = keyof typeof CHANNELS;

export const ORIGIN_TAG = SITE_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '');
export const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const ATTESTATION_TTL_SECONDS = 30 * 60;

export function channelFor(source: Draft['source']): ChannelName {
	return source === 'claude' ? 'prompt' : 'site';
}

export function draftRef(draftId: string): Hex {
	return keccak256(stringToBytes(`${ORIGIN_TAG}:draft:${draftId}`));
}

function evmAttester() {
	const key = process.env.ATTESTER_PRIVATE_KEY;
	return key && /^0x[0-9a-fA-F]{64}$/.test(key) ? privateKeyToAccount(key as Hex) : null;
}

function solanaAttester(): Keypair | null {
	const raw = process.env.ATTESTER_SOLANA_SECRET?.trim();
	if (!raw) return null;
	const bytes = raw.startsWith('[') ? Uint8Array.from(JSON.parse(raw) as number[]) : bs58.decode(raw);
	return Keypair.fromSecretKey(bytes);
}

/** Public keys anyone can check launch origins against. */
export function attesters() {
	return {
		robinhood: evmAttester()?.address ?? null,
		solana: solanaAttester()?.publicKey.toBase58() ?? null,
	};
}

export type EvmOrigin = { channel: number; ref: Hex; deadline: bigint; signature: Hex };

const DIRECT_ORIGIN: EvmOrigin = { channel: 0, ref: `0x${'0'.repeat(64)}`, deadline: BigInt(0), signature: '0x' };

/** EIP-712 attestation for a Robinhood Chain launch, bound to the wallet that will send it. */
export async function signEvmOrigin(draft: Draft, creator: Address): Promise<EvmOrigin> {
	const account = evmAttester();
	if (!account || !PAD_FACTORY) return DIRECT_ORIGIN;
	const channel = CHANNELS[channelFor(draft.source)];
	const ref = draftRef(draft.id);
	const deadline = BigInt(Math.floor(Date.now() / 1000) + ATTESTATION_TTL_SECONDS);
	const signature = await account.signTypedData({
		domain: { name: 'PadFactory', version: '1', chainId: robinhoodChain.id, verifyingContract: PAD_FACTORY },
		types: {
			Launch: [
				{ name: 'name', type: 'string' },
				{ name: 'symbol', type: 'string' },
				{ name: 'image', type: 'string' },
				{ name: 'description', type: 'string' },
				{ name: 'feeRecipient', type: 'address' },
				{ name: 'creator', type: 'address' },
				{ name: 'channel', type: 'uint8' },
				{ name: 'ref', type: 'bytes32' },
				{ name: 'deadline', type: 'uint64' },
			],
		},
		primaryType: 'Launch',
		message: {
			name: draft.name,
			symbol: draft.symbol,
			image: draft.image,
			description: draft.description,
			feeRecipient: draft.feeWallet as Address,
			creator,
			channel,
			ref,
			deadline,
		},
	});
	return { channel, ref, deadline, signature };
}

/** Memo instruction the attester must co-sign; returns null when no Solana attester is set. */
export function solanaOriginInstruction(draft: Draft) {
	const attester = solanaAttester();
	if (!attester) return null;
	const text = `${ORIGIN_TAG}:v1:${channelFor(draft.source)}:${draft.id}`;
	return {
		instruction: new TransactionInstruction({
			programId: MEMO_PROGRAM,
			keys: [{ pubkey: attester.publicKey, isSigner: true, isWritable: false }],
			data: Buffer.from(text, 'utf8'),
		}),
		signer: attester,
		memo: text,
	};
}
