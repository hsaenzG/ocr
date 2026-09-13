import { createHmac, timingSafeEqual } from "node:crypto";

export interface AuthCredentials {
  username: string;
  password: string;
  jwtSecret: string;
}

export interface AuthSession {
  username: string;
  token: string;
  expiresAt: string;
}

export class AuthError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function createAuthService(deps: {
  loadCredentials: () => Promise<AuthCredentials>;
  sessionTtlSeconds?: number;
}) {
  const sessionTtlSeconds = deps.sessionTtlSeconds ?? 60 * 60 * 12;
  let cached: AuthCredentials | null = null;
  let cachedAt = 0;
  const cacheTtlMs = 5 * 60 * 1000;

  async function credentials(): Promise<AuthCredentials> {
    const now = Date.now();
    if (cached && now - cachedAt < cacheTtlMs) {
      return cached;
    }
    cached = await deps.loadCredentials();
    cachedAt = now;
    return cached;
  }

  return {
    async login(username: string, password: string): Promise<AuthSession> {
      const creds = await credentials();
      if (
        !stringsEqual(username, creds.username) ||
        !stringsEqual(password, creds.password)
      ) {
        throw new AuthError(
          401,
          "INVALID_CREDENTIALS",
          "Usuario o contraseña incorrectos",
        );
      }

      const expiresAtEpoch =
        Math.floor(Date.now() / 1000) + sessionTtlSeconds;
      const token = signJwt(
        { sub: creds.username, typ: "access" },
        creds.jwtSecret,
        expiresAtEpoch,
      );

      return {
        username: creds.username,
        token,
        expiresAt: new Date(expiresAtEpoch * 1000).toISOString(),
      };
    },

    async requireUser(
      authorizationHeader: string | undefined,
    ): Promise<{ username: string }> {
      if (!authorizationHeader?.startsWith("Bearer ")) {
        throw new AuthError(401, "UNAUTHORIZED", "Missing bearer token");
      }
      const token = authorizationHeader.slice("Bearer ".length).trim();
      if (!token) {
        throw new AuthError(401, "UNAUTHORIZED", "Missing bearer token");
      }
      const creds = await credentials();
      const payload = verifyJwt(token, creds.jwtSecret);
      return { username: payload.sub };
    },
  };
}

export function deriveJwtSecret(password: string): string {
  return createHmac("sha256", password).update("ocr-session-v1").digest("hex");
}

function signJwt(
  payload: { sub: string; typ: string },
  secret: string,
  expiresAtEpoch: number,
): string {
  const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const body = base64UrlJson({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: expiresAtEpoch,
  });
  const signature = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verifyJwt(
  token: string,
  secret: string,
): { sub: string; typ: string; exp: number } {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AuthError(401, "UNAUTHORIZED", "Invalid token");
  }
  const [header, body, signature] = parts;
  const expected = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new AuthError(401, "UNAUTHORIZED", "Invalid token");
  }

  let payload: { sub?: string; typ?: string; exp?: number };
  try {
    payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as { sub?: string; typ?: string; exp?: number };
  } catch {
    throw new AuthError(401, "UNAUTHORIZED", "Invalid token payload");
  }

  if (!payload.sub || typeof payload.exp !== "number") {
    throw new AuthError(401, "UNAUTHORIZED", "Invalid token payload");
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new AuthError(401, "UNAUTHORIZED", "Token expired");
  }

  return {
    sub: payload.sub,
    typ: payload.typ ?? "access",
    exp: payload.exp,
  };
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function stringsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
