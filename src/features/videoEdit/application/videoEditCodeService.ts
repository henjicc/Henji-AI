import { createLogger } from '@/core/logging'
import { appendCodeMaterialVersion, makeCodeMaterialDefinition } from '@/core/videoEdit/codeMaterialVersions'
import { validateCodeMaterialParameters } from '@/core/videoEdit/codeMaterial/parameters'
import { createVideoEditSequence, videoEditComposition, videoEditDocumentSchema } from '@/core/videoEdit/document'
import type { CodeMaterialMetadataReader } from '@/core/videoEdit/codeMaterialDocument'
import type { VideoEditDocument, VideoEditItem } from '@/core/videoEdit/document'
import type { CodeMaterialDefinition } from '@/core/videoEdit/codeMaterialPersistence'
import { compileVideoEditCode, forgetVideoEditCodeMetadata, rememberVideoEditCodeMetadata } from './videoEditCodeState'
import { editVideoProject, requireVideoEditInstance, listVideoEditInstances, subscribeVideoEditDomain } from './videoEditService'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { readVideoEditCodeMetadata } from './videoEditCodeState'
import { trialVideoEditCodeFrames } from './videoEditCodeTrial'

const logger = createLogger('features.videoEdit.code')
export interface VideoEditCodeInput { source: string; name?: string; binId?: string }
export interface VideoEditCodeVersionInput { source: string; definitionId: string }
interface Candidate { definition: CodeMaterialDefinition; item: VideoEditItem }
/** Trial uses the same full-resolution source/compiler/GPU path as preview and
 * export. Its bounded temporary session is always released before publication. */
async function trialCandidates(candidates: Candidate[], read: CodeMaterialMetadataReader, signal: AbortSignal): Promise<void> {
  const sequence = createVideoEditSequence('源码候选检查')
  const document: VideoEditDocument = { format: 'henji-video-project', version: 2, id: crypto.randomUUID(), name: sequence.name, revision: 0, media: [], bins: [], items: candidates.map(candidate => ({ ...candidate.item, binId: undefined })), codeMaterials: candidates.map(candidate => candidate.definition), sequences: [sequence] }
  const frames = candidates.map(candidate => {
    const program = read(candidate.item.code!)
    sequence.width = program.width; sequence.height = program.height
    sequence.clips = [makeVideoEditItemClip(document, candidate.item.id, sequence.id, { frame: 0 }, read)]
    document.revision++
    return { document: videoEditComposition(structuredClone(document), sequence.id), frame: 0 }
  })
  await trialVideoEditCodeFrames(frames, signal)
}
/** Creation is an algorithmic collection operation: raw source is checked,
 * trial-rendered, then becomes one atomic domain edit. It never executes JS. */
export async function createVideoEditCodeItems(projectId: string, inputs: VideoEditCodeInput[], signal?: AbortSignal): Promise<string[]> {
  signal?.throwIfAborted()
  if (!inputs.length || inputs.length > 32) throw new Error('每次创建1到32个代码素材。')
  const owner = requireVideoEditInstance(projectId)
  const baseline = owner.document
  const controller = new AbortController()
  const cancel = (): void => { controller.abort(signal?.reason ?? new Error('代码素材创建已取消。')) }
  signal?.addEventListener('abort', cancel, { once: true })
  const unsubscribe = subscribeVideoEditDomain(() => {
    if (!listVideoEditInstances().includes(owner)) controller.abort(new Error('原工程已关闭，候选已取消。'))
    else if (owner.document !== baseline) controller.abort(new Error('检查期间工程已修改，候选已取消。'))
  })
  const candidates: Candidate[] = []
  logger.info('检查代码素材', { event: 'video_edit.code.create.start', context: { projectId, count: inputs.length } })
  try {
    for (const input of inputs) {
      const { definition, program } = await makeCodeMaterialDefinition(input.source, source => compileVideoEditCode(source, controller.signal))
      controller.signal.throwIfAborted()
      if (program.kind !== 'generator') throw new Error('输入滤镜应添加为效果，不能直接创建生成素材。')
      if (requireVideoEditInstance(projectId) !== owner) throw new Error('原工程已关闭，源码检查不会写入新会话。')
      if (input.name !== undefined) definition.name = input.name
      const item: VideoEditItem = { id: crypto.randomUUID(), name: input.name ?? program.name, kind: 'code', ...(input.binId ? { binId: input.binId } : {}), code: { definitionId: definition.id, versionId: definition.defaultVersionId, parameters: validateCodeMaterialParameters(program) } }
      candidates.push({ definition, item })
      rememberVideoEditCodeMetadata(owner, definition.id, definition.versions[0], program)
    }
    if (owner.document !== baseline) throw new Error('源码检查期间工程已修改，请重新检查候选。')
    const candidateDocument = videoEditDocumentSchema.parse({ ...baseline, codeMaterials: [...(baseline.codeMaterials ?? []), ...candidates.map(candidate => candidate.definition)], items: [...baseline.items, ...candidates.map(candidate => candidate.item)] })
    await trialCandidates(candidates, readVideoEditCodeMetadata(owner, candidateDocument), controller.signal)
    controller.signal.throwIfAborted()
    if (requireVideoEditInstance(projectId) !== owner) throw new Error('原工程已关闭，候选不会写入新会话。')
    if (owner.document !== baseline) throw new Error('试渲染期间工程已修改，请重新检查候选。')
    editVideoProject(projectId, document => ({ ...document, codeMaterials: [...(document.codeMaterials ?? []), ...candidates.map(candidate => candidate.definition)], items: [...document.items, ...candidates.map(candidate => candidate.item)] }))
    logger.info('代码素材已创建', { event: 'video_edit.code.create.completed', context: { projectId, count: candidates.length } })
    return candidates.map(candidate => candidate.item.id)
  } catch (error) {
    for (const candidate of candidates) forgetVideoEditCodeMetadata(owner, candidate.definition.defaultVersionId)
    logger.debug('代码素材检查未完成', { event: 'video_edit.code.create.failed', error, context: { projectId } })
    throw error
  } finally { unsubscribe(); signal?.removeEventListener('abort', cancel) }
}

/** Append checked immutable versions. Existing defaults, items and clips keep
 * their fixed bindings; an explicit domain property edit binds a new version. */
export async function createVideoEditCodeVersions(projectId: string, inputs: VideoEditCodeVersionInput[], signal?: AbortSignal): Promise<string[]> {
  signal?.throwIfAborted()
  if (!inputs.length || inputs.length > 32) throw new Error('每次创建1到32个源码版本。')
  const owner = requireVideoEditInstance(projectId); const baseline = owner.document
  const controller = new AbortController(); const cancel = (): void => controller.abort(signal?.reason ?? new Error('源码版本创建已取消。'))
  signal?.addEventListener('abort', cancel, { once: true })
  const off = subscribeVideoEditDomain(() => { if (!listVideoEditInstances().includes(owner) || owner.document !== baseline) controller.abort(new Error('原工程已关闭或内容已改变，候选已取消。')) })
  const definitions = new Map((baseline.codeMaterials ?? []).map(definition => [definition.id, definition])); const added: string[] = []; const trials: Candidate[] = []
  try {
    for (const input of inputs) {
      const definition = definitions.get(input.definitionId)
      if (!definition) throw new Error('代码素材定义不属于此工程。')
      const result = await appendCodeMaterialVersion(definition, input.source, source => compileVideoEditCode(source, controller.signal))
      controller.signal.throwIfAborted()
      if (result.program.kind !== 'generator') throw new Error('当前代码版本仅支持生成素材。')
      if (definition.versions.some(version => version.id === result.versionId)) throw new Error('相同源码版本已存在，请直接使用原版本。')
      definitions.set(definition.id, result.definition); added.push(result.versionId)
      rememberVideoEditCodeMetadata(owner, definition.id, result.definition.versions.find(version => version.id === result.versionId)!, result.program)
      trials.push({ definition: { ...result.definition, defaultVersionId: result.versionId }, item: { id: crypto.randomUUID(), kind: 'code', name: result.program.name, code: { definitionId: definition.id, versionId: result.versionId, parameters: validateCodeMaterialParameters(result.program) } } })
    }
    const document = videoEditDocumentSchema.parse({ ...baseline, codeMaterials: [...definitions.values()] })
    const read = readVideoEditCodeMetadata(owner, document)
    // Separate candidates may append to the same definition; each isolated
    // source trial avoids duplicate definitions while retaining one queue.
    for (const trial of trials) await trialCandidates([trial], read, controller.signal)
    controller.signal.throwIfAborted()
    if (requireVideoEditInstance(projectId) !== owner || owner.document !== baseline) throw new Error('源码版本检查期间原工程已改变。')
    editVideoProject(projectId, () => document)
    return added
  } catch (error) { added.forEach(version => forgetVideoEditCodeMetadata(owner, version)); throw error }
  finally { off(); signal?.removeEventListener('abort', cancel) }
}
