import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __hiltechPrisma: PrismaClient | undefined;
}

export const prisma =
  global.__hiltechPrisma ??
  new PrismaClient({
    log: ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__hiltechPrisma = prisma;
}
