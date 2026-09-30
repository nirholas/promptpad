import { errorResponse, json } from '@/lib/http';
import { LaunchError } from '@/lib/launches';
import { sendBundle } from '@/lib/solana/pump';

/** Forwards signed launch transactions to the Jito block engine as one atomic bundle. */
export async function POST(req: Request) {
	try {
		const { transactions } = (await req.json().catch(() => ({}))) as { transactions?: unknown };
		if (!Array.isArray(transactions) || transactions.length < 1 || transactions.length > 5 || !transactions.every((t) => typeof t === 'string' && t.length < 4000)) {
			throw new LaunchError('Expected one to five signed transactions.');
		}
		const bundleId = await sendBundle(transactions as string[]).catch((e: Error) => {
			throw new LaunchError(e.message, 502);
		});
		return json({ bundleId });
	} catch (error) {
		return errorResponse(error);
	}
}
