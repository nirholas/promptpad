import { chainLabel, nativeSymbol, type ChainKey } from '@/lib/config';
import type { FeeSchedule } from '@/lib/fees';
import { formatBps } from '@/lib/format';

function rows(f: FeeSchedule) {
	const n = nativeSymbol(f.chain);
	return [
		['launch fee', `${f.launchFee} ${n}, paid once by the launcher`],
		[
			'trade fee',
			f.antiSnipe
				? `${formatBps(f.tradeFeeBps)} per trade. Opens at ${formatBps(f.antiSnipe.startBps)} and decays to it over ${f.antiSnipe.seconds}s to blunt snipers`
				: `${formatBps(f.tradeFeeBps)} per buy and sell on the curve`,
		],
		['creator share', `${formatBps(f.creatorShareBps)} of trade fees, to the fee wallet forever`],
		['graduation', `at ${f.graduationTarget} ${n} raised, into ${f.graduatesTo}`],
		['graduation fee', `${formatBps(f.graduationFeeBps)} of the raise`],
		['liquidity', f.lpTerms],
	] as const;
}

export function FeeTable({ schedules }: { schedules: Record<ChainKey, FeeSchedule | null> }) {
	return (
		<div className="grid-2">
			{(['robinhood', 'solana'] as const).map((chain) => {
				const f = schedules[chain];
				return (
					<div key={chain} className="card" style={{ overflow: 'hidden' }}>
						<div className="card-pad" style={{ paddingBottom: 8 }}>
							<h3 style={{ fontSize: 22 }}>{chainLabel(chain).toLowerCase()}</h3>
						</div>
						{f ? (
							<div className="table-scroll">
								<table className="fee-table">
									<tbody>
										{rows(f).map(([k, v]) => (
											<tr key={k}>
												<td>{k}</td>
												<td>{v}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						) : (
							<div className="card-pad" style={{ paddingTop: 0 }}>
								<p className="muted">launches on {chainLabel(chain).toLowerCase()} are not open on this deployment yet.</p>
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
