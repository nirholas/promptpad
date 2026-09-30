-- D1 (SQLite) schema. Mirrors the Postgres schema in src/lib/db.ts; timestamps are ISO-8601 text.
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
	created_at text not null,
	expires_at text not null,
	launch_id integer
);

create table if not exists launches (
	id integer primary key autoincrement,
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
	graduated integer not null default 0,
	channel integer not null default 0,
	attested integer not null default 0,
	client text,
	created_at text not null,
	unique (chain, address)
);

create index if not exists launches_created_idx on launches (created_at desc);
create index if not exists launches_number_idx on launches (number desc);
create index if not exists launches_symbol_idx on launches (chain, lower(symbol));
create index if not exists launches_channel_idx on launches (channel, number desc);

create table if not exists sync_state (
	key text primary key,
	value text not null,
	updated_at text not null
);
