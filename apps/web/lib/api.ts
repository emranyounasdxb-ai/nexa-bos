export type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown[];
    requestId?: string;
  };
};

export class ApiClientError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(message: string, status: number, body: ApiErrorBody | null) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.body = body;
  }
}

export type HealthResponse = { status: string };
export type ReadyResponse = { status: string };

let csrfToken: string | null = null;

export function getCsrfToken(): string | null {
  return csrfToken;
}

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export async function apiRequest<T>(
  path: string,
  baseUrl: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const method = (init.method ?? "GET").toUpperCase();
  if (csrfToken && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, { ...init, headers, cache: "no-store", credentials: "include" });
  if (response.status === 204) {
    return undefined as T;
  }
  const body = (await response.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!response.ok) {
    const errorBody = (body ?? null) as ApiErrorBody | null;
    throw new ApiClientError(
      errorBody?.error?.message ?? `API request failed (${response.status})`,
      response.status,
      errorBody,
    );
  }
  return body as T;
}

export async function apiDownload(
  path: string,
  baseUrl: string,
  init: RequestInit = {},
): Promise<{ blob: Blob; contentType: string; filename: string | null }> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (csrfToken && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, { ...init, headers, cache: "no-store", credentials: "include" });
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiClientError(
      errorBody?.error?.message ?? `API request failed (${response.status})`,
      response.status,
      errorBody,
    );
  }
  const disposition = response.headers.get("Content-Disposition");
  const filenameMatch = disposition?.match(/filename="([^"]+)"/);
  return {
    blob: await response.blob(),
    contentType: response.headers.get("Content-Type") ?? "application/octet-stream",
    filename: filenameMatch?.[1] ?? null,
  };
}

export async function apiGet<T>(path: string, baseUrl: string): Promise<T> {
  return apiRequest<T>(path, baseUrl, { method: "GET" });
}
