import { errorResponse, json } from '@/lib/http';
import { LaunchError } from '@/lib/launches';
import { buildCreatorClaimTransaction } from '@/lib/solana/dbc';
import { isSolanaAddress } from '@/lib/validate';

export async function POST(req: Request) {
	try {
		const { mint, creator } = (await req.json().catch(() => ({}))) as { mint?: string; creator?: string };
		if (!mint || !isSolanaAddress(mint)) throw new LaunchError('Unknown token.');
		if (!creator || !isSolanaAddress(creator)) throw new LaunchError('Connect the fee wallet first.');
		const built = await buildCreatorClaimTransaction(mint, creator).catch((e: Error) => {
			throw new LaunchError(e.message);
		});
		return json(built);
	} catch (error) {
		return errorResponse(error);
	}
}
