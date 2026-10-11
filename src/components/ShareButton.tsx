import { SITE_URL } from '@/lib/config';
import type { Launch } from '@/lib/types';

/** Post the token to X with its share card; the page URL unfurls into the card from opengraph-image. */
export function ShareButton({ launch, className = 'btn btn-sm' }: { launch: Pick<Launch, 'chain' | 'address' | 'symbol' | 'name' | 'channel' | 'source' | 'client'>; className?: string }) {
	const prompt = launch.channel === 2 || launch.source === 'claude';
	const who = launch.client === 'claude' ? 'Claude' : 'a prompt';
	const text = prompt
		? `$${launch.symbol} (${launch.name}) was launched from ${who} on promptpad`
		: `$${launch.symbol} (${launch.name}) is live on promptpad`;
	const url = `${SITE_URL}/t/${launch.chain}/${launch.address}`;
	const href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
	return (
		<a className={className} href={href} target="_blank" rel="noreferrer">
			share on x
		</a>
	);
}
