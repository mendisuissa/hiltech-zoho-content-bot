import sharp from 'sharp';
import path from 'node:path';

const LOGO_PATH = path.resolve(process.cwd(), 'assets', 'hiltech-logo.png');

/**
 * Adds the supplied HilTech logo after image generation.
 * We deliberately composite it ourselves rather than asking an image model to draw it,
 * because generation models cannot preserve a precise brand mark reliably.
 */
export async function applyHilTechBranding(sourceImage: Buffer): Promise<Buffer> {
  const base = sharp(sourceImage).png();
  const metadata = await base.metadata();
  const width = metadata.width ?? 1536;
  const height = metadata.height ?? 1024;

  const logoWidth = Math.max(190, Math.min(330, Math.round(width * 0.18)));
  const margin = Math.max(28, Math.round(width * 0.035));

  const logo = await sharp(LOGO_PATH)
    .resize({ width: logoWidth, withoutEnlargement: true })
    .png()
    .toBuffer();

  const logoMeta = await sharp(logo).metadata();
  const logoHeight = logoMeta.height ?? 60;

  // A subtle brand plaque keeps the opaque logo artwork readable on light generated scenes.
  const plaqueWidth = logoWidth + 28;
  const plaqueHeight = logoHeight + 24;
  const plaqueSvg = `
    <svg width="${plaqueWidth}" height="${plaqueHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${plaqueWidth}" height="${plaqueHeight}" rx="12" fill="#14233a" fill-opacity="0.94"/>
      <rect x="0.75" y="0.75" width="${plaqueWidth - 1.5}" height="${plaqueHeight - 1.5}" rx="11.25" fill="none" stroke="#55e2d3" stroke-opacity="0.35" stroke-width="1.5"/>
    </svg>`;

  const left = Math.max(0, width - plaqueWidth - margin);
  const top = margin;

  return base
    .composite([
      { input: Buffer.from(plaqueSvg), left, top },
      { input: logo, left: left + 14, top: top + 12 },
    ])
    .png()
    .toBuffer();
}
