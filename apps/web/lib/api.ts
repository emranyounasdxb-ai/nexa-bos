export type HealthResponse = {
  status: string;
};

export type ReadyResponse = {
  status: string;
};

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

export async function apiGet<T>(path: string, baseUrl: string): Promise<T> {
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

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
