import { prng } from './logo';

/**
 * The generated mark as Satori-compatible JSX, shared by the logo PNG route and the share cards so
 * a card never has to fetch the site's own logo URL.
 */
export function LogoMark({ symbol, seed, size }: { symbol: string; seed: string; size: number }) {
	const GRID = 8;
	const rand = prng(seed);
	const dark = rand() < 0.72;
	const fg = dark ? '#f4f4f4' : '#0b0b0b';
	const bg = dark ? '#0b0b0b' : '#f4f4f4';

	// A left half of random cells mirrored onto the right, like an identicon, so every mark is
	// symmetric and reads as a designed glyph rather than noise.
	const cells: { x: number; y: number; o: number }[] = [];
	for (let y = 0; y < GRID; y++) {
		for (let x = 0; x < GRID / 2; x++) {
			if (rand() < 0.46) {
				const o = 0.1 + rand() * 0.22;
				cells.push({ x, y, o }, { x: GRID - 1 - x, y, o });
			}
		}
	}
	const k = size / 512;
	const cell = size / GRID;
	const label = symbol.length <= 4 ? symbol : symbol.slice(0, 5);
	const fontSize = (label.length <= 2 ? 220 : label.length === 3 ? 170 : label.length === 4 ? 132 : 104) * k;

	return (
		<div style={{ width: size, height: size, display: 'flex', position: 'relative', background: bg, overflow: 'hidden' }}>
			{cells.map((c, i) => (
				<div
					key={i}
					style={{
						position: 'absolute',
						left: c.x * cell + 4 * k,
						top: c.y * cell + 4 * k,
						width: cell - 8 * k,
						height: cell - 8 * k,
						background: fg,
						opacity: c.o,
						borderRadius: 6 * k,
					}}
				/>
			))}
			<div
				style={{
					position: 'absolute',
					left: 0,
					top: 0,
					width: size,
					height: size,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					color: fg,
					fontSize,
					fontWeight: 700,
					letterSpacing: -fontSize * 0.04,
				}}
			>
				{label}
			</div>
			{size >= 256 ? (
				<div style={{ position: 'absolute', left: 28 * k, right: 28 * k, bottom: 26 * k, display: 'flex', justifyContent: 'space-between', color: fg, opacity: 0.55, fontSize: 22 * k }}>
					<span>${symbol}</span>
					<span>{seed}</span>
				</div>
			) : null}
		</div>
	);
}

/** Parses a generated-logo URL back into its symbol and seed, or null for any other image. */
export function parseGeneratedLogo(url: string): { symbol: string; seed: string } | null {
	const match = /\/api\/logo\/([A-Z0-9]{1,10})\?v=([0-9a-f]{8})$/.exec(url);
	return match ? { symbol: match[1], seed: match[2] } : null;
}
