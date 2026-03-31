#!/usr/bin/env node

import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ── GitHub Client ─────────────────────────────────────────────────────────────

const GH_BASE = "https://api.github.com";
const GH_OWNER = "Mythicc123";

const GH_HEADERS = {
  Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function ghGet(path: string) {
  const res = await fetch(`${GH_BASE}${path}`, { headers: GH_HEADERS });
  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<any>;
}

async function ghPost(path: string, body: any) {
  const res = await fetch(`${GH_BASE}${path}`, {
    method: "POST",
    headers: { ...GH_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "github-ops", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ── Tool Definitions ──────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_repo_health",
        description: "Get a health summary across all portfolio repos — last commit, open issues, open PRs",
        inputSchema: {
          type: "object",
          properties: {
            repos: {
              type: "array",
              items: { type: "string" },
              description: "List of repo names to check e.g. ['gh-deployment-workflow', 'ec2-static-site']",
            },
          },
          required: ["repos"],
        },
      },
      {
        name: "get_workflow_runs",
        description: "Get recent CI/CD workflow runs for a repository",
        inputSchema: {
          type: "object",
          properties: {
            repo: {
              type: "string",
              description: "Repository name e.g. gh-deployment-workflow",
            },
            status: {
              type: "string",
              description: "Filter by status: completed, in_progress, queued, failure, success",
              enum: ["completed", "in_progress", "queued", "failure", "success"],
            },
            limit: {
              type: "number",
              description: "Number of runs to return (default: 5)",
            },
          },
          required: ["repo"],
        },
      },
      {
        name: "trigger_workflow",
        description: "Manually trigger a GitHub Actions workflow",
        inputSchema: {
          type: "object",
          properties: {
            repo: {
              type: "string",
              description: "Repository name",
            },
            workflow_id: {
              type: "string",
              description: "Workflow filename e.g. deploy.yml",
            },
            ref: {
              type: "string",
              description: "Branch to run on (default: main)",
            },
          },
          required: ["repo", "workflow_id"],
        },
      },
      {
        name: "get_deployment_history",
        description: "Get recent deployments for a repository and environment",
        inputSchema: {
          type: "object",
          properties: {
            repo: {
              type: "string",
              description: "Repository name",
            },
            environment: {
              type: "string",
              description: "Environment name e.g. production, staging",
            },
          },
          required: ["repo"],
        },
      },
    ],
  };
});

// ── Tool Handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    // ── get_repo_health ────────────────────────────────────────────────────
    case "get_repo_health": {
      const repos = args?.repos as string[];

      const results = await Promise.all(
        repos.map(async (repo) => {
          const [repoData, issues, prs] = await Promise.all([
            ghGet(`/repos/${GH_OWNER}/${repo}`),
            ghGet(`/repos/${GH_OWNER}/${repo}/issues?state=open&per_page=5`),
            ghGet(`/repos/${GH_OWNER}/${repo}/pulls?state=open&per_page=5`),
          ]);
          return {
            repo,
            default_branch: repoData.default_branch,
            last_pushed: repoData.pushed_at,
            open_issues: repoData.open_issues_count,
            open_prs: prs.length,
            visibility: repoData.visibility,
            recent_issues: issues.map((i: any) => ({
              title: i.title,
              created_at: i.created_at,
            })),
          };
        })
      );

      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }

    // ── get_workflow_runs ──────────────────────────────────────────────────
    case "get_workflow_runs": {
      const repo = args?.repo as string;
      const status = args?.status as string | undefined;
      const limit = (args?.limit as number) ?? 5;

      const query = status ? `?status=${status}&per_page=${limit}` : `?per_page=${limit}`;
      const data = await ghGet(`/repos/${GH_OWNER}/${repo}/actions/runs${query}`);

      const runs = data.workflow_runs.map((r: any) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        conclusion: r.conclusion,
        branch: r.head_branch,
        triggered_by: r.triggering_actor?.login,
        started_at: r.run_started_at,
        updated_at: r.updated_at,
        url: r.html_url,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(runs, null, 2) }],
      };
    }

    // ── trigger_workflow ───────────────────────────────────────────────────
    case "trigger_workflow": {
      const repo = args?.repo as string;
      const workflowId = args?.workflow_id as string;
      const ref = (args?.ref as string) ?? "main";

      await ghPost(
        `/repos/${GH_OWNER}/${repo}/actions/workflows/${workflowId}/dispatches`,
        { ref }
      );

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "triggered",
            repo,
            workflow: workflowId,
            ref,
            message: `Workflow ${workflowId} dispatched on ${ref}`,
          }, null, 2),
        }],
      };
    }

    // ── get_deployment_history ─────────────────────────────────────────────
    case "get_deployment_history": {
      const repo = args?.repo as string;
      const environment = args?.environment as string | undefined;

      const query = environment ? `?environment=${environment}&per_page=10` : `?per_page=10`;
      const deployments = await ghGet(`/repos/${GH_OWNER}/${repo}/deployments${query}`);

      const results = await Promise.all(
        deployments.slice(0, 5).map(async (d: any) => {
          const statuses = await ghGet(`/repos/${GH_OWNER}/${repo}/deployments/${d.id}/statuses`);
          return {
            id: d.id,
            environment: d.environment,
            ref: d.ref,
            created_at: d.created_at,
            latest_status: statuses[0]?.state ?? "unknown",
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