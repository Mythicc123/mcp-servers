#!/usr/bin/env node
import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ── PCO Client ────────────────────────────────────────────────────────────────

const PCO_BASE = "https://api.planningcenteronline.com";

const PCO_HEADERS = {
  Authorization: `Basic ${Buffer.from(
    `${process.env.PCO_APP_ID}:${process.env.PCO_SECRET}`
  ).toString("base64")}`,
  "Content-Type": "application/json",
};

async function pcoGet(path: string) {
  const res = await fetch(`${PCO_BASE}${path}`, { headers: PCO_HEADERS });
  if (!res.ok) throw new Error(`PCO API error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<any>;
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "planning-center", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ── Tool Definitions ──────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_service_types",
        description: "List all service types in Planning Center (e.g. Sunday Morning, Youth)",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_upcoming_roster",
        description: "Get upcoming service plans and their rostered team members",
        inputSchema: {
          type: "object",
          properties: {
            service_type_id: {
              type: "string",
              description: "The ID of the service type to query. Get this from get_service_types first.",
            },
            weeks: {
              type: "number",
              description: "How many weeks ahead to look (default: 4)",
            },
          },
          required: ["service_type_id"],
        },
      },
      {
        name: "get_unassigned_slots",
        description: "Find team positions that have no one rostered for upcoming services",
        inputSchema: {
          type: "object",
          properties: {
            service_type_id: {
              type: "string",
              description: "The ID of the service type to query.",
            },
            weeks: {
              type: "number",
              description: "How many weeks ahead to check (default: 4)",
            },
          },
          required: ["service_type_id"],
        },
      },
    ],
  };
});

// ── Tool Handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    // ── get_service_types ──────────────────────────────────────────────────
    case "get_service_types": {
      const data = await pcoGet("/services/v2/service_types");
      const types = data.data.map((t: any) => ({
        id: t.id,
        name: t.attributes.name,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(types, null, 2) }],
      };
    }

    // ── get_upcoming_roster ────────────────────────────────────────────────
    case "get_upcoming_roster": {
      const serviceTypeId = args?.service_type_id as string;
      const weeks = (args?.weeks as number) ?? 4;

      const after = new Date().toISOString();
      const before = new Date(
        Date.now() + weeks * 7 * 24 * 60 * 60 * 1000
      ).toISOString();

      const plansData = await pcoGet(
        `/services/v2/service_types/${serviceTypeId}/plans?filter=future&per_page=10`
      );

      const plans = plansData.data.slice(0, weeks);

      const results = await Promise.all(
        plans.map(async (plan: any) => {
          const teamData = await pcoGet(
            `/services/v2/service_types/${serviceTypeId}/plans/${plan.id}/team_members`
          );
          const members = teamData.data.map((m: any) => ({
            name: m.attributes.name,
            team_position: m.attributes.team_position_name,
            status: m.attributes.status,
          }));
          return {
            plan_id: plan.id,
            date: plan.attributes.sort_date,
            title: plan.attributes.title ?? "(untitled)",
            members,
          };
        })
      );

      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }

    // ── get_unassigned_slots ───────────────────────────────────────────────
    case "get_unassigned_slots": {
      const serviceTypeId = args?.service_type_id as string;
      const weeks = (args?.weeks as number) ?? 4;

      const plansData = await pcoGet(
        `/services/v2/service_types/${serviceTypeId}/plans?filter=future&per_page=10`
      );

      const plans = plansData.data.slice(0, weeks);

      const results = await Promise.all(
        plans.map(async (plan: any) => {
          const teamData = await pcoGet(
            `/services/v2/service_types/${serviceTypeId}/plans/${plan.id}/team_members`
          );
          const unassigned = teamData.data
            .filter((m: any) => m.attributes.status === "U")
            .map((m: any) => ({
              team_position: m.attributes.team_position_name,
              status: m.attributes.status,
            }));
          return {
            date: plan.attributes.sort_date,
            title: plan.attributes.title ?? "(untitled)",
            unassigned_slots: unassigned,
          };
        })
      );

      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
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