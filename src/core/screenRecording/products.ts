import { z } from 'zod'
import type { RecordingDocument } from './document'
import type { RecordingUnderstanding } from './understanding'

export const recordingProductKindSchema = z.enum(['steps', 'gif', 'bug_report', 'image_document'])
export type RecordingProductKind = z.infer<typeof recordingProductKindSchema>
export interface RecordingProductStep { id: string; title: string; description: string; startUs: number; endUs: number; representativeUs: number; image: string }

/** Select real source ranges. Gaps and missing pictures never become a fabricated screenshot. */
export function recordingProductSteps(recording: RecordingDocument, understanding: RecordingUnderstanding, ids?: readonly string[]): RecordingProductStep[] {
  if (ids && new Set(ids).size !== ids.length) throw new Error('stepIds 不能重复。')
  const selected = ids ? ids.map(id => { const step = understanding.steps.find(step => step.id === id); if (!step) throw new Error(`stepIds:步骤 ${id} 不存在，请读取理解结果。`); return step }) : understanding.steps
  if (!selected.length) throw new Error('会话尚无步骤，请先理解录制。')
  if (selected.length > 100) throw new Error('每批最多导出 100 步，请用 stepIds 分批选择。')
  return selected.map((step, index) => {
    const ranges = recording.media.filter(media => media.kind === 'screen').map(media => ({ start: Math.max(step.startUs, media.monoUs), end: Math.min(step.endUs, media.monoUs + media.durationUs) })).filter(range => range.end > range.start)
    if (!ranges.length) throw new Error(`步骤“${step.title}”没有已保存的屏幕画面。`)
    // The longest real part is representative, even when a step spans a capture gap.
    const range = ranges.reduce((best, next) => next.end - next.start > best.end - best.start ? next : best)
    return { ...step, representativeUs: Math.floor((range.start + range.end) / 2), image: `step-${String(index + 1).padStart(3, '0')}.png` }
  })
}

export function recordingHtmlEscape(value: string): string { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!)) }
function markdownText(value: string): string { return value.replace(/\\/g, '\\\\').replace(/([`*_{}[\]<>#!|])/g, '\\$1').replace(/\r?\n/g, '  \n') }
export function recordingStepsMarkdown(name: string, steps: readonly RecordingProductStep[], warnings: readonly string[] = []): string {
  return [`# ${markdownText(name)}`, ...warnings.map(warning => `> ${markdownText(warning)}`), ...steps.flatMap((step, index) => [`## ${index + 1}. ${markdownText(step.title)}`, markdownText(step.description), `![步骤 ${index + 1}](./${step.image})`])].join('\n\n') + '\n'
}
export function recordingStepsHtml(name: string, steps: readonly RecordingProductStep[], warnings: readonly string[] = []): string {
  const escape = recordingHtmlEscape
  return `<!doctype html>\n<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(name)}</title><body><main><h1>${escape(name)}</h1>${warnings.map(warning => `<p>${escape(warning)}</p>`).join('')}${steps.map((step, index) => `<section><h2>${index + 1}. ${escape(step.title)}</h2><p>${escape(step.description).replace(/\r?\n/g, '<br>')}</p><img src="./${step.image}" alt="步骤 ${index + 1}" width="960"></section>`).join('')}</main></body></html>\n`
}
