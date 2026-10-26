import { changedCodeMaterialVersions } from '@/core/videoEdit/codeMaterialDocument'
import { ensureVideoEditChangedCodeMetadata } from './videoEditCodeState'
import type { CodeFramePerformance } from '@/core/videoEdit/codeMaterial/performance'
import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { withVideoEditCurrentMetadata, editVideoProject, requireVideoEditInstance, listVideoEditInstances, subscribeVideoEditDomain } from './videoEditService'
import { VIDEO_EDIT_DOCUMENT_VERSION } from '@/core/persistence/schemaVersions'
import { importAssetCodeComponents, discardProjectCodeComponents, discardVideoEditCodeFiles } from './videoEditCodeStorage'
import { assetCodeSourceResolver, rememberCodeAssetSources } from '@/core/videoEdit/codeAsset'
import { prepareCodeVersionPublication } from './videoEditCodeStorage'
import { addressCodeMaterialFiles, loadCodeSourceReferences, codeFilesFromInput, componentFileReferences, verifyCodeSourceReferences, documentCodeSourceResolver, resolveCodeMaterialFiles, type CodeFileReference } from '@/core/videoEdit/codeMaterial/sources'
import { createLogger } from '@/core/logging'
import { appendCodeMaterialVersion, makeCodeMaterialDefinition } from '@/core/videoEdit/codeMaterialVersions'
import { validateCodeMaterialParameters } from '@/core/videoEdit/codeMaterial/parameters'
import { isCodeImageReference, isCodeAudioReference } from '@/core/videoEdit/codeMaterial/contract'
import { createVideoEditSequence, videoEditComposition, videoEditDocumentSchema } from '@/core/videoEdit/document'
import type { CodeMaterialMetadataReader } from '@/core/videoEdit/codeMaterialDocument'
import type { VideoEditDocument, VideoEditItem, VideoEditComposition, VideoEditMedia } from '@/core/videoEdit/document'
import type { CodeMaterialDefinition, CodeMaterialInstance } from '@/core/videoEdit/codeMaterialPersistence'
import type { CodeAuthorProgram as CodeMaterialProgram } from '@/core/videoEdit/codeAuthorProgram'
import { createVideoEditGraphic } from '@/core/videoEdit/graphics'
import { compileVideoEditCode, forgetVideoEditCodeMetadata, rememberVideoEditCodeMetadata } from './videoEditCodeState'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { readVideoEditCodeMetadata } from './videoEditCodeState'
import { trialVideoEditCodeFrames, videoEditCodeValidationFrames } from './videoEditCodeTrial'
import { validateCodeMaterialDocument } from '@/core/videoEdit/codeMaterialDocument'
import { codeMaterialInstanceSchema } from '@/core/videoEdit/codeMaterialPersistence'
import { prepareCodeMaterialParameters } from '@/core/videoEdit/codeMaterialAnimation'
import type { CodeAsset } from '@/core/videoEdit/codeAsset'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { codeMaterialSize } from '@/core/videoEdit/codeMaterialTiming'
import type { CodeTypeCheckReport } from '@/core/videoEdit/codeMaterial/typeDiagnostics'
import { settleVideoEditCodeTypeChecks, startVideoEditCodeTypeCheck, withVideoEditCodeTypeContext } from './videoEditCodeTypeCheck'

const logger = createLogger('features.videoEdit.code')
export interface VideoEditCodeInput { source?: string; files?: Record<string, string>; entry?: string; name?: string; binId?: string }
export interface VideoEditCodeVersionInput { source?: string; files?: Record<string, string>; entry?: string; definitionId: string }
interface Candidate { definition: CodeMaterialDefinition; item: VideoEditItem; filter?: CodeMaterialInstance }
interface CodeAssetPublication {
  asset: CodeAsset; media: VideoEditMedia[]; mediaIds: ReadonlyMap<string, string>; origin: { assetId: string; contentIdentity: string }
  filterTarget?: { sequenceId: string; clipId: string }
  afterImport?: (document: VideoEditDocument, itemIds: string[]) => VideoEditDocument
  beforePublish(): Promise<void>
}
function candidate(definition: CodeMaterialDefinition, program: CodeMaterialProgram, input: { name?: string; binId?: string }, initial?: Pick<CodeMaterialInstance, 'parameters' | 'curves'>, host = createVideoEditSequence()): Candidate {
  const code = codeMaterialInstanceSchema.parse({ definitionId: definition.id, versionId: definition.defaultVersionId, parameters: validateCodeMaterialParameters(program, initial?.parameters), ...(initial?.curves ? { curves: initial.curves } : {}) })
  prepareCodeMaterialParameters(program, code)
  const name = input.name ?? program.name
  if (program.kind === 'generator') return { definition, item: { id: crypto.randomUUID(), name, kind: 'code', ...(input.binId ? { binId: input.binId } : {}), code } }
  if (input.binId) throw new Error('滤镜从效果控件使用，不属于素材箱。')
  const size = codeMaterialSize(program, host)
  const graphic = createVideoEditGraphic('solid', size.width, size.height); graphic.objects[0].parameters.fill = [1, 1, 1, 1]
  // The graphic is only an isolated trial input. Filters publish a definition,
  // never a fake generating item or a stored duplicate of the input image.
  return { definition, item: { id: crypto.randomUUID(), name, kind: 'graphic', graphic }, filter: code }
}
/** Trial uses the same full-resolution source/compiler/GPU path as preview and
 * export. Its bounded temporary session is always released before publication. */
function candidateFrames(candidates: Candidate[], read: CodeMaterialMetadataReader, media: VideoEditMedia[] = [], endpoints = false, host = createVideoEditSequence()): Array<{ document: VideoEditComposition; frame: number }> {
  const sequence = { ...createVideoEditSequence('源码候选检查'), width: host.width, height: host.height, frameRate: host.frameRate }
  const document: VideoEditDocument = { format: 'henji-video-project', version: VIDEO_EDIT_DOCUMENT_VERSION, id: crypto.randomUUID(), name: sequence.name, revision: 0, media, bins: [], items: candidates.map(candidate => ({ ...candidate.item, binId: undefined })), codeMaterials: candidates.map(candidate => candidate.definition), sequences: [sequence] }
  const frames = candidates.flatMap(candidate => {
    const program = read(candidate.filter ?? candidate.item.code!)
    Object.assign(sequence, codeMaterialSize(program, sequence))
    const clip = makeVideoEditItemClip(document, candidate.item.id, sequence.id, { frame: 0 }, read)
    if (candidate.filter) {
      if (program.mode === 'dynamic' && program.durationSeconds !== undefined) clip.duration = Math.min(clip.duration, Math.max(1, Math.floor(program.durationSeconds * host.frameRate.numerator / host.frameRate.denominator)))
      clip.effects = [{ id: crypto.randomUUID(), name: candidate.item.name, enabled: true, amount: 1, code: candidate.filter }]
    }
    sequence.clips = [clip]
    document.revision++
    const composition = videoEditComposition(structuredClone(document), sequence.id)
    return endpoints && clip.duration > 1 ? [{ document: composition, frame: 0 }, { document: composition, frame: clip.duration - 1 }] : [{ document: composition, frame: 0 }]
  })
  return frames
}
/** Exercise examples through the same timeline path without publishing a project. */
export async function trialVideoEditAuthorSource(source: Parameters<typeof addressCodeMaterialFiles>[0], program: CodeMaterialProgram, signal: AbortSignal): Promise<void> {
  const { codeSources: _texts, ...manifest } = await addressCodeMaterialFiles(source)
  const versionId = crypto.randomUUID()
  const definition: CodeMaterialDefinition = { id: crypto.randomUUID(), name: program.name, defaultVersionId: versionId, versions: [{ id: versionId, ...manifest, apiVersion: 4, languageVersion: 4 }] }
  const samples = candidateFrames([candidate(definition, program, {})], () => program, [], true)
  if (samples.length > 1) samples.splice(1, 0, { ...samples[0], frame: Math.floor(samples.at(-1)!.frame / 2) })
  await trialVideoEditCodeFrames(samples, signal)
}
/** Creation is an algorithmic collection operation: raw source is checked,
 * executed in the render worker, trial-rendered, then becomes one atomic domain edit.
 * `typeReports` opts into author type checking: it runs beside bundling and the trial,
 * never blocks publication, and receives one report per input after the edit is committed. */
async function createCheckedMaterials(projectId: string, inputs: VideoEditCodeInput[], expectedKind: 'generator' | 'filter' | undefined, signal?: AbortSignal, publication?: CodeAssetPublication, afterCreate?: (document: VideoEditDocument, itemIds: string[]) => VideoEditDocument, measurements?: CodeFramePerformance[], typeReports?: CodeTypeCheckReport[]): Promise<Candidate[]> {
  signal?.throwIfAborted()
  if (!inputs.length) throw new Error('请提供要创建的代码素材。')
  const owner = requireVideoEditInstance(projectId)
  const baseline = owner.document; const contentVersion = owner.contentVersion
  const controller = new AbortController()
  const cancel = (): void => { controller.abort(signal?.reason ?? new Error('代码素材创建已取消。')) }
  signal?.addEventListener('abort', cancel, { once: true })
  const unsubscribe = subscribeVideoEditDomain(() => {
    if (!listVideoEditInstances().includes(owner)) controller.abort(new Error('原剪辑已关闭，候选已取消。'))
    else if (!isVideoEditContentCurrent(owner, contentVersion)) controller.abort(new Error('检查期间剪辑已修改，候选已取消。'))
  })
  const candidates: Candidate[] = []; const createdFiles: CodeFileReference[] = []
  // 类型检查不随创建取消信号结束：提交本身会改变剪辑内容并触发上面的取消订阅。
  const typeAbort = new AbortController(); const typeChecks: Array<Promise<CodeTypeCheckReport>> = []
  logger.info('检查代码素材', { event: 'video_edit.code.create.start', context: { projectId, count: inputs.length } })
  try {
    for (const input of inputs) {
      const contents = codeFilesFromInput(input)
      const publicationState = await prepareCodeVersionPublication(projectId, contents, input.name, publication?.asset.sourceVersion.imports, createdFiles)
      const typeCheck = typeReports ? startVideoEditCodeTypeCheck(contents, publicationState.imports, typeAbort.signal) : undefined
      if (typeCheck) typeChecks.push(typeCheck)
      const { definition, program } = await withVideoEditCodeTypeContext(() => makeCodeMaterialDefinition(contents, source => compileVideoEditCode(source, controller.signal), publicationState), typeCheck ? [typeCheck] : [], controller.signal)
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
        for (const [key, value] of Object.entries(parameters)) if (isCodeImageReference(value) && value.kind !== 'sequence' || isCodeAudioReference(value)) {
          const mediaId = publication.mediaIds.get(value.mediaId)
          if (!mediaId) throw new Error('代码资产媒体依赖未完成映射。')
          parameters[key] = { ...value, mediaId }
        }
        initial = { parameters, ...(publication.asset.curves ? { curves: structuredClone(publication.asset.curves) } : {}) }
      }
      const checked = candidate(definition, program, publication && program.kind === 'filter' ? { name: input.name } : input, initial, baseline.sequences.find(sequence => sequence.id === owner.activeSequenceId))
      if (publication?.asset.elementOverrides) {
        if (program.kind !== 'generator') throw new Error('元素覆盖需要代码生成素材。')
        checked.item.elementOverrides = structuredClone(publication.asset.elementOverrides)
      }
      candidates.push(checked)
      rememberVideoEditCodeMetadata(owner, definition.id, definition.versions[0], program)
    }
    if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('源码检查期间剪辑已修改，请重新检查候选。')
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
      await ensureVideoEditChangedCodeMetadata(owner, baseline, candidateDocument, controller.signal)
      validateCodeMaterialDocument(candidateDocument, readVideoEditCodeMetadata(owner, candidateDocument), changedCodeMaterialVersions(baseline, candidateDocument))
      filterTrial = videoEditCodeValidationFrames(candidateDocument, [{ ...target, effectIds: [effect.id] }], { sequenceId: sequence.id, frame: Math.max(clip.start, Math.min(clip.start + clip.duration - 1, owner.frame)) })
    }
    if (publication?.afterImport) candidateDocument = videoEditDocumentSchema.parse(publication.afterImport(candidateDocument, items.map(item => item.id)))
    if (afterCreate) candidateDocument = videoEditDocumentSchema.parse(afterCreate(candidateDocument, items.map(item => item.id)))
    const read = readVideoEditCodeMetadata(owner, candidateDocument)
    await ensureVideoEditChangedCodeMetadata(owner, baseline, candidateDocument, controller.signal)
    validateCodeMaterialDocument(candidateDocument, read, changedCodeMaterialVersions(baseline, candidateDocument))
    const placements = publication || afterCreate ? candidateDocument.sequences.flatMap(sequence => sequence.clips.filter(clip => items.some(item => item.id === clip.itemId)).map(clip => ({ sequenceId: sequence.id, clipId: clip.id }))) : []
    const frames = placements.length ? videoEditCodeValidationFrames(candidateDocument, placements, { sequenceId: placements[0].sequenceId, frame: candidateDocument.sequences.find(sequence => sequence.id === placements[0].sequenceId)!.clips.find(clip => clip.id === placements[0].clipId)!.start }) : candidateFrames(candidates, read, candidateDocument.media, Boolean(publication), owner.document.sequences.find(sequence => sequence.id === owner.activeSequenceId))
    await withVideoEditCodeTypeContext(() => trialVideoEditCodeFrames(filterTrial ?? frames, controller.signal, false, undefined, measurements), typeChecks, controller.signal)
    if (publication) await publication.beforePublish()
    controller.signal.throwIfAborted()
    if (requireVideoEditInstance(projectId) !== owner) throw new Error('原剪辑已关闭，候选不会写入新会话。')
    if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('试渲染期间剪辑已修改，请重新检查候选。')
    editVideoProject(projectId, current => withVideoEditCurrentMetadata(candidateDocument, current))
    logger.info('代码素材已创建', { event: 'video_edit.code.create.completed', context: { projectId, count: candidates.length } })
  } catch (error) {
    typeAbort.abort()
    await discardVideoEditCodeFiles(createdFiles)
    for (const candidate of candidates) forgetVideoEditCodeMetadata(owner, candidate.definition.defaultVersionId)
    logger.debug('代码素材检查未完成', { event: 'video_edit.code.create.failed', error, context: { projectId } })
    throw error
  } finally { unsubscribe(); signal?.removeEventListener('abort', cancel) }
  // 已提交：类型结论只作诊断，等不到也不改变创建结果。
  if (typeReports) typeReports.push(...await settleVideoEditCodeTypeChecks(typeChecks))
  return candidates
}
export async function createVideoEditCodeItems(projectId: string, inputs: VideoEditCodeInput[], signal?: AbortSignal): Promise<string[]> {
  return (await createCheckedMaterials(projectId, inputs, 'generator', signal)).map(candidate => candidate.item.id)
}
/** Domain composition: creation and placement share the source trial and one undo boundary. */
export async function createVideoEditPlacedCodeItems(projectId: string, inputs: VideoEditCodeInput[], afterCreate: (document: VideoEditDocument, itemIds: string[]) => VideoEditDocument, signal?: AbortSignal): Promise<string[]> {
  return (await createCheckedMaterials(projectId, inputs, 'generator', signal, undefined, afterCreate)).map(candidate => candidate.item.id)
}
/** General source creation publishes trusted generator or filter definitions. */
export async function createVideoEditCodeMaterials(projectId: string, inputs: VideoEditCodeInput[], signal?: AbortSignal, measurements?: CodeFramePerformance[], typeReports?: CodeTypeCheckReport[]): Promise<string[]> {
  return (await createCheckedMaterials(projectId, inputs, undefined, signal, undefined, undefined, measurements, typeReports)).map(candidate => candidate.definition.id)
}
/** Effect authoring refuses a generator before any project publication. */
export async function createVideoEditFilterMaterials(projectId: string, inputs: VideoEditCodeInput[], signal?: AbortSignal): Promise<string[]> {
  return (await createCheckedMaterials(projectId, inputs, 'filter', signal)).map(candidate => candidate.definition.id)
}

/** Asset imports reuse the source creation transaction with a complete instance. */
export async function createVideoEditCodeAssetInstance(projectId: string, publication: CodeAssetPublication, binId?: string, signal?: AbortSignal): Promise<{ definitionId: string; itemId?: string }> {
  await verifyCodeSourceReferences({ files: [...publication.asset.sourceVersion.files, ...componentFileReferences(publication.asset.sourceVersion.imports)] }, assetCodeSourceResolver(publication.asset))
  publication = { ...publication, asset: await importAssetCodeComponents(projectId, publication.asset, signal) }
  try {
  rememberCodeAssetSources(publication.asset)
  signal?.throwIfAborted()
  const created = (await createCheckedMaterials(projectId, [{ ...resolveCodeMaterialFiles(publication.asset.sourceVersion, assetCodeSourceResolver(publication.asset)), name: publication.asset.name, ...(binId ? { binId } : {}) }], undefined, signal, publication))[0]
  return { definitionId: created.definition.id, ...(!created.filter ? { itemId: created.item.id } : {}) }
  } catch (error) {
    // Compensate the entire import batch so referenced dependencies remain protected.
    const components = publication.asset.sourceVersion.imports ?? []
    const flattened = (pins: typeof components): typeof components => pins.flatMap(pin => [...flattened(pin.imports), pin])
    await discardProjectCodeComponents(flattened(components)); throw error
  }
}

/** Append checked immutable versions. Existing defaults, items and clips keep
 * their fixed bindings; an explicit domain property edit binds a new version. */
export async function createVideoEditCodeVersions(projectId: string, inputs: VideoEditCodeVersionInput[], signal?: AbortSignal, measurements?: CodeFramePerformance[], typeReports?: CodeTypeCheckReport[]): Promise<string[]> {
  signal?.throwIfAborted()
  if (!inputs.length) throw new Error('请提供要创建的源码版本。')
  const owner = requireVideoEditInstance(projectId); const baseline = owner.document; const contentVersion = owner.contentVersion
  const controller = new AbortController(); const cancel = (): void => controller.abort(signal?.reason ?? new Error('源码版本创建已取消。'))
  signal?.addEventListener('abort', cancel, { once: true })
  const off = subscribeVideoEditDomain(() => { if (!isVideoEditContentCurrent(owner, contentVersion)) controller.abort(new Error('原剪辑已关闭或内容已改变，候选已取消。')) })
  const definitions = new Map((baseline.codeMaterials ?? []).map(definition => [definition.id, definition])); const added: string[] = []; const trials: Candidate[] = []; const createdFiles: CodeFileReference[] = []
  // 同 createCheckedMaterials：类型检查与打包、试渲染并行，提交后才收结果。
  const typeAbort = new AbortController(); const typeChecks: Array<Promise<CodeTypeCheckReport>> = []
  try {
    for (const input of inputs) {
      const definition = definitions.get(input.definitionId)
      if (!definition) throw new Error('代码素材定义不属于此剪辑。')
      await loadCodeSourceReferences(definition.versions.find(version => version.id === definition.defaultVersionId)!)
      const contents = codeFilesFromInput(input)
      const publicationState = await prepareCodeVersionPublication(projectId, contents, undefined, undefined, createdFiles)
      const typeCheck = typeReports ? startVideoEditCodeTypeCheck(contents, publicationState.imports, typeAbort.signal) : undefined
      if (typeCheck) typeChecks.push(typeCheck)
      const result = await withVideoEditCodeTypeContext(() => appendCodeMaterialVersion(definition, contents, source => compileVideoEditCode(source, controller.signal), documentCodeSourceResolver(), publicationState), typeCheck ? [typeCheck] : [], controller.signal)
      controller.signal.throwIfAborted()
      if (definition.versions.some(version => version.id === result.versionId)) throw new Error('相同源码版本已存在，请直接使用原版本。')
      definitions.set(definition.id, result.definition); added.push(result.versionId)
      rememberVideoEditCodeMetadata(owner, definition.id, result.definition.versions.find(version => version.id === result.versionId)!, result.program)
      trials.push(candidate({ ...result.definition, defaultVersionId: result.versionId }, result.program, {}))
    }
    const document = videoEditDocumentSchema.parse({ ...baseline, codeMaterials: [...definitions.values()] })
    await ensureVideoEditChangedCodeMetadata(owner, baseline, document, controller.signal)
    const read = readVideoEditCodeMetadata(owner, document)
    // Separate candidates may append to the same definition; each isolated
    // source trial avoids duplicate definitions while retaining one queue.
    await withVideoEditCodeTypeContext(() => trialVideoEditCodeFrames(trials.flatMap(trial => candidateFrames([trial], read, [], false, owner.document.sequences.find(sequence => sequence.id === owner.activeSequenceId))), controller.signal, false, undefined, measurements), typeChecks, controller.signal)
    controller.signal.throwIfAborted()
    if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('源码版本检查期间原剪辑已改变。')
    editVideoProject(projectId, current => withVideoEditCurrentMetadata(document, current))
  } catch (error) { typeAbort.abort(); await discardVideoEditCodeFiles(createdFiles); added.forEach(version => forgetVideoEditCodeMetadata(owner, version)); throw error }
  finally { off(); signal?.removeEventListener('abort', cancel) }
  if (typeReports) typeReports.push(...await settleVideoEditCodeTypeChecks(typeChecks))
  return added
}
