export function LogoMark({ size = 28 }: { size?: number }) {
	return (
		<svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
			<rect x="1" y="1" width="30" height="30" rx="9" fill="var(--ink)" />
			<path d="M9 22.5 C 13 22.5, 15 9.5, 23 9.5" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
			<circle cx="23" cy="9.5" r="3" fill="var(--rh)" />
			<path d="M9 17v5.5h5.5" fill="none" stroke="var(--bg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity=".55" />
		</svg>
	);
}
