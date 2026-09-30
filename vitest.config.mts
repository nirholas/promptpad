import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
			// Next enforces `server-only` at bundle time; under vitest the modules are already server-side.
			'server-only': fileURLToPath(new URL('./tests/support/server-only.ts', import.meta.url)),
		},
	},
	test: {
		include: ['tests/**/*.test.ts'],
		testTimeout: 60_000,
		env: { PGLITE_DIR: 'memory://' },
	},
});
