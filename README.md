## Stack

- TypeScript + MCP SDK (`@modelcontextprotocol/sdk`)
- Node.js (stdio transport)
- Each server is independently runnable and independently configured

## Key Decisions

**Personal Access Tokens over OAuth** — all three servers access only my own data. OAuth adds complexity (callback URLs, token refresh) with no benefit for single-user personal tooling.

**stdio transport over HTTP** — Claude Desktop communicates with MCP servers over stdin/stdout. No port management, no network exposure, no auth layer needed between the model and the server. Right tool for local tooling.

**Separate servers over a monolith** — each server has a single responsibility and a single credential scope. A bug in the portfolio server can't affect the Planning Center server. Each can be updated, restarted, or replaced independently.

**No database** — all data is fetched live from upstream APIs. No sync jobs, no stale state, no storage layer to maintain for tools at this scale.

## Setup

Each server has its own setup instructions. See the individual READMEs:
- [planning-center/README.md](./planning-center/README.md)
- [portfolio/README.md](./portfolio/README.md)
- [github-ops/README.md](./github-ops/README.md)