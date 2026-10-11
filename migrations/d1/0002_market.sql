-- Market data for rich token pages: every curve and pool trade, and every holder balance, indexed
-- from chain logs. Mirrors the Postgres schema in src/lib/db.ts.
create table if not exists trades (
	chain text not null,
	token text not null,
	tx text not null,
	log_index integer not null,
	block bigint not null,
	ts bigint not null,
	trader text not null,
	side text not null,
	venue text not null,
	native_amount double precision not null,
	token_amount double precision not null,
	price_native double precision not null,
	fee_native double precision not null default 0,
	primary key (chain, tx, log_index)
);

create index if not exists trades_token_ts_idx on trades (chain, token, ts desc);
create index if not exists trades_trader_idx on trades (chain, token, trader);

create table if not exists holders (
	chain text not null,
	token text not null,
	holder text not null,
	balance text not null,
	primary key (chain, token, holder)
);

create index if not exists holders_token_idx on holders (chain, token);
