import { styleKitSchema, styleKitContent, resolveVideoEditStyleKit, type StyleKit, type StyleKitContent } from '@/core/videoEdit/styleKit'
import { BUILTIN_STYLE_KITS, availableStyleKitFonts } from '@/core/videoEdit/styleKitPresets'
import { extractStyleFromWork, type StyleWorkObservation } from '@/core/videoEdit/styleKitExtraction'
import { styleColorFromHex } from '@/core/videoEdit/styleKit'
import { isCodeColor } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeParameterDeclaration } from '@/core/videoEdit/codeMaterial/contract'
import { createLogger } from '@/core/logging'
import { loadFontLibrary, validateFontName } from '@/platform/fonts'
import { compileVideoEditCode, readVideoEditCodeProgram } from './videoEditCodeState'
import { editVideoProject, requireVideoEditInstance } from './videoEditService'
import { videoEditStyleKitLibrary } from './videoEditStyleKitLibrary'
import type { VideoEditDocument } from '@/core/videoEdit/document'
import { evaluateCodeMaterial } from '@/core/videoEdit/codeMaterial/evaluate'
import { measureCodeText } from '../videoEditGlyphMetrics'
import { codeMaterialSource } from '@/core/videoEdit/codeMaterialDocument'
import { portableCodeComponentFiles } from '@/core/videoEdit/codeMaterial/components'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'

const logger = createLogger('features.videoEdit.styleKits')
export function projectStyleKit(document: VideoEditDocument, id: string): StyleKit { const kit = document.styleKits?.find(value => value.id === id); if (!kit) throw new Error('NOT_FOUND：工程风格包不存在，请重新列出 video_edit.style_kit。'); return kit }
export function addProjectStyleKit(projectId: string, kit: StyleKit): StyleKit {
  const value = styleKitSchema.parse({ ...kit, id: crypto.randomUUID(), revision: 0 })
  editVideoProject(projectId, document => ({ ...document, styleKits: [...(document.styleKits ?? []), value] })); return value
}
export function updateProjectStyleKit(projectId: string, id: string, patch: Partial<Pick<StyleKit, 'name' | 'tokens' | 'rules' | 'samples'>>): StyleKit {
  const previous = projectStyleKit(requireVideoEditInstance(projectId).document, id)
  const value = styleKitSchema.parse({ ...previous, ...patch, revision: previous.revision + 1 })
  editVideoProject(projectId, document => ({ ...document, styleKits: document.styleKits!.map(kit => kit.id === id ? value : kit) })); return value
}
export function removeProjectStyleKit(projectId: string, id: string): void {
  const document = requireVideoEditInstance(projectId).document; projectStyleKit(document, id)
  if (document.sequences.some(sequence => sequence.styleKitId === id || sequence.clips.some(clip => clip.styleKitId === id))) throw new Error('此风格仍被序列或片段使用；请先绑定其他风格或清除绑定。')
  editVideoProject(projectId, document => ({ ...document, styleKits: document.styleKits!.filter(kit => kit.id !== id) }))
}
/** Shared validation for UI and generic entity writes. No model or paid request. */
export async function checkStyleKit(kit: StyleKit, signal?: AbortSignal, previous?: StyleKit): Promise<StyleKit> {
  const checked = styleKitSchema.parse(kit)
  for (const sample of checked.samples) {
    signal?.throwIfAborted(); const program = await compileVideoEditCode(sample.source, signal)
    if (program.kind !== 'generator' || program.languageVersion !== 3) throw new Error(`样例“${sample.name}”必须使用 v3 生成器。`)
    signal?.throwIfAborted()
    for (const time of [0, program.durationSeconds / 2, program.durationSeconds]) evaluateCodeMaterial(program, { time, localTime: time, sequenceTime: time, width: program.width, height: program.height, frame: Math.round(time * 30), fps: 30, style: checked.tokens }, {}, { measureText: measureCodeText })
  }
  if (Object.entries(checked.tokens.fonts).some(([role, font]) => JSON.stringify(font) !== JSON.stringify(previous?.tokens.fonts[role as keyof StyleKit['tokens']['fonts']]))) {
    await loadFontLibrary(); signal?.throwIfAborted()
    for (const font of Object.values(checked.tokens.fonts)) validateFontName(font.family)
  }
  return checked
}
export async function copyAvailableStyleKit(kit: StyleKit, signal?: AbortSignal): Promise<StyleKit> { const catalog = await loadFontLibrary(); signal?.throwIfAborted(); return { ...availableStyleKitFonts(kit, catalog.faces), id: crypto.randomUUID(), revision: 0, name: `${kit.name} 副本` } }
export function applyStyleKitToSequence(projectId: string, sequenceId: string, kit: StyleKit): StyleKit { return applyVideoEditStyleKit(projectId, sequenceId, kit) }
export function applyStyleKitToClips(projectId: string, sequenceId: string, kit: StyleKit, clipIds: readonly string[]): StyleKit { if (!clipIds.length) throw new Error('请选择要覆盖风格的片段。'); return applyVideoEditStyleKit(projectId, sequenceId, kit, clipIds) }
function applyVideoEditStyleKit(projectId: string, sequenceId: string, kit: StyleKit, clipIds?: readonly string[]): StyleKit {
  logger.info('style_kit.apply.start', '应用序列风格', { context: { projectId, sequenceId } })
  try {
    let value = styleKitSchema.parse(kit)
    editVideoProject(projectId, document => {
      const sequence = document.sequences.find(sequence => sequence.id === sequenceId)
      if (!sequence) throw new Error('原序列不存在。')
      if (clipIds) { if (clipIds.some(id => !sequence.clips.some(clip => clip.id === id))) throw new Error('所选片段已移除。'); assertVideoEditClipsEditable(sequence, clipIds) }
      const previous = document.styleKits?.find(candidate => candidate.id === value.id)
      if (previous) value = styleKitSchema.parse({ ...value, revision: previous.revision + 1 })
      else value = styleKitSchema.parse({ ...value, id: crypto.randomUUID(), revision: 0 })
      return { ...document, styleKits: [...(document.styleKits ?? []).filter(candidate => candidate.id !== value.id), value], sequences: document.sequences.map(sequence => sequence.id === sequenceId ? clipIds ? { ...sequence, clips: sequence.clips.map(clip => clipIds.includes(clip.id) ? { ...clip, styleKitId: value.id } : clip) } : { ...sequence, styleKitId: value.id } : sequence) }
    })
    logger.info('style_kit.apply.completed', '序列风格已应用', { context: { projectId, sequenceId, styleKitId: value.id } }); return value
  } catch (error) { logger.error('style_kit.apply.failed', '序列风格应用失败', { error, context: { projectId, sequenceId } }); throw error }
}
export function appendStyleKitRule(kit: StyleKit, preference: string): StyleKit { const text = preference.trim(); if (!text) throw new Error('请填写要记住的偏好。'); return styleKitSchema.parse({ ...kit, rules: `${kit.rules}\n\n## 长期偏好\n${text}` }) }
/** Capture an existing checked code component; keep source authoring in the sole code editor. */
export function captureVideoEditStyleSample(projectId: string, sequenceId: string, kit: StyleKit): StyleKit {
  const owner = requireVideoEditInstance(projectId); const sequence = owner.document.sequences.find(value => value.id === sequenceId)
  const clip = sequence?.clips.find(value => value.id === owner.selection)
  if (!clip?.code) throw new Error('请先选择一个 v3 代码片段。')
  const program = readVideoEditCodeProgram(owner, owner.document, clip.code)
  if (program.kind !== 'generator' || program.languageVersion !== 3) throw new Error('风格组件需要 v3 生成器。')
  return styleKitSchema.parse({ ...kit, samples: [...kit.samples, { id: crypto.randomUUID(), name: clip.name, kind: 'chapter', source: portableCodeComponentFiles(codeMaterialSource(owner.document, clip.code).compilation) }] })
}
export function styleKitHostSummary(projectId: string, sequenceId: string): { ref: string | null; name: string; summary: string } {
  const owner = requireVideoEditInstance(projectId); const sequence = owner.document.sequences.find(value => value.id === sequenceId)
  if (!sequence) return { ref: null, name: '', summary: '写代码前选择并读取风格包；未绑定时使用默认令牌。' }
  const selected = sequence.clips.find(clip => clip.id === owner.selection)
  const kit = resolveVideoEditStyleKit(owner.document, sequence, selected)
  return kit ? { ref: `video_edit.style_kit:${projectId}:${kit.id}`, name: kit.name, summary: `AI 写新代码前先 read_application_entity 读取此风格包的 content（tokens、rules、samples），按 rules 做/不做并引用 ctx.style；标题 ${kit.tokens.fonts.display.family}，正文 ${kit.tokens.fonts.body.family}。` } : { ref: null, name: '', summary: '未绑定风格；ctx.style 使用默认令牌。可先列出 video_edit.style_preset，复制 content 创建 video_edit.style_kit，再写 sequence.style_kit_id。' }
}
export async function extractVideoEditWorkStyle(projectId: string, sequenceId: string, name: string, signal?: AbortSignal): Promise<StyleKit> {
  const owner = requireVideoEditInstance(projectId); const baseline = owner.document; const sequence = baseline.sequences.find(value => value.id === sequenceId)
  if (!sequence) throw new Error('原序列不存在。')
  logger.info('style_kit.extract_work.start', '从作品提取风格', { context: { projectId, sequenceId } })
  try {
    const observations: StyleWorkObservation[] = []; const fps = sequence.frameRate.numerator / sequence.frameRate.denominator; const basePalette = BUILTIN_STYLE_KITS[0].tokens.palette
    for (let index = 0; index < sequence.clips.length; index++) {
      signal?.throwIfAborted(); const clip = sequence.clips[index]
      const observation: StyleWorkObservation = { height: sequence.height, fonts: [], colors: [], colorRoles: {} }
      const textStyles = [clip.textStyle, ...(clip.graphic?.objects.map(object => object.textStyle) ?? [])].filter(value => !!value)
      for (const style of textStyles) { observation.fonts.push({ family: style.fontFamily, weight: style.fontWeight, size: style.fontSize }); if (style.fill.enabled) { const color = styleColorFromHex(style.fill.color); observation.colors.push(color); observation.colorRoles!.fg = color } if (style.background.enabled) observation.colorRoles!.surface = styleColorFromHex(style.background.color, style.background.opacity) }
      for (const object of clip.graphic?.objects ?? []) { const fill = object.parameters.fill; if (Array.isArray(fill) && fill.length === 4 && fill.every(channel => typeof channel === 'number')) observation.colors.push(fill as [number, number, number, number]); if (typeof object.parameters.radius === 'number') observation.radius = object.parameters.radius }
      if (clip.code) {
        const program = readVideoEditCodeProgram(owner, baseline, clip.code)
        observation.parameters = { ...Object.fromEntries(program.parameters.map(parameter => [parameter.key, parameter.default])), ...clip.code.parameters }
        const collectColor = (parameter: CodeParameterDeclaration, value: unknown, key: string): void => {
          if (parameter.type === 'color' && isCodeColor(value)) { observation.colors.push(value); if (Object.hasOwn(basePalette, key)) observation.colorRoles![key as keyof StyleKit['tokens']['palette']] = value }
          if (parameter.type === 'custom' && value && typeof value === 'object' && !Array.isArray(value)) for (const [field, member] of Object.entries(parameter.fields)) collectColor(member, (value as Record<string, unknown>)[field], `${key}.${field}`)
        }
        for (const parameter of program.parameters) collectColor(parameter, observation.parameters[parameter.key], parameter.key)
      }
      const opacity = clip.curves?.opacity
      if (opacity && opacity.length >= 2) { observation.enterSeconds = (opacity[1].time - opacity[0].time) / fps; observation.exitSeconds = (opacity.at(-1)!.time - opacity.at(-2)!.time) / fps; observation.ease = opacity[0].interpolation === 'linear' ? 'linear' : 'cubicOut' }
      observations.push(observation)
      if (index % 128 === 127) await new Promise<void>(resolve => setTimeout(resolve, 0))
    }
    for (let index = 0; index < (sequence.captions?.length ?? 0); index++) {
      signal?.throwIfAborted(); const style = sequence.captions![index].style
      if (style) observations.push({ height: 1080, fonts: [{ family: style.fontFamily, weight: style.fontWeight, size: style.fontSize }], colors: style.fill.enabled ? [styleColorFromHex(style.fill.color)] : [], colorRoles: style.fill.enabled ? { fg: styleColorFromHex(style.fill.color) } : {} })
      if (index % 128 === 127) await new Promise<void>(resolve => setTimeout(resolve, 0))
    }
    signal?.throwIfAborted(); if (requireVideoEditInstance(projectId) !== owner || owner.document !== baseline) throw new Error('提取期间作品已修改，请重新提取。')
    const base = resolveVideoEditStyleKit(baseline, sequence) ?? BUILTIN_STYLE_KITS[0]
    const candidate = extractStyleFromWork(observations, base, name)
    logger.info('style_kit.extract_work.completed', '已生成作品风格候选', { context: { projectId, sequenceId } }); return candidate
  } catch (error) { logger.error('style_kit.extract_work.failed', '作品风格提取失败', { error, context: { projectId, sequenceId } }); throw error }
}
export function styleKitFromContent(name: string, content: StyleKitContent): StyleKit { return styleKitSchema.parse({ id: crypto.randomUUID(), name, ...content, revision: 0 }) }
export function saveStyleKitToLibrary(kit: StyleKit): StyleKit { return videoEditStyleKitLibrary.save(styleKitSchema.parse({ ...kit, ...styleKitContent(kit) })) }
