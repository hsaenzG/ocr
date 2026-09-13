#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { OcrStack } from "../lib/ocr-stack";

const app = new cdk.App();

const stackName = process.env.STACK_NAME ?? "OcrStack";

new OcrStack(app, stackName, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: "Serverless OCR — S3 → SQS → Lambda → Textract → DynamoDB",
});
