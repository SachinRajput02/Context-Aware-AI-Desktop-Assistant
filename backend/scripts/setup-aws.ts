// backend/scripts/setup-aws.ts
// Run: npx ts-node scripts/setup-aws.ts
// Creates DynamoDB tables and S3 bucket needed for the project

import { DynamoDBClient, CreateTableCommand, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { S3Client, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { config } from "dotenv";
import * as path from "path";

config({ path: path.join(__dirname, "../.env") });

const region = process.env.AWS_REGION || "us-east-1";
const dynamodb = new DynamoDBClient({ region });
const s3 = new S3Client({ region });

const TABLES = [
  {
    TableName: process.env.AWS_DYNAMODB_TABLE_SESSIONS || "ai-assistant-sessions",
    AttributeDefinitions: [{ AttributeName: "sessionId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "sessionId", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST" as const,
    TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
  },
];

const S3_BUCKET = process.env.AWS_S3_BUCKET || "ai-assistant-screenshots";

async function createTables() {
  console.log("🔵 Setting up DynamoDB tables...");

  const existing = await dynamodb.send(new ListTablesCommand({}));
  const existingNames = existing.TableNames || [];

  for (const table of TABLES) {
    if (existingNames.includes(table.TableName)) {
      console.log(`  ✓ Table "${table.TableName}" already exists`);
      continue;
    }
    try {
      await dynamodb.send(new CreateTableCommand(table));
      console.log(`  ✓ Created table "${table.TableName}"`);
    } catch (err: any) {
      console.error(`  ✗ Failed to create table "${table.TableName}":`, err.message);
    }
  }
}

async function createBucket() {
  console.log("\n🔵 Setting up S3 bucket...");
  try {
    await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
    console.log(`  ✓ Bucket "${S3_BUCKET}" already exists`);
  } catch {
    try {
      await s3.send(
        new CreateBucketCommand({
          Bucket: S3_BUCKET,
          ...(region !== "us-east-1" && {
            CreateBucketConfiguration: { LocationConstraint: region as any },
          }),
        })
      );
      console.log(`  ✓ Created bucket "${S3_BUCKET}"`);
    } catch (err: any) {
      console.error(`  ✗ Failed to create bucket:`, err.message);
    }
  }
}

async function main() {
  console.log(`\n🚀 AI Desktop Assistant — AWS Setup`);
  console.log(`   Region: ${region}\n`);

  await createTables();
  await createBucket();

  console.log("\n✅ AWS setup complete!\n");
  console.log("Next steps:");
  console.log("  1. cd backend && npm run dev");
  console.log("  2. cd electron-app && npm start");
}

main().catch(console.error);