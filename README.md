# promptpad

Launch a token from a prompt. Tell Claude (through a remote MCP connector) or fill in a short form, and the token goes live on **Robinhood Chain** or **Solana** on a bonding curve that graduates into locked liquidity. The launcher signs from their own wallet; the fee wallet they name earns the creator share of every trade forever.

Unlike a free, sponsored launcher, every step here carries revenue:

| | Robinhood Chain (own contracts) | Solana (Meteora DBC partner config) |
|---|---|---|
| Launch fee | 0.002 ETH, flat | 0.04 SOL, flat (Meteora keeps 10%) |
| Trade fee on the curve | 1%, split 50/50 creator / platform | 1% steady state, opening at 50% and decaying over 60s (anti-snipe); partner share split 50/50 creator / platform after Meteora's 20% cut |
| Graduation | at 4.2 ETH raised, into a Uniswap v3 1% pool, full range | at 85 SOL raised, into Meteora DAMM v2 |
| Graduation fee | 3% of the raise | 3% of the migrated quote |
| After graduation | LP position is held by the factory forever; pool fees split creator / platform | LP permanently locked, 50% creator / 50% platform, each claims its own pool fees |

All Robinhood Chain values are constructor/owner settings with hard caps in the contract (trade fee at most 2%, launch fee at most 0.05 ETH, graduation fee at most 10%) and are snapshotted per token at launch. All Solana values live in [`src/lib/solana/curve-config.ts`](src/lib/solana/curve-config.ts), which is exactly what the config script writes on-chain.

## How it works

```
Claude ──MCP──▶ /mcp  launch_token ─┐
                                     ├─▶ draft (validated, 24h) ─▶ /launch/<id> checkout ─▶ wallet signs
Site form ───▶ POST /api/drafts ─────┘                                                        │
                                                                                               ▼
                    Robinhood Chain: PadFactory.createToken      Solana: DBC createPool + first buy
                                                                         + transfer creator to fee wallet
                                                                                               │
                  POST /api/drafts/<id>/confirm  ◀── verified on-chain before it enters the registry
```

- **Nothing is spent before the user signs.** The connector only prepares and validates: name and ticker limits, ticker uniqueness in the registry, fee wallet format per chain, and that the logo link is a reachable public https image (SSRF-guarded).
- **The registry is chain-truthful.** Launches are recorded only after the transaction is verified on-chain, and launches made straight against the contracts (outside the site) are backfilled and numbered too. Registry numbers are gapless.
- **Resumable.** Reopening a checkout after signing picks the launch back up.

### Robinhood Chain contracts ([`contracts/`](contracts))

- `PadToken`: fixed 1B supply ERC20, no owner, no mint, no tax. Name, symbol, image and description are set at birth.
- `PadFactory`: constant-product curve over virtual reserves. 800M tokens sell on the curve, and the curve sells out at exactly `targetRaise`. The graduating buy is capped and the excess refunded. In the same transaction it creates or repairs the WETH/token 1% Uniswap v3 pool at the curve's final price, including a price-limited correction swap if someone pre-created the pool at a wrong price. It then mints a full-range position the factory can never withdraw and burns the unused reserve. `collectLpFees` splits pool fees afterwards. Sellers need no approval.
- Verified against the live Uniswap v3 deployment on chain 4663 (factory `0x1f7d…2EfA`, position manager `0x7399…E0D3`, WETH `0x0Bd7…AD73`).

### Solana

A Meteora Dynamic Bonding Curve **partner config** holds all economics. Every launch creates a pool under it with the launcher as payer. An optional first buy is bundled at the minimum fee, and creator rights move to the chosen fee wallet in the same transaction. Token metadata JSON is served by `/api/metadata/<draftId>`.

## Stack

Next.js 16 (App Router) · viem + wagmi v3 (any EIP-6963 wallet) · Solana wallet adapter (any Wallet Standard wallet) · `@meteora-ag/dynamic-bonding-curve-sdk` · `@modelcontextprotocol/sdk` (stateless Streamable HTTP) · Postgres (or embedded PGlite with zero setup) · Foundry.

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
SOLANA_SIM_CONFIG=<any SOL-quoted DBC config> SOLANA_SIM_PAYER=<funded address> npm test   # simulates a real launch tx on mainnet, sends nothing
npm run typecheck && npm run lint
```

## Going live

These steps spend real funds and are run by the owner.

1. **Robinhood Chain factory.** Deploy it (about 4.8M gas):
   ```bash
   cd contracts
   PAD_OWNER=<owner multisig> PAD_TREASURY=<treasury> \
     forge script script/Deploy.s.sol --rpc-url https://rpc.mainnet.chain.robinhood.com --account <keystore> --broadcast
   ```
   Set `NEXT_PUBLIC_PAD_FACTORY` to the printed address. To override defaults, set `PAD_LAUNCH_FEE_WEI`, `PAD_TRADE_FEE_BPS`, `PAD_CREATOR_SHARE_BPS`, `PAD_GRADUATION_FEE_BPS` and `PAD_TARGET_RAISE_WEI`.
2. **Solana partner config.** Dry-run first (simulated against the live program, sends nothing), then create it:
   ```bash
   SOLANA_RPC_URL=<rpc> SOLANA_PARTNER_KEYPAIR=<keypair.json> node scripts/solana-create-config.ts
   SOLANA_RPC_URL=<rpc> SOLANA_PARTNER_KEYPAIR=<keypair.json> node scripts/solana-create-config.ts --send
   ```
   Set `NEXT_PUBLIC_DBC_CONFIG` to the printed address. The keypair becomes the fee claimer (override with `SOLANA_FEE_CLAIMER`).
3. **Hosting.** Any Node host works (`npm run build && npm start`). Set `NEXT_PUBLIC_SITE_URL` (it is baked into Solana metadata URIs and the connector URL), `DATABASE_URL`, and dedicated RPC URLs (`SOLANA_RPC_URL` must allow `getProgramAccounts` for registry backfill; the public endpoints rate-limit hard).

## Collecting revenue

- **Robinhood Chain.** Launch fees, the platform share of trade fees, graduation fees and leftovers accrue in the factory. Anyone can send them to the treasury:
  `cast send <factory> "withdrawProtocolFees()" --rpc-url https://rpc.mainnet.chain.robinhood.com --account <keystore>`.
  Pool fees on graduated tokens: `collectLpFees(token)`, also callable from each token page. The treasury share goes straight to the treasury.
- **Solana.** Report, then claim trading fees, launch fees and migration fees across every pool:
  ```bash
  NEXT_PUBLIC_DBC_CONFIG=<config> SOLANA_PARTNER_KEYPAIR=<fee claimer> node scripts/solana-claim-partner-fees.ts [--send]
  ```

## Claude connector

In Claude: settings, connectors, add custom connector, then paste `https://<your-domain>/mcp`. The tools:

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
| `tests/` | vitest suites |
