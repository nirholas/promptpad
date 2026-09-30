# contracts

Foundry project for the Robinhood Chain side of promptpad.

- `src/PadToken.sol`: fixed-supply ERC20 minted once to the factory. No owner, mint, tax or blacklist.
- `src/PadFactory.sol`: bonding curve, fees, and graduation into a factory-held, full-range Uniswap v3 position.
- `test/PadFactory.t.sol`: fork tests against the live Uniswap v3 deployment on Robinhood Chain (4663).
- `script/Deploy.s.sol`: deploys to 4663 (mainnet) or 46630 (testnet) with the matching Uniswap addresses.

```bash
forge build
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test
PAD_OWNER=<owner> PAD_TREASURY=<treasury> forge script script/Deploy.s.sol --rpc-url <rpc> --account <keystore> --broadcast
```

After changing a contract, regenerate the app's ABI from the repo root: `(cd contracts && forge build) && npm run abi`.
