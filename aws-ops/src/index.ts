#!/usr/bin/env node

import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { EC2Client, DescribeInstancesCommand, DescribeInstanceStatusCommand } from "@aws-sdk/client-ec2";
import { CloudWatchClient, GetMetricStatisticsCommand } from "@aws-sdk/client-cloudwatch";
import { CloudWatchLogsClient, FilterLogEventsCommand, DescribeLogGroupsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { S3Client, ListBucketsCommand, GetBucketLocationCommand } from "@aws-sdk/client-s3";

// ── AWS Clients ───────────────────────────────────────────────────────────────

const AWS_REGION = process.env.AWS_REGION ?? "ap-southeast-2";

const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
};

const ec2 = new EC2Client({ region: AWS_REGION, credentials });
const cloudwatch = new CloudWatchClient({ region: AWS_REGION, credentials });
const cwLogs = new CloudWatchLogsClient({ region: AWS_REGION, credentials });
const s3 = new S3Client({ region: AWS_REGION, credentials });

// ── Server ────────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "aws-ops", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ── Tool Definitions ──────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_ec2_status",
        description: "Get status and details of EC2 instances in your account",
        inputSchema: {
          type: "object",
          properties: {
            instance_ids: {
              type: "array",
              items: { type: "string" },
              description: "List of instance IDs to query. Leave empty to list all instances.",
            },
          },
        },
      },
      {
        name: "get_cloudwatch_metrics",
        description: "Get CloudWatch metrics for an EC2 instance (CPU, network, disk)",
        inputSchema: {
          type: "object",
          properties: {
            instance_id: {
              type: "string",
              description: "EC2 instance ID e.g. i-1234567890abcdef0",
            },
            metric: {
              type: "string",
              description: "Metric to retrieve",
              enum: ["CPUUtilization", "NetworkIn", "NetworkOut", "DiskReadBytes", "DiskWriteBytes"],
            },
            hours: {
              type: "number",
              description: "How many hours back to query (default: 1)",
            },
          },
          required: ["instance_id", "metric"],
        },
      },
      {
        name: "list_s3_buckets",
        description: "List all S3 buckets in your account with their regions",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_recent_logs",
        description: "Get recent log events from a CloudWatch log group",
        inputSchema: {
          type: "object",
          properties: {
            log_group: {
              type: "string",
              description: "CloudWatch log group name e.g. /var/log/nginx",
            },
            minutes: {
              type: "number",
              description: "How many minutes back to fetch logs (default: 30)",
            },
            filter_pattern: {
              type: "string",
              description: "Optional CloudWatch filter pattern e.g. ERROR",
            },
          },
          required: ["log_group"],
        },
      },
      {
        name: "list_log_groups",
        description: "List available CloudWatch log groups in your account",
        inputSchema: {
          type: "object",
          properties: {
            prefix: {
              type: "string",
              description: "Optional prefix to filter log groups",
            },
          },
        },
      },
    ],
  };
});

// ── Tool Handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    // ── get_ec2_status ─────────────────────────────────────────────────────
    case "get_ec2_status": {
      const instanceIds = args?.instance_ids as string[] | undefined;

      const command = new DescribeInstancesCommand(
        instanceIds?.length ? { InstanceIds: instanceIds } : {}
      );
      const data = await ec2.send(command);

      const instances = data.Reservations?.flatMap(r => r.Instances ?? []).map(i => ({
        instance_id: i.InstanceId,
        state: i.State?.Name,
        type: i.InstanceType,
        public_ip: i.PublicIpAddress ?? null,
        private_ip: i.PrivateIpAddress ?? null,
        launch_time: i.LaunchTime,
        name: i.Tags?.find(t => t.Key === "Name")?.Value ?? "(unnamed)",
        az: i.Placement?.AvailabilityZone,
      })) ?? [];

      return {
        content: [{ type: "text", text: JSON.stringify(instances, null, 2) }],
      };
    }

    // ── get_cloudwatch_metrics ─────────────────────────────────────────────
    case "get_cloudwatch_metrics": {
      const instanceId = args?.instance_id as string;
      const metric = args?.metric as string;
      const hours = (args?.hours as number) ?? 1;

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - hours * 60 * 60 * 1000);

      const command = new GetMetricStatisticsCommand({
        Namespace: "AWS/EC2",
        MetricName: metric,
        Dimensions: [{ Name: "InstanceId", Value: instanceId }],
        StartTime: startTime,
        EndTime: endTime,
        Period: 300, // 5 min intervals
        Statistics: ["Average", "Maximum"],
      });

      const data = await cloudwatch.send(command);
      const points = (data.Datapoints ?? [])
        .sort((a, b) => (a.Timestamp?.getTime() ?? 0) - (b.Timestamp?.getTime() ?? 0))
        .map(p => ({
          timestamp: p.Timestamp,
          average: Math.round((p.Average ?? 0) * 100) / 100,
          maximum: Math.round((p.Maximum ?? 0) * 100) / 100,
          unit: p.Unit,
        }));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            instance_id: instanceId,
            metric,
            period_hours: hours,
            data_points: points,
          }, null, 2),
        }],
      };
    }

    // ── list_s3_buckets ────────────────────────────────────────────────────
    case "list_s3_buckets": {
      const data = await s3.send(new ListBucketsCommand({}));

      const buckets = await Promise.all(
        (data.Buckets ?? []).map(async (b) => {
          try {
            const loc = await s3.send(new GetBucketLocationCommand({ Bucket: b.Name! }));
            return {
              name: b.Name,
              created: b.CreationDate,
              region: loc.LocationConstraint ?? "us-east-1",
            };
          } catch {
            return { name: b.Name, created: b.CreationDate, region: "unknown" };
          }
        })
      );

      return {
        content: [{ type: "text", text: JSON.stringify(buckets, null, 2) }],
      };
    }

    // ── get_recent_logs ────────────────────────────────────────────────────
    case "get_recent_logs": {
      const logGroup = args?.log_group as string;
      const minutes = (args?.minutes as number) ?? 30;
      const filterPattern = args?.filter_pattern as string | undefined;

      const startTime = Date.now() - minutes * 60 * 1000;

      const command = new FilterLogEventsCommand({
        logGroupName: logGroup,
        startTime,
        filterPattern: filterPattern ?? "",
        limit: 50,
      });

      const data = await cwLogs.send(command);
      const events = (data.events ?? []).map(e => ({
        timestamp: new Date(e.timestamp!).toISOString(),
        message: e.message?.trim(),
      }));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            log_group: logGroup,
            period_minutes: minutes,
            filter: filterPattern ?? "none",
            events,
          }, null, 2),
        }],
      };
    }

    // ── list_log_groups ────────────────────────────────────────────────────
    case "list_log_groups": {
      const prefix = args?.prefix as string | undefined;

      const command = new DescribeLogGroupsCommand({
        logGroupNamePrefix: prefix,
        limit: 50,
      });

      const data = await cwLogs.send(command);
      const groups = (data.logGroups ?? []).map(g => ({
        name: g.logGroupName,
        stored_bytes: g.storedBytes,
        retention_days: g.retentionInDays ?? "never expires",
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(groups, null, 2) }],
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