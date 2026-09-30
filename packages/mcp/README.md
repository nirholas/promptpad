# promptpad-mcp

Launch a token on **Robinhood Chain** or **Solana** from any MCP client. Describe the token in chat; the server validates it and returns a checkout link where you connect your own wallet, see the exact fee, and sign. Nothing is deployed and nothing is spent before you sign.

This package is a small stdio bridge to the hosted MCP server, for clients that start servers with `npx`. Clients that support remote connectors (Claude on the web and desktop) can add the `/mcp` URL directly instead.

## Use it

Claude Desktop, Cursor, Cline, Windsurf and others:

```json
{
  "mcpServers": {
    "promptpad": {
      "command": "npx",
      "args": ["-y", "promptpad-mcp"]
    }
  }
}
```

Point it at another deployment with `"env": { "PROMPTPAD_URL": "https://<host>/mcp" }`.

## Tools

| tool | what it does |
|---|---|
| `launch_token` | validates name, ticker, logo and fee wallet, and returns a preview plus a 24h checkout link |
| `launch_status` | whether a prepared launch was signed, with its token address and links |
| `token_info` | live price, market cap, curve progress and claimable creator fees |
| `recent_launches` | the registry, filterable by chain or search |
| `fee_schedule` | launch, trade and graduation fees per chain, read from the chain |

The tool list is fetched from the server at startup, so the bridge always matches the live server.

## Provenance

Every launch prepared through MCP is attested on-chain as a prompt launch: an EIP-712 signature the Robinhood Chain factory verifies, or an attester-signed memo in the Solana pool-creation transaction. Anyone can list prompt-born tokens from chain data alone; see `/.well-known/launch-provenance.json` on the server.
