# github-ops MCP Server

An MCP server that wraps GitHub Actions CI/CD operations as AI-callable tools — workflow dispatch, run status, deployment history, and repo health across portfolio projects.

## Why it exists

Checking CI status, inspecting recent deployments, and triggering workflows across multiple repos normally means navigating GitHub's UI or writing one-off API calls. This server exposes those operations as natural language queries in Claude Desktop.

## Tools

| Tool | Description |
|---|---|
| `get_repo_health` | Summary of last push, open issues, and open PRs across a list of repos |
| `get_workflow_runs` | Recent CI/CD workflow runs for a repo, filterable by status |
| `trigger_workflow` | Dispatches a workflow by filename and branch via `workflow_dispatch` |
| `get_deployment_history` | Recent deployments and their statuses for a repo and environment |

## Architecture
```
Claude Desktop
     │ MCP (stdio)
     ▼
github-ops server (Node.js)
     │ Bearer token auth
     ▼
GitHub REST API (api.github.com)
/repos/{owner}/{repo}/actions/runs
/repos/{owner}/{repo}/actions/workflows/{id}/dispatches
/repos/{owner}/{repo}/deployments
/repos/{owner}/{repo}/issues
/repos/{owner}/{repo}/pulls
```

## Setup

**1. Generate a GitHub Personal Access Token**

Go to `https://github.com/settings/tokens/new`. Required scopes: `repo`, `workflow`.

**2. Install and build**
```bash
cd github-ops
npm install
npm run build
```

**3. Configure Claude Desktop**

Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "github-ops": {
      "command": "node",
      "args": ["/absolute/path/to/github-ops/build/index.js"],
      "env": {
        "GITHUB_TOKEN": "your_github_token_here"
      }
    }
  }
}
```

Restart Claude Desktop. The tools will appear in the hammer icon menu.

## Key Decisions

**Personal Access Token over GitHub App** — GitHub Apps are the right choice for multi-repo, multi-org tooling at scale. For single-owner personal portfolio repos, a PAT with scoped permissions is simpler and sufficient.

**`workflow_dispatch` only for triggering** — the server only supports manually-dispatchable workflows. This is intentional — triggering arbitrary workflows via push event simulation would bypass branch protection and review gates. `workflow_dispatch` requires the workflow to explicitly opt in to remote triggering.

**Owner hardcoded, repo as input** — all repos are under the same GitHub owner. Hardcoding the owner and accepting repo name as a tool input is the right split — flexible enough for multi-repo use, without opening the tool to arbitrary owner/repo combinations.

## What's next

- `get_workflow_run_logs` — fetch and surface failure logs directly from a run
- `cancel_workflow_run` — cancel an in-progress run by ID
- Cross-repo status dashboard as a single tool call