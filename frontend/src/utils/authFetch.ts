import config from "../config.json";

export const VALIDATION_TOKEN_KEY = "validationToken";

export function getValidationToken(): string | null {
  return localStorage.getItem(VALIDATION_TOKEN_KEY);
}

export function setValidationToken(token: string): void {
  localStorage.setItem(VALIDATION_TOKEN_KEY, token);
}

export function clearValidationToken(): void {
  localStorage.removeItem(VALIDATION_TOKEN_KEY);
}

export class AuthError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function authFetch(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<Response> {
  const authToken = token ?? getValidationToken();
  if (!authToken) {
    throw new AuthError("Missing validation token.", 401);
  }

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${authToken}`);

  const response = await fetch(`${config.backendUrl}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearValidationToken();
    throw new AuthError("Invalid or expired validation token.", 401);
  }

  return response;
}
