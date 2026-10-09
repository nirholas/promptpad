import { canonicalPumpPoolPdaWithQuote, normalizeQuoteMint } from '@pump-fun/pump-sdk';
import type { Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

/**
 * Byte range of `Pool.creator_fees` in a PumpSwap pool account: 8-byte discriminator, then
 * pool_bump u8, index u16, creator, base_mint, quote_mint, lp_mint, pool_base_token_account,
 * pool_quote_token_account (6 pubkeys), lp_supply u64, coin_creator pubkey, is_mayhem_mode bool,
 * is_cashback_coin bool, virtual_quote_reserves i128, creator_fee_bps u64, can_edit_creator_fee
 * bool, is_holder_reward bool, protocol_fees u64, creator_fees u64 (pump_amm IDL, October 2026).
 */
const CREATOR_FEES_START = 279;
const CREATOR_FEES_END = 287;

/**
 * Creator fees the PumpSwap v2 trades left waiting in a pool's own bucket. They only reach the
 * creator vault after a permissionless `sweep_creator_fee`, so the creator-vault views (and
 * `getMinimumDistributableFee`) do not count them. Pools written before the upgrade are shorter
 * than the field: they read as zero, as the program treats them.
 */
export function poolCreatorFeesFromAccount(data: Uint8Array): BN {
	if (data.length < CREATOR_FEES_END) return new BN(0);
	return new BN(data.subarray(CREATOR_FEES_START, CREATOR_FEES_END), 'le');
}

/** Waiting pool-side creator fees of a graduated coin, or zero when it has no canonical pool. */
export async function readPoolCreatorFees(connection: Connection, mint: PublicKey, quoteMint: PublicKey): Promise<BN> {
	const info = await connection.getAccountInfo(canonicalPumpPoolPdaWithQuote(mint, normalizeQuoteMint(quoteMint)));
	return info ? poolCreatorFeesFromAccount(info.data) : new BN(0);
}
