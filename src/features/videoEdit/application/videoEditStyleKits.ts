import { styleKitSchema, styleKitContent, styleKitBriefing, styleKitSummary, resolveVideoEditStyleKit, type StyleKit, type StyleKitContent } from '@/core/videoEdit/styleKit'
import { createLogger } from '@/core/logging'
import { compileVideoEditCode, readVideoEditCodeProgram } from './videoEditCodeState'
import { editVideoProject, requireVideoEditInstance } from './videoEditService'
import { videoEditStyleKitLibrary } from './videoEditStyleKitLibrary'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { trialVideoEditAuthorSource } from './videoEditCodeService'
import { codeMaterialSource } from '@/core/videoEdit/codeMaterialDocument'
import { portableCodeComponentFiles } from '@/core/videoEdit/codeMaterial/components'

const logger = createLogger('features.videoEdit.styleKits')
export function projectStyleKit(document: VideoEditDocument, id: string): StyleKit { const kit = document.styleKits?.find(value => value.id === id); if (!kit) throw new Error('NOT_FOUND：工程风格不存在，请重新列出 video_edit.style_kit。'); return kit }
export function addProjectStyleKit(projectId: string, kit: StyleKit): StyleKit {
  const value = styleKitSchema.parse({ ...kit, id: crypto.randomUUID(), revision: 0 })
  editVideoProject(projectId, document => ({ ...document, styleKits: [...(document.styleKits ?? []), value] })); return value
}
export function updateProjectStyleKit(projectId: string, id: string, patch: Partial<Pick<StyleKit, 'name' | 'guide' | 'examples'>>): StyleKit {
  const previous = projectStyleKit(requireVideoEditInstance(projectId).document, id)
  const value = styleKitSchema.parse({ ...previous, ...patch, revision: previous.revision + 1 })
  editVideoProject(projectId, document => ({ ...document, styleKits: document.styleKits!.map(kit => kit.id === id ? value : kit) })); return value
}
export function removeProjectStyleKit(projectId: string, id: string): void {
  const document = requireVideoEditInstance(projectId).document; projectStyleKit(document, id)
  if (document.sequences.some(sequence => sequence.styleKitId === id)) throw new Error('此风格仍被序列使用；请先绑定其他风格或清除绑定。')
  editVideoProject(projectId, document => ({ ...document, styleKits: document.styleKits!.filter(kit => kit.id !== id) }))
}
/** Shared validation for UI and generic entity writes: the guide's sections (schema) and every example compiles and draws. No model or paid request. */
export async function checkStyleKit(kit: StyleKit, signal?: AbortSignal): Promise<StyleKit> {
  const checked = styleKitSchema.parse(kit)
  for (const example of checked.examples) {
    signal?.throwIfAborted(); const program = await compileVideoEditCode(example.source, signal)
    if (program.kind !== 'generator') throw new Error(`示例“${example.title}”必须使用 JS 生成器。`)
    signal?.throwIfAborted()
    try { await trialVideoEditAuthorSource(example.source, program, signal ?? new AbortController().signal) }
    catch (error) { throw new Error(`示例“${example.title}”无法绘制：${error instanceof Error ? error.message : String(error)}`, { cause: error }) }
  }
  return checked
}
export function copyStyleKit(kit: StyleKit): StyleKit { return styleKitSchema.parse({ ...styleKitContent(kit), id: crypto.randomUUID(), revision: 0, name: `${kit.name} 副本` }) }
/** Binding only tells the assistant which guide to follow; nothing on the timeline changes. */
export function applyStyleKitToSequence(projectId: string, sequenceId: string, kit: StyleKit): StyleKit {
  logger.info('style_kit.apply.start', '为序列绑定风格', { context: { projectId, sequenceId } })
  try {
    let value = styleKitSchema.parse(kit)
    editVideoProject(projectId, document => {
      if (!document.sequences.some(sequence => sequence.id === sequenceId)) throw new Error('原序列不存在。')
      const previous = document.styleKits?.find(candidate => candidate.id === value.id)
      value = styleKitSchema.parse(previous ? { ...value, revision: previous.revision + 1 } : { ...value, id: crypto.randomUUID(), revision: 0 })
      return { ...document, styleKits: [...(document.styleKits ?? []).filter(candidate => candidate.id !== value.id), value], sequences: document.sequences.map(sequence => sequence.id === sequenceId ? { ...sequence, styleKitId: value.id } : sequence) }
    })
    logger.info('style_kit.apply.completed', '序列风格已绑定', { context: { projectId, sequenceId, styleKitId: value.id } }); return value
  } catch (error) { logger.error('style_kit.apply.failed', '序列风格绑定失败', { error, context: { projectId, sequenceId } }); throw error }
}
/** Add the selected checked code clip as a reference example; source authoring stays in the code editor. */
export function captureVideoEditStyleExample(projectId: string, sequenceId: string, kit: StyleKit): StyleKit {
  const owner = requireVideoEditInstance(projectId); const sequence = owner.document.sequences.find(value => value.id === sequenceId)
  const clip = sequence?.clips.find(value => value.id === owner.selection)
  if (!clip?.code) throw new Error('请先在时间线上选择一个代码片段。')
  const program = readVideoEditCodeProgram(owner, owner.document, clip.code)
  if (program.kind !== 'generator') throw new Error('参考示例需要 JS 生成器。')
  return styleKitSchema.parse({ ...kit, examples: [...kit.examples, { id: crypto.randomUUID(), title: clip.name.slice(0, 80), note: '', source: portableCodeComponentFiles(codeMaterialSource(owner.document, clip.code).compilation) }] })
}
/** Host context: the bound guide in full (examples are read through the entity), or the personal styles to recommend from. */
export function styleKitHostSummary(projectId: string, sequenceId: string): { ref: string | null; name: string; summary: string } {
  const owner = requireVideoEditInstance(projectId); const sequence = owner.document.sequences.find(value => value.id === sequenceId)
  if (!sequence) return { ref: null, name: '', summary: '' }
  const kit = resolveVideoEditStyleKit(owner.document, sequence)
  if (kit) return { ref: `video_edit.style_kit:${projectId}:${kit.id}`, name: kit.name, summary: `本序列按下面的风格说明书创作：新做的代码画面、文字、标题、字幕、关键帧和转场都要遵守它，“必须”不可违反，“可以自由发挥”的部分每次做出变化。${kit.examples.length ? `参考示例 ${kit.examples.length} 段，需要时读取 content.examples，只学手法不照搬。` : ''}做完逐条对照“必须”和核心理念的判据自查。\n\n${styleKitBriefing(kit, { examples: false })}` }
  const personal = videoEditStyleKitLibrary.custom()
  const listed = personal.slice(0, 8).map(value => { const summary = styleKitSummary(value); return summary ? `${value.name}（${summary.slice(0, 40)}）` : value.name })
  return { ref: null, name: '', summary: `未绑定风格：按用户的需求和偏好自己定方向直接做，交付时说明选了什么。${listed.length ? `本机个人风格 ${personal.length} 套：${listed.join('、')}${personal.length > listed.length ? ' 等' : ''}；用户提到其中某套、或任务明显对得上时，可以直接按它做并说明，也可以建议绑定。` : ''}` }
}
export function styleKitFromContent(name: string, content: StyleKitContent): StyleKit { return styleKitSchema.parse({ id: crypto.randomUUID(), name, ...content, revision: 0 }) }
export function saveStyleKitToLibrary(kit: StyleKit): StyleKit { return videoEditStyleKitLibrary.save(styleKitSchema.parse({ ...kit, ...styleKitContent(kit) })) }
/** Host context reads preset preferences next to the style summary, through this already-public module. */
export { videoEditPresetHostSummary } from './videoEditPresetCatalog'
