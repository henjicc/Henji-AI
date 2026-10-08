import { createLogger } from '@/core/logging'
import { appendCodeMaterialVersion, makeCodeMaterialDefinition } from '@/core/videoEdit/codeMaterialVersions'
import { validateCodeMaterialParameters } from '@/core/videoEdit/codeMaterial/parameters'
import { isCodeImageReference } from '@/core/videoEdit/codeMaterial/contract'
import { createVideoEditSequence, videoEditComposition, videoEditDocumentSchema } from '@/core/videoEdit/document'
import type { CodeMaterialMetadataReader } from '@/core/videoEdit/codeMaterialDocument'
import type { VideoEditDocument, VideoEditItem, VideoEditComposition, VideoEditMedia } from '@/core/videoEdit/document'
import type { CodeMaterialDefinition, CodeMaterialInstance } from '@/core/videoEdit/codeMaterialPersistence'
import type { CodeMaterialProgram } from '@/core/videoEdit/codeMaterial/contract'
import { createVideoEditGraphic } from '@/core/videoEdit/graphics'
import { compileVideoEditCode, forgetVideoEditCodeMetadata, rememberVideoEditCodeMetadata } from './videoEditCodeState'
import { editVideoProject, requireVideoEditInstance, listVideoEditInstances, subscribeVideoEditDomain } from './videoEditService'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { readVideoEditCodeMetadata } from './videoEditCodeState'
import { trialVideoEditCodeFrames, videoEditCodeValidationFrames } from './videoEditCodeTrial'
import { validateCodeMaterialDocument } from '@/core/videoEdit/codeMaterialDocument'
import { codeMaterialInstanceSchema } from '@/core/videoEdit/codeMaterialPersistence'
import { prepareCodeMaterialParameters } from '@/core/videoEdit/codeMaterialAnimation'
import type { CodeAsset } from '@/core/videoEdit/codeAsset'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'

const logger = createLogger('features.videoEdit.code')
export interface VideoEditCodeInput { source: string; name?: string; binId?: string }
export interface VideoEditCodeVersionInput { source: string; definitionId: string }
interface Candidate { definition: CodeMaterialDefinition; item: VideoEditItem; filter?: CodeMaterialInstance }
interface CodeAssetPublication {
  asset: CodeAsset; media: VideoEditMedia[]; mediaIds: ReadonlyMap<string, string>; origin: { assetId: string; contentIdentity: string }
  filterTarget?: { sequenceId: string; clipId: string }
  afterImport?: (document: VideoEditDocument, itemIds: string[]) => VideoEditDocument
  beforePublish(): Promise<void>
}
function candidate(definition: CodeMaterialDefinition, program: CodeMaterialProgram, input: { name?: string; binId?: string }, initial?: Pick<CodeMaterialInstance, 'parameters' | 'curves'>): Candidate {
  const code = codeMaterialInstanceSchema.parse({ definitionId: definition.id, versionId: definition.defaultVersionId, parameters: validateCodeMaterialParameters(program, initial?.parameters), ...(initial?.curves ? { curves: initial.curves } : {}) })
  prepareCodeMaterialParameters(program, code)
  const name = input.name ?? program.name
  if (program.kind === 'generator') return { definition, item: { id: crypto.randomUUID(), name, kind: 'code', ...(input.binId ? { binId: input.binId } : {}), code } }
  if (input.binId) throw new Error('滤镜从效果控件使用，不属于素材箱。')
  const graphic = createVideoEditGraphic('solid', program.width, program.height); graphic.objects[0].parameters.fill = [1, 1, 1, 1]
  // The graphic is only an isolated trial input. Filters publish a definition,
  // never a fake generating item or a stored duplicate of the input image.
  return { definition, item: { id: crypto.randomUUID(), name, kind: 'graphic', graphic }, filter: code }
}
/** Trial uses the same full-resolution source/compiler/GPU path as preview and
 * export. Its bounded temporary session is always released before publication. */
function candidateFrames(candidates: Candidate[], read: CodeMaterialMetadataReader, media: VideoEditMedia[] = [], endpoints = false): Array<{ document: VideoEditComposition; frame: number }> {
  const sequence = createVideoEditSequence('源码候选检查')
  const document: VideoEditDocument = { format: 'henji-video-project', version: 2, id: crypto.randomUUID(), name: sequence.name, revision: 0, media, bins: [], items: candidates.map(candidate => ({ ...candidate.item, binId: undefined })), codeMaterials: candidates.map(candidate => candidate.definition), sequences: [sequence] }
  const frames = candidates.flatMap(candidate => {
    const program = read(candidate.filter ?? candidate.item.code!)
    sequence.width = program.width; sequence.height = program.height
    const clip = makeVideoEditItemClip(document, candidate.item.id, sequence.id, { frame: 0 }, read)
    if (candidate.filter) {
      if (program.mode === 'dynamic') clip.duration = Math.min(clip.duration, Math.max(1, Math.floor(program.durationSeconds * 30)))
      clip.effects = [{ id: crypto.randomUUID(), name: candidate.item.name, enabled: true, amount: 1, code: candidate.filter }]
    }
    sequence.clips = [clip]
    document.revision++
    const composition = videoEditComposition(structuredClone(document), sequence.id)
    return endpoints && clip.duration > 1 ? [{ document: composition, frame: 0 }, { document: composition, frame: clip.duration - 1 }] : [{ document: composition, frame: 0 }]
  })
  return frames
}
/** Creation is an algorithmic collection operation: raw source is checked,
 * trial-rendered, then becomes one atomic domain edit. It never executes JS. */
async function createCheckedMaterials(projectId: string, inputs: VideoEditCodeInput[], expectedKind: 'generator' | 'filter' | undefined, signal?: AbortSignal, publication?: CodeAssetPublication, afterCreate?: (document: VideoEditDocument, itemIds: string[]) => VideoEditDocument): Promise<Candidate[]> {
  signal?.throwIfAborted()
  if (!inputs.length) throw new Error('请提供要创建的代码素材。')
  const owner = requireVideoEditInstance(projectId)
  const baseline = owner.document
  const controller = new AbortController()
  const cancel = (): void => { controller.abort(signal?.reason ?? new Error('代码素材创建已取消。')) }
  signal?.addEventListener('abort', cancel, { once: true })
  const unsubscribe = subscribeVideoEditDomain(() => {
    if (!listVideoEditInstances().includes(owner)) controller.abort(new Error('原剪辑已关闭，候选已取消。'))
    else if (owner.document !== baseline) controller.abort(new Error('检查期间剪辑已修改，候选已取消。'))
  })
  const candidates: Candidate[] = []
  logger.info('检查代码素材', { event: 'video_edit.code.create.start', context: { projectId, count: inputs.length } })
  try {
    for (const input of inputs) {
      const { definition, program } = await makeCodeMaterialDefinition(input.source, source => compileVideoEditCode(source, controller.signal))
      controller.signal.throwIfAborted()
      if (expectedKind === 'generator' && program.kind !== 'generator') throw new Error('输入滤镜应添加为效果，不能直接创建生成素材。')
      if (expectedKind === 'filter' && program.kind !== 'filter') throw new Error('效果源码需要声明为输入滤镜。')
      if (requireVideoEditInstance(projectId) !== owner) throw new Error('原剪辑已关闭，源码检查不会写入新会话。')
      if (input.name !== undefined) definition.name = input.name
      let initial: Pick<CodeMaterialInstance, 'parameters' | 'curves'> | undefined
      if (publication) {
        if (inputs.length !== 1 || program.apiVersion !== publication.asset.sourceVersion.apiVersion || program.languageVersion !== publication.asset.sourceVersion.languageVersion) throw new Error('代码资产固定源码与语言版本不一致。')
        definition.versions[0].assetOrigin = publication.origin
        const parameters = structuredClone(publication.asset.parameters)
        for (const [key, value] of Object.entries(parameters)) if (isCodeImageReference(value)) {
          const mediaId = publication.mediaIds.get(value.mediaId)
          if (!mediaId) throw new Error('代码资产图片依赖未完成映射。')
          parameters[key] = { kind: 'image', mediaId }
        }
        initial = { parameters, ...(publication.asset.curves ? { curves: structuredClone(publication.asset.curves) } : {}) }
      }
      const checked = candidate(definition, program, publication && program.kind === 'filter' ? { name: input.name } : input, initial)
      if (publication?.asset.elementOverrides) {
        if (program.kind !== 'generator' || program.languageVersion !== 3) throw new Error('元素覆盖需要第三版代码生成素材。')
        checked.item.elementOverrides = structuredClone(publication.asset.elementOverrides)
      }
      candidates.push(checked)
      rememberVideoEditCodeMetadata(owner, definition.id, definition.versions[0], program)
    }
    if (owner.document !== baseline) throw new Error('源码检查期间剪辑已修改，请重新检查候选。')
    const items = candidates.filter(candidate => !candidate.filter).map(candidate => candidate.item)
    let candidateDocument = videoEditDocumentSchema.parse({ ...baseline, media: [...baseline.media.map(media => publication?.media.find(incoming => incoming.id === media.id) ?? media), ...(publication?.media ?? []).filter(media => !baseline.media.some(existing => existing.id === media.id))], codeMaterials: [...(baseline.codeMaterials ?? []), ...candidates.map(candidate => candidate.definition)], items: [...baseline.items, ...items] })
    const filter = candidates.find(candidate => candidate.filter)
    let filterTrial: Array<{ document: VideoEditComposition; frame: number }> | undefined
    if (publication && filter) {
      const target = publication.filterTarget
      if (!target) throw new Error('请选择要应用此代码效果的片段。')
      const sequence = candidateDocument.sequences.find(sequence => sequence.id === target.sequenceId)
      const clip = sequence?.clips.find(clip => clip.id === target.clipId)
      if (!sequence || !clip || clip.kind === 'audio') throw new Error('代码效果需要原序列中的画面片段。')
      assertVideoEditClipsEditable(videoEditComposition(baseline, sequence.id), [clip.id])
      const effect = { id: crypto.randomUUID(), name: filter.definition.name, enabled: true, amount: 1, code: filter.filter! }
      clip.effects = [...(clip.effects ?? []), effect]
      validateCodeMaterialDocument(candidateDocument, readVideoEditCodeMetadata(owner, candidateDocument))
      filterTrial = videoEditCodeValidationFrames(candidateDocument, [{ ...target, effectIds: [effect.id] }], { sequenceId: sequence.id, frame: Math.max(clip.start, Math.min(clip.start + clip.duration - 1, owner.frame)) })
    }
    if (publication?.afterImport) candidateDocument = videoEditDocumentSchema.parse(publication.afterImport(candidateDocument, items.map(item => item.id)))
    if (afterCreate) candidateDocument = videoEditDocumentSchema.parse(afterCreate(candidateDocument, items.map(item => item.id)))
    const read = readVideoEditCodeMetadata(owner, candidateDocument)
    validateCodeMaterialDocument(candidateDocument, read)
    const placements = publication || afterCreate ? candidateDocument.sequences.flatMap(sequence => sequence.clips.filter(clip => items.some(item => item.id === clip.itemId)).map(clip => ({ sequenceId: sequence.id, clipId: clip.id }))) : []
    const frames = placements.length ? videoEditCodeValidationFrames(candidateDocument, placements, { sequenceId: placements[0].sequenceId, frame: candidateDocument.sequences.find(sequence => sequence.id === placements[0].sequenceId)!.clips.find(clip => clip.id === placements[0].clipId)!.start }) : candidateFrames(candidates, read, candidateDocument.media, Boolean(publication))
    await trialVideoEditCodeFrames(filterTrial ?? frames, controller.signal)
    if (publication) await publication.beforePublish()
    controller.signal.throwIfAborted()
    if (requireVideoEditInstance(projectId) !== owner) throw new Error('原剪辑已关闭，候选不会写入新会话。')
    if (owner.document !== baseline) throw new Error('试渲染期间剪辑已修改，请重新检查候选。')
    editVideoProject(projectId, () => candidateDocument)
    logger.info('代码素材已创建', { event: 'video_edit.code.create.completed', context: { projectId, count: candidates.length } })
    return candidates
  } catch (error) {
    for (const candidate of candidates) forgetVideoEditCodeMetadata(owner, candidate.definition.defaultVersionId)
    logger.debug('代码素材检查未完成', { event: 'video_edit.code.create.failed', error, context: { projectId } })
    throw error
  } finally { unsubscribe(); signal?.removeEventListener('abort', cancel) }
}
export async function createVideoEditCodeItems(projectId: string, inputs: VideoEditCodeInput[], signal?: AbortSignal): Promise<string[]> {
  return (await createCheckedMaterials(projectId, inputs, 'generator', signal)).map(candidate => candidate.item.id)
}
/** Domain composition: creation and placement share the source trial and one undo boundary. */
export async function createVideoEditPlacedCodeItems(projectId: string, inputs: VideoEditCodeInput[], afterCreate: (document: VideoEditDocument, itemIds: string[]) => VideoEditDocument, signal?: AbortSignal): Promise<string[]> {
  return (await createCheckedMaterials(projectId, inputs, 'generator', signal, undefined, afterCreate)).map(candidate => candidate.item.id)
}
/** General source creation publishes trusted generator or filter definitions. */
export async function createVideoEditCodeMaterials(projectId: string, inputs: VideoEditCodeInput[], signal?: AbortSignal): Promise<string[]> {
  return (await createCheckedMaterials(projectId, inputs, undefined, signal)).map(candidate => candidate.definition.id)
}
/** Effect authoring refuses a generator before any project publication. */
export async function createVideoEditFilterMaterials(projectId: string, inputs: VideoEditCodeInput[], signal?: AbortSignal): Promise<string[]> {
  return (await createCheckedMaterials(projectId, inputs, 'filter', signal)).map(candidate => candidate.definition.id)
}

/** Asset imports reuse the source creation transaction with a complete instance. */
export async function createVideoEditCodeAssetInstance(projectId: string, publication: CodeAssetPublication, binId?: string, signal?: AbortSignal): Promise<{ definitionId: string; itemId?: string }> {
  const created = (await createCheckedMaterials(projectId, [{ source: publication.asset.sourceVersion.source, name: publication.asset.name, ...(binId ? { binId } : {}) }], undefined, signal, publication))[0]
  return { definitionId: created.definition.id, ...(!created.filter ? { itemId: created.item.id } : {}) }
}

/** Append checked immutable versions. Existing defaults, items and clips keep
 * their fixed bindings; an explicit domain property edit binds a new version. */
export async function createVideoEditCodeVersions(projectId: string, inputs: VideoEditCodeVersionInput[], signal?: AbortSignal): Promise<string[]> {
  signal?.throwIfAborted()
  if (!inputs.length) throw new Error('请提供要创建的源码版本。')
  const owner = requireVideoEditInstance(projectId); const baseline = owner.document
  const controller = new AbortController(); const cancel = (): void => controller.abort(signal?.reason ?? new Error('源码版本创建已取消。'))
  signal?.addEventListener('abort', cancel, { once: true })
  const off = subscribeVideoEditDomain(() => { if (!listVideoEditInstances().includes(owner) || owner.document !== baseline) controller.abort(new Error('原剪辑已关闭或内容已改变，候选已取消。')) })
  const definitions = new Map((baseline.codeMaterials ?? []).map(definition => [definition.id, definition])); const added: string[] = []; const trials: Candidate[] = []
  try {
    for (const input of inputs) {
      const definition = definitions.get(input.definitionId)
      if (!definition) throw new Error('代码素材定义不属于此剪辑。')
      const result = await appendCodeMaterialVersion(definition, input.source, source => compileVideoEditCode(source, controller.signal))
      controller.signal.throwIfAborted()
      if (definition.versions.some(version => version.id === result.versionId)) throw new Error('相同源码版本已存在，请直接使用原版本。')
      definitions.set(definition.id, result.definition); added.push(result.versionId)
      rememberVideoEditCodeMetadata(owner, definition.id, result.definition.versions.find(version => version.id === result.versionId)!, result.program)
      trials.push(candidate({ ...result.definition, defaultVersionId: result.versionId }, result.program, {}))
    }
    const document = videoEditDocumentSchema.parse({ ...baseline, codeMaterials: [...definitions.values()] })
    const read = readVideoEditCodeMetadata(owner, document)
    // Separate candidates may append to the same definition; each isolated
    // source trial avoids duplicate definitions while retaining one queue.
    await trialVideoEditCodeFrames(trials.flatMap(trial => candidateFrames([trial], read)), controller.signal)
    controller.signal.throwIfAborted()
    if (requireVideoEditInstance(projectId) !== owner || owner.document !== baseline) throw new Error('源码版本检查期间原剪辑已改变。')
    editVideoProject(projectId, () => document)
    return added
  } catch (error) { added.forEach(version => forgetVideoEditCodeMetadata(owner, version)); throw error }
  finally { off(); signal?.removeEventListener('abort', cancel) }
}
