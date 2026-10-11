'use client';

import { useSearchParams } from 'next/navigation';

export const SLIPPAGE_CHOICES = [50, 100, 200, 500] as const;

/**
 * A trade prefilled from the link that opened the page: `?side=buy&amount=0.05`. This is what the
 * connector's trade_link tool produces, so a trade planned in chat opens ready to sign.
 */
export function useTradeIntent(): { side: 'buy' | 'sell'; amount: string } {
	const params = useSearchParams();
	const side = params.get('side') === 'sell' ? 'sell' : 'buy';
	const amount = params.get('amount') ?? '';
	return { side, amount: /^\d+(\.\d+)?$/.test(amount) ? amount : '' };
}

export function SlippagePicker({ value, onChange }: { value: number; onChange: (bps: number) => void }) {
	return (
		<div className="segmented" role="group" aria-label="Maximum slippage">
			{SLIPPAGE_CHOICES.map((bps) => (
				<button key={bps} type="button" aria-pressed={value === bps} onClick={() => onChange(bps)}>
					{bps / 100}%
				</button>
			))}
		</div>
	);
}
