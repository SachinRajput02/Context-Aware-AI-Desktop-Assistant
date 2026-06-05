// backend/src/lambda.ts
// Wraps the Express app for AWS Lambda using serverless-http

import serverless from "serverless-http";
import app from "./server";

export const handler = serverless(app);