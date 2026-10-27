import { z } from 'zod'

export const boxSelectorsSchema = z.array(z.string().trim().min(1).max(1000)).max(32)
export const boxTrackQueryShape = {
  key: z.string().min(1).max(2000).optional().describe('只用于 boxes：元素键精确匹配；与 keyPrefix 同时给出时取交集'),
  keyPrefix: z.string().min(1).max(2000).optional().describe('只用于 boxes：元素键前缀，如 node-、act: 或 .ask#'),
  fromSeconds: z.number().finite().nonnegative().optional().describe('只用于 boxes：录制时间范围起点秒数（含）；补上此刻已存在元素的位置'),
  toSeconds: z.number().finite().nonnegative().optional().describe('只用于 boxes：录制时间范围终点秒数（含），不得小于 fromSeconds'),
}
export const boxTrackQuerySchema = z.object(boxTrackQueryShape).strict().refine(validBoxTimeRange, { path: ['toSeconds'], message: 'toSeconds 不得小于 fromSeconds' })
export type BoxTrackQuery = z.infer<typeof boxTrackQuerySchema>

export function validBoxTimeRange(value: { fromSeconds?: number; toSeconds?: number }): boolean {
  return value.toSeconds === undefined || value.toSeconds >= (value.fromSeconds ?? 0)
}
