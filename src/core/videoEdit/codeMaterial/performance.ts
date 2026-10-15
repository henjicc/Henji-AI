import { z } from 'zod'
import type { CodeSourceSpan } from './contract'

export interface CodeHeavyStructure { kind: string; cpuMs: number; sourceSpan: CodeSourceSpan }
export interface CodeFramePerformance { frame: number; cpuMs: number; gpuMs: number; budgetMs: number; heaviest?: CodeHeavyStructure }
/** GPU elapsed is wall time from render submission preparation through queue
 * completion, including raster upload; it is not a hardware timestamp query. */
export const codeFramePerformanceSchema = z.object({
  frame: z.number().int().nonnegative(), cpuMs: z.number().finite().nonnegative(), gpuMs: z.number().finite().nonnegative(), budgetMs: z.number().positive(),
  heaviest: z.object({ kind: z.string(), cpuMs: z.number().finite().nonnegative(), sourceSpan: z.object({ file: z.string(), start: z.number(), end: z.number(), startLine: z.number(), startColumn: z.number(), endLine: z.number(), endColumn: z.number() }).strict() }).strict().optional(),
}).strict()
export function codePerformanceExceeded(value: CodeFramePerformance): boolean { return value.cpuMs + value.gpuMs > value.budgetMs }
export function codePerformanceMessage(value: CodeFramePerformance): string {
  const h = value.heaviest; const at = h ? `；最重结构 ${h.kind}（${h.sourceSpan.file ?? 'main.ts'}:${h.sourceSpan.startLine}:${h.sourceSpan.startColumn}，CPU ${h.cpuMs.toFixed(2)}ms）` : ''
  return `帧 ${value.frame}：CPU 求值 ${value.cpuMs.toFixed(2)}ms，GPU 渲染完成 ${value.gpuMs.toFixed(2)}ms，实时预算 ${value.budgetMs.toFixed(2)}ms${at}。`
}
