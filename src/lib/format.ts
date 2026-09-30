export function shortAddress(value: string, head = 4, tail = 4) {
	if (value.length <= head + tail + 1) return value;
	return `${value.slice(0, head + (value.startsWith('0x') ? 2 : 0))}…${value.slice(-tail)}`;
}

/** Native-asset amounts: enough precision for tiny curve prices, none of the noise for big ones. */
export function formatNative(value: number, symbol?: string) {
	const abs = Math.abs(value);
	let text: string;
	if (abs === 0) text = '0';
	else if (abs < 0.000001) text = value.toExponential(2);
	else if (abs < 1) text = value.toPrecision(3);
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
