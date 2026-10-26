import { z } from 'zod'
import type { CodeSourceSpan } from './contract'

export interface CodeHeavyStructure { kind: string; cpuMs: number; sourceSpan: CodeSourceSpan }
export interface CodeStructureCost extends CodeHeavyStructure { gpuMs: number; cpuShare: number; gpuShare: number }
export interface CodeReuseStatistics { culledGroups: number; culledDraws: number; frameHits: number; subtreeHits: number; subtreeMisses: number; operations: number }
/**
 * Canvas 图层这一帧的栅格情况（ES 模块作者运行时）：按作者图层计数。`reused` 沿用已上传的栅格，`redrawn` 重放录制的指令重画，
 * `direct` 录制不了、直接画；`video` 是其中画着逐帧变化输入（视频）的层。`uploads`/`uploadBytes` 是画布拷进纹理的次数与字节
 * （按宽×高×4 计，含模糊副本与 WebGL 整帧拷贝）。
 */
export interface CodeLayerStatistics { reused: number; redrawn: number; direct: number; video: number; uploads: number; uploadBytes: number }
export interface CodeFramePerformance {
  frame: number; cpuMs: number; gpuMs: number; budgetMs: number; heaviest?: CodeHeavyStructure; structures?: CodeStructureCost[]; reuse?: CodeReuseStatistics; attribution?: 'draw-preparation-wall'
  layers?: CodeLayerStatistics
  /** First pass includes session/font/pipeline/glyph/texture preparation AND its
   * first frame. It is reported separately, never added to the steady sample. */
  preparation?: { wallMs: number; cpuMs: number; gpuMs: number; sessionReused: boolean }
  sampling?: { mode: 'adjacent-frame' | 'repeat-frame' | 'unavailable'; precedingFrame: number; error?: string }
}
/** GPU elapsed is wall time from render submission preparation through queue
 * completion, including raster upload; it is not a hardware timestamp query. */
export const codeFramePerformanceSchema = z.object({
  frame: z.number().int().nonnegative(), cpuMs: z.number().finite().nonnegative(), gpuMs: z.number().finite().nonnegative(), budgetMs: z.number().positive(),
  heaviest: z.object({ kind: z.string(), cpuMs: z.number().finite().nonnegative(), sourceSpan: z.object({ file: z.string(), start: z.number(), end: z.number(), startLine: z.number(), startColumn: z.number(), endLine: z.number(), endColumn: z.number() }).strict() }).strict().optional(),
  structures: z.array(z.object({ kind: z.string(), cpuMs: z.number().finite().nonnegative(), gpuMs: z.number().finite().nonnegative(), cpuShare: z.number().min(0).max(1), gpuShare: z.number().min(0).max(1), sourceSpan: z.object({ file: z.string(), start: z.number(), end: z.number(), startLine: z.number(), startColumn: z.number(), endLine: z.number(), endColumn: z.number() }).strict() }).strict()).max(5).optional(),
  reuse: z.object({ culledGroups: z.number().int().nonnegative(), culledDraws: z.number().int().nonnegative(), frameHits: z.number().int().nonnegative(), subtreeHits: z.number().int().nonnegative(), subtreeMisses: z.number().int().nonnegative(), operations: z.number().int().nonnegative() }).strict().optional(),
  attribution: z.literal('draw-preparation-wall').optional(),
  layers: z.object({ reused: z.number().int().nonnegative(), redrawn: z.number().int().nonnegative(), direct: z.number().int().nonnegative(), video: z.number().int().nonnegative(), uploads: z.number().int().nonnegative(), uploadBytes: z.number().int().nonnegative() }).strict().optional(),
  preparation: z.object({ wallMs: z.number().finite().nonnegative(), cpuMs: z.number().finite().nonnegative(), gpuMs: z.number().finite().nonnegative(), sessionReused: z.boolean() }).strict().optional(),
  sampling: z.object({ mode: z.enum(['adjacent-frame', 'repeat-frame', 'unavailable']), precedingFrame: z.number().int().nonnegative(), error: z.string().optional() }).strict().optional(),
}).strict()
/** Draw-preparation scopes overlap. They do not insert GPU submissions or fences. Shares use the sum of all measured scopes (before
 * top-five truncation), not frame latency; Structure gpuMs measures command preparation only; the frame gpuMs includes
 * queue completion. Neither is a hardware timestamp; do not sum scopes as frame time. */
export function codeStructureCosts(cpu: readonly CodeHeavyStructure[], gpu: readonly (CodeHeavyStructure & { gpuMs: number })[], totals?: { cpuMs: number; gpuMs: number }): CodeStructureCost[] {
  const entries = new Map<string, CodeStructureCost>()
  for (const value of [...cpu, ...gpu]) {
    const key = `${value.sourceSpan.file}:${value.sourceSpan.start}:${value.kind}`
    const entry = entries.get(key) ?? { kind: value.kind, sourceSpan: value.sourceSpan, cpuMs: 0, gpuMs: 0, cpuShare: 0, gpuShare: 0 }
    entry.cpuMs += value.cpuMs; entry.gpuMs += 'gpuMs' in value && typeof value.gpuMs === 'number' ? value.gpuMs : 0; entries.set(key, entry)
  }
  const values = [...entries.values()]; const cpuTotal = totals?.cpuMs ?? values.reduce((sum, value) => sum + value.cpuMs, 0); const gpuTotal = totals?.gpuMs ?? values.reduce((sum, value) => sum + value.gpuMs, 0)
  for (const value of values) { value.cpuShare = cpuTotal ? Math.min(1, value.cpuMs / cpuTotal) : 0; value.gpuShare = gpuTotal ? Math.min(1, value.gpuMs / gpuTotal) : 0 }
  return values.sort((a, b) => b.cpuShare + b.gpuShare - a.cpuShare - a.gpuShare).slice(0, 5)
}
/** 同一序列帧里各代码片段的图层统计相加；没有片段报告时为 undefined。 */
export function codeLayerTotals(frames: readonly Pick<CodeFramePerformance, 'layers'>[]): CodeLayerStatistics | undefined {
  const reported = frames.flatMap(frame => frame.layers ?? [])
  if (!reported.length) return undefined
  const total: CodeLayerStatistics = { reused: 0, redrawn: 0, direct: 0, video: 0, uploads: 0, uploadBytes: 0 }
  for (const value of reported) for (const key of Object.keys(total) as Array<keyof CodeLayerStatistics>) total[key] += value[key]
  return total
}
export function codePerformanceExceeded(value: CodeFramePerformance): boolean { return value.cpuMs + value.gpuMs > value.budgetMs }
export function codePerformanceMessage(value: CodeFramePerformance): string {
  const h = value.heaviest; const at = h ? `；最重结构 ${h.kind}（${h.sourceSpan.file ?? 'main.ts'}:${h.sourceSpan.startLine}:${h.sourceSpan.startColumn}，CPU ${h.cpuMs.toFixed(2)}ms）` : ''
  const distribution = value.structures?.map(item => `${item.kind} ${item.sourceSpan.file}:${item.sourceSpan.startLine}:${item.sourceSpan.startColumn} CPU ${item.cpuMs.toFixed(2)}ms/${(item.cpuShare * 100).toFixed(1)}%，绘制 ${item.gpuMs.toFixed(2)}ms/${(item.gpuShare * 100).toFixed(1)}%`).join('；')
  const reuse = value.reuse
  const layers = value.layers
  const layerText = layers ? `图层沿用 ${layers.reused}、重画 ${layers.redrawn}、直接绘制 ${layers.direct}（其中画视频 ${layers.video}），上传 ${layers.uploads} 次共 ${(layers.uploadBytes / 1024 / 1024).toFixed(1)}MB。` : ''
  const preparation = value.preparation
  const sample = value.sampling
  const setup = preparation ? `首次准备与首帧 ${preparation.wallMs.toFixed(2)}ms（${preparation.sessionReused ? '复用会话' : '新会话，含字体、管线和纹理准备'}）；${sample?.mode === 'unavailable' ? `稳态采样未完成：${sample.error}，下列为首帧成本` : `同一会话${sample?.mode === 'repeat-frame' ? '重复帧' : '相邻帧'}预热后的稳态成本`}。` : ''
  return `${setup}帧 ${value.frame}：CPU 求值 ${value.cpuMs.toFixed(2)}ms，GPU 渲染完成 ${value.gpuMs.toFixed(2)}ms，实时预算 ${value.budgetMs.toFixed(2)}ms${at}。${distribution ? `成本分布（含子结构，结构绘制仅计准备，整帧另含队列完成，非硬件计时；占比按各类已测结构总和）：${distribution}。` : ''}${reuse ? `剔除组 ${reuse.culledGroups}，剔除绘制 ${reuse.culledDraws}，整帧复用 ${reuse.frameHits}，子树复用 ${reuse.subtreeHits}/${reuse.subtreeHits + reuse.subtreeMisses}。` : ''}${layerText}`
}
