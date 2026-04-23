#!/usr/bin/env node
import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

// ── Utilities ──────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadNicknames(): Record<string, string> {
  const path = resolve(__dirname, "..", "nicknames.json");
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.warn(`[planning-center] Could not load nicknames.json at ${path}:`, err);
    return {};
  }
}

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

async function pcoPost(path: string, body: any) {
  const res = await fetch(`${PCO_BASE}${path}`, {
    method: "POST",
    headers: PCO_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PCO POST ${path} ${res.status}: ${await res.text()}`);
  return res.json() as Promise<any>;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function createTeamMember(
  serviceTypeId: string,
  planId: string,
  personId: string,
  teamPositionName: string
) {
  return pcoPost(
    `/services/v2/service_types/${serviceTypeId}/plans/${planId}/team_members`,
    {
      data: {
        type: "PlanPerson",
        attributes: {
          status: "C",
          team_position_name: teamPositionName,
        },
        relationships: {
          person: { data: { type: "Person", id: personId } },
        },
      },
    }
  );
}

async function fetchExistingTeamMembers(serviceTypeId: string, planId: string) {
  const data = await pcoGet(
    `/services/v2/service_types/${serviceTypeId}/plans/${planId}/team_members?per_page=100`
  );
  return data.data.map((tm: any) => ({
    id: tm.id,
    person_id: tm.relationships?.person?.data?.id,
    person_name: tm.attributes.name,
    team_position_name: tm.attributes.team_position_name,
    status: tm.attributes.status,
    plan_date: null as string | null,
  }));
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
      {
        name: "get_nicknames",
        description: "Return the nickname-to-legal-name map (e.g. Meeko → Michael). Use when a person's display name may differ from their Planning Center first name.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_team_positions",
        description: "List all team positions for a service type (e.g. 'Worship Leader 1', 'Backup Vocals', 'Drums'). Use this to map sheet labels to PCO position IDs and names.",
        inputSchema: {
          type: "object",
          properties: {
            service_type_id: {
              type: "string",
              description: "The ID of the service type to query. Get this from get_service_types first.",
            },
          },
          required: ["service_type_id"],
        },
      },
      {
        name: "get_team_position_members",
        description: "List people assigned to a specific team position (the candidate pool for first-name matching when importing a roster).",
        inputSchema: {
          type: "object",
          properties: {
            service_type_id: {
              type: "string",
              description: "The ID of the service type the position belongs to.",
            },
            team_position_id: {
              type: "string",
              description: "The ID of a team position. Get this from get_team_positions.",
            },
          },
          required: ["service_type_id", "team_position_id"],
        },
      },
      {
        name: "assign_team_members",
        description: "Create team member assignments on service plans. Defaults to dry_run=true to preview changes without writing. Skips exact duplicates (same person already on that position in that plan). All assignments are created with status 'C' (confirmed); invitations are sent manually in PCO. Caller may add multiple people to the same position on the same plan (e.g. 3 people on 'Backup Vocals'); capacity is not enforced.",
        inputSchema: {
          type: "object",
          properties: {
            service_type_id: {
              type: "string",
              description: "The ID of the service type these plans belong to.",
            },
            assignments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  plan_id: { type: "string" },
                  team_position_name: {
                    type: "string",
                    description: "The exact PCO team position name (e.g. 'Worship Leader 1', 'Backup Vocals').",
                  },
                  person_id: { type: "string" },
                  source_label: {
                    type: "string",
                    description: "Human-readable label identifying this assignment in reports (e.g. 'May 10 / B-up 2 / Meeko').",
                  },
                },
                required: ["plan_id", "team_position_name", "person_id", "source_label"],
              },
            },
            dry_run: {
              type: "boolean",
              description: "If true (default), returns a preview without writing. Set to false to actually create assignments.",
            },
          },
          required: ["service_type_id", "assignments"],
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

    // ── get_nicknames ──────────────────────────────────────────────────────
    case "get_nicknames": {
      const nicknames = loadNicknames();
      return {
        content: [{ type: "text", text: JSON.stringify(nicknames, null, 2) }],
      };
    }

    // ── get_team_positions ─────────────────────────────────────────────────
    case "get_team_positions": {
      const serviceTypeId = args?.service_type_id as string;
      const data = await pcoGet(
        `/services/v2/service_types/${serviceTypeId}/team_positions?per_page=100&include=team`
      );

      const teamsById = new Map<string, string>();
      for (const inc of (data.included ?? [])) {
        if (inc.type === "Team") teamsById.set(inc.id, inc.attributes.name);
      }

      const positions = data.data.map((p: any) => {
        const teamId = p.relationships?.team?.data?.id;
        return {
          id: p.id,
          name: p.attributes.name,
          team_id: teamId,
          team_name: teamId ? teamsById.get(teamId) ?? null : null,
        };
      });

      return {
        content: [{ type: "text", text: JSON.stringify(positions, null, 2) }],
      };
    }

    // ── get_team_position_members ──────────────────────────────────────────
    case "get_team_position_members": {
      const serviceTypeId = args?.service_type_id as string;
      const teamPositionId = args?.team_position_id as string;
      const data = await pcoGet(
        `/services/v2/service_types/${serviceTypeId}/team_positions/${teamPositionId}/person_team_position_assignments?include=person&per_page=100`
      );

      const peopleById = new Map<string, any>();
      for (const inc of (data.included ?? [])) {
        if (inc.type === "Person") peopleById.set(inc.id, inc);
      }

      const members = data.data.map((a: any) => {
        const personId = a.relationships?.person?.data?.id;
        const person = personId ? peopleById.get(personId) : null;
        if (!person) return null;
        return {
          person_id: person.id,
          full_name: `${person.attributes.first_name ?? ""} ${person.attributes.last_name ?? ""}`.trim(),
          first_name: person.attributes.first_name ?? "",
        };
      }).filter(Boolean);

      return {
        content: [{ type: "text", text: JSON.stringify(members, null, 2) }],
      };
    }

    // ── assign_team_members ────────────────────────────────────────────────
    case "assign_team_members": {
      const serviceTypeId = args?.service_type_id as string;
      const assignments = (args?.assignments ?? []) as Array<{
        plan_id: string;
        team_position_name: string;
        person_id: string;
        source_label: string;
      }>;
      const dryRun = args?.dry_run !== false; // default true

      // Group by plan_id to minimize PCO reads
      const planIds = Array.from(new Set(assignments.map((a) => a.plan_id)));

      // Build existing-members cache: plan_id → Array<existing>
      const existingByPlan = new Map<string, Awaited<ReturnType<typeof fetchExistingTeamMembers>>>();
      for (const pid of planIds) {
        existingByPlan.set(pid, await fetchExistingTeamMembers(serviceTypeId, pid));
      }

      const created: any[] = [];
      const skipped_existing: any[] = [];
      const errors: any[] = [];

      for (const a of assignments) {
        // Look for an exact duplicate: same person, same position, same plan.
        // Capacity is not enforced — multiple people can hold the same position
        // on the same plan (e.g. 3 people on "Backup Vocals"). So the ONLY skip
        // condition is "this exact person is already assigned to this exact position".
        const duplicate = (existingByPlan.get(a.plan_id) ?? []).find(
          (e: any) =>
            e.team_position_name === a.team_position_name &&
            e.person_id === a.person_id
        );

        if (duplicate) {
          skipped_existing.push({
            source_label: a.source_label,
            existing_person_name: duplicate.person_name,
            reason: "exact duplicate: person already assigned to this position on this plan",
          });
          continue;
        }

        created.push({
          source_label: a.source_label,
          plan_id: a.plan_id,
          team_position_name: a.team_position_name,
          person_id: a.person_id,
        });
      }

      if (dryRun) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  mode: "dry_run",
                  created,
                  skipped_existing,
                  errors,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // Commit path: execute the plan computed above.
      // Only `created` needs writing — there is no `replaced` branch in this simplified model.
      const committed_created: any[] = [];
      const committed_errors: any[] = [];

      // Serialize writes with ~300ms gap between calls to stay well under PCO's rate limit.
      const INTER_CALL_DELAY_MS = 300;

      for (const c of created) {
        try {
          await createTeamMember(
            serviceTypeId,
            c.plan_id,
            c.person_id,
            c.team_position_name
          );
          committed_created.push(c);
        } catch (err: any) {
          const msg = String(err?.message ?? err);
          // Retry once on 429 after a 2s backoff.
          if (msg.includes(" 429")) {
            await sleep(2000);
            try {
              await createTeamMember(
                serviceTypeId,
                c.plan_id,
                c.person_id,
                c.team_position_name
              );
              committed_created.push(c);
            } catch (err2: any) {
              committed_errors.push({
                source_label: c.source_label,
                reason: String(err2?.message ?? err2),
              });
            }
          } else {
            committed_errors.push({
              source_label: c.source_label,
              reason: msg,
            });
          }
        }
        await sleep(INTER_CALL_DELAY_MS);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                mode: "committed",
                created: committed_created,
                skipped_existing,
                errors: committed_errors,
              },
              null,
              2
            ),
          },
        ],
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