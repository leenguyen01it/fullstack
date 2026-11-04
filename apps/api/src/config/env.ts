import { z } from 'zod';

/**
 * Validates the environment variables the API needs at startup.
 * @since REQ-001
 * @updated REQ-002
 * @updated REQ-005
 * @updated REQ-006
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  REFRESH_COOKIE_PATH: z.string().startsWith('/').default('/api/auth'),
  RATE_LIMIT_AUTH_PER_MINUTE: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_API_CAPACITY: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_API_REFILL_PER_SECOND: z.coerce.number().positive().default(2),
  WEB_URL: z.url().default('http://localhost:5173'),
  SMTP_URL: z.url().default('smtp://localhost:1025'),
  MAIL_FROM: z.string().min(3).default('TaskFlow <no-reply@taskflow.local>'),
  RUN_WORKERS: z.stringbool().default(true),
  REMINDER_CRON: z.string().min(9).default('*/5 * * * *'),
  REMINDER_WINDOW_HOURS: z.coerce.number().int().positive().default(24),
  INVITATION_TTL_DAYS: z.coerce.number().int().positive().default(7),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parses raw environment variables and throws a readable error listing every invalid key.
 * @since REQ-001
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}
