import { loadSharp } from '../../image/sharp-loader';

const profiles = new Map<string, Promise<Buffer>>();
/** libvips/LittleCMS owns standard ICC bytes; never attach an unrelated source profile. */
export function standardRgbProfile(space: 'srgb' | 'display-p3'): Promise<Buffer> {
  let pending = profiles.get(space);
  if (!pending) {
    pending = (async () => {
      const sharp = await loadSharp();
      const pixels = await sharp({ create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } } })
        .withIccProfile(space === 'srgb' ? 'srgb' : 'p3').png().toBuffer();
      const metadata = await sharp(pixels).metadata();
      if (!metadata.icc) throw new Error('标准颜色配置不可用');
      return metadata.icc;
    })();
    profiles.set(space, pending);
    pending.catch(() => { if (profiles.get(space) === pending) profiles.delete(space); });
  }
  return pending;
}
