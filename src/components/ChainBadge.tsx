import { chainLabel, type ChainKey } from '@/lib/config';

export function ChainBadge({ chain }: { chain: ChainKey }) {
	return (
		<span className={`chain-badge ${chain}`}>
			<i aria-hidden="true" />
			{chainLabel(chain).toLowerCase()}
		</span>
	);
}
