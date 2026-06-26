import config from "../config.json";

export function ratingTokenKey(raterId: string): string {
  return `ratingToken_${raterId}`;
}

export function getRaterToken(raterId: string): string | null {
  return localStorage.getItem(ratingTokenKey(raterId));
}

export function setRaterToken(raterId: string, token: string): void {
  localStorage.setItem(ratingTokenKey(raterId), token);
}

export function clearRaterToken(raterId: string): void {
  localStorage.removeItem(ratingTokenKey(raterId));
}

export class RaterAuthError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function raterAuthFetch(
  raterId: string,
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<Response> {
  const authToken = token ?? getRaterToken(raterId);
  if (!authToken) {
    throw new RaterAuthError("Missing rater token.", 401);
  }

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${authToken}`);

  const response = await fetch(`${config.backendUrl}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearRaterToken(raterId);
    throw new RaterAuthError("Invalid or expired rater token.", 401);
  }

  return response;
}

export async function fetchRatingSchema(): Promise<Response> {
  return fetch(`${config.backendUrl}/rating/schema`);
}
