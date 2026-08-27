export function getBrowserApiUrl(): string {
  const value = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  return value.replace(/\/$/, "");
}

export function getServerApiUrl(): string {
  const value = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  return value.replace(/\/$/, "");
}
