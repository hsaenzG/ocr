import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import {
  deriveJwtSecret,
  type AuthCredentials,
} from "./tokens.js";

/**
 * Loads single-user credentials from Secrets Manager or env vars.
 * Secret JSON shape: { "username": "...", "password": "...", "jwtSecret"?: "..." }
 */
export function createCredentialsLoader(deps?: {
  client?: SecretsManagerClient;
  secretArn?: string;
  env?: NodeJS.ProcessEnv;
}): () => Promise<AuthCredentials> {
  const env = deps?.env ?? process.env;
  const secretArn = deps?.secretArn ?? env.AUTH_SECRET_ARN ?? "";
  const client = deps?.client ?? new SecretsManagerClient({});

  return async () => {
    if (secretArn) {
      const result = await client.send(
        new GetSecretValueCommand({ SecretId: secretArn }),
      );
      if (!result.SecretString) {
        throw new Error("Auth secret is empty");
      }
      const parsed = JSON.parse(result.SecretString) as {
        username?: string;
        password?: string;
        jwtSecret?: string;
      };
      if (!parsed.username || !parsed.password) {
        throw new Error(
          "Auth secret must include username and password",
        );
      }
      return {
        username: parsed.username,
        password: parsed.password,
        jwtSecret: parsed.jwtSecret || deriveJwtSecret(parsed.password),
      };
    }

    const username = env.AUTH_USERNAME ?? "";
    const password = env.AUTH_PASSWORD ?? "";
    if (!username || !password) {
      throw new Error(
        "Set AUTH_SECRET_ARN or AUTH_USERNAME + AUTH_PASSWORD",
      );
    }
    return {
      username,
      password,
      jwtSecret: env.AUTH_JWT_SECRET || deriveJwtSecret(password),
    };
  };
}
