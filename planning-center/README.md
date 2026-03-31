# planning-center MCP Server

An MCP server that exposes Planning Center Services data as AI-callable tools — roster queries, upcoming service plans, and unassigned slot detection via natural language in Claude Desktop.

## Why it exists

Managing a church music roster across multiple Sundays means regularly cross-referencing who's available, what's coming up, and where the gaps are. Doing that manually through the Planning Center UI is slow. This server makes it a single question to Claude.

## Tools

| Tool | Description |
|---|---|
| `get_service_types` | Lists all service types (e.g. Sunday Morning, Youth) with their IDs |
| `get_upcoming_roster` | Returns rostered team members for upcoming plans within a given service type |
| `get_unassigned_slots` | Surfaces team positions with no one rostered across upcoming services |

## Architecture
```
Claude Desktop
     │ MCP (stdio)
     ▼
planning-center server (Node.js)
     │ HTTP Basic Auth (Personal Access Token)
     ▼
Planning Center REST API
/services/v2/service_types
/services/v2/service_types/{id}/plans
/services/v2/service_types/{id}/plans/{id}/team_members
```

## Setup

**1. Get a Personal Access Token**

Go to `https://api.planningcenteronline.com/oauth/applications`, register an app, then navigate to Personal Access Tokens and generate one.

**2. Install and build**
```bash
cd planning-center
npm install
npm run build
```

**3. Configure Claude Desktop**

Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "planning-center": {
      "command": "node",
      "args": ["/absolute/path/to/planning-center/build/index.js"],
      "env": {
        "PCO_APP_ID": "your_app_id",
        "PCO_SECRET": "your_personal_access_token"
      }
    }
  }
}
```

Restart Claude Desktop. The tools will appear in the hammer icon menu.

## Key Decisions

**Personal Access Token over OAuth** — this server accesses one org's data on behalf of one user. OAuth is the right choice when building multi-tenant apps; it's unnecessary overhead here.

**No caching** — Planning Center roster data changes frequently enough that caching would require invalidation logic. Live queries keep it simple and accurate.

**Unassigned status via `"U"` filter** — Planning Center's API returns team member status as a single character. `"U"` is unconfirmed/unassigned. This is undocumented but consistent across the API — confirmed by live testing.

## What's next

- `get_member_schedule` — query an individual's upcoming commitments
- `find_available_member` — cross-reference a role and date against existing assignments