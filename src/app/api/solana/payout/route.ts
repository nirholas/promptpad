import { errorResponse, json } from '@/lib/http';
import { LaunchError } from '@/lib/launches';
import { buildPayoutTransaction } from '@/lib/solana/pump';
import { isSolanaAddress } from '@/lib/validate';

/** Permissionless payout of accrued creator fees to the coin's locked fee split. */
export async function POST(req: Request) {
	try {
		const { mint, payer } = (await req.json().catch(() => ({}))) as { mint?: string; payer?: string };
		if (!mint || !isSolanaAddress(mint)) throw new LaunchError('Unknown token.');
		if (!payer || !isSolanaAddress(payer)) throw new LaunchError('Connect a Solana wallet first.');
		const built = await buildPayoutTransaction(mint, payer).catch((e: Error) => {
			throw new LaunchError(e.message);
		});
		return json(built);
	} catch (error) {
		return errorResponse(error);
	}
}
