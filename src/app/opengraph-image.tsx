import { ImageResponse } from 'next/og';

import { SITE_URL } from '@/lib/config';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Launch a token from a prompt';

/** The site-wide card: what the product is, in one line, and where to connect Claude. */
export default function Image() {
	const host = new URL(SITE_URL).host;
	return new ImageResponse(
		(
			<div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0b0b0b', color: '#f4f4f4', padding: 72 }}>
				<div style={{ fontSize: 32, color: '#8a8a8a' }}>{host}</div>
				<div style={{ fontSize: 104, fontWeight: 700, letterSpacing: -4, lineHeight: 1.02, marginTop: 40, display: 'flex', flexDirection: 'column' }}>
					<span>launch a token</span>
					<span style={{ color: '#8a8a8a' }}>from a prompt.</span>
				</div>
				<div style={{ flex: 1 }} />
				<div style={{ display: 'flex', gap: 16, fontSize: 28 }}>
					<span style={{ background: '#f4f4f4', color: '#0b0b0b', borderRadius: 10, padding: '10px 18px' }}>claude connector: {host}/mcp</span>
					<span style={{ border: '1px solid #3d3d3d', borderRadius: 10, padding: '10px 18px', color: '#bdbdbd' }}>robinhood chain · solana</span>
				</div>
			</div>
		),
		size,
	);
}
