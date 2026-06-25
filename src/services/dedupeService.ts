import type { Prisma, SourceItem } from '@prisma/client';
import { prisma } from '../db/prisma';

export function normalizeCanonicalUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = '';
  const params = new URLSearchParams(url.search);
  for (const key of [...params.keys()]) {
    if (key.startsWith('utm_') || key === 'ref' || key === 'source') {
      params.delete(key);
    }
  }
  url.search = params.toString();
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

export async function findSourceItemByUniqueKeys(canonicalUrl: string, contentHash: string) {
  return prisma.sourceItem.findFirst({
    where: {
      OR: [{ canonicalUrl }, { contentHash }],
    },
  });
}

export async function upsertSourceItem(
  data: Prisma.SourceItemCreateInput,
): Promise<SourceItem> {
  try {
    return await prisma.sourceItem.create({ data });
  } catch (error) {
    const knownError = error as { code?: string };
    if (knownError.code === 'P2002') {
      const existing = await prisma.sourceItem.findFirst({
        where: {
          OR: [{ canonicalUrl: data.canonicalUrl as string }, { contentHash: data.contentHash as string }],
        },
      });
      if (existing) {
        return existing;
      }
    }
    throw error;
  }
}
