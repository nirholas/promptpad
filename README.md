# promptpad 

**Live at [promptpad.fun](https://promptpad.fun)** · connector `https://promptpad.fun/mcp`

| Chain | Contract | Status |
|---|---|---|
| Robinhood Chain (4663) | PadFactory [`0xDD47D5e5De93E968Df0BdF02e426f82d4EA0D4f6`](https://robinhoodchain.blockscout.com/address/0xDD47D5e5De93E968Df0BdF02e426f82d4EA0D4f6) | live: 0.0005 ETH launch fee, 1% trade fee (70% to creators), graduates at 4.2 ETH |
| Solana | pump.fun program | closed until `NEXT_PUBLIC_SOLANA_TREASURY` is set |

Launch a token from a prompt. Tell Claude (through a remote MCP connector) or fill in a short form, and the token goes live on **Robinhood Chain** or **Solana** on a bonding curve that graduates into locked liquidity. The launcher signs from their own wallet; the fee wallet they name earns the creator share of every trade forever.

The economics, identical in shape on both chains:

| | Robinhood Chain (own contracts) | Solana (pump.fun) |
|---|---|---|
| Launch fee | 0.0005 ETH | 0.01 SOL |
| Trade fee | 1% on curve and pool | pump.fun's fee schedule (read live) |
| Creator / platform | 70% / 30% of the trade fee | 70% / 30% of pump.fun's creator fee, via a fee-sharing config locked at launch |
| Graduation | 4.2 ETH, no fee; the whole raise goes into the pool | pump.fun's curve target, into PumpSwap |
| Liquidity | Uniswap v3 position held by the factory forever | locked by pump.fun at graduation |
| Anti-snipe | 99% buy tax falling to 0 over 5s | the creator's first buy lands in the same atomic bundle as the coin |

On Robinhood Chain no wallet is ever exempt from the anti-snipe tax; the only untaxed buy is the creator's initial buy executed atomically inside the launch transaction. Wallet exemptions are how snipe taxes get gamed, so there are none.

All Robinhood Chain values are constructor/owner settings with hard caps in the contract (trade fee at most 2%, launch fee at most 0.05 ETH, graduation fee at most 10%) and are snapshotted per token at launch. All Solana values live in [`src/lib/solana/curve-config.ts`](src/lib/solana/curve-config.ts), which is exactly what the config script writes on-chain.

## How it works

```
Claude ──MCP──▶ /mcp  launch_token ─┐
                                     ├─▶ draft (validated, 24h) ─▶ /launch/<id> checkout ─▶ wallet signs
Site form ───▶ POST /api/drafts ─────┘                                                        │
                                                                                               ▼
                    Robinhood Chain: PadFactory.createToken      Solana: Jito bundle [pump.fun create + first buy]
                                                                         [launch fee + locked fee split + memo + tip]
                                                                                               │
                  POST /api/drafts/<id>/confirm  ◀── verified on-chain before it enters the registry
```

- **Nothing is spent before the user signs.** The connector only prepares and validates: name and ticker limits, ticker uniqueness in the registry, fee wallet format per chain, and that the logo link is a reachable public https image (SSRF-guarded).
- **The registry is chain-truthful.** Launches are recorded only after the transaction is verified on-chain, and launches made straight against the contracts (outside the site) are backfilled and numbered too. Registry numbers are gapless.
- **Resumable.** Reopening a checkout after signing picks the launch back up.

### Provenance: which coins were born from a prompt

Every launch the platform prepares is attested, so "launched from a prompt in Claude" is provable from chain data alone. It does not depend on our database.

- **Robinhood Chain.** The site signs an EIP-712 `Launch` message (exact name, ticker, logo, description, fee wallet, the sending wallet, channel, a one-time reference and a deadline) with the attester key. `PadFactory` verifies it and emits `LaunchOrigin(token, channel, ref)`, with channel `1` for the site and `2` for a prompt. Forged, replayed, expired or altered attestations revert. A direct contract call without one is recorded as channel `0`.
- **Solana.** The launch bundle carries a Memo `<tag>:v1:<site|prompt>:<draftId>:<mint>` whose required signer is the attester, in the transaction that writes that coin's fee split, so it cannot be moved onto another coin. The attester's own transaction history is therefore a complete, database-free index of every Solana launch.
- **Aggregating.** `GET /api/launches?origin=prompt` is the feed, and the registry page has a "born from a prompt" filter. `/.well-known/launch-provenance.json` publishes the attester keys, contract and config addresses, and the recipe any indexer can follow without our API: filter `LaunchOrigin` logs by `channel == 2`, or read the Solana attester's transaction history for the signed memos. The MCP client that prepared a launch (for example Claude) is also recorded from its User-Agent and shown as "born in claude".

### Robinhood Chain contracts ([`contracts/`](contracts))

- `PadToken`: fixed 1B supply ERC20, no owner, no mint, no tax. Name, symbol, image and description are set at birth.
- `PadFactory`: constant-product curve over virtual reserves. 800M tokens sell on the curve, and the curve sells out at exactly `targetRaise`. The graduating buy is capped and the excess refunded. In the same transaction it creates or repairs the WETH/token 1% Uniswap v3 pool at the curve's final price, including a price-limited correction swap if someone pre-created the pool at a wrong price. It then mints a full-range position the factory can never withdraw and burns the unused reserve. `collectLpFees` splits pool fees afterwards. Sellers need no approval.
- Verified against the live Uniswap v3 deployment on chain 4663 (factory `0x1f7d…2EfA`, position manager `0x7399…E0D3`, WETH `0x0Bd7…AD73`).

### Solana (pump.fun)

Coins are created on pump.fun's own bonding curve, so they appear on pump.fun and in every Solana terminal from the first second, and graduate to PumpSwap on pump.fun's terms. Revenue comes from pump.fun's creator-fee sharing: at launch the creator's fee stream is split 70% to the chosen fee wallet and 30% to the platform treasury, and pump.fun locks that split permanently once written.

A launch is two transactions (a single one exceeds Solana's 1232-byte packet limit) sent as one atomic Jito bundle:

1. create the coin + the creator's first buy (so nobody buys before the creator)
2. launch fee + fee-sharing config + locked 70/30 split + attester-signed provenance memo + Jito tip

They land together or not at all. If the block engine is unreachable, the site sends the same signed transactions in order through the RPC, and a coin whose split was not written can be finished from its checkout link (only the second transaction is rebuilt). The mint keypair signs only the first transaction and the attester only the second, both server-side, so neither can be altered. Coin metadata JSON is served at `/m/<draftId>`. There is no on-chain setup: setting `NEXT_PUBLIC_SOLANA_TREASURY` opens the lane.

## Stack

Next.js 16 (App Router) · viem + wagmi v3 (any EIP-6963 wallet) · Solana wallet adapter (any Wallet Standard wallet) · `@pump-fun/pump-sdk` + Jito bundles · `@modelcontextprotocol/sdk` (stateless Streamable HTTP) · Postgres (or embedded PGlite with zero setup) · Foundry.

## Run locally

```bash
git clone --recurse-submodules <repo> && cd promptpad
npm install
cp .env.example .env.local        # fill in what you have; unset chains show as "not open yet"
npm run dev                       # http://localhost:3000, connector at http://localhost:3000/mcp
```

With no `DATABASE_URL`, data lives in an embedded Postgres under `.data/`.

### Full local Robinhood Chain loop (no real funds)

```bash
anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 4663
cd contracts && PAD_OWNER=<addr> PAD_TREASURY=<addr> \
  forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --private-key <anvil key> --broadcast
# .env.local: NEXT_PUBLIC_ROBINHOOD_RPC_URL=http://127.0.0.1:8545  NEXT_PUBLIC_PAD_FACTORY=<printed address>
```

## Tests

```bash
npm test                                                   # unit + integration (PGlite, validation, SSRF guard)
cd contracts && ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test   # fork tests on real Uniswap v3
PUMP_SIM_PAYER=<funded address> npm test   # builds and simulates the real pump.fun launch bundle on mainnet, sends nothing
npm run typecheck && npm run lint
```

## Deployments

### Robinhood Chain mainnet (chain 4663)

Deployed 2026-09-30 from [`contracts/script/Deploy.s.sol`](contracts/script/Deploy.s.sol). Every value below was read back from the contract after the deploy; the site's [guide](https://promptpad.fun/guide#contracts) shows the same addresses live from the chain.

| | |
|---|---|
| PadFactory | [`0xDD47D5e5De93E968Df0BdF02e426f82d4EA0D4f6`](https://robinhoodchain.blockscout.com/address/0xDD47D5e5De93E968Df0BdF02e426f82d4EA0D4f6) |
| Deploy transaction | [`0x15da0fdb…29df8`](https://robinhoodchain.blockscout.com/tx/0x15da0fdb1d459a06a1f57386ce00eb8ae585db6f60fa3c4e7b34106ac8a29df8), block 76349359, 0.000575 ETH gas |
| Owner | [`0xc0dE5dBCB4316477AA66E3723Fb6E8EDfe4FB0B0`](https://robinhoodchain.blockscout.com/address/0xc0dE5dBCB4316477AA66E3723Fb6E8EDfe4FB0B0) (also the deployer) |
| Treasury | [`0xc0dEc2b113E235856eC26AFe33B34Fd07F90D997`](https://robinhoodchain.blockscout.com/address/0xc0dEc2b113E235856eC26AFe33B34Fd07F90D997) |
| Launch attester | `0x98e8601aC8799df6bd1029eaD21594850fA9b650` (key held as the `ATTESTER_PRIVATE_KEY` Worker secret) |
| Launch fee | 0.0005 ETH |
| Trade fee | 1%, of which 70% goes to the creator's fee wallet and 30% to the treasury |
| Graduation | at 4.2 ETH raised, no graduation fee, into a 1% Uniswap v3 WETH pool held by the factory forever |
| Anti-snipe | 99% buy tax falling to 0 over the first 5 seconds; only the creator's atomic launch buy is exempt |
| Uniswap v3 | factory `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`, position manager `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3`, WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |

The site at promptpad.fun is built with `NEXT_PUBLIC_PAD_FACTORY` set to this address.

### Solana

Closed until `NEXT_PUBLIC_SOLANA_TREASURY` is set and the site is rebuilt. No on-chain deploy is needed; the Solana attester (`ATTESTER_SOLANA_SECRET`) is already a Worker secret.

## Deploying your own

These steps spend real funds and are run by the owner.

1. **Robinhood Chain factory.** Deploy it (4.9M gas, which cost 0.000575 ETH on mainnet):
   ```bash
   cd contracts
   PAD_OWNER=<owner multisig> PAD_TREASURY=<treasury> \
     forge script script/Deploy.s.sol --rpc-url https://rpc.mainnet.chain.robinhood.com --account <keystore> --broadcast
   ```
   Add `PAD_ATTESTER=<address of ATTESTER_PRIVATE_KEY>` so prompt launches are attested from the first one. Run it once without `--broadcast` first: forge simulates against mainnet and prints the contract address and the gas it will need. Set `NEXT_PUBLIC_PAD_FACTORY` to the printed address. To override defaults, set `PAD_LAUNCH_FEE_WEI`, `PAD_TRADE_FEE_BPS`, `PAD_CREATOR_SHARE_BPS`, `PAD_GRADUATION_FEE_BPS` and `PAD_TARGET_RAISE_WEI`.
2. **Solana.** No on-chain setup. Set `NEXT_PUBLIC_SOLANA_TREASURY` to the wallet that should receive the launch fee and the platform's 30% of creator fees (and optionally `NEXT_PUBLIC_SOLANA_LAUNCH_FEE_SOL`, default 0.01).
3. **Attester keys.** Generate one EVM key and one Solana key. Keep them as secrets (`ATTESTER_PRIVATE_KEY`, `ATTESTER_SOLANA_SECRET`), and pass the EVM address as `PAD_ATTESTER` when deploying the factory (or call `setAttester` later).
4. **Hosting on Cloudflare Workers** (via OpenNext; the bundle is about 5.4 MB gzipped, so it needs the Workers Paid plan):
   ```bash
   # Data lives in D1 (wrangler.jsonc binds it; apply migrations/d1 once):
   npx wrangler d1 migrations apply promptpad --remote
   npx wrangler secret put ATTESTER_PRIVATE_KEY
   npx wrangler secret put ATTESTER_SOLANA_SECRET
   NEXT_PUBLIC_SITE_URL=https://<domain> NEXT_PUBLIC_PAD_FACTORY=... NEXT_PUBLIC_SOLANA_TREASURY=... \
     NEXT_PUBLIC_SOLANA_RPC_URL=... npm run cf:deploy
   ```
   Move `.env.local` aside for the build if it holds local values (an anvil RPC, a local factory): Next.js loads it into the production bundle otherwise. `NEXT_PUBLIC_*` values are baked in at build time; `NEXT_PUBLIC_SITE_URL` also goes into Solana metadata URIs and the connector URL. `npm run cf:preview` runs the production build locally in workerd. Any Node host works as well (`npm run build && npm start`); without `DATABASE_URL` it falls back to embedded PGlite. Use dedicated RPC URLs: the public endpoints rate-limit hard.

## Collecting revenue

- **Robinhood Chain.** Launch fees, the platform share of trade fees, graduation fees and leftovers accrue in the factory. Anyone can send them to the treasury (the call pays out to the treasury, never to the caller):
  ```bash
  cast send 0xDD47D5e5De93E968Df0BdF02e426f82d4EA0D4f6 "withdrawProtocolFees()" \
    --rpc-url https://rpc.mainnet.chain.robinhood.com --account <keystore>
  ```
  What is waiting: `cast call 0xDD47D5e5De93E968Df0BdF02e426f82d4EA0D4f6 "protocolFeesOwed()(uint256)" --rpc-url https://rpc.mainnet.chain.robinhood.com`.
  Pool fees on graduated tokens: `collectLpFees(token)`, also callable from each token page. The treasury share goes straight to the treasury.
- **Solana.** The launch fee arrives in the treasury inside each launch bundle. Creator fees are paid out by a permissionless payout that sends 70% to the fee wallet and 30% to the treasury; token pages have a button for it, and this pays out every launch at once:
  ```bash
  SITE=https://<domain> SOLANA_KEYPAIR=<any funded keypair> node scripts/solana-payout-all.ts [--send]
  ```

## Operating the Robinhood Chain factory

Owner-only calls, all bounded by the caps in the contract (launch fee at most 0.05 ETH, trade fee at most 2%, graduation fee at most 10%). Changes apply to tokens launched afterwards; every existing token keeps the terms it launched with.

```bash
F=0xDD47D5e5De93E968Df0BdF02e426f82d4EA0D4f6
RPC=https://rpc.mainnet.chain.robinhood.com

# Change fees or the treasury, or pause new launches (last argument true). Arguments:
# treasury, launch fee (wei), trade fee (bps), creator share (bps), graduation fee (bps), paused
cast send $F "setConfig(address,uint256,uint16,uint16,uint16,bool)" \
  0xc0dEc2b113E235856eC26AFe33B34Fd07F90D997 500000000000000 100 7000 0 false --rpc-url $RPC --account <owner>

# Rotate the launch attester (then update the ATTESTER_PRIVATE_KEY Worker secret to match)
cast send $F "setAttester(address)" <new attester> --rpc-url $RPC --account <owner>

# Hand ownership to a new wallet. Two steps (Ownable2Step), so a typo cannot lose the contract:
cast send $F "transferOwnership(address)" <new owner> --rpc-url $RPC --account <owner>
cast send $F "acceptOwnership()" --rpc-url $RPC --account <new owner>
```

## Claude connector and npm package

In Claude: settings, connectors, add custom connector, then paste `https://promptpad.fun/mcp`. Clients that start servers with `npx` (Claude Desktop, Cursor, Cline) use the stdio bridge in [`packages/mcp`](packages/mcp): `npx -y promptpad-mcp`. [`server.json`](server.json) is the MCP registry entry. The tools:

| tool | what it does |
|---|---|
| `launch_token` | validates a launch, returns a preview and a 24h checkout link; spends nothing |
| `launch_status` | whether a prepared launch was signed; token address and links once it was |
| `token_info` | live price, market cap, curve progress, claimable creator fees |
| `recent_launches` | the registry, filterable by chain or search |
| `fee_schedule` | fee terms per chain, read from the chain |

## Layout

| path | what |
|---|---|
| `contracts/` | Foundry project: `PadToken`, `PadFactory`, fork tests, deploy script |
| `src/app/` | pages (`/`, `/launch`, `/launch/[id]`, `/t/[chain]/[address]`, `/registry`, `/guide`), API routes, `/mcp` |
| `src/lib/evm/`, `src/lib/solana/` | chain reads, transaction builders, the Solana economics |
| `src/lib/launches.ts` | drafts, on-chain verification, registry and chain backfill |
| `scripts/` | ABI generation, Solana config creation, Solana fee collection |
| `packages/mcp/` | `promptpad-mcp`, the stdio bridge published to npm |
| `src/lib/origin.ts` | launch provenance: EIP-712 attestations and the Solana memo |
| `wrangler.jsonc`, `open-next.config.ts` | Cloudflare Workers deployment |
| `tests/` | vitest suites |
