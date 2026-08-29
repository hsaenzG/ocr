import type { APIGatewayProxyResultV2 } from "aws-lambda";
import type { ApiErrorBody } from "@ocr/shared";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

export function jsonResponse(
  statusCode: number,
  body: unknown,
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      ...corsHeaders,
    },
    body: JSON.stringify(body),
  };
}

export function errorResponse(
  statusCode: number,
  error: string,
  message: string,
  code: string,
): APIGatewayProxyResultV2 {
  const body: ApiErrorBody = { error, message, code };
  return jsonResponse(statusCode, body);
}

export function optionsResponse(): APIGatewayProxyResultV2 {
  return {
    statusCode: 204,
    headers: corsHeaders,
    body: "",
  };
}
