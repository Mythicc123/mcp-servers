# portfolio MCP Server

An MCP server that exposes live ETF portfolio data and deposit goal projections as AI-callable tools — built around a personal allocation across IVV, NDQ, STW, and ASIA.

## Why it exists

Tracking a multi-ETF portfolio across different weightings and projecting a house deposit timeline requires pulling prices, doing allocation math, and running compound growth models. This server makes that a single question to Claude instead of a spreadsheet exercise.

## Tools

| Tool | Description |
|---|---|
| `get_portfolio_snapshot` | Current prices for all ETFs weighted by allocation, against a given total portfolio value |
| `get_etf_performance` | Historical price data and return percentage for a single ETF over a chosen period |
| `project_deposit_goal` | Compound growth projection to a target deposit amount given current value, monthly contribution, and growth rate |

## Architecture
```
Claude Desktop
     │ MCP (stdio)
     ▼
portfolio server (Node.js)
     │ HTTPS (no auth — public data)
     ▼
Yahoo Finance API (unofficial)
query1.finance.yahoo.com/v8/finance/chart/{ticker}
```

## Portfolio Config

Allocation weightings are hardcoded in `src/index.ts` and reflect the actual portfolio:
```
IVV.AX  50%
NDQ.AX  20%
STW.AX  20%
ASIA.AX 10%
```

Update `DEPOSIT_TARGET` and `MONTHLY_CONTRIBUTION` constants to match your actual figures before building.

## Setup

**1. Install and build**
```bash
cd portfolio
npm install
npm run build
```

**2. Configure Claude Desktop**

Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "portfolio": {
      "command": "node",
      "args": ["/absolute/path/to/portfolio/build/index.js"]
    }
  }
}
```

No credentials needed — Yahoo Finance's chart API is public.

Restart Claude Desktop. The tools will appear in the hammer icon menu.

## Key Decisions

**Yahoo Finance over a paid data provider** — for personal portfolio tracking at this frequency, the unofficial Yahoo Finance API is sufficient. No API key, no rate limit concerns at personal usage scale. The tradeoff is instability — Yahoo has broken this endpoint before without notice.

**Hardcoded allocations over dynamic input** — allocation weightings are stable enough to live in config. Requiring them as tool inputs every call adds friction with no real benefit for a single-user tool.

**Compound growth model over Monte Carlo** — the projection tool uses a fixed annual growth rate, not a distribution. This is intentional: the goal is a rough milestone estimate, not a financial forecast. The output includes a disclaimer to that effect.

## Known Limitations

- Yahoo Finance's unofficial API has no SLA and has broken historically. If prices stop returning, check the endpoint URL first.
- Projections do not account for tax (CGT), brokerage fees, or variable returns. Use as a directional guide only.
- AUD/USD FX is not factored into US-denominated ETF valuations — prices are returned in AUD as quoted on the ASX.

## What's next

- `get_market_summary` — ASX and US index snapshot alongside portfolio performance
- FX-aware valuation for international ETF holdings