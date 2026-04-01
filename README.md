# mcp-servers

A suite of four MCP (Model Context Protocol) servers that expose real operational data as AI-callable tools — built for personal use and as portfolio demonstrations of platform tooling patterns.

Each server runs locally and connects to Claude Desktop via the MCP standard, enabling natural language queries against live data sources.

## Servers

| Server | Data Source | What it does |
|---|---|---|
| `planning-center` | Planning Center API | Church service roster management — upcoming plans, team assignments, unassigned slots |
| `portfolio` | Yahoo Finance | ETF portfolio tracking and house deposit goal projection |
| `github-ops` | GitHub REST API | CI/CD operations across portfolio repos — workflow runs, deployments, repo health |
| `aws-ops` | AWS SDK v3 | EC2 status, CloudWatch metrics, S3 buckets, and log querying across portfolio infrastructure |

## Architecture
```
Claude Desktop
     │
     │  MCP Protocol (stdio)
     ├──────────────────────▶ planning-center server ──▶ Planning Center API
     ├──────────────────────▶ portfolio server        ──▶ Yahoo Finance API
     ├──────────────────────▶ github-ops server       ──▶ GitHub REST API
     └──────────────────────▶ aws-ops server          ──▶ AWS (EC2, CloudWatch, S3)
```

## Stack

- TypeScript + MCP SDK (`@modelcontextprotocol/sdk`)
- Node.js (stdio transport)
- AWS SDK v3 (`@aws-sdk/client-ec2`, `@aws-sdk/client-cloudwatch`, `@aws-sdk/client-s3`, `@aws-sdk/client-cloudwatch-logs`)
- Each server is independently runnable and independently configured

## Key Decisions

**Personal Access Tokens / dedicated IAM user over root or OAuth** — all servers access only my own data. OAuth adds unnecessary complexity for single-user tooling. AWS operations run under a dedicated `mcp-ops-user` IAM user with read-only policies — not root credentials.

**stdio transport over HTTP** — Claude Desktop communicates with MCP servers over stdin/stdout. No port management, no network exposure, no auth layer needed between the model and the server. Right tool for local tooling.

**Separate servers over a monolith** — each server has a single responsibility and a single credential scope. A bug in one server can't affect the others. Each can be updated, restarted, or replaced independently.

**No database** — all data is fetched live from upstream APIs. No sync jobs, no stale state, no storage layer to maintain for tools at this scale.

## Setup

Each server has its own setup instructions. See the individual READMEs:
- [planning-center/README.md](./planning-center/README.md)
- [portfolio/README.md](./portfolio/README.md)
- [github-ops/README.md](./github-ops/README.md)
- [aws-ops/README.md](./aws-ops/README.md)