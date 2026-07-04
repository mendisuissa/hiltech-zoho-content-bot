import { Router } from 'express';
import { prisma } from '../db/prisma';
import { env } from '../config/env';

export const dashboardRouter = Router();

function auth(req: any, res: any): boolean {
  const token = req.query.token || req.headers['x-dashboard-token'];
  const expected = process.env.HILTECH_DASHBOARD_SECRET || process.env.SCAN_SECRET || '';
  if (!expected || token !== expected) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// Graph stats — total items per product
dashboardRouter.get('/graph', async (req, res, next) => {
  if (!auth(req, res)) return;
  try {
    const byProduct = await prisma.sourceItem.groupBy({
      by: ['category'],
      _count: { id: true },
    });
    const total = await prisma.sourceItem.count();
    const bySrc = await prisma.sourceConfig.findMany({
      select: { name: true, product: true, _count: { select: { items: true } } },
      where: { active: true },
    });
    const nodes = bySrc.map(s => ({ type: s.product, name: s.name, count: s._count.items }));
    return res.json({ nodes, total });
  } catch (err) { return next(err); }
});

// Ingest stats — sources + last run
dashboardRouter.get('/ingest-stats', async (req, res, next) => {
  if (!auth(req, res)) return;
  try {
    const sources = await prisma.sourceConfig.findMany({
      where: { active: true },
      select: {
        id: true, slug: true, name: true, product: true,
        updatedAt: true,
        _count: { select: { items: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const formatted = sources.map(s => ({
      id: s.id,
      label: s.name,
      family: s.product,
      items_ingested: s._count.items,
      last_run_at: s.updatedAt?.toISOString() || null,
    }));
    const lastRun = sources[0]?.updatedAt?.toISOString() || null;
    return res.json({ sources: formatted, lastRun });
  } catch (err) { return next(err); }
});

// Recent items
dashboardRouter.get('/recent', async (req, res, next) => {
  if (!auth(req, res)) return;
  try {
    const rows = await prisma.sourceItem.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        title: true, canonicalUrl: true, publishedAt: true, category: true, audience: true,
        sourceConfig: { select: { product: true } },
      },
    });
    const items = rows.map(r => ({
      title: r.title,
      url: r.canonicalUrl,
      published_at: r.publishedAt?.toISOString() || null,
      products: [r.sourceConfig.product],
    }));
    return res.json({ items });
  } catch (err) { return next(err); }
});

// Product coverage
dashboardRouter.get('/products', async (req, res, next) => {
  if (!auth(req, res)) return;
  try {
    const rows = await prisma.sourceItem.groupBy({
      by: ['category'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });
    const products = rows.map(r => ({ name: r.category, count: r._count.id }));
    return res.json({ products });
  } catch (err) { return next(err); }
});
