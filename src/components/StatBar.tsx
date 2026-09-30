import { stats } from '@/lib/launches';

export async function StatBar() {
	const s = await stats();
	const total = s.robinhood.launches + s.solana.launches;
	const cells = [
		['tokens live', total],
		['born from a prompt', s.robinhood.prompt + s.solana.prompt],
		['graduated', s.robinhood.graduated + s.solana.graduated],
		['on robinhood chain', s.robinhood.launches],
		['on solana', s.solana.launches],
	] as const;
	return (
		<section className="card statbar" aria-label="Registry totals">
			{cells.map(([label, value]) => (
				<div key={label}>
					<span className="caps">{label}</span>
					<strong>{value.toLocaleString('en-US')}</strong>
				</div>
			))}
		</section>
	);
}
