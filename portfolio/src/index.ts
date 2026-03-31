#!/usr/bin/env node

import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ── Portfolio Config ───────────────────────────────────────────────────────────
// Your actual allocation weightings — update if you rebalance

const PORTFOLIO = [
  { ticker: "IVV.AX", label: "IVV", weight: 0.50 },
  { ticker: "NDQ.AX", label: "NDQ", weight: 0.20 },
  { ticker: "STW.AX", label: "STW", weight: 0.20 },
  { ticker: "ASIA.AX", label: "ASIA", weight: 0.10 },
];

const DEPOSIT_TARGET = 600000; // Update to your actual target
const MONTHLY_CONTRIBUTION = 500; // Update to your actual monthly contribution

// ── Yahoo Finance Client ──────────────────────────────────────────────────────

async function getPrice(ticker: string): Promise<number> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`Yahoo Finance error ${res.status} for ${ticker}`);
  const data = await res.json() as any;
  const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (!price) throw new Error(`No price found for ${ticker}`);
  return price;
}

async function getHistoricalPrices(ticker: string, period: string): Promise<{ date: string; close: number }[]> {
  const rangeMap: Record<string, string> = {
    "1W": "5d", "1M": "1mo", "3M": "3mo", "1Y": "1y", "3Y": "3y",
  };
  const range = rangeMap[period] ?? "1mo";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${range}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo Finance error ${res.status}`);
  const data = await res.json() as any;
  const result = data?.chart?.result?.[0];
  const timestamps: number[] = result?.timestamp ?? [];
  const closes: number[] = result?.indicators?.quote?.[0]?.close ?? [];
  return timestamps.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().split("T")[0],
    close: Math.round(closes[i] * 100) / 100,
  })).filter(p => p.close);
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "portfolio", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ── Tool Definitions ──────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_portfolio_snapshot",
        description: "Get current prices and estimated portfolio value based on your ETF allocations",
        inputSchema: {
          type: "object",
          properties: {
            total_invested: {
              type: "number",
              description: "Your current total portfolio value in AUD to calculate weighted holdings",
            },
          },
          required: ["total_invested"],
        },
      },
      {
        name: "get_etf_performance",
        description: "Get historical performance of a specific ETF over a given period",
        inputSchema: {
          type: "object",
          properties: {
            ticker: {
              type: "string",
              description: "ETF ticker e.g. IVV, NDQ, STW, ASIA",
              enum: ["IVV", "NDQ", "STW", "ASIA"],
            },
            period: {
              type: "string",
              description: "Time period: 1W, 1M, 3M, 1Y, 3Y",
              enum: ["1W", "1M", "3M", "1Y", "3Y"],
            },
          },
          required: ["ticker", "period"],
        },
      },
      {
        name: "project_deposit_goal",
        description: "Project when your portfolio will reach your house deposit target based on contributions and assumed growth rate",
        inputSchema: {
          type: "object",
          properties: {
            current_value: {
              type: "number",
              description: "Current total portfolio value in AUD",
            },
            monthly_contribution: {
              type: "number",
              description: "Monthly contribution in AUD (default: your configured amount)",
            },
            annual_growth_rate: {
              type: "number",
              description: "Assumed annual growth rate as a decimal e.g. 0.08 for 8% (default: 0.08)",
            },
            target: {
              type: "number",
              description: "Deposit target in AUD (default: your configured target)",
            },
          },
          required: ["current_value"],
        },
      },
    ],
  };
});

// ── Tool Handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    // ── get_portfolio_snapshot ─────────────────────────────────────────────
    case "get_portfolio_snapshot": {
      const totalInvested = args?.total_invested as number;

      const prices = await Promise.all(
        PORTFOLIO.map(async (etf) => {
          const price = await getPrice(etf.ticker);
          const allocation = totalInvested * etf.weight;
          return {
            ticker: etf.label,
            weight: `${etf.weight * 100}%`,
            current_price_aud: price,
            allocated_value_aud: Math.round(allocation),
          };
        })
      );

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total_portfolio_value_aud: totalInvested,
            holdings: prices,
            as_of: new Date().toISOString().split("T")[0],
          }, null, 2),
        }],
      };
    }

    // ── get_etf_performance ────────────────────────────────────────────────
    case "get_etf_performance": {
      const label = args?.ticker as string;
      const period = args?.period as string;
      const etf = PORTFOLIO.find(e => e.label === label);
      if (!etf) throw new Error(`Unknown ETF: ${label}`);

      const history = await getHistoricalPrices(etf.ticker, period);
      const first = history[0]?.close;
      const last = history[history.length - 1]?.close;
      const returnPct = first && last
        ? Math.round(((last - first) / first) * 10000) / 100
        : null;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ticker: label,
            period,
            start_price: first,
            end_price: last,
            return_pct: returnPct,
            data_points: history.length,
            history,
          }, null, 2),
        }],
      };
    }

    // ── project_deposit_goal ───────────────────────────────────────────────
    case "project_deposit_goal": {
      const currentValue = args?.current_value as number;
      const monthlyContribution = (args?.monthly_contribution as number) ?? MONTHLY_CONTRIBUTION;
      const annualGrowthRate = (args?.annual_growth_rate as number) ?? 0.08;
      const target = (args?.target as number) ?? DEPOSIT_TARGET;
      const monthlyRate = annualGrowthRate / 12;

      let value = currentValue;
      let months = 0;
      const maxMonths = 360; // 30 year cap

      while (value < target && months < maxMonths) {
        value = value * (1 + monthlyRate) + monthlyContribution;
        months++;
      }

      const years = Math.floor(months / 12);
      const remainingMonths = months % 12;
      const targetDate = new Date();
      targetDate.setMonth(targetDate.getMonth() + months);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            current_value_aud: currentValue,
            target_aud: target,
            monthly_contribution_aud: monthlyContribution,
            assumed_annual_growth_rate: `${annualGrowthRate * 100}%`,
            projected_months: months,
            projected_years: years,
            projected_remaining_months: remainingMonths,
            projected_target_date: targetDate.toISOString().split("T")[0],
            note: "Does not account for tax, fees, or variable returns. Use as a rough guide only.",
          }, null, 2),
        }],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});