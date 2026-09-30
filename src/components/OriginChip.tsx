import type { Launch } from '@/lib/types';

/** How a token was born, and whether that is provable on-chain. */
export function OriginChip({ launch }: { launch: Pick<Launch, 'channel' | 'source' | 'attested' | 'client'> }) {
	const prompt = launch.channel === 2 || launch.source === 'claude';
	if (!prompt) return null;
	const label = launch.client === 'claude' ? 'born in claude' : launch.client === 'chatgpt' ? 'born in chatgpt' : 'born from a prompt';
	return (
		<span
			className="chip chip-accent"
			title={
				launch.attested
					? 'Prepared by an AI assistant over MCP. The platform attestation is recorded on-chain, so anyone can verify it.'
					: 'Prepared by an AI assistant over MCP.'
			}
		>
			{launch.attested ? '✓ ' : ''}
			{label}
		</span>
	);
}
