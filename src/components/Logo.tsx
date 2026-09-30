export function LogoMark({ size = 26 }: { size?: number }) {
	return (
		<svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
			<rect x="1" y="1" width="30" height="30" rx="5" fill="var(--ink)" />
			<path d="M9 10.5 14.5 16 9 21.5" fill="none" stroke="var(--bg)" strokeWidth="2.6" strokeLinecap="square" />
			<path d="M17 22h7" stroke="var(--bg)" strokeWidth="2.6" strokeLinecap="square" />
		</svg>
	);
}
