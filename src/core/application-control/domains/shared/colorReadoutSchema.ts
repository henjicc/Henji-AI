import { z } from 'zod'

/** Color readout of `computeColorStatistics`, shared by the video and image observations and the panel scopes. */
export const colorReadoutSchema = z.object({
  exposure: z.object({ middleGrayOffsetEv: z.number().describe('对数平均亮度相对 18% 中灰的偏差（EV），负值偏暗'), key: z.enum(['low', 'normal', 'high']).describe('画面基调：low 低调（如夜景，不宜硬提亮）、high 高调（如雪景）') }).strict(),
  clipping: z.object({ highlightsPercent: z.number().describe('高光溢出像素百分比'), shadowsPercent: z.number().describe('暗部死黑像素百分比') }).strict(),
  tone: z.object({ p2: z.number(), p50: z.number(), p98: z.number() }).strict().describe('显示亮度分位（0–100）：p2 黑点、p50 中位、p98 白点'),
  whiteBalance: z.object({ kelvin: z.number().describe('估计光源色温；写入 temperature_kelvin 可中和'), tint: z.number().describe('估计色调偏移；写入 tint 可中和'), confidence: z.number().describe('0–1；低于 0.4 时画面可能是有意偏色，只做部分校正'), neutralPercent: z.number().describe('可用于估计的中性像素百分比') }).strict(),
  color: z.object({ chromaMedian: z.number(), chromaP95: z.number(), oversaturatedPercent: z.number().describe('OkLCh 彩度超过 0.25 的像素百分比'), palette: z.array(z.object({ hex: z.string(), percent: z.number() }).strict()).max(5) }).strict(),
  skin: z.object({ candidatePercent: z.number().describe('肤色候选像素百分比（按颜色判断，不做人脸检测）'), hueOffsetDegrees: z.number().nullable().describe('肤色候选的中位色相相对肤色线的偏差（度），正值偏黄、负值偏红；候选太少时为 null') }).strict(),
}).strict()
export const colorScopesSchema = z.object({
  histogram: z.object({ luma: z.array(z.number()), red: z.array(z.number()), green: z.array(z.number()), blue: z.array(z.number()) }).strict(),
  waveform: z.object({ columns: z.number().int(), levels: z.number().int(), density: z.array(z.number()) }).strict(),
  vectorscope: z.object({ size: z.number().int(), range: z.number(), density: z.array(z.number()) }).strict(),
}).strict()

