// backend/src/services/s3Service.ts
// Upload screenshots to S3 for storage and optional future retraining

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { logger } from "../utils/logger";

const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
const BUCKET = process.env.AWS_S3_BUCKET || "ai-assistant-screenshots";

export const s3Service = {
  async uploadScreenshot(
    imageBase64: string,
    sessionId: string,
    timestamp: number
  ): Promise<string> {
    const key = `screenshots/${sessionId}/${timestamp}.jpg`;
    const buffer = Buffer.from(imageBase64, "base64");

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: "image/jpeg",
        Metadata: {
          sessionId,
          timestamp: timestamp.toString(),
        },
      })
    );

    const url = `https://${BUCKET}.s3.amazonaws.com/${key}`;
    logger.info(`Screenshot uploaded: ${url}`);
    return url;
  },
};