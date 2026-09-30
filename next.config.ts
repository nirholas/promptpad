import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
	serverExternalPackages: ['@electric-sql/pglite', 'pg'],
	images: { unoptimized: true },
	poweredByHeader: false,
};

export default nextConfig;
