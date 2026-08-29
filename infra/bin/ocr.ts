#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { OcrStack } from "../lib/ocr-stack";

const app = new cdk.App();

new OcrStack(app, "OcrStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: "Serverless OCR — S3 → SQS → Lambda → Textract → DynamoDB",
});
