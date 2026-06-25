import { z } from 'zod';

const booleanFromEnv = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-1'),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_APPROVER_CHAT_ID: z.string().min(1).optional(),
  SCAN_SECRET: z.string().min(1).optional(),
  FACEBOOK_PAGE_PUBLISHING_ENABLED: booleanFromEnv,
  FACEBOOK_PAGE_ACCESS_TOKEN: z.string().optional().default(''),
  FACEBOOK_PAGE_ID: z.string().optional().default(''),
  APP_BASE_URL: z.string().url().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  ENABLE_LOCAL_SCHEDULER: booleanFromEnv,
  CRON_SCHEDULE: z.string().default('0 8,20 * * *'),
});

export const env = envSchema.parse(process.env);

type RequiredIntegration = 'DATABASE_URL' | 'OPENAI_API_KEY' | 'TELEGRAM_BOT_TOKEN' | 'TELEGRAM_APPROVER_CHAT_ID' | 'SCAN_SECRET';

export function requireEnv(...names: RequiredIntegration[]): Record<RequiredIntegration, string> {
  const values = {} as Record<RequiredIntegration, string>;
  const missing: string[] = [];
  for (const name of names) {
    const value = env[name];
    if (!value) missing.push(name);
    else values[name] = value;
  }
  if (missing.length > 0) {
    throw new Error(`Missing required configuration for this operation: ${missing.join(', ')}`);
  }
  return values;
}
