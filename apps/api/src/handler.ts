import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { createApiRouter } from "./http/router.js";
import { createDocumentRepository } from "./adapters/dynamoDocumentRepository.js";
import { createObjectStore } from "./adapters/s3ObjectStore.js";
import { createClock } from "./adapters/systemClock.js";
import { createIdGenerator } from "./adapters/uuidGenerator.js";

const tableName = process.env.TABLE_NAME ?? "";
const docsBucketName = process.env.DOCS_BUCKET_NAME ?? "";
const uploadPrefix = process.env.UPLOAD_PREFIX ?? "uploads/";
const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 10_485_760);

const documents = createDocumentRepository({ tableName });
const objectStore = createObjectStore({ bucketName: docsBucketName });
const clock = createClock();
const ids = createIdGenerator();

const router = createApiRouter({
  documents,
  objectStore,
  clock,
  ids,
  uploadPrefix,
  maxUploadBytes,
  docsBucketName,
});

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  return router.handle(event);
}
