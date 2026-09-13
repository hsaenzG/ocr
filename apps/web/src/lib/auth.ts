const TOKEN_KEY = "ocr_auth_token";
const USER_KEY = "ocr_auth_user";
const EXPIRES_KEY = "ocr_auth_expires";

export function getAuthToken(): string | null {
  if (typeof sessionStorage === "undefined") {
    return null;
  }
  const token = sessionStorage.getItem(TOKEN_KEY);
  const expiresAt = sessionStorage.getItem(EXPIRES_KEY);
  if (!token) {
    return null;
  }
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
    clearAuthSession();
    return null;
  }
  return token;
}

export function getAuthUsername(): string | null {
  if (typeof sessionStorage === "undefined") {
    return null;
  }
  return sessionStorage.getItem(USER_KEY);
}

export function setAuthSession(session: {
  token: string;
  username: string;
  expiresAt: string;
}): void {
  sessionStorage.setItem(TOKEN_KEY, session.token);
  sessionStorage.setItem(USER_KEY, session.username);
  sessionStorage.setItem(EXPIRES_KEY, session.expiresAt);
}

export function clearAuthSession(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(EXPIRES_KEY);
}

export function isAuthenticated(): boolean {
  return Boolean(getAuthToken());
}

export function requireAuthOrRedirect(): boolean {
  if (isAuthenticated()) {
    return true;
  }
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.href = `/login/?next=${encodeURIComponent(next)}`;
  return false;
}
