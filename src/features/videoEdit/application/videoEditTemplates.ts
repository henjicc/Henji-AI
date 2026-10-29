import { readContentTrustFailure } from '@/core/contentTrust'
import { z } from 'zod'
import { createLogger } from '@/core/logging'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { resolveVideoEditDropMode } from '@/core/videoEdit/dropPlacement'
import { applyVideoEditTimelineEditResult } from '@/core/videoEdit/timelineEdits'
import { videoEditEdgeTracks } from '@/core/videoEdit/tracks'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { codeMaterialSource, retargetCodeMaterialInstances } from '@/core/videoEdit/codeMaterialDocument'
import { videoEditCodeInstanceMigration, type VideoEditCodeInstanceMigration } from '@/core/application-control/domains/videoEdit/videoEditCodeProjectCapabilities'
import { portableCodeComponentFiles } from '@/core/videoEdit/codeMaterial/components'
import { validateCodeMaterialParameters } from '@/core/videoEdit/codeMaterial/parameters'
import type { CodeParameterValues } from '@/core/videoEdit/codeMaterial/contract'
import { videoEditDocumentSchema, videoEditProjectTemplateSchema, type VideoEditClip, type VideoEditDocument, type VideoEditItem, type VideoEditNativeTemplateClip, type VideoEditProjectTemplate, type VideoEditSequence } from '@/core/videoEdit/document'
import { captureNativeTemplateContent, instantiateNativeTemplate, nativeTemplateTexts } from '@/core/videoEdit/styles/nativeTemplates'
import { videoEditTemplateContentHash, videoEditStyleIdSchema, type VideoEditStyle } from '@/core/videoEdit/styles/styleSchemas'
import { videoEditTemplateSchema, type VideoEditTemplate } from '@/core/videoEdit/styles/templateSchemas'
import type { CodeMaterialVersion } from '@/core/videoEdit/codeMaterialPersistence'
import { videoEditFps } from '@/core/videoEdit/time'
import { notExecutedFailure } from '@/core/application-control/execution/writeExecution'
import { editVideoProject, listVideoEditInstances, requireVideoEditInstance, setVideoEditView, type VideoEditInstance } from './videoEditService'
import { ensureVideoEditRetargetMetadata, withVideoEditCodeMetadata, withVideoEditUnreadableCodeVersions, readVideoEditCodeMetadata } from './videoEditCodeState'
import { createVideoEditCodeVersions, createVideoEditPlacedCodeItems } from './videoEditCodeService'
import { videoEditStyleLibrary } from './videoEditStyleLibrary'
import type { VideoEditDropPlacement } from './videoEditDrop'

const logger = createLogger('features.videoEdit.templates')

/**
 * 模板（照搬 Frameflow templates）：做好的元素换内容就能反复用。工程模板跟着工程走、默认联动——
 * 代码模板的全部片段共用同一个代码定义，原生模板的片段带同一个 templateId；改模板时所有实例一起变，单独改一处先分离。
 * 库模板（全局）用进工程时复制一份成为工程模板并记下来源与版本，库里更新只提示，用户同意才升级。
 */
export type VideoEditTemplateScope = 'project' | 'library'
export const VIDEO_EDIT_TEMPLATE_DRAG_MIME = 'application/x-henji-video-template'
export const videoEditTemplateDragSchema = z.object({ kind: z.literal('template'), scope: z.enum(['project', 'library']), templateId: videoEditStyleIdSchema }).strict()
export function writeVideoEditTemplateDrag(transfer: DataTransfer, scope: VideoEditTemplateScope, templateId: string): void {
  transfer.setData(VIDEO_EDIT_TEMPLATE_DRAG_MIME, JSON.stringify({ kind: 'template', scope, templateId })); transfer.effectAllowed = 'copy'
}
const newId = (): string => crypto.randomUUID()

/**
 * 模板操作的执行事实：剪辑内容还没变、也没开始写风格库或代码文件时的失败（片段、风格、模板找不到，类型不对，轨道锁定……）
 * 标成未执行，调用方修正后直接重试，不把剪辑锁进“结果未知”；剪辑内容已变或已开始写外部存储时按原样抛出，交执行层核对。
 * 剪辑内容只经 editVideoProject 原子提交，内容版本没变就是零修改；风格库与代码文件不在内容版本里，写之前先调 external()。
 */
async function templateOperation<T>(projectId: string, work: (external: () => void) => Promise<T>): Promise<T> {
  let owner: VideoEditInstance | undefined; let contentVersion = 0; let external = false
  try {
    owner = requireVideoEditInstance(projectId); contentVersion = owner.contentVersion
    return await work(() => { external = true })
  } catch (error) {
    const unchanged = !external && (!owner || listVideoEditInstances().includes(owner) && owner.contentVersion === contentVersion)
    throw unchanged ? notExecutedFailure(error) : error
  }
}

export function requireProjectTemplate(document: Pick<VideoEditDocument, 'templates'>, id: string): VideoEditProjectTemplate {
  const template = document.templates?.find(value => value.id === id)
  if (!template) throw new Error(`NOT_FOUND：工程里没有这个模板（${id}），请重新列出 video_edit.project_template。`)
  return template
}
/** 这个工程模板联动的全部片段。 */
export function videoEditTemplateInstances(document: Pick<VideoEditDocument, 'sequences'>, template: VideoEditProjectTemplate): Array<{ sequenceId: string; clipId: string }> {
  return document.sequences.flatMap(sequence => sequence.clips.filter(clip => template.body.kind === 'code' ? clip.code?.definitionId === template.body.definitionId : clip.templateId === template.id).map(clip => ({ sequenceId: sequence.id, clipId: clip.id })))
}
/** 片段属于哪个工程模板（代码片段看代码定义，文字图形看 templateId）。 */
export function videoEditClipTemplate(document: Pick<VideoEditDocument, 'templates'>, clip: Pick<VideoEditClip, 'code' | 'templateId'>): VideoEditProjectTemplate | undefined {
  return document.templates?.find(template => template.body.kind === 'code' ? template.body.definitionId === clip.code?.definitionId : template.id === clip.templateId)
}
/** 库里同一来源的版本更高时返回库版本。 */
export function newerLibraryTemplateVersion(template: Pick<VideoEditProjectTemplate, 'origin'>): number | null {
  const library = template.origin ? videoEditStyleLibrary.findTemplate(template.origin.id) : undefined
  return library && template.origin && library.template.version > template.origin.version ? library.template.version : null
}
function codeVersionHash(version: CodeMaterialVersion): Promise<string> { return videoEditTemplateContentHash({ kind: 'code', entry: version.entry, files: version.files.map(file => [file.path, file.hash]).sort(), imports: version.imports ?? [] }) }
function defaultVersion(document: VideoEditDocument, definitionId: string): CodeMaterialVersion {
  const definition = document.codeMaterials?.find(value => value.id === definitionId)
  const version = definition?.versions.find(value => value.id === definition.defaultVersionId)
  if (!definition || !version) throw new Error('模板的代码定义不存在。')
  return version
}
/** 模板所属风格的引用：工程风格副本优先，其次风格库。 */
function styleRef(document: Pick<VideoEditDocument, 'styles'>, styleId: string | null | undefined): { id: string; version: number } | null {
  if (!styleId) return null
  const style: VideoEditStyle | undefined = document.styles?.find(value => value.id === styleId) ?? videoEditStyleLibrary.findStyle(styleId)?.style
  if (!style) throw new Error(`NOT_FOUND：没有这个风格（${styleId}），请重新列出 video_edit.style 或 video_edit.project_style。`)
  return { id: style.id, version: style.version }
}

interface PreparedClip { clip: VideoEditClip; item?: VideoEditItem; layer: number }
/** 放置一组片段：落点默认播放头、最上层可用视频轨；多层组合按层数占用连续视频轨，轨道不够就新建。整组一步撤销。 */
function placeClips(owner: VideoEditInstance, document: VideoEditDocument, sequenceId: string, prepared: PreparedClip[], placement?: VideoEditDropPlacement): { document: VideoEditDocument; clipIds: string[] } {
  const sequence = document.sequences.find(value => value.id === sequenceId)
  if (!sequence) throw new Error('原模板落点序列不存在。')
  const frame = placement?.frame ?? (owner.activeSequenceId === sequenceId ? owner.frame : 0)
  const track = placement?.track ?? sequence.tracks.filter(value => value.kind === 'video' && !value.locked && value.enabled).sort((a, b) => b.index - a.index)[0]?.index
  const layers = [...new Set(prepared.map(entry => entry.layer))].sort((a, b) => a - b)
  const added = placement?.newTrack === 'video' ? videoEditEdgeTracks(sequence, 'video', layers.length) : []
  if (placement?.newTrack === 'audio' || (!added.length && track === undefined)) throw new Error('模板需要可用的视频轨道。')
  const base = added[0]?.index ?? track!
  const first = [...sequence.tracks, ...added].find(value => value.index === base)
  if (!first || first.kind !== 'video' || first.locked) throw new Error('模板目标轨道必须是未锁定的视频轨。')
  const lanes = [...sequence.tracks, ...added].filter(value => value.kind === 'video' && value.index >= base && !value.locked && (value.index === base || value.enabled)).sort((a, b) => a.index - b.index)
  if (lanes.length < layers.length) { const extra = videoEditEdgeTracks({ tracks: [...sequence.tracks, ...added] }, 'video', layers.length - lanes.length); added.push(...extra); lanes.push(...extra) }
  const trackMap = new Map(layers.map((layer, index) => [layer, lanes[index].index]))
  const items = [...document.items, ...prepared.flatMap(entry => entry.item ? [entry.item] : [])]
  const groupId = prepared.length > 1 ? newId() : undefined
  const clips = prepared.map(entry => ({ ...entry.clip, ...(groupId ? { groupId } : {}), start: frame + entry.clip.start, track: trackMap.get(entry.layer)! }))
  const withTracks = { ...document, items, sequences: document.sequences.map(value => value.id === sequenceId ? { ...value, tracks: [...value.tracks, ...added] } : value) }
  const target = withTracks.sequences.find(value => value.id === sequenceId)!
  const mode = placement?.mode ?? 'top'
  const resolved = resolveVideoEditDropMode(mode === 'top' ? { ...target, tracks: target.tracks.map(value => ({ ...value, locked: value.locked || !value.enabled })) } : target, clips, { frame, mode, targetTrackIds: owner.targetTrackIds })
  const result = applyVideoEditTimelineEditResult({ ...document, items }, sequenceId, { kind: 'place', mode: resolved.mode, frame: resolved.frame, clipboard: { projectId: owner.document.id, frameRate: sequence.frameRate, clips: resolved.clips, annotations: [] }, newTracks: [...added, ...resolved.newTracks], ...(resolved.mode === 'insert' ? { targetTracks: [...new Set(resolved.clips.map(clip => clip.track))] } : {}) })
  return { document: { ...withTracks, sequences: withTracks.sequences.map(value => value.id === sequenceId ? result.sequence : value) }, clipIds: result.selectedClipIds ?? [] }
}
function nativeClips(document: VideoEditDocument, sequence: VideoEditSequence, template: VideoEditProjectTemplate, options: { durationSeconds?: number; texts?: readonly string[] }): PreparedClip[] {
  if (template.body.kind !== 'native') throw new Error('不是原生模板。')
  return instantiateNativeTemplate(template.body.content, sequence, options).map(snapshot => {
    const itemId = newId()
    const item: VideoEditItem = { id: itemId, name: snapshot.name, kind: snapshot.kind, ...(snapshot.graphic ? { graphic: structuredClone(snapshot.graphic) } : {}) }
    const clip: VideoEditClip = { ...makeVideoEditItemClip({ ...document, items: [...document.items, item] }, itemId, sequence.id, { frame: snapshot.start, duration: snapshot.duration, track: sequence.tracks.find(value => value.kind === 'video')?.index }), ...snapshot, id: newId(), itemId, templateId: template.id }
    return { clip, item, layer: snapshot.track }
  })
}
function codeClip(owner: VideoEditInstance, document: VideoEditDocument, sequence: VideoEditSequence, definitionId: string, options: { durationSeconds?: number; parameters?: CodeParameterValues }): PreparedClip {
  const read = readVideoEditCodeMetadata(owner, document)
  const version = document.codeMaterials!.find(value => value.id === definitionId)!.defaultVersionId
  const existing = document.items.find(item => item.code?.definitionId === definitionId)
  const name = document.codeMaterials!.find(value => value.id === definitionId)!.name
  const item: VideoEditItem | undefined = existing ? undefined : { id: newId(), name, kind: 'code', code: { definitionId, versionId: version, parameters: {} } }
  const itemId = existing?.id ?? item!.id
  const scratch = { ...document, items: item ? [...document.items, item] : document.items }
  const video = sequence.tracks.find(value => value.kind === 'video' && !value.locked)?.index
  // 已有素材项可能停在旧版本：默认时长按模板当前使用的版本计算。
  const clip = makeVideoEditItemClip(scratch, itemId, sequence.id, { frame: 0, ...(video !== undefined ? { track: video } : {}) }, code => read({ ...code, versionId: version }))
  const program = read({ definitionId, versionId: version, parameters: {} })
  clip.code = { ...clip.code!, versionId: version, parameters: validateCodeMaterialParameters(program, { ...(existing?.code?.versionId === version ? existing.code.parameters : {}), ...options.parameters }) }
  if (options.durationSeconds) clip.duration = Math.max(1, Math.round(options.durationSeconds * videoEditFps(sequence.frameRate)))
  return { clip: { ...clip, id: newId(), start: 0 }, ...(item ? { item } : {}), layer: 0 }
}

export interface VideoEditTemplateApplyOptions { placement?: VideoEditDropPlacement; durationSeconds?: number; parameters?: CodeParameterValues; texts?: readonly string[] }
/** 应用模板：工程模板直接加实例（联动）；库模板第一次用进这个工程时先复制登记，之后复用同一份。整组一步撤销。 */
export async function applyVideoEditTemplate(projectId: string, sequenceId: string, scope: VideoEditTemplateScope, templateId: string, options: VideoEditTemplateApplyOptions = {}, signal?: AbortSignal): Promise<{ template: VideoEditProjectTemplate; clipIds: string[]; copied: boolean }> {
  logger.info('template.apply.start', '应用模板', { context: { projectId, sequenceId, scope } })
  try { return await templateOperation(projectId, async external => {
    const owner = requireVideoEditInstance(projectId)
    let template = scope === 'project' ? requireProjectTemplate(owner.document, templateId) : owner.document.templates?.find(value => value.origin?.id === templateId)
    let copied = false; let clipIds: string[] = []
    if (!template) {
      await videoEditStyleLibrary.ready()
      const library = videoEditStyleLibrary.requireTemplate(templateId).template; copied = true
      const meta = { id: newId(), name: library.name, description: library.description, version: 1, updatedAt: new Date().toISOString(), style: library.style, origin: { id: library.id, version: library.version } }
      if (library.body.kind === 'native') {
        const registered = videoEditProjectTemplateSchema.parse({ ...meta, contentHash: await videoEditTemplateContentHash(library.body), body: library.body })
        editVideoProject(projectId, document => {
          const next = { ...document, templates: [...(document.templates ?? []), registered] }
          const sequence = next.sequences.find(value => value.id === sequenceId); if (!sequence) throw new Error('原模板落点序列不存在。')
          const placed = placeClips(owner, next, sequenceId, nativeClips(next, sequence, registered, options), options.placement); clipIds = placed.clipIds; return placed.document
        })
        template = registered
      } else {
        const body = library.body; let registered: VideoEditProjectTemplate | undefined
        const placement = { frame: owner.activeSequenceId === sequenceId ? owner.frame : 0, ...options.placement }
        external()
        await createVideoEditPlacedCodeItems(projectId, [{ files: body.code.files, entry: body.code.entry, name: library.name, trustContext: library.foreign ? [library.foreign] : [] }], (document, itemIds) => {
          const item = document.items.find(value => value.id === itemIds[0])!
          registered = videoEditProjectTemplateSchema.parse({ ...meta, contentHash: '', body: { kind: 'code', definitionId: item.code!.definitionId } })
          const next = { ...document, templates: [...(document.templates ?? []), registered] }
          const sequence = next.sequences.find(value => value.id === sequenceId); if (!sequence) throw new Error('原模板落点序列不存在。')
          const placed = placeClips(owner, next, sequenceId, [codeClip(owner, next, sequence, item.code!.definitionId, { durationSeconds: options.durationSeconds ?? body.durationSeconds, parameters: options.parameters })], placement)
          clipIds = placed.clipIds; return placed.document
        }, signal)
        const hash = await codeVersionHash(defaultVersion(requireVideoEditInstance(projectId).document, (registered!.body as { definitionId: string }).definitionId))
        editVideoProject(projectId, document => ({ ...document, templates: document.templates!.map(value => value.id === registered!.id ? { ...value, contentHash: hash } : value) }))
        template = { ...registered!, contentHash: hash }
      }
    } else {
      const chosen = template
      await withVideoEditCodeMetadata(() => editVideoProject(projectId, document => {
        const sequence = document.sequences.find(value => value.id === sequenceId); if (!sequence) throw new Error('原模板落点序列不存在。')
        const prepared = chosen.body.kind === 'native' ? nativeClips(document, sequence, chosen, options) : [codeClip(owner, document, sequence, chosen.body.definitionId, options)]
        const placed = placeClips(owner, document, sequenceId, prepared, options.placement); clipIds = placed.clipIds; return placed.document
      }))
    }
    if (owner.activeSequenceId === sequenceId) setVideoEditView(projectId, { selection: clipIds[0] ?? null })
    logger.info('template.apply.completed', '模板已加到时间线', { context: { projectId, sequenceId, copied, count: clipIds.length } })
    return { template, clipIds, copied }
  }) } catch (error) { logger.error('template.apply.failed', '模板应用失败', { error, context: { projectId, sequenceId } }); throw error }
}

export interface VideoEditTemplateCreateOptions { name: string; description?: string; styleId?: string | null; global?: boolean }
/**
 * 把实战里做好的元素固化成模板：一个代码片段登记它的代码定义（源码不另存一份），一组文字图形片段登记成原生模板，
 * 原片段即成为第一个实例。global 时同时存进风格库，以后别的工程也能用。
 */
export function createVideoEditTemplate(projectId: string, sequenceId: string, clipIds: readonly string[], options: VideoEditTemplateCreateOptions): Promise<{ template: VideoEditProjectTemplate; library?: VideoEditTemplate }> {
  return templateOperation(projectId, async external => {
    const owner = requireVideoEditInstance(projectId); const document = owner.document
    const sequence = document.sequences.find(value => value.id === sequenceId)
    const clips = sequence?.clips.filter(clip => clipIds.includes(clip.id)) ?? []
    if (!sequence || !clips.length || clips.length !== new Set(clipIds).size) throw new Error('请选择原序列里要登记为模板的片段。')
    const code = clips.filter(clip => clip.code)
    if (code.length && clips.length > 1) throw new Error('代码模板一次只登记一个代码片段；文字与图形可以多个一起登记。')
    const existing = clips.map(clip => videoEditClipTemplate(document, clip)).find(Boolean)
    if (existing) throw new Error(`所选片段已经是模板“${existing.name}”的实例；要改它请用 update_video_edit_template，或先分离。`)
    const styleId = options.styleId === undefined ? sequence.styleId : options.styleId
    // 风格库按需读取：引用库里的风格或要存进风格库时先读完，任何写入之前就能判断风格在不在。
    if (options.global || styleId && !document.styles?.some(value => value.id === styleId)) await videoEditStyleLibrary.ready()
    const style = styleRef(document, styleId)
    const meta = { id: newId(), name: options.name, description: options.description ?? '', version: 1, updatedAt: new Date().toISOString(), style, origin: null }
    let template: VideoEditProjectTemplate
    if (code.length) {
      const definitionId = code[0].code!.definitionId
      template = videoEditProjectTemplateSchema.parse({ ...meta, contentHash: await codeVersionHash(defaultVersion(document, definitionId)), body: { kind: 'code', definitionId } })
      editVideoProject(projectId, current => ({ ...current, templates: [...(current.templates ?? []), template] }))
    } else {
      const content = captureNativeTemplateContent(sequence, clips)
      template = videoEditProjectTemplateSchema.parse({ ...meta, contentHash: await videoEditTemplateContentHash({ kind: 'native', content }), body: { kind: 'native', content } })
      editVideoProject(projectId, current => ({ ...current, templates: [...(current.templates ?? []), template], sequences: current.sequences.map(value => value.id === sequenceId ? { ...value, clips: value.clips.map(clip => clipIds.includes(clip.id) ? { ...clip, templateId: template.id } : clip) } : value) }))
    }
    logger.info('template.create.completed', '已登记工程模板', { context: { projectId, kind: template.body.kind } })
    if (!options.global) return { template }
    const promoted = await promoteTemplate(projectId, template.id, 'new', external)
    return { template: promoted.template, library: promoted.library }
  })
}

/** 工程模板设为全局：默认更新它的来源库模板，mode=new 另存为新的库模板。 */
export function promoteVideoEditTemplate(projectId: string, templateId: string, mode: 'update' | 'new' = 'update'): Promise<{ template: VideoEditProjectTemplate; library: VideoEditTemplate }> {
  return templateOperation(projectId, external => promoteTemplate(projectId, templateId, mode, external))
}
async function promoteTemplate(projectId: string, templateId: string, mode: 'update' | 'new', external: () => void): Promise<{ template: VideoEditProjectTemplate; library: VideoEditTemplate }> {
  await videoEditStyleLibrary.ready()
  const document = requireVideoEditInstance(projectId).document; const template = requireProjectTemplate(document, templateId)
  const body = template.body.kind === 'native' ? template.body : { kind: 'code' as const, code: portableCodeComponentFiles(codeMaterialSource(document, { definitionId: template.body.definitionId, versionId: defaultVersion(document, template.body.definitionId).id, parameters: {} }).compilation) }
  const target = mode === 'update' && template.origin ? videoEditStyleLibrary.findTemplate(template.origin.id)?.template : undefined
  const foreign = template.body.kind === 'code' ? defaultVersion(document, template.body.definitionId).foreign : undefined
  const draft = videoEditTemplateSchema.parse({ id: target?.id ?? newId(), name: template.name, description: template.description, foreign, version: target?.version ?? 1, contentHash: target?.contentHash ?? '', updatedAt: new Date().toISOString(), style: template.style, body })
  external()
  const saved = (await videoEditStyleLibrary.saveTemplate(draft)).template
  const next = { ...template, origin: { id: saved.id, version: saved.version } }
  editVideoProject(projectId, current => ({ ...current, templates: current.templates!.map(value => value.id === templateId ? next : value) }))
  logger.info('template.promote.completed', '工程模板已存进风格库', { context: { projectId, mode } })
  return { template: next, library: saved }
}

/** 按当前模板内容刷新原生模板的全部实例：每组保留落点、时长与已改的文字。 */
function refreshNativeInstances(document: VideoEditDocument, template: VideoEditProjectTemplate): VideoEditDocument {
  if (template.body.kind !== 'native') return document
  const content = template.body.content
  return { ...document, sequences: document.sequences.map(sequence => {
    const members = sequence.clips.filter(clip => clip.templateId === template.id)
    if (!members.length) return sequence
    const groups = new Map<string, VideoEditClip[]>()
    for (const clip of members) groups.set(clip.groupId ?? clip.id, [...groups.get(clip.groupId ?? clip.id) ?? [], clip])
    const replaced = new Set(members.map(clip => clip.id)); const added: VideoEditClip[] = []
    for (const [groupId, group] of groups) {
      assertVideoEditClipsEditable(sequence, group.map(clip => clip.id))
      const sorted = [...group].sort((a, b) => a.track - b.track || a.start - b.start)
      const start = Math.min(...group.map(clip => clip.start)); const base = Math.min(...group.map(clip => clip.track))
      const end = Math.max(...group.map(clip => clip.start + clip.duration))
      const snapshots: VideoEditNativeTemplateClip[] = instantiateNativeTemplate(content, sequence, { durationSeconds: (end - start) / videoEditFps(sequence.frameRate), texts: nativeTemplateTexts(sorted) })
      snapshots.forEach((snapshot, index) => {
        const previous = sorted[index]; const itemId = previous?.itemId ?? newId()
        added.push({ ...(previous ?? sorted[0]), ...snapshot, id: previous?.id ?? newId(), itemId, start: start + snapshot.start, track: base + snapshot.track, templateId: template.id, ...(snapshots.length > 1 ? { groupId } : {}) })
      })
    }
    return { ...sequence, clips: [...sequence.clips.filter(clip => !replaced.has(clip.id)), ...added] }
  }) }
}
/** 刷新后原生片段对应的素材项图形跟着更新（素材箱里看到的与时间线一致）。 */
function syncNativeItems(document: VideoEditDocument, templateId: string): VideoEditDocument {
  const graphics = new Map(document.sequences.flatMap(sequence => sequence.clips.filter(clip => clip.templateId === templateId).map(clip => [clip.itemId, clip] as const)))
  return { ...document, items: [...document.items.map(item => { const clip = graphics.get(item.id); return clip ? { ...item, name: clip.name, kind: clip.kind, ...(clip.graphic ? { graphic: structuredClone(clip.graphic) } : {}) } : item }), ...[...graphics].filter(([id]) => !document.items.some(item => item.id === id)).map(([id, clip]) => ({ id, name: clip.name, kind: clip.kind, ...(clip.graphic ? { graphic: structuredClone(clip.graphic) } : {}) }) as VideoEditItem)] }
}
function rebindCode(owner: VideoEditInstance, document: VideoEditDocument, definitionId: string, versionId: string, unreadable: ReadonlySet<string>): { document: VideoEditDocument; codeInstances: VideoEditCodeInstanceMigration[] } {
  const read = readVideoEditCodeMetadata(owner, document)
  const moved = retargetCodeMaterialInstances(document, definitionId, versionId, read({ definitionId, versionId, parameters: {} }), read, { unreadable })
  return { document: { ...moved.document, codeMaterials: moved.document.codeMaterials!.map(definition => definition.id === definitionId ? { ...definition, defaultVersionId: versionId } : definition) }, codeInstances: moved.instances.map(instance => videoEditCodeInstanceMigration(document.id, instance)) }
}

/** 换版本后给用户的一句话：去掉与恢复默认的参数各几个，按参数计、不按实例重复计；逐实例明细写日志。 */
export function videoEditCodeParameterChangeSummary(codeInstances: readonly VideoEditCodeInstanceMigration[]): string {
  const removed = new Set(codeInstances.flatMap(row => row.removedParameters)).size
  const reset = new Set(codeInstances.flatMap(row => row.resetParameters)).size
  return `${removed ? `，${removed} 个参数随新版本移除` : ''}${reset ? `，${reset} 个参数恢复默认` : ''}`
}
export type VideoEditTemplateUpdateSource ={ kind: 'version'; versionId: string } | { kind: 'clips'; sequenceId: string; clipIds: readonly string[] } | { kind: 'library' }
/**
 * 改模板内容并刷新全部联动实例（先说影响范围再调用）：代码模板换成该定义的另一个源码版本；原生模板按一组实例片段重新登记；
 * library 用库里的更新版本覆盖工程副本。内容变了版本加 1。
 */
export function updateVideoEditTemplate(projectId: string, templateId: string, source: VideoEditTemplateUpdateSource, signal?: AbortSignal): Promise<{ template: VideoEditProjectTemplate; instances: number; codeInstances: VideoEditCodeInstanceMigration[] }> {
  return templateOperation(projectId, async external => {
    // 局部副本：在本函数里重新赋值，类型收窄才能跟到后面的回调里。
    let content = source
    const owner = requireVideoEditInstance(projectId); let template = requireProjectTemplate(owner.document, templateId)
    logger.info('template.update.start', '更新模板并刷新实例', { context: { projectId, source: content.kind } })
    let origin = template.origin
    if (content.kind === 'library') {
      await videoEditStyleLibrary.ready()
      if (!template.origin) throw new Error('这个模板不是从风格库复制来的，没有可升级的来源。')
      const library = videoEditStyleLibrary.requireTemplate(template.origin.id).template
      if (library.body.kind !== template.body.kind) throw new Error('库模板与工程副本的类型不同，不能直接升级；请重新应用库模板。')
      origin = { id: library.id, version: library.version }
      if (library.body.kind === 'code') {
        external()
        const [versionId] = await createVideoEditCodeVersions(projectId, [{ definitionId: (template.body as { definitionId: string }).definitionId, files: library.body.code.files, entry: library.body.code.entry, trustContext: library.foreign ? [library.foreign] : [] }], signal).catch(async (error: unknown) => {
          if (readContentTrustFailure(error)) throw error
          // 源码与工程里已有的某个版本完全相同：直接改用那个版本。
          const match = await findSameVersion(requireVideoEditInstance(projectId).document, (template.body as { definitionId: string }).definitionId, library.body.kind === 'code' ? library.body.code : undefined)
          if (match) return [match]; throw error
        })
        content = { kind: 'version', versionId }
      } else template = { ...template, body: library.body }
    }
    if (content.kind === 'clips') {
      if (template.body.kind !== 'native') throw new Error('代码模板的内容就是它的代码定义：请创建新的源码版本，再用 source.kind=version 更新。')
      const sequence = owner.document.sequences.find(value => value.id === content.sequenceId); const clips = sequence?.clips.filter(clip => content.clipIds.includes(clip.id)) ?? []
      if (!sequence || clips.length !== content.clipIds.length || clips.some(clip => clip.templateId !== template.id)) throw new Error('请选择这个模板的一组实例片段作为新内容。')
      template = { ...template, body: { kind: 'native', content: captureNativeTemplateContent(sequence, clips) } }
    }
    const document = requireVideoEditInstance(projectId).document; const unreadable = new Set<string>()
    if (content.kind === 'version') {
      if (template.body.kind !== 'code') throw new Error('原生模板没有源码版本。')
      const definition = document.codeMaterials?.find(value => value.id === (template.body as { definitionId: string }).definitionId)
      const version = definition?.versions.find(value => value.id === content.versionId)
      if (!definition || !version) throw new Error('源码版本不属于这个模板的代码定义；先在这个定义下创建新版本。')
      for (const versionId of await ensureVideoEditRetargetMetadata(owner, document, definition.id, content.versionId, signal)) unreadable.add(versionId)
    }
    const body = template.body
    const hash = body.kind === 'code' && content.kind === 'version' ? await codeVersionHash(document.codeMaterials!.find(value => value.id === body.definitionId)!.versions.find(value => value.id === content.versionId)!) : await videoEditTemplateContentHash(body)
    const changed = hash !== template.contentHash
    const next = videoEditProjectTemplateSchema.parse({ ...template, origin, contentHash: hash, version: template.version + (changed ? 1 : 0), updatedAt: new Date().toISOString() })
    let instances = 0; let codeInstances: VideoEditCodeInstanceMigration[] = []
    // 等待期间新出现的版本引用在写入时才知道，读取中就等它读完再重试。
    await withVideoEditUnreadableCodeVersions(owner, unreadable, () => withVideoEditCodeMetadata(() => editVideoProject(projectId, current => {
      let value: VideoEditDocument = { ...current, templates: current.templates!.map(item => item.id === templateId ? next : item) }
      if (next.body.kind === 'code' && content.kind === 'version') ({ document: value, codeInstances } = rebindCode(owner, value, next.body.definitionId, content.versionId, unreadable))
      if (next.body.kind === 'native') value = syncNativeItems(refreshNativeInstances(value, next), next.id)
      instances = videoEditTemplateInstances(value, next).length
      return videoEditDocumentSchema.parse(value)
    })))
  logger.info('template.update.completed', '模板与联动实例已更新', { context: { projectId, instances, changed, codeInstances: codeInstances.filter(row => row.removedParameters.length || row.resetParameters.length || row.note) } })
  return { template: next, instances, codeInstances }
  })
}
async function findSameVersion(document: VideoEditDocument, definitionId: string, code: { entry: string; files: Record<string, string> } | undefined): Promise<string | undefined> {
  if (!code) return undefined
  const definition = document.codeMaterials?.find(value => value.id === definitionId)
  for (const version of definition?.versions ?? []) {
    const files = codeMaterialSource(document, { definitionId, versionId: version.id, parameters: {} }).contents
    if (files.entry === code.entry && JSON.stringify(Object.entries(files.files).sort()) === JSON.stringify(Object.entries(code.files).sort())) return version.id
  }
  return undefined
}

/** 分离：这些片段不再跟着模板变。原生片段去掉标记；代码片段复制成独立的代码定义并保留参数与关键帧。 */
export function detachVideoEditTemplateInstances(projectId: string, sequenceId: string, clipIds: readonly string[], signal?: AbortSignal): Promise<string[]> {
  return templateOperation(projectId, async external => {
    const owner = requireVideoEditInstance(projectId); const sequence = owner.document.sequences.find(value => value.id === sequenceId)
    const clips = sequence?.clips.filter(clip => clipIds.includes(clip.id)) ?? []
    if (!sequence || !clips.length || clips.length !== new Set(clipIds).size) throw new Error('请选择原序列里的模板实例。')
    assertVideoEditClipsEditable(sequence, [...clipIds])
    const linked = clips.map(clip => ({ clip, template: videoEditClipTemplate(owner.document, clip) }))
    if (linked.some(entry => !entry.template)) throw new Error('所选片段里有不属于任何模板的片段。')
    logger.info('template.detach.start', '分离模板实例', { context: { projectId, count: clips.length } })
    const native = linked.filter(entry => entry.template!.body.kind === 'native').map(entry => entry.clip.id)
    if (native.length) editVideoProject(projectId, document => ({ ...document, sequences: document.sequences.map(value => value.id === sequenceId ? { ...value, clips: value.clips.map(clip => native.includes(clip.id) ? (({ templateId: _templateId, ...rest }) => rest)(clip) : clip) } : value) }))
    for (const { clip } of linked.filter(entry => entry.template!.body.kind === 'code')) {
      const files = portableCodeComponentFiles(codeMaterialSource(requireVideoEditInstance(projectId).document, clip.code!).compilation)
      external()
      await createVideoEditPlacedCodeItems(projectId, [{ files: files.files, entry: files.entry, name: `${clip.name}（已分离）`, trustContext: codeMaterialSource(requireVideoEditInstance(projectId).document, clip.code!).compilation.trustContext }], (document, itemIds) => {
        const item = document.items.find(value => value.id === itemIds[0])!
        return { ...document, sequences: document.sequences.map(value => value.id === sequenceId ? { ...value, clips: value.clips.map(current => current.id === clip.id ? { ...current, itemId: item.id, name: item.name, code: { ...item.code!, parameters: current.code!.parameters, ...(current.code!.curves ? { curves: current.code!.curves } : {}) } } : current) } : value) }
      }, signal)
    }
    logger.info('template.detach.completed', '模板实例已分离', { context: { projectId, count: clips.length } })
    return [...clipIds]
  })
}

/** 取消登记：模板从工程里移除，代码与实例都保留（原生片段去掉联动标记）。 */
export function unregisterVideoEditTemplates(document: VideoEditDocument, templateIds: readonly string[]): VideoEditDocument {
  return { ...document, templates: (document.templates ?? []).filter(template => !templateIds.includes(template.id)), sequences: document.sequences.map(sequence => ({ ...sequence, clips: sequence.clips.map(clip => clip.templateId && templateIds.includes(clip.templateId) ? (({ templateId: _templateId, ...rest }) => rest)(clip) : clip) })) }
}
