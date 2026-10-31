import pixelmatch from 'pixelmatch'

export interface VideoEditEffectPixelEvidence { width: number; height: number; changedPixels: number; unstablePixels: number; maxChannelDifference: number; meanChannelDifference: number; changedPixelRatio: number }
/** 与仓内图像验收同用 pixelmatch；关闭抗锯齿忽略和颜色容差，不漏掉细小辉光。 */
export function compareVideoEditEffectPixels(on: Uint8ClampedArray, off: Uint8ClampedArray, repeat: Uint8ClampedArray, width: number, height: number): VideoEditEffectPixelEvidence {
  if ([on, off, repeat].some(pixels => pixels.length !== width * height * 4)) throw new Error('效果比较的画面尺寸不一致，请重查。')
  const changedPixels = pixelmatch(on, off, undefined, width, height, { threshold: 0, includeAA: true })
  let max = 0, total = 0
  for (let i = 0; i < on.length; i++) { const difference = Math.abs(on[i] - off[i]); max = Math.max(max, difference); total += difference }
  return { width, height, changedPixels, unstablePixels: pixelmatch(on, repeat, undefined, width, height, { threshold: 0, includeAA: true }), maxChannelDifference: max / 255, meanChannelDifference: total / (on.length * 255), changedPixelRatio: changedPixels / (width * height) }
}
