import type { JsonObject } from '../../types/runtime'

export const FAL_COMMON_IMAGE_RATIOS = [
  '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'
] as const

export function falOneMegapixelSize(ratioText: string): JsonObject {
  const pair = ratioText.split(':').map(Number)
  const ratio = pair[0] > 0 && pair[1] > 0 ? pair[0] / pair[1] : 1
  const targetArea = 1024 * 1024
  return {
    width: Math.ceil(Math.sqrt(targetArea * ratio) / 16) * 16,
    height: Math.ceil(Math.sqrt(targetArea / ratio) / 16) * 16,
  }
}
