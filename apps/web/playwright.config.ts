import { defineConfig, devices } from "@playwright/test";

function requireSafeTestDatabaseUrl(value: string | undefined) {
  if (!value?.trim()) {
    throw new Error("DATABASE_URL must be explicitly set for Playwright tests");
  }

  const parsed = new URL(value.replace(/^postgresql\+asyncpg:/, "postgresql:"));
  const database = parsed.pathname.replace(/^\//, "");
  const port = Number(parsed.port || "5432");
  if (port === 15432) {
    throw new Error("DATABASE_URL must not use canonical host port 15432");
  }
  if (database.toLowerCase() === "nexa_bos") {
    throw new Error("DATABASE_URL must not use canonical database 'nexa_bos'");
  }
  if (!/(?:^|_)test(?:_|$)/i.test(database)) {
    throw new Error("DATABASE_URL database name must contain a distinct 'test' segment");
  }
}

requireSafeTestDatabaseUrl(process.env.DATABASE_URL);

const webPort = process.env.PLAYWRIGHT_WEB_PORT ?? "3010";
const apiPort = process.env.PLAYWRIGHT_API_PORT ?? "8010";
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;

const apiCommand =
  process.platform === "win32"
    ? `uv run --directory ..\\..\\apps\\api alembic upgrade head && uv run --directory ..\\..\\apps\\api uvicorn nexa_bos_api.main:app --host 127.0.0.1 --port ${apiPort}`
    : `uv run --directory ../../apps/api alembic upgrade head && uv run --directory ../../apps/api uvicorn nexa_bos_api.main:app --host 127.0.0.1 --port ${apiPort}`;

export default defineConfig({
  testDir: "../../tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? webOrigin,
    timezoneId: "UTC",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: apiCommand,
      url: `${apiOrigin}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        APP_ENV: process.env.APP_ENV ?? "test",
        CORS_ORIGINS: `${webOrigin},http://localhost:${webPort}`,
        WEB_ORIGIN: webOrigin,
        BOOTSTRAP_SECRET: process.env.BOOTSTRAP_SECRET ?? "nexa-test-bootstrap-secret",
      },
    },
    {
      command: `pnpm exec next dev --hostname 127.0.0.1 --port ${webPort}`,
      url: webOrigin,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_URL: apiOrigin,
      },
    },
  ],
});
