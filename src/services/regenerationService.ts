import { prisma } from '../db/prisma';
import { createEditorialBrief, normalizeEditorialBrief } from './editorialService';
import { generateContentPack } from './contentGenerator';
import { assessContentQuality, buildRewriteInstructions, qualityScore } from './qualityService';

/** Rebuilds an existing pending approval from its stored official Zoho source.
 * Used after writing-rule changes; resend only replays old drafts and never regenerates them.
 */
export async function regeneratePendingApproval(approvalId: string) {
  const approval = await prisma.approvalRequest.findFirst({
    where: { id: approvalId, status: 'pending' },
    include: { sourceItem: { include: { sourceConfig: true } } },
  });
  if (!approval) return null;

  const { sourceItem } = approval;
  const source = sourceItem.sourceConfig;
  const editorialBrief = normalizeEditorialBrief(
    await createEditorialBrief(source, sourceItem),
    sourceItem.audience,
    sourceItem.category,
  );

  let contentPack = await generateContentPack(source, sourceItem, editorialBrief);
  let qualityReport = await assessContentQuality({ source, item: sourceItem, editorialBrief, content: contentPack });
  let rewriteCount = 0;
  if (qualityReport.status === 'rewrite_required') {
    rewriteCount = 1;
    contentPack = await generateContentPack(source, sourceItem, editorialBrief, buildRewriteInstructions(qualityReport));
    qualityReport = await assessContentQuality({ source, item: sourceItem, editorialBrief, content: contentPack });
  }

  return prisma.approvalRequest.update({
    where: { id: approval.id },
    data: {
      title: contentPack.articleDraft.raw.title || editorialBrief.hebrewTitle || sourceItem.title,
      category: editorialBrief.category,
      audience: editorialBrief.audience,
      articleDraft: contentPack.articleDraft.raw,
      facebookPageDraft: contentPack.facebookPageDraft.raw,
      facebookGroupDraft: contentPack.facebookGroupDraft.raw,
      whatsappDraft: contentPack.whatsappDraft.raw,
      coverDraft: contentPack.coverDraft.raw,
      editorialBrief,
      qualityReport,
      qualityScore: qualityScore(qualityReport),
      qualityStatus: qualityReport.status,
      rewriteCount,
    },
    include: { sourceItem: true },
  });
}
