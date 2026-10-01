import { createLogger } from '@/core/logging'
import { makeCodeMaterialDefinition } from '@/core/videoEdit/codeMaterialVersions'
import { validateCodeMaterialParameters } from '@/core/videoEdit/codeMaterial/parameters'
import { createVideoEditSequence, videoEditComposition, videoEditDocumentSchema } from '@/core/videoEdit/document'
import type { CodeMaterialMetadataReader } from '@/core/videoEdit/codeMaterialDocument'
import type { VideoEditDocument, VideoEditItem } from '@/core/videoEdit/document'
import type { CodeMaterialDefinition } from '@/core/videoEdit/codeMaterialPersistence'
import { compileVideoEditCode, forgetVideoEditCodeMetadata, rememberVideoEditCodeMetadata } from './videoEditCodeState'
import { editVideoProject, requireVideoEditInstance, listVideoEditInstances, subscribeVideoEditDomain } from './videoEditService'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { readVideoEditCodeMetadata } from './videoEditCodeState'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'

const logger = createLogger('features.videoEdit.code')
export interface VideoEditCodeInput { source: string; name?: string; binId?: string }
interface Candidate { definition: CodeMaterialDefinition; item: VideoEditItem }
let trialTail: Promise<void> = Promise.resolve()
let trials = 0
/** Trial uses the same full-resolution source/compiler/GPU path as preview and
 * export. Its bounded temporary session is always released before publication. */
async function trialCandidates(candidates: Candidate[], read: CodeMaterialMetadataReader, signal: AbortSignal): Promise<void> {
  if (trials >= 4) throw new Error('代码素材试渲染队列已满，请等待当前检查完成。')
  trials++
  const previous = trialTail
  let release!: () => void
  trialTail = new Promise<void>(resolve => { release = resolve })
  await previous
  let renderer: VideoEditRenderSession | undefined
  let expired = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  try {
    signal.throwIfAborted()
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(new Error('源码试渲染超过30秒，已释放候选；请重新检查。')) }, 30_000)
      abort = () => { expired = true; reject(signal.reason) }
      signal.addEventListener('abort', abort, { once: true })
    })
    const sequence = createVideoEditSequence('源码候选检查')
    const document: VideoEditDocument = { format: 'henji-video-project', version: 2, id: crypto.randomUUID(), name: sequence.name, revision: 0, media: [], bins: [], items: candidates.map(candidate => ({ ...candidate.item, binId: undefined })), codeMaterials: candidates.map(candidate => candidate.definition), sequences: [sequence] }
    for (const candidate of candidates) {
      const program = read(candidate.item.code!)
      sequence.width = program.width; sequence.height = program.height
      sequence.clips = [makeVideoEditItemClip(document, candidate.item.id, sequence.id, { frame: 0 }, read)]
      document.revision++
      const composition = videoEditComposition(document, sequence.id)
      if (!renderer) renderer = new VideoEditRenderSession(composition)
      else await Promise.race([renderer.updateDocument(composition), deadline])
      const frame = await Promise.race([renderer.present(0).then(frame => {
        if (expired || signal.aborted) { frame.bitmap?.close(); throw signal.reason ?? new Error('源码候选已失效。') }
        return frame
      }), deadline])
      try { if (!frame.presented || !frame.bitmap) throw new Error('源码候选没有生成可用画面。') }
      finally { frame.bitmap?.close() }
    }
  } finally {
    clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort)
    try { await renderer?.dispose() } finally { trials--; release() }
  }
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
