import { recordVideoEditPreparation } from './videoEditPreparationTiming'
import { readAuthorMetadataCache, writeAuthorMetadataCache } from './videoEditAuthorMetadataCache'
import { codeMediaFrameParameters } from '@/core/videoEdit/codeMediaInput'
import { isCodeImageReference } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeMaterialContext } from '@/core/videoEdit/codeMaterial/contract'
import { VideoEditRecordingCursorSource } from './videoEditRecordingCursorSource'
import { RECORDING_CURSOR_EFFECT, sampleRecordingCursor } from '@/core/videoEdit/recordingCursor'
import { recordingCursorDraws, type RecordingCursorRenderInput } from './videoEditRecordingCursorPlan'
import { evaluateRecordingZoom, RECORDING_ZOOM_EFFECT, recordingZoomParams, recordingZoomPointerSpans } from '@/core/videoEdit/recordingZoom'
import { RECORDING_FRAME_EFFECT } from '@/core/videoEdit/recordingFrame'
import { recordingFrameContent, recordingZoomDraw, type RecordingEffectsRenderInput } from './videoEditRecordingZoomPlan'
import { VideoEditRecordingZoomPointers } from './videoEditRecordingZoomSource'
import { evaluateVideoEditEffect } from '@/core/videoEdit/keyframes'
import { resolveVideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { expandPinnedCodeComponents } from '@/core/videoEdit/codeMaterial/components'
import { codeMaterialFilesKey, codeVersionContentKey, documentCodeSourceResolver, resolveCodeMaterialFiles, loadCodeSourceReferences } from '@/core/videoEdit/codeMaterial/sources'
import { documentFontRevision } from '@/platform/fontFaces'
import { createLogger } from '@/core/logging'
import { codeMaterialVersion as codeMaterialSource } from '@/core/videoEdit/codeMaterialDocument'
import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeParameterValues } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeAuthorProgram as CodeMaterialProgram } from '@/core/videoEdit/codeAuthorProgram'
import type { AuthorAssets, AuthorFrameInfo } from './videoEditAuthorModule'
import { evaluateCodeMaterialParameters, prepareCodeMaterialParameters } from '@/core/videoEdit/codeMaterialAnimation'
import type { PreparedCodeMaterialParameters } from '@/core/videoEdit/codeMaterialAnimation'
import type { CodeMaterialInstance } from '@/core/videoEdit/codeMaterialPersistence'
import { videoEditSourceSeconds } from '@/core/videoEdit/time'
import { videoEditClipSourceTimeAt } from '@/core/videoEdit/clipSpeed'
import { codeMaterialContextForFrame, codeMaterialContextForTransitionFrame, codeMaterialSize } from '@/core/videoEdit/codeMaterialTiming'
import type { CodeMotionClock } from '@/core/videoEdit/codeMaterial/motionSampling'
import type { CodeMaterialVersion } from '@/core/videoEdit/codeMaterialPersistence'
import { videoEditClipMedia, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { VideoEditCodeCompiler } from './videoEditCodeCompiler'
import type { VideoEditCodeGpu, VideoEditCodePicture } from './videoEditCodeGpu'
import type { VideoEditCodeImageInput } from './videoEditCodeGpu'
import { codeMaterialImageIds, codeMaterialUsesAudio } from '@/core/videoEdit/codeMaterialResources'
import { evaluateVideoEditGraphic, prepareVideoEditGraphic } from '@/core/videoEdit/graphics'
import type { PreparedVideoEditGraphic, VideoEditGraphic, VideoEditGraphicDraw } from '@/core/videoEdit/graphics'
import type { VideoEditBuiltinEffectInstance, VideoEditEffect } from '@/core/videoEdit/compositing'
import { activeVideoEditEffects, videoEditEffectCodes } from '@/core/videoEdit/compositing'
import type { VideoEditTransitionWindow } from '@/core/videoEdit/transitions'
import type { VideoEditSmartRegionMask } from './videoEditSmartRegionMasks'
import { videoEditTrackerResultKey } from './videoEditTrackResults'
import { videoEditEffectMask } from './videoEditEffectMasks'
import { videoEditClipPictureSize } from '@/core/videoEdit/clipGeometry'
import { evaluateCodeElementOverride } from '@/core/videoEdit/codeElementOverrides'
import { videoEditTextResolution } from './videoEditTextSurface'

const logger = createLogger('features.videoEdit.codeSources')
/** Soft cache budgets: the current frame's working set is pinned regardless of chain length. */
const CACHED_PROGRAMS = 32; const CACHED_PROGRAM_BYTES = 16 * 1024 ** 2
type CodeRuntime = Pick<VideoEditCodeGpu, 'authorGenerator' | 'inspectAuthor' | 'retainAuthorInstances' | 'observeAuthor' | 'releaseUnused'> & Partial<Pick<VideoEditCodeGpu, 'draw' | 'generatorTargetCapacity' | 'spillGeneratorTarget' | 'resetFramePerformance' | 'warmAuthor' | 'protectAuthorInstances'>>
type Compiler = Pick<VideoEditCodeCompiler, 'bundle' | 'dispose'> & Partial<Pick<VideoEditCodeCompiler, 'diagnostics'>>
interface KnownVersion { source: string; apiVersion: number; languageVersion: number; bytes: number }
interface CachedProgram { source: string; program: CodeMaterialProgram; bytes: number }
interface Plan { clip: VideoEditClip; key: string; static: boolean; program?: CodeMaterialProgram; draws?: VideoEditGraphicDraw[]; parameters: CodeParameterValues; context: ReturnType<typeof codeMaterialContextForFrame>; transitionHandles: boolean; motion?: CodeMotionClock }
export interface PreparedVideoEditCodeEffect { effect: VideoEditEffect; builtin?: undefined; version: string; instanceKey: string; info: AuthorFrameInfo; program: CodeMaterialProgram; parameters: CodeParameterValues; context: ReturnType<typeof codeMaterialContextForFrame>; transitionHandles: boolean }
/** 内置效果不需要编译源码，直接交给合成器的 GPU 实现（4.7）；`mask` 是这一帧的智能区域蒙版（4.7d）。 */
export interface PreparedVideoEditBuiltinEffect { effect: VideoEditEffect; builtin: VideoEditBuiltinEffectInstance & RecordingCursorRenderInput & RecordingEffectsRenderInput; mask?: VideoEditSmartRegionMask }
export type PreparedVideoEditEffect = PreparedVideoEditCodeEffect | PreparedVideoEditBuiltinEffect
export interface PreparedCodeSources { pictures: Map<string, VideoEditCodePicture | ImageBitmap>; effects: Map<string, PreparedVideoEditEffect[]>; sourceTimestamps: number[]; cacheHits: number }
export interface VideoEditCodePrepareOptions { preparationOnly?: boolean; transitions?: readonly VideoEditTransitionWindow[]; surfaceKeys?: ReadonlySet<string>; onEffectError?: (effect: VideoEditEffect, error: unknown) => void; audio?: (clip: VideoEditClip, program: CodeMaterialProgram, parameters: CodeParameterValues, signal: AbortSignal) => Promise<Pick<CodeMaterialContext, 'audio' | 'audioTime'>> }
function identity(definitionId: string, versionId: string): string { return JSON.stringify([definitionId, versionId]) }
function freezeProgram(program: CodeMaterialProgram): CodeMaterialProgram {
  const seen = new WeakSet<object>()
  const freeze = (value: unknown): void => {
    if (typeof value !== 'object' || value === null || seen.has(value)) return
    seen.add(value); Object.values(value).forEach(freeze); Object.freeze(value)
  }
  freeze(program); return program
}
/** Visible-code session only. Programs stay in memory; source remains the document truth. */
export class VideoEditCodeSources {
  private readonly cursorSources = new VideoEditRecordingCursorSource()
  private readonly zoomPointers = new VideoEditRecordingZoomPointers(this.cursorSources)
  private readonly known = new Map<string, KnownVersion>()
  private knownBytes = 0
  private readonly programs = new Map<string, CachedProgram>()
  private programBytes = 0
  private readonly staticPictures = new Map<string, VideoEditCodePicture | ImageBitmap>()
  private readonly targetPictures = new Map<string, VideoEditCodePicture | ImageBitmap>()
  private readonly spilledPictures = new Set<ImageBitmap>()
  private readonly parameters = new WeakMap<CodeMaterialInstance, { program: CodeMaterialProgram; prepared: PreparedCodeMaterialParameters }>()
  private readonly graphics = new WeakMap<VideoEditGraphic, PreparedVideoEditGraphic>()
  private runtime?: CodeRuntime
  private controller?: AbortController
  private epoch = 0
  private disposed = false
  private protectedKeys = new Set<string>()
  private gpuWork: Promise<void> = Promise.resolve()
  private releaseUnused(keys: ReadonlySet<string>): void {
    this.runtime?.releaseUnused(keys)
    for (const key of this.targetPictures.keys()) if (!keys.has(key)) this.targetPictures.delete(key)
    for (const [key, picture] of this.staticPictures) if (!keys.has(key)) { if (typeof ImageBitmap !== 'undefined' && picture instanceof ImageBitmap) picture.close(); this.staticPictures.delete(key) }
  }
  constructor(private document: VideoEditComposition, private readonly acquireRuntime: () => Promise<CodeRuntime>, private readonly compiler: Compiler = new VideoEditCodeCompiler(), private readonly onAheadHit?: () => void) { this.checkVersions(document) }
  private checkVersions(document: VideoEditComposition): void {
    const additions = new Map<string, KnownVersion>(); let bytes = this.knownBytes
    for (const definition of document.codeMaterials ?? []) for (const version of definition.versions) {
      const key = identity(definition.id, version.id); const known = this.known.get(key) ?? additions.get(key)
      const source = codeVersionContentKey(version)
      if (known) {
        if (known.source !== source || known.apiVersion !== version.apiVersion || known.languageVersion !== version.languageVersion) throw new CodeMaterialError('COMPATIBILITY', '不可变代码版本被改写，请创建新版本。')
        continue
      }
      const size = new TextEncoder().encode(source).byteLength
      bytes += size
      additions.set(key, { source, apiVersion: version.apiVersion, languageVersion: version.languageVersion, bytes: size })
    }
    for (const [key, version] of additions) this.known.set(key, version)
    this.knownBytes = bytes
  }
  async replaceContent(document: VideoEditComposition): Promise<void> {
    this.cancel(); await this.gpuWork
    this.protectedKeys.clear(); this.releaseUnused(this.protectedKeys)
    for (const bitmap of this.spilledPictures) bitmap.close()
    this.spilledPictures.clear(); this.targetPictures.clear(); this.staticPictures.clear()
    // Versions belong to a document; a candidate from another owner may use the same ids.
    const previous = new Map(this.known)
    this.known.clear(); this.knownBytes = 0; this.checkVersions(document)
    for (const [key, cached] of this.programs) {
      const next = this.known.get(key); const old = previous.get(key)
      if (next && old && next.source === old.source && next.apiVersion === old.apiVersion && next.languageVersion === old.languageVersion) continue
      this.programs.delete(key); this.programBytes -= cached.bytes
    }
  }
  updateDocument(document: VideoEditComposition): void {
    if (this.disposed) throw new Error('代码素材源会话已关闭。')
    // 节目渲染器在序列间切换时沿用同一会话：代码素材定义与版本是项目级、不可变的，编译结果按版本缓存可直接复用；
    // 片段级的静态画面在下一次渲染时由 releaseUnused 按实际用到的键释放。
    this.checkVersions(document); this.cancel(); this.cursorSources.clear(); this.zoomPointers.clear(); this.document = document
  }
  /** The caller has established that immutable code versions and media did not change. */
  updateParameters(document: VideoEditComposition): void { this.cancel(); this.document = document }
  cancel(): void { this.epoch++; this.controller?.abort(); this.controller = undefined }
  private readonly preparedAhead = new Set<string>()
  /** 复用正式 program/inspect 入口，仅准备不可变版本，不进入 gpuWork 或取消正在呈现的帧。 */
  async prepareAhead(document: VideoEditComposition, clips: readonly VideoEditClip[], signal: AbortSignal): Promise<number> {
    const instances = clips.flatMap(clip => [...(clip.code ? [clip.code] : []), ...videoEditEffectCodes(activeVideoEditEffects(clip))])
    const pinned = new Set(instances.map(instance => identity(instance.definitionId, instance.versionId)))
    let prepared = 0
    for (const instance of instances) {
      signal.throwIfAborted()
      const key = identity(instance.definitionId, instance.versionId)
      if (this.programs.has(key)) continue
      const program = await this.program(key, codeMaterialSource(document, instance), signal, pinned)
      signal.throwIfAborted()
      await this.runtime!.inspectAuthor(program.bundle)
      signal.throwIfAborted()
      this.preparedAhead.add(key); prepared++
    }
    return prepared
  }
  private async program(key: string, version: CodeMaterialVersion, signal: AbortSignal, pinned: ReadonlySet<string>): Promise<CodeMaterialProgram> {
    signal.throwIfAborted()
    const cached = this.programs.get(key)
    if (cached) {
      // checkVersions validates immutable manifests at document updates. Do not
      // reread, parse module imports or serialize bundled libraries every frame.
      if (this.preparedAhead.delete(key)) this.onAheadHit?.()
      this.programs.delete(key); this.programs.set(key, cached); return cached.program
    }
    await loadCodeSourceReferences(version); signal.throwIfAborted()
    const resolver = documentCodeSourceResolver(); const files = expandPinnedCodeComponents(resolveCodeMaterialFiles(version, resolver), version.imports ?? [], resolver); const source = codeMaterialFilesKey(files)
    logger.debug('可见代码源码检查开始', { event: 'video_edit.code.compile.start', context: { sequenceId: this.document.id, version: key } })
    try {
      const started = performance.now()
      const bundle = await this.compiler.bundle(files, signal); signal.throwIfAborted()
      this.runtime ??= await this.acquireRuntime(); signal.throwIfAborted()
      const metadata = await readAuthorMetadataCache(source); signal.throwIfAborted()
      const program = metadata ? { ...metadata, bundle } : await this.runtime.inspectAuthor(bundle); signal.throwIfAborted()
      if (!metadata) writeAuthorMetadataCache(source, program)
      recordVideoEditPreparation('sourceCompilation', performance.now() - started)
      if (program.apiVersion !== version.apiVersion || program.languageVersion !== version.languageVersion) throw new CodeMaterialError('COMPATIBILITY', '代码源码协议与固定版本声明不一致。')
      const bytes = new TextEncoder().encode(source).byteLength + new TextEncoder().encode(JSON.stringify(program)).byteLength
      while (this.programs.size >= CACHED_PROGRAMS || this.programBytes + bytes > CACHED_PROGRAM_BYTES) {
        const oldest = [...this.programs].find(([key]) => !pinned.has(key))
        if (!oldest) break
        this.programs.delete(oldest[0]); this.programBytes -= oldest[1].bytes
      }
      this.programs.set(key, { source, program: freezeProgram(program), bytes }); this.programBytes += bytes
      logger.debug('可见代码源码检查完成', { event: 'video_edit.code.compile.completed', context: { sequenceId: this.document.id, version: key } })
      return program
    } catch (error) {
      if (!signal.aborted) logger.warn('可见代码源码检查失败', { event: 'video_edit.code.compile.failed', error, context: { sequenceId: this.document.id, version: key } })
      throw error
    }
  }
  async prepare(document: VideoEditComposition, clips: VideoEditClip[], frame: number, shouldPresent: () => boolean, images?: Promise<ReadonlyMap<string, VideoEditCodeImageInput> | undefined>, options: VideoEditCodePrepareOptions = {}): Promise<PreparedCodeSources> {
    this.cancel(); const epoch = this.epoch; const controller = new AbortController(); this.controller = controller
    // A decode can reject while source compilation is still pending.
    const imageOutcome = images ? Promise.allSettled([images]) : undefined
    const assertCurrent = (): void => { if (this.disposed || controller.signal.aborted || this.epoch !== epoch || this.document !== document || !shouldPresent()) throw new DOMException('旧代码画面已取消。', 'AbortError') }
    const plans: Plan[] = []; const keys = new Set<string>(options.surfaceKeys)
    const effects = new Map<string, PreparedVideoEditEffect[]>()
    const pinned = new Set(clips.flatMap(clip => [...(clip.code ? [clip.code] : []), ...videoEditEffectCodes(activeVideoEditEffects(clip))].map(instance => identity(instance.definitionId, instance.versionId))))
    const transitionByClip = new Map(options.transitions?.flatMap(window => [[window.left.id, window], [window.right.id, window]] as const))
    const animated = async (clip: VideoEditClip, instance: CodeMaterialInstance, program: CodeMaterialProgram): Promise<Pick<Plan, 'context' | 'parameters' | 'transitionHandles' | 'motion'>> => {
      let animation = this.parameters.get(instance)
      if (!animation || animation.program !== program) { animation = { program, prepared: prepareCodeMaterialParameters(program, instance) }; this.parameters.set(instance, animation) }
      const window = transitionByClip.get(clip.id)
      const context = window ? codeMaterialContextForTransitionFrame(clip, frame, document.frameRate, program, window, document) : codeMaterialContextForFrame(clip, frame, document.frameRate, program, document)
      const parameters = evaluateCodeMaterialParameters(animation.prepared, videoEditClipSourceTimeAt(clip, frame - clip.start, document.frameRate, Boolean(window) && program.mode === 'static'))
      Object.assign(context, await options.audio?.(clip, program, parameters, controller.signal)); assertCurrent()
      const motion = undefined
      return { context, parameters: codeMediaFrameParameters(clip, parameters), transitionHandles: Boolean(window), ...(motion ? { motion } : {}) }
    }
    try {
      for (const clip of clips) {
        assertCurrent()
        const chain: PreparedVideoEditEffect[] = []
        for (const effect of activeVideoEditEffects(clip)) {
          if (effect.builtin?.id === RECORDING_CURSOR_EFFECT) {
            const source = videoEditClipMedia(document, clip)?.recordingCursor
            if (!source) throw new Error('此素材没有光标事件日志，请从录制会话创建屏幕片段。')
            const params = resolveVideoEditBuiltinParams(evaluateVideoEditEffect(effect, frame - clip.start).builtin!)
            const timeUs = videoEditSourceSeconds(videoEditClipSourceTimeAt(clip, frame - clip.start, document.frameRate, transitionByClip.has(clip.id))) * 1_000_000 + source.recordingStartUs
            const events = await this.cursorSources.window(source, timeUs, Number(params.hide_after), controller.signal); assertCurrent()
            const sample = sampleRecordingCursor(events, timeUs, { smoothing: Number(params.smoothing), hideAfterSeconds: Number(params.hide_after), cursorBakedIn: source.cursorBakedIn })
            chain.push({ effect, builtin: { ...effect.builtin, cursorDraws: recordingCursorDraws(sample, source, clip, document, params) } })
            continue
          }
          if (effect.builtin?.id === RECORDING_ZOOM_EFFECT) {
            // 区间按源时间求值（与光标同一时间基准）；跟随区间的指针按全局网格分块读取，没有日志时镜头停在画面中央。
            const source = videoEditClipMedia(document, clip)?.recordingCursor
            const params = recordingZoomParams(resolveVideoEditBuiltinParams(evaluateVideoEditEffect(effect, frame - clip.start).builtin!))
            const regions = effect.builtin.regions ?? []
            const sourceUs = videoEditSourceSeconds(videoEditClipSourceTimeAt(clip, frame - clip.start, document.frameRate, transitionByClip.has(clip.id))) * 1_000_000
            const spans = recordingZoomPointerSpans(regions, sourceUs, params)
            const pointer = source && spans.length ? await this.zoomPointers.pointer(source, spans, controller.signal) : () => null
            assertCurrent()
            const zoom = recordingZoomDraw(evaluateRecordingZoom(regions, sourceUs, params, pointer), clip, document)
            chain.push({ effect, builtin: { ...effect.builtin, ...(zoom ? { zoom } : {}) } })
            continue
          }
          if (effect.builtin?.id === RECORDING_FRAME_EFFECT) { chain.push({ effect, builtin: { ...effect.builtin, frameContent: recordingFrameContent(clip, document) } }); continue }
          if (effect.builtin) {
            if (!effect.mask) { chain.push({ effect, builtin: effect.builtin }); continue }
            // 作用区域（4.7d 智能区域、4.10 手绘遮罩）：智能区域还没分析好时先不画这个效果；导出前会等分析完成。
            const mask = await this.regionMask(document, clip, effect.mask, frame); assertCurrent()
            if (mask) chain.push({ effect, builtin: effect.builtin, mask })
            continue
          }
          if (!effect.code) continue
          try {
            const key = identity(effect.code.definitionId, effect.code.versionId)
            const program = await this.program(key, codeMaterialSource(document, effect.code), controller.signal, pinned); assertCurrent()
            if (program.kind !== 'filter') throw new CodeMaterialError('TYPE', '附加效果必须使用单输入滤镜源码。')
            const animation = await animated(clip, effect.code, program)
            chain.push({ effect, version: key, instanceKey: `${clip.id}:${effect.id}`, info: { audio: animation.context.audio, audioTime: animation.context.audioTime, time: animation.context.time, frameDuration: 1 / document.fps, clip: { time: animation.context.localTime, duration: clip.duration / document.fps } }, program, ...animation })
          } catch (error) {
            assertCurrent()
            if (!options.onEffectError) throw error
            options.onEffectError(effect, error)
          }
        }
        if (chain.length) effects.set(clip.id, chain)
        if (clip.kind === 'graphic') {
          if (!clip.graphic) throw new CodeMaterialError('COMPATIBILITY', '图形片段缺少结构化对象。')
          let prepared = this.graphics.get(clip.graphic)
          if (!prepared) { prepared = prepareVideoEditGraphic(clip.graphic); this.graphics.set(clip.graphic, prepared) }
          const time = videoEditClipSourceTimeAt(clip, frame - clip.start, document.frameRate, transitionByClip.has(clip.id))
          const draws = evaluateVideoEditGraphic(prepared, time)
          const moving = prepared.objects.some(object => object.parameters.curves.size > 0)
          const target = moving ? `graphic:dynamic:${clip.id}` : `graphic:static:${JSON.stringify([prepared.width, prepared.height, draws, draws.some(draw => draw.textStyle) ? documentFontRevision() : 0, videoEditTextResolution(Math.min(document.width / prepared.width, document.height / prepared.height) * clip.scale)])}`
          keys.add(target)
          plans.push({ clip, key: target, static: !moving, draws, parameters: {}, transitionHandles: transitionByClip.has(clip.id), context: { width: prepared.width, height: prepared.height, time: time.sourceInUs / 1e6 + time.sourceRemainder.numerator / time.sourceRemainder.denominator / 1e6, localTime: (frame - clip.start) / document.fps, sequenceTime: frame / document.fps, frame, fps: document.fps } })
          continue
        }
        if (clip.kind !== 'code') continue
        if (!clip.code) throw new CodeMaterialError('COMPATIBILITY', '代码片段缺少固定源码实例。')
        const version = codeMaterialSource(document, clip.code)
        const key = identity(clip.code.definitionId, clip.code.versionId)
        const program = await this.program(key, version, controller.signal, pinned); assertCurrent()
        if (program.kind !== 'generator') throw new CodeMaterialError('TYPE', '单输入滤镜不能作为生成片段渲染。')
        const { parameters, context, transitionHandles, motion } = await animated(clip, clip.code, program)
        const imageSources = [...codeMaterialImageIds(clip.code)].map(id => { const media = document.media.find(media => media.id === id && ['image', 'video'].includes(media.kind)); if (!media) throw new Error('代码图片引用不存在。'); return [id, media.path, media.sourceRevision, media.width, media.height] })
        const sourceTime = videoEditClipSourceTimeAt(clip, frame - clip.start, document.frameRate, transitionHandles && program.mode === 'static')
        const overrideValues = clip.elementOverrides ? Object.fromEntries(Object.entries(clip.elementOverrides).map(([id, value]) => [id, evaluateCodeElementOverride(value, sourceTime)])) : undefined
        const isStatic = program.mode === 'static' && !codeMaterialUsesAudio(program) && !Object.values(clip.code.parameters).some(value => isCodeImageReference(value) && value.kind !== 'image')
        const target = isStatic ? `code:static:${JSON.stringify([key, parameters, imageSources, documentFontRevision(), overrideValues])}` : `code:dynamic:${clip.id}`
        keys.add(target)
        plans.push({ clip, key: target, static: isStatic, program, parameters, context, transitionHandles, ...(motion ? { motion } : {}) })
      }
      assertCurrent(); if (!options.preparationOnly) this.protectedKeys = keys
      const result: PreparedCodeSources = { pictures: new Map(), effects, sourceTimestamps: plans.map(plan => plan.context.time), cacheHits: 0 }
      // Serialize GPU mutations, including a generator whose readiness resolves after cancellation.
      const work = this.gpuWork.then(async () => {
        assertCurrent()
        if (plans.length || effects.size || keys.size) { this.runtime ??= await this.acquireRuntime(); assertCurrent() }
        if (options.preparationOnly) {
          for (const plan of plans) {
            assertCurrent()
            if (plan.program) await this.runtime?.inspectAuthor(plan.program.bundle)
          }
          for (const chain of effects.values()) for (const effect of chain) {
            assertCurrent()
            if (!effect.builtin) await this.runtime?.inspectAuthor(effect.program.bundle)
          }
          return
        }
        this.runtime?.resetFramePerformance?.()
        const outcome = (await imageOutcome)?.[0]
        if (outcome?.status === 'rejected') throw outcome.reason
        const inputs = outcome?.status === 'fulfilled' ? outcome.value : undefined; assertCurrent()
        await this.runtime?.retainAuthorInstances(new Set([...plans.filter(plan => plan.program).map(plan => plan.clip.id), ...[...effects.values()].flatMap(chain => chain.flatMap(effect => effect.builtin ? [] : [effect.instanceKey]))]))
        this.releaseUnused(keys)
        for (const bitmap of this.spilledPictures) bitmap.close()
        this.spilledPictures.clear()
        const resident = this.targetPictures
        const capacity = Math.min(...plans.map(plan => this.runtime?.generatorTargetCapacity?.(plan.context.width, plan.context.height) ?? Infinity))
        for (const plan of plans) {
          assertCurrent()
          let picture = plan.static ? this.staticPictures.get(plan.key) : undefined
          if (picture) result.cacheHits++
          else {
            while (resident.size >= capacity && this.runtime?.spillGeneratorTarget) {
              const [oldKey, oldPicture] = resident.entries().next().value!
              const bitmap = await this.runtime.spillGeneratorTarget(oldKey)
              this.spilledPictures.add(bitmap); resident.delete(oldKey); this.staticPictures.delete(oldKey)
              for (const [id, value] of result.pictures) if (value === oldPicture) result.pictures.set(id, bitmap)
              assertCurrent()
            }
            if (plan.draws) {
              if (!this.runtime!.draw) throw new Error('当前GPU会话不支持结构化图形绘制。')
              picture = await this.runtime!.draw(plan.key, plan.context.width, plan.context.height, plan.draws, undefined, Math.min(document.width / plan.context.width, document.height / plan.context.height) * plan.clip.scale)
            } else {
              const assets: Record<string, CanvasImageSource> = {}
              for (const [name, value] of Object.entries(plan.parameters)) if (isCodeImageReference(value)) {
                const input = inputs?.get(value.mediaId)
                if (!input?.source) throw new Error(`作者图片参数 ${name} 没有可绘制的源画面。`)
                assets[name] = input.source
              }
              const sourceTime = videoEditClipSourceTimeAt(plan.clip, frame - plan.clip.start, document.frameRate, plan.transitionHandles && plan.program!.mode === 'static')
              const overrides = plan.clip.elementOverrides ? Object.fromEntries(Object.entries(plan.clip.elementOverrides).map(([id, value]) => [id, evaluateCodeElementOverride(value, sourceTime)])) : undefined
              picture = await this.runtime!.authorGenerator(plan.key, plan.clip.id, plan.program!, plan.context, plan.parameters, assets satisfies AuthorAssets, { audio: plan.context.audio, audioTime: plan.context.audioTime, time: plan.context.time, frameDuration: 1 / document.fps, clip: { time: plan.context.localTime, duration: plan.clip.duration / document.fps } }, overrides, document.motionBlur === true)
            }
            assertCurrent()
            if (plan.static) this.staticPictures.set(plan.key, picture)
          }
          resident.delete(plan.key); resident.set(plan.key, picture)
          result.pictures.set(plan.clip.id, picture)
        }
      })
      this.gpuWork = work.catch(() => { if (!options.preparationOnly) this.releaseUnused(this.protectedKeys) })
      await work; assertCurrent(); return result
    } catch (error) {
      // File I/O can fail before the serialized GPU work starts. Drop this frame's
      // retained pictures without touching a newer frame's protected working set.
      if (imageOutcome && (this.controller === controller || !this.controller)) { this.protectedKeys = new Set(); this.releaseUnused(this.protectedKeys) }
      throw error
    } finally { if (this.controller === controller) this.controller = undefined }
  }
  /** 片段在这一帧的作用区域蒙版（智能区域按素材时间取分析结果，手绘遮罩按几何栅格化）；读取失败只记日志，效果按未就绪跳过。 */
  private async regionMask(document: VideoEditComposition, clip: VideoEditClip, mask: NonNullable<VideoEditEffect['mask']>, frame: number): Promise<VideoEditSmartRegionMask | undefined> {
    const media = videoEditClipMedia(document, clip)
    const visual = media && (media.kind === 'video' || media.kind === 'image') ? media : undefined
    const timeUs = !visual || visual.kind === 'image' ? 0 : Math.round(videoEditSourceSeconds(videoEditClipSourceTimeAt(clip, frame - clip.start, document.frameRate, true)) * 1e6)
    const pathTimeUs = videoEditSourceSeconds(videoEditClipSourceTimeAt(clip, frame - clip.start, document.frameRate, true)) * 1e6
    try { return await videoEditEffectMask(mask, { trackerKeys: Object.fromEntries((clip.trackers ?? []).map(tracker => [tracker.id, videoEditTrackerResultKey(document, clip, media?.id ?? '', tracker)])), mediaUrl: visual?.path, picture: videoEditClipPictureSize(document, clip), timeUs, pathTimeUs }) } catch (error) {
      logger.warn('作用区域蒙版读取失败', { event: 'video_edit.smart_region.mask_failed', error, context: { sequenceId: document.id, clipId: clip.id, region: mask.regionId } })
      return undefined
    }
  }
  observeElements(frame: number): import('@/core/videoEdit/codeAuthorProgram').CodeAuthorFrameObservation {
    const clips = this.document.clips.flatMap(clip => {
      if (!clip.code || clip.kind !== 'code' || frame < clip.start || frame >= clip.start + clip.duration) return []
      const program = this.programs.get(identity(clip.code.definitionId, clip.code.versionId))?.program
      if (!program) return []
      return [{ clipId: clip.id, versionId: clip.code.versionId, ...codeMaterialSize(program, this.document), elements: this.runtime?.observeAuthor(clip.id) ?? [] }]
    })
    return { sequenceId: this.document.id, revision: this.document.revision, frame, clips }
  }
  diagnostics() { return { programs: this.programs.size, programBytes: this.programBytes, staticPictures: this.staticPictures.size, seenVersions: this.known.size, seenManifestBytes: this.knownBytes, compiler: this.compiler.diagnostics?.() } }
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true; this.cursorSources.clear(); this.zoomPointers.clear(); this.cancel(); this.compiler.dispose(); this.protectedKeys.clear()
    await Promise.allSettled([this.gpuWork])
    this.spilledPictures.forEach(bitmap => bitmap.close()); this.spilledPictures.clear(); this.targetPictures.clear()
    try { this.runtime?.releaseUnused(new Set()) }
    finally { for (const picture of this.staticPictures.values()) if (typeof ImageBitmap !== 'undefined' && picture instanceof ImageBitmap) picture.close(); this.programs.clear(); this.programBytes = 0; this.staticPictures.clear(); this.known.clear(); this.knownBytes = 0 }
  }
}
