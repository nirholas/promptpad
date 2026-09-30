'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const TABS = [
	{ href: '/', label: 'Tokens', match: (p: string) => p === '/' || p.startsWith('/registry') || p.startsWith('/t/') },
	{ href: '/launch', label: 'Launch', match: (p: string) => p.startsWith('/launch') },
	{ href: '/guide', label: 'Guide', match: (p: string) => p === '/guide' },
	{ href: '/guide#fees', label: 'Fees', match: () => false },
	{ href: '/guide#faq', label: 'FAQ', match: () => false },
];

export function HeaderNav() {
	const pathname = usePathname();
	return (
		<nav className="tabs-nav" aria-label="Main">
			{TABS.map((t, i) => (
				<Link key={t.href} href={t.href} aria-current={t.match(pathname) ? 'page' : undefined} className={i > 2 ? 'hide-md' : i === 2 ? 'hide-sm' : undefined}>
					{t.label}
				</Link>
			))}
		</nav>
	);
}

export function McpPill({ url }: { url: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<span className="pill hide-md" title="Claude connector URL">
			<span className="muted">MCP</span>
			<span className="pill-text">{url.replace(/^https?:\/\//, '')}</span>
			<button
				type="button"
				aria-label="Copy the connector URL"
				onClick={async () => {
					try {
						await navigator.clipboard.writeText(url);
						setCopied(true);
						setTimeout(() => setCopied(false), 1400);
					} catch {
						window.prompt('Copy the connector URL:', url);
					}
				}}
			>
				{copied ? <CheckIcon /> : <CopyIcon />}
			</button>
		</span>
	);
}

export function ThemeToggle() {
	return (
		<button
			type="button"
			className="icon-btn"
			aria-label="Toggle light and dark theme"
			onClick={() => {
				const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
				document.documentElement.dataset.theme = next;
				try {
					localStorage.setItem('theme', next);
				} catch {
					// The theme still switches for this visit when storage is unavailable.
				}
			}}
		>
			<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
				<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
				<path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
			</svg>
		</button>
	);
}

export function CopyIcon({ size = 14 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
			<rect x="8" y="8" width="12" height="12" rx="1.5" />
			<path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
		</svg>
	);
}

export function CheckIcon({ size = 14 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2">
			<path d="m5 12.5 4.5 4.5L19 7.5" />
		</svg>
	);
}
