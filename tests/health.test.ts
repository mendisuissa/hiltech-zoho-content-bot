import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let server: import('http').Server | undefined;
let baseUrl = '';

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/hiltech_test?schema=public';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_MODEL = 'gpt-4.1-mini';
  process.env.TELEGRAM_BOT_TOKEN = 'test-telegram-token';
  process.env.TELEGRAM_APPROVER_CHAT_ID = '123456';
  process.env.WORDPRESS_BASE_URL = 'https://example.com';
  process.env.WORDPRESS_USERNAME = 'user';
  process.env.WORDPRESS_APP_PASSWORD = 'password';
  process.env.SCAN_SECRET = 'secret';
  process.env.FACEBOOK_PAGE_PUBLISHING_ENABLED = 'false';
  process.env.ENABLE_LOCAL_SCHEDULER = 'false';
  process.env.PORT = '3001';

  const { createApp } = await import('../src/app');
  const app = createApp();
  server = app.listen(0);
  const activeServer = server;
  await new Promise<void>((resolve) => {
    activeServer.once('listening', resolve);
  });
  const address = activeServer.address();
  if (address && typeof address === 'object') {
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
});

afterAll(async () => {
  const activeServer = server;
  if (!activeServer) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    activeServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});

describe('health route', () => {
  it('returns ok', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('ok');
    expect(data.service).toBe('HilTech Zoho Content Bot');
  });
});
