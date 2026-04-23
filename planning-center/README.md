# planning-center MCP Server

An MCP server that exposes Planning Center Services data as AI-callable tools — roster queries, upcoming service plans, unassigned slot detection, and automated roster import from a Google Sheets draft.

## Why it exists

Managing a church music roster across multiple Sundays means regularly cross-referencing who's available, what's coming up, and where the gaps are. Co-leaders draft the roster in Google Sheets; transcribing each cell into Planning Center by hand is slow. This server lets Claude answer roster questions and — with the import tools — take a sheet and write assignments directly into PCO.

## Tools

### Read tools

| Tool | Description |
|---|---|
| `get_service_types` | Lists all service types (e.g. JRM Service Flow) with their IDs |
| `get_upcoming_roster` | Returns rostered team members for upcoming plans within a given service type |
| `get_unassigned_slots` | Surfaces team positions with no one rostered across upcoming services |
| `get_team_positions` | Lists all team positions (e.g. Worship Leader 1, Backup Vocals) for a service type |
| `get_team_position_members` | Lists the people eligible for a given team position — the candidate pool for name matching |
| `get_nicknames` | Returns the sheet-alias → canonical-first-name map (e.g. `Meeko → Michael`) |

### Write tool

| Tool | Description |
|---|---|
| `assign_team_members` | Creates team-member assignments on service plans. Defaults to `dry_run: true` — always previews first. Set `dry_run: false` to commit. Skips exact duplicates (same person already on that position on that plan). Status is always `"C"` (confirmed); invitations are sent manually via PCO's "invite all" button. |

## Roster import workflow

```
Meeko: "Import the May roster from <sheet link>"
  │
  ▼
Claude reads sheet via Google Drive MCP → calls get_team_positions,
get_team_position_members, get_nicknames to resolve each cell into
(plan_id, team_position_name, person_id)
  │
  ▼
Claude calls assign_team_members with dry_run=true → shows preview
  │
  ▼
Meeko: "Looks good, apply it"
  │
  ▼
Claude calls assign_team_members with dry_run=false → writes to PCO
```

**Sheet label → PCO team position name**

Labels in the Google Sheet map to exact PCO position names. Multi-occupancy positions (e.g. Backup Vocals) hold multiple people:

| Sheet label | PCO team position |
|---|---|
| `WL 1` | `Worship Leader 1` |
| `WL 2` | `Worship Leader 2` |
| `B-up 1`, `B-up 2`, `B-up 3` | `Back up Vocals` (all three go on the same position) |
| `Acoustic` | `Acoustic` |
| `Bass` | `Bass` |
| `Drums` | `Drums` |
| `Electric` | `Electric` |
| `Keys` | `Keys` |

The `TEAM` row (T1/T2/T3) in the sheet is informational and ignored by the import.

**Name matching.** Claude matches a sheet cell's first name against `get_team_position_members` for that position. If zero matches, it retries once using `get_nicknames` as a fallback. If still zero, the cell is reported as skipped (probable co-leader typo or person not on that team). If multiple matches (e.g. two "Mark"s on the same team), Claude asks which one and caches the answer for the rest of the run.

**Dry-run skip semantics.** The tool only skips exact duplicates — same person already assigned to the same position on the same plan. Capacity is not enforced, so you can add three vocalists to `Back up Vocals` on the same plan.

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
/services/v2/service_types/{id}/team_positions
/services/v2/service_types/{id}/team_positions/{id}/person_team_position_assignments
/services/v2/service_types/{id}/plans
/services/v2/service_types/{id}/plans/{id}/team_members  (GET + POST)
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

**4. Nicknames**

`nicknames.json` at the server root is a flat `{ alias: canonical_first_name }` map. It's loaded live on every `get_nicknames` call — no rebuild or restart needed when you add an entry. Only add an entry when the direct first-name match fails because the sheet alias differs from the PCO first-name.

## Key Decisions

**Thin MCP, Claude orchestrates** — the server speaks Planning Center only. Sheet parsing, name matching, and ambiguity resolution happen in Claude. Keeps the MCP narrow and the import logic observable.

**Personal Access Token over OAuth** — this server accesses one org's data on behalf of one user. OAuth is the right choice when building multi-tenant apps; it's unnecessary overhead here.

**No caching** — Planning Center roster data changes frequently enough that caching would require invalidation logic. Live queries keep it simple and accurate.

**Dry-run default + exact-duplicate skip only** — the write tool defaults to `dry_run: true`. On commit it only skips *exact* duplicates (same person, position, plan). It never replaces or removes existing assignments — if you want to swap someone out, do it in the PCO UI.

**Confirmed status, manual invitations** — all written assignments use `status: "C"` (confirmed). Invitations are sent by clicking "invite all" in the PCO roster matrix after the import.

**Rate limiting** — writes are serialized with a 300 ms gap between calls, with a 2-second backoff and one retry on 429. A typical import is ~50 writes, well under PCO's ~100 / 20s limit.

**Unassigned status via `"U"` filter** — Planning Center's API returns team member status as a single character. `"U"` is unconfirmed/unassigned. Undocumented but consistent across the API — confirmed by live testing.
