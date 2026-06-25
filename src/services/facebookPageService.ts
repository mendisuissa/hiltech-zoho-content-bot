import axios from 'axios';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export type FacebookPagePublishInput = {
  message: string;
  link?: string;
};

export type FacebookPagePublishResult = {
  enabled: boolean;
  published: boolean;
  postId?: string;
  skippedReason?: string;
};

export async function publishFacebookPagePost(
  input: FacebookPagePublishInput,
): Promise<FacebookPagePublishResult> {
  if (!env.FACEBOOK_PAGE_PUBLISHING_ENABLED) {
    return {
      enabled: false,
      published: false,
      skippedReason: 'FACEBOOK_PAGE_PUBLISHING_ENABLED is false',
    };
  }

  if (!env.FACEBOOK_PAGE_ACCESS_TOKEN || !env.FACEBOOK_PAGE_ID) {
    throw new Error('Facebook Page publishing is enabled but credentials are missing');
  }

  const endpoint = new URL(
    `/v19.0/${env.FACEBOOK_PAGE_ID}/feed`,
    'https://graph.facebook.com',
  ).toString();

  const response = await axios.post(
    endpoint,
    new URLSearchParams([
      ['message', input.message],
      ['access_token', env.FACEBOOK_PAGE_ACCESS_TOKEN],
      ...(input.link ? [['link', input.link] as [string, string]] : []),
    ]),
    {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    },
  );

  logger.info('Facebook Page post published', { postId: response.data.id });

  return {
    enabled: true,
    published: true,
    postId: response.data.id,
  };
}
