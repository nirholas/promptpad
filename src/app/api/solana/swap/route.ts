import { errorResponse, json } from '@/lib/http';
import { LaunchError } from '@/lib/launches';
import { buildSwapTransaction, quoteSwap } from '@/lib/solana/dbc';
import { isSolanaAddress } from '@/lib/validate';

type Body = { mint?: string; owner?: string; side?: string; amount?: number | string; slippageBps?: number; quoteOnly?: boolean };

/** Quotes a curve trade, or builds the unsigned swap transaction for the trader's wallet to sign. */
export async function POST(req: Request) {
	try {
		const body = (await req.json().catch(() => ({}))) as Body;
		const side = body.side === 'sell' ? 'sell' : body.side === 'buy' ? 'buy' : null;
		const amount = Number(body.amount);
		const slippageBps = Math.min(Math.max(Math.round(Number(body.slippageBps ?? 100)), 10), 5_000);
		if (!body.mint || !isSolanaAddress(body.mint)) throw new LaunchError('Unknown token.');
		if (!side) throw new LaunchError('Choose buy or sell.');
		if (!Number.isFinite(amount) || amount <= 0) throw new LaunchError('Enter an amount above zero.');

		if (body.quoteOnly) {
			const quote = await quoteSwap(body.mint, side, amount, slippageBps).catch((e: Error) => {
				throw new LaunchError(e.message);
			});
			return json({ quote: quote.display });
		}
		if (!body.owner || !isSolanaAddress(body.owner)) throw new LaunchError('Connect a Solana wallet first.');
		const built = await buildSwapTransaction(body.mint, body.owner, side, amount, slippageBps).catch((e: Error) => {
			throw new LaunchError(e.message);
		});
		return json(built);
	} catch (error) {
		return errorResponse(error);
	}
}
