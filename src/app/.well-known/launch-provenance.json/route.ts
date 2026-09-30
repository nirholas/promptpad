import { PAD_FACTORY, robinhoodChain, SITE_NAME, SITE_URL, SOLANA_CLUSTER, SOLANA_TREASURY } from '@/lib/config';
import { json } from '@/lib/http';
import { attesters, CHANNELS, MEMO_PROGRAM, ORIGIN_TAG } from '@/lib/origin';

/**
 * Machine-readable recipe for verifying, from chain data alone, which tokens were launched through
 * this platform and through which channel. Aggregators and indexers can use it without our API.
 */
export function GET() {
	const keys = attesters();
	return json(
		{
			launchpad: SITE_NAME,
			site: SITE_URL,
			channels: CHANNELS,
			feed: `${SITE_URL}/api/launches?origin=prompt`,
			robinhood: {
				chainId: robinhoodChain.id,
				factory: PAD_FACTORY,
				attester: keys.robinhood,
				verify:
					'Filter the factory’s LaunchOrigin(address indexed token, uint8 indexed channel, bytes32 indexed ref) logs by channel. The factory only emits channel 1 or 2 after verifying an EIP-712 signature from `attester` over the exact token parameters and the creator; origins(token) returns the same on-chain.',
			},
			solana: {
				cluster: SOLANA_CLUSTER,
				venue: 'pump.fun',
				treasury: SOLANA_TREASURY,
				attester: keys.solana,
				memoProgram: MEMO_PROGRAM.toBase58(),
				memoFormat: `${ORIGIN_TAG}:v1:<site|prompt>:<draftId>:<mint>`,
				verify:
					'Read the attester address history: each launch bundle includes a Memo in memoFormat signed by `attester`, next to the coin\'s locked pump.fun fee split (70% fee wallet / 30% treasury). A memo cannot be moved to another coin, because the attester signature covers the transaction that writes that coin\'s split.',
			},
		},
		{ headers: { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } },
	);
}
