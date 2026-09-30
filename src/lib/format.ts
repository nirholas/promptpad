export function shortAddress(value: string, head = 4, tail = 4) {
	if (value.length <= head + tail + 1) return value;
	return `${value.slice(0, head + (value.startsWith('0x') ? 2 : 0))}…${value.slice(-tail)}`;
}

const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉';

/**
 * Native-asset amounts. Tiny curve prices use the trading-terminal convention of a subscript zero
 * count (0.0₇101 = 0.0000000101), so they stay short without scientific notation.
 */
export function formatNative(value: number, symbol?: string) {
	const abs = Math.abs(value);
	let text: string;
	if (abs === 0) text = '0';
	else if (abs < 0.0001) {
		const zeros = Math.ceil(-Math.log10(abs)) - 1;
		const digits = (abs * 10 ** (zeros + 1)).toFixed(2).replace('.', '').replace(/0+$/, '') || '0';
		const sub = String(zeros).split('').map((d) => SUBSCRIPT[Number(d)]).join('');
		text = `${value < 0 ? '-' : ''}0.0${sub}${digits.slice(0, 3)}`;
	} else if (abs < 1) text = value.toPrecision(3);
	else if (abs < 1000) text = value.toFixed(abs < 10 ? 3 : 2);
	else text = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
	return symbol ? `${text} ${symbol}` : text;
}

export function formatTokens(value: number) {
	return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
}

export function formatPercent(fraction: number, digits = 1) {
	return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatBps(bps: number) {
	return `${Number((bps / 100).toFixed(2))}%`;
}

export function formatDate(iso: string) {
	return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
		.format(new Date(iso))
		.toLowerCase();
}

export function registryNumber(id: number) {
	return `#${String(id).padStart(5, '0')}`;
}

/** Compact age like the reference layout: 45s, 12m, 3h, 11d, 8mo, 2y. */
export function formatAge(iso: string, now = Date.now()) {
	const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
	if (s < 60) return `${s}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86_400) return `${Math.floor(s / 3600)}h`;
	if (s < 30 * 86_400) return `${Math.floor(s / 86_400)}d`;
	if (s < 365 * 86_400) return `${Math.floor(s / (30 * 86_400))}mo`;
	return `${Math.floor(s / (365 * 86_400))}y`;
}
