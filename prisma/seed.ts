import { PrismaClient } from '@prisma/client';
import { sourceConfigs } from '../src/config/sources';

const prisma = new PrismaClient();

async function main() {
  for (const source of sourceConfigs) {
    await prisma.sourceConfig.upsert({
      where: { slug: source.slug },
      update: {
        name: source.name,
        url: source.url,
        product: source.product,
        active: true,
      },
      create: {
        slug: source.slug,
        name: source.name,
        url: source.url,
        product: source.product,
        active: true,
      },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
