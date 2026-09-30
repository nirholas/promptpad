import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
	serverExternalPackages: ['@electric-sql/pglite', 'pg'],
	// pg loads its Workers socket shim conditionally, so file tracing cannot see it on its own.
	outputFileTracingIncludes: { '/**': ['./node_modules/pg-cloudflare/**/*'] },
	images: { unoptimized: true },
	poweredByHeader: false,
};

export default nextConfig;

if (process.env.NODE_ENV === 'development') {
	// Local `next dev` gets Cloudflare bindings (Hyperdrive, env) when running under OpenNext's helper.
	import('@opennextjs/cloudflare').then(({ initOpenNextCloudflareForDev }) => initOpenNextCloudflareForDev());
}
