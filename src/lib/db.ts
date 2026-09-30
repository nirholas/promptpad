import 'server-only';

import { onWorkers } from './runtime';

/**
 * Postgres when DATABASE_URL is set (production), an embedded file-backed Postgres (PGlite) under
 * `.data/` otherwise, so a fresh clone runs with zero setup. Both speak the same SQL.
 */

type Row = Record<string, unknown>;
type Query = <T extends Row = Row>(text: string, params?: unknown[]) => Promise<T[]>;

const SCHEMA = `
create table if not exists drafts (
	id text primary key,
	chain text not null,
	name text not null,
	symbol text not null,
	image text not null,
	description text not null default '',
	fee_wallet text not null,
	initial_buy text not null default '0',
	source text not null,
	mint text,
	client text,
	created_at timestamptz not null default now(),
	expires_at timestamptz not null,
	launch_id integer
);

create table if not exists launches (
	id serial primary key,
	number integer not null unique,
	chain text not null,
	address text not null,
	pool text,
	name text not null,
	symbol text not null,
	image text not null default '',
	description text not null default '',
	creator text not null,
	fee_wallet text not null,
	tx text,
	draft_id text,
	source text not null,
	graduated boolean not null default false,
	channel smallint not null default 0,
	attested boolean not null default false,
	client text,
	created_at timestamptz not null default now(),
	unique (chain, address)
);

alter table drafts add column if not exists client text;
alter table launches add column if not exists channel smallint not null default 0;
alter table launches add column if not exists attested boolean not null default false;
alter table launches add column if not exists client text;
create index if not exists launches_channel_idx on launches (channel, number desc);

create index if not exists launches_created_idx on launches (created_at desc);
create index if not exists launches_number_idx on launches (number desc);
create index if not exists launches_symbol_idx on launches (chain, lower(symbol));

create table if not exists sync_state (
	key text primary key,
	value text not null,
	updated_at timestamptz not null default now()
);
`;

let ready: Promise<Query> | null = null;


async function workersConnectionString(): Promise<string | null> {
	const { getCloudflareContext } = await import('@opennextjs/cloudflare');
	const { env } = await getCloudflareContext({ async: true });
	const hyperdrive = (env as { HYPERDRIVE?: { connectionString: string } }).HYPERDRIVE;
	return hyperdrive?.connectionString ?? process.env.DATABASE_URL ?? null;
}

/**
 * Workers cannot share a socket across requests, so each query opens a client (Hyperdrive makes
 * that cheap). The schema is ensured once per isolate.
 */
async function connectWorkers(): Promise<Query> {
	const { Client } = await import('pg');
	const connectionString = await workersConnectionString();
	if (!connectionString) throw new Error('Set DATABASE_URL or bind HYPERDRIVE for the Workers deployment.');
	const run = async <T extends Row>(text: string, params: unknown[] = []) => {
		const client = new Client({ connectionString });
		await client.connect();
		try {
			return (await client.query(text, params)).rows as T[];
		} finally {
			await client.end().catch(() => undefined);
		}
	};
	await run(SCHEMA);
	return run;
}

async function connect(): Promise<Query> {
	if (onWorkers) return connectWorkers();
	if (process.env.DATABASE_URL) {
		const { Pool } = await import('pg');
		const pool = new Pool({
			connectionString: process.env.DATABASE_URL,
			max: 5,
			ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
				? undefined
				: { rejectUnauthorized: false },
		});
		await pool.query(SCHEMA);
		return async (text, params = []) => (await pool.query(text, params)).rows;
	}
	// A runtime specifier keeps the embedded database out of the Workers bundle; it only ever runs
	// in local development and self-hosted Node without DATABASE_URL.
	const specifier = ['@electric-sql', 'pglite'].join('/');
	const { PGlite } = (await import(/* webpackIgnore: true */ specifier)) as typeof import('@electric-sql/pglite');
	const dir = process.env.PGLITE_DIR || './.data/pglite';
	if (!dir.startsWith('memory://')) {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });
	}
	const db = await PGlite.create(dir);
	await db.exec(SCHEMA);
	return async <T extends Row>(text: string, params: unknown[] = []) => (await db.query<T>(text, params)).rows;
}

export async function sql<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
	const globalCache = globalThis as unknown as { __promptpadDb?: Promise<Query> };
	ready ??= globalCache.__promptpadDb ??= connect().catch((error) => {
		ready = null;
		globalCache.__promptpadDb = undefined;
		throw error;
	});
	const query = await ready;
	return query<T>(text, params);
}
