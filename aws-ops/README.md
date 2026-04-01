# aws-ops MCP Server

An MCP server that exposes AWS resource monitoring as AI-callable tools — EC2 instance status, CloudWatch metrics, S3 buckets, and log querying via natural language in Claude Desktop.

## Why it exists

Operating portfolio infrastructure across EC2, S3, and CloudWatch normally means context-switching between the AWS console, CLI, and log streams. This server makes operational queries — "what's the CPU on that instance?" or "show me recent errors from that log group" — a single question to Claude.

## Tools

| Tool | Description |
|---|---|
| `get_ec2_status` | State, type, IP, and tags for all or specific EC2 instances |
| `get_cloudwatch_metrics` | CPU, network, and disk metrics for an EC2 instance over a given time window |
| `list_s3_buckets` | All S3 buckets in the account with their regions and creation dates |
| `get_recent_logs` | Recent events from a CloudWatch log group, with optional filter pattern |
| `list_log_groups` | All CloudWatch log groups in the account, with retention settings |

## Architecture
```
Claude Desktop
     │ MCP (stdio)
     ▼
aws-ops server (Node.js)
     │ AWS SDK v3 (IAM user credentials)
     ├──▶ EC2Client          → DescribeInstances, DescribeInstanceStatus
     ├──▶ CloudWatchClient   → GetMetricStatistics
     ├──▶ CloudWatchLogsClient → FilterLogEvents, DescribeLogGroups
     └──▶ S3Client           → ListBuckets, GetBucketLocation
```

## IAM Setup

This server runs under a dedicated `mcp-ops-user` IAM user with read-only permissions — not root credentials. Policies attached:

- `ReadOnlyAccess` (AWS managed — job function)
- `AmazonS3ReadOnlyAccess` (required separately — `ReadOnlyAccess` does not include `s3:ListAllMyBuckets`)

Never use root credentials for programmatic access.

## Setup

**1. Create an IAM user**

In the AWS Console → IAM → Users → Create user. Attach `ReadOnlyAccess` and `AmazonS3ReadOnlyAccess`. Generate an access key under Security credentials → Create access key → CLI use case.

**2. Install and build**
```bash
cd aws-ops
npm install
npm run build
```

**3. Configure Claude Desktop**

Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "aws-ops": {
      "command": "node",
      "args": ["/absolute/path/to/aws-ops/build/index.js"],
      "env": {
        "AWS_ACCESS_KEY_ID": "your_access_key_id",
        "AWS_SECRET_ACCESS_KEY": "your_secret_access_key",
        "AWS_REGION": "ap-southeast-2"
      }
    }
  }
}
```

Restart Claude Desktop. The tools will appear in the hammer icon menu.

## Key Decisions

**Dedicated IAM user over root credentials** — root credentials have unrestricted access and cannot be scoped. A dedicated IAM user with read-only policies limits blast radius if credentials are ever compromised.

**ReadOnlyAccess + AmazonS3ReadOnlyAccess** — `ReadOnlyAccess` as a job function policy does not include `s3:ListAllMyBuckets`. This is a known AWS policy gap. Both policies are required for full read coverage.

**AWS SDK v3 over CLI subprocess** — spawning `aws` CLI commands from Node.js is fragile (PATH issues, output parsing, error handling). The AWS SDK v3 gives typed responses, proper error objects, and no shell dependency.

**Named profile in CLI, env vars in MCP** — the `mcp-ops` AWS CLI profile is used for local terminal work. The MCP server receives credentials via environment variables in `claude_desktop_config.json` — no shared credentials file dependency, no profile resolution ambiguity.

## What's next

- `get_alb_target_health` — target group health for load balancers
- `get_cost_explorer_summary` — monthly spend breakdown by service
- Integration with `github-ops` for a unified deploy + infra health view