// Regenerates src/lib/evm/abi.ts from the Foundry build output.
// Usage: (cd contracts && forge build) && npm run abi
import { readFileSync, writeFileSync } from 'node:fs';

const load = (name) =>
	JSON.parse(readFileSync(new URL(`../contracts/out/${name}.sol/${name}.json`, import.meta.url))).abi.filter(
		(item) => item.type !== 'constructor',
	);

const body = [
	'// Generated from contracts/out by `npm run abi`. Do not edit by hand.',
	'',
	`export const padFactoryAbi = ${JSON.stringify(load('PadFactory'), null, 2)} as const;`,
	'',
	`export const padTokenAbi = ${JSON.stringify(load('PadToken'), null, 2)} as const;`,
	'',
].join('\n');

writeFileSync(new URL('../src/lib/evm/abi.ts', import.meta.url), body);
console.log('wrote src/lib/evm/abi.ts');
