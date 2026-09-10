// 2026-09-10 APIMart官方公开尺寸/token表；Fal仅作为同型号输出参考估算。
// https://docs.apimart.ai/en/api-reference/images/gpt-image-2.5/generation.md
import type { JsonObject } from '../../types/runtime'
import { GPT25_RATIOS, GPT25_RESOLUTIONS, GPT25_QUALITIES, gpt25Choice, gpt25Count, gpt25Ratio } from './gptImage25'

export const GPT25_OUTPUT_REFERENCE: Record<string, { width: number; height: number; tokens: number[] }> = {
  "1:1": {
    "width": 1024,
    "height": 1024,
    "tokens": [
      196,
      439,
      1756,
      3122,
      7024
    ]
  },
  "3:2": {
    "width": 1536,
    "height": 1024,
    "tokens": [
      158,
      343,
      1372,
      2459,
      5488
    ]
  },
  "2:3": {
    "width": 1024,
    "height": 1536,
    "tokens": [
      158,
      343,
      1372,
      2459,
      5488
    ]
  },
  "4:3": {
    "width": 1024,
    "height": 768,
    "tokens": [
      134,
      301,
      1204,
      2140,
      4815
    ]
  },
  "3:4": {
    "width": 768,
    "height": 1024,
    "tokens": [
      134,
      301,
      1204,
      2140,
      4815
    ]
  },
  "5:4": {
    "width": 1280,
    "height": 1024,
    "tokens": [
      173,
      378,
      1510,
      2702,
      6119
    ]
  },
  "4:5": {
    "width": 1024,
    "height": 1280,
    "tokens": [
      173,
      378,
      1510,
      2702,
      6119
    ]
  },
  "16:9": {
    "width": 1536,
    "height": 864,
    "tokens": [
      120,
      280,
      1078,
      1917,
      4312
    ]
  },
  "9:16": {
    "width": 864,
    "height": 1536,
    "tokens": [
      120,
      280,
      1078,
      1917,
      4312
    ]
  },
  "2:1": {
    "width": 2048,
    "height": 1024,
    "tokens": [
      132,
      295,
      1180,
      2098,
      4720
    ]
  },
  "1:2": {
    "width": 1024,
    "height": 2048,
    "tokens": [
      132,
      295,
      1180,
      2098,
      4720
    ]
  },
  "21:9": {
    "width": 2016,
    "height": 864,
    "tokens": [
      105,
      225,
      943,
      1617,
      3682
    ]
  },
  "9:21": {
    "width": 864,
    "height": 2016,
    "tokens": [
      105,
      225,
      943,
      1617,
      3682
    ]
  },
  "3:1": {
    "width": 1536,
    "height": 512,
    "tokens": [
      56,
      134,
      535,
      937,
      2140
    ]
  },
  "1:3": {
    "width": 512,
    "height": 1536,
    "tokens": [
      56,
      134,
      535,
      937,
      2140
    ]
  },
  "1:1@2k": {
    "width": 2048,
    "height": 2048,
    "tokens": [
      397,
      892,
      3568,
      6343,
      14272
    ]
  },
  "3:2@2k": {
    "width": 2048,
    "height": 1360,
    "tokens": [
      211,
      460,
      1838,
      3216,
      7351
    ]
  },
  "2:3@2k": {
    "width": 1360,
    "height": 2048,
    "tokens": [
      211,
      460,
      1838,
      3216,
      7351
    ]
  },
  "4:3@2k": {
    "width": 2048,
    "height": 1536,
    "tokens": [
      247,
      556,
      2223,
      3952,
      8892
    ]
  },
  "3:4@2k": {
    "width": 1536,
    "height": 2048,
    "tokens": [
      247,
      556,
      2223,
      3952,
      8892
    ]
  },
  "5:4@2k": {
    "width": 2560,
    "height": 2048,
    "tokens": [
      377,
      826,
      3303,
      5911,
      13385
    ]
  },
  "4:5@2k": {
    "width": 2048,
    "height": 2560,
    "tokens": [
      377,
      826,
      3303,
      5911,
      13385
    ]
  },
  "16:9@2k": {
    "width": 2048,
    "height": 1152,
    "tokens": [
      157,
      367,
      1413,
      2511,
      5650
    ]
  },
  "9:16@2k": {
    "width": 1152,
    "height": 2048,
    "tokens": [
      157,
      367,
      1413,
      2511,
      5650
    ]
  },
  "2:1@2k": {
    "width": 2688,
    "height": 1344,
    "tokens": [
      180,
      405,
      1617,
      2874,
      6466
    ]
  },
  "1:2@2k": {
    "width": 1344,
    "height": 2688,
    "tokens": [
      180,
      405,
      1617,
      2874,
      6466
    ]
  },
  "21:9@2k": {
    "width": 2688,
    "height": 1152,
    "tokens": [
      143,
      306,
      1285,
      2202,
      5016
    ]
  },
  "9:21@2k": {
    "width": 1152,
    "height": 2688,
    "tokens": [
      143,
      306,
      1285,
      2202,
      5016
    ]
  },
  "3:1@2k": {
    "width": 3072,
    "height": 1024,
    "tokens": [
      103,
      247,
      988,
      1729,
      3952
    ]
  },
  "1:3@2k": {
    "width": 1024,
    "height": 3072,
    "tokens": [
      103,
      247,
      988,
      1729,
      3952
    ]
  },
  "1:1@4k": {
    "width": 2880,
    "height": 2880,
    "tokens": [
      659,
      1483,
      5930,
      10542,
      23719
    ]
  },
  "3:2@4k": {
    "width": 3520,
    "height": 2336,
    "tokens": [
      450,
      982,
      3926,
      6870,
      15703
    ]
  },
  "2:3@4k": {
    "width": 2336,
    "height": 3520,
    "tokens": [
      450,
      982,
      3926,
      6870,
      15703
    ]
  },
  "4:3@4k": {
    "width": 3312,
    "height": 2480,
    "tokens": [
      491,
      1104,
      4413,
      7845,
      17650
    ]
  },
  "3:4@4k": {
    "width": 2480,
    "height": 3312,
    "tokens": [
      491,
      1104,
      4413,
      7845,
      17650
    ]
  },
  "5:4@4k": {
    "width": 3216,
    "height": 2576,
    "tokens": [
      535,
      1173,
      4690,
      8393,
      19006
    ]
  },
  "4:5@4k": {
    "width": 2576,
    "height": 3216,
    "tokens": [
      535,
      1173,
      4690,
      8393,
      19006
    ]
  },
  "16:9@4k": {
    "width": 3840,
    "height": 2160,
    "tokens": [
      371,
      865,
      3336,
      5930,
      13342
    ]
  },
  "9:16@4k": {
    "width": 2160,
    "height": 3840,
    "tokens": [
      371,
      865,
      3336,
      5930,
      13342
    ]
  },
  "2:1@4k": {
    "width": 3840,
    "height": 1920,
    "tokens": [
      300,
      675,
      2700,
      4799,
      10798
    ]
  },
  "1:2@4k": {
    "width": 1920,
    "height": 3840,
    "tokens": [
      300,
      675,
      2700,
      4799,
      10798
    ]
  },
  "21:9@4k": {
    "width": 3840,
    "height": 1648,
    "tokens": [
      234,
      500,
      2099,
      3598,
      8196
    ]
  },
  "9:21@4k": {
    "width": 1648,
    "height": 3840,
    "tokens": [
      234,
      500,
      2099,
      3598,
      8196
    ]
  },
  "3:1@4k": {
    "width": 3840,
    "height": 1280,
    "tokens": [
      139,
      332,
      1328,
      2324,
      5311
    ]
  },
  "1:3@4k": {
    "width": 1280,
    "height": 3840,
    "tokens": [
      139,
      332,
      1328,
      2324,
      5311
    ]
  }
}

export function gpt25SizeReference(params: JsonObject) {
  const ratio = gpt25Ratio(params, params.gpt25AspectRatio, GPT25_RATIOS)
  const resolution = gpt25Choice(params.gpt25Resolution, GPT25_RESOLUTIONS, '1K')
  return GPT25_OUTPUT_REFERENCE[ratio + (resolution === '1K' ? '' : '@' + resolution.toLowerCase())]
}

export function gpt25OutputEstimate(params: JsonObject, rate: number, defaultQuality: string): number {
  const quality = gpt25Choice(params.gpt25Quality, GPT25_QUALITIES, defaultQuality)
  const index = ['low', 'medium', 'high', 'xhigh', 'max'].indexOf(quality === 'auto' ? 'max' : quality)
  return gpt25SizeReference(params).tokens[index] * rate / 1000000 * gpt25Count(params.gpt25Count, 10)
}
