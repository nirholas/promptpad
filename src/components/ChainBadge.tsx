import { chainLabel, type ChainKey } from '@/lib/config';

/** Monochrome chain marks: a quill for Robinhood Chain, three slanted bars for Solana. */
export function ChainIcon({ chain }: { chain: ChainKey }) {
	return chain === 'robinhood' ? (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<path d="M13.5 2.5C9 3 5.2 6.6 3.8 11.2l-.9 2.8 1.4-.6c.6-1.6 1.4-2.7 2.4-3.6l2.6-.5-1.8-.6c1.9-2 4.1-3.6 6-6.2Z" fill="currentColor" />
		</svg>
	) : (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<path d="M4.2 3h9.3l-1.7 2.2H2.5zM2.5 6.9h9.3l1.7 2.2H4.2zM4.2 10.8h9.3L11.8 13H2.5z" fill="currentColor" />
		</svg>
	);
}

export function ChainBadge({ chain }: { chain: ChainKey }) {
	return (
		<span className="chain-badge">
			<ChainIcon chain={chain} />
			{chainLabel(chain).toLowerCase()}
		</span>
	);
}
