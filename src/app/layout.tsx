import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { SITE_NAME, SITE_URL } from '@/lib/config';

import './globals.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist', weight: ['400', '500', '600', '700', '800'] });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', weight: ['400', '500', '600'] });

export const metadata: Metadata = {
	metadataBase: new URL(SITE_URL),
	title: { default: `${SITE_NAME}: launch a token from a prompt`, template: `%s · ${SITE_NAME}` },
	description:
		'Launch a token on Robinhood Chain or Solana straight from Claude or the site. Bonding curve, locked liquidity at graduation, creator fees to your wallet.',
	openGraph: { siteName: SITE_NAME, type: 'website' },
	twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
	themeColor: [
		{ media: '(prefers-color-scheme: light)', color: '#fafafa' },
		{ media: '(prefers-color-scheme: dark)', color: '#0b0b0b' },
	],
};

// Applies the saved theme before first paint so there is no flash; dark is the default.
const themeBootstrap = `try{var t=localStorage.getItem('theme');document.documentElement.dataset.theme=t==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en" data-theme="dark" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
			</head>
			<body>
				<SiteHeader />
				<main>{children}</main>
				<SiteFooter />
			</body>
		</html>
	);
}
