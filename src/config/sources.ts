import type { SourceProduct } from '@prisma/client';

export type SeedSourceConfig = {
  slug: string;
  name: string;
  url: string;
  product: SourceProduct;
};

export const sourceConfigs: SeedSourceConfig[] = [
  {
    slug: 'zoho-crm',
    name: 'Zoho CRM',
    url: 'https://www.zoho.com/crm/whats-new/release-notes.html',
    product: 'crm',
  },
  {
    slug: 'zoho-projects',
    name: 'Zoho Projects',
    url: 'https://www.zoho.com/projects/whats-new.html',
    product: 'projects',
  },
  {
    slug: 'zoho-desk',
    name: 'Zoho Desk',
    url: 'https://www.zoho.com/desk/release-notes.html',
    product: 'desk',
  },
];

export const officialZohoHostnames = new Set(['www.zoho.com', 'zoho.com']);
