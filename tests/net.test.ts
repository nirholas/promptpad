import { describe, expect, it } from 'vitest';

import { checkImageUrl, publicFetch } from '@/lib/net';

describe('SSRF guard', () => {
	it.each(['http://example.org/a.png', 'https://127.0.0.1/a.png', 'https://10.0.0.5/a.png', 'https://169.254.169.254/latest', 'https://[::1]/a.png', 'https://localhost/a.png'])(
		'refuses %s',
		async (url) => {
			await expect(publicFetch(url)).rejects.toThrow();
		},
	);

	it('reports a non-image link without throwing', async () => {
		const result = await checkImageUrl('https://127.0.0.1/a.png');
		expect(result.ok).toBe(false);
	});
});
