import '../application/videoEditCodeStorage'
import { expandPinnedCodeComponents } from '@/core/videoEdit/codeMaterial/components'
import { codeMaterialFilesKey, codeVersionContentKey, documentCodeSourceResolver, resolveCodeMaterialFiles, loadCodeSourceReferences } from '@/core/videoEdit/codeMaterial/sources'
import { documentFontRevision } from '@/platform/fontFaces'
import { createLogger } from '@/core/logging'
import { codeMaterialVersion as codeMaterialSource } from '@/core/videoEdit/codeMaterialDocument'
import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeMaterialProgram, CodeParameterValues } from '@/core/videoEdit/codeMaterial/contract'
import { evaluateCodeMaterialParameters, prepareCodeMaterialParameters } from '@/core/videoEdit/codeMaterialAnimation'
import type { PreparedCodeMaterialParameters } from '@/core/videoEdit/codeMaterialAnimation'
import type { CodeMaterialInstance } from '@/core/videoEdit/codeMaterialPersistence'
import { videoEditSourceSeconds } from '@/core/videoEdit/time'
import { videoEditClipSourceTimeAt } from '@/core/videoEdit/clipSpeed'
import { codeMaterialContextForFrame, codeMaterialContextForTransitionFrame } from '@/core/videoEdit/codeMaterialTiming'
import type { CodeMaterialVersion } from '@/core/videoEdit/codeMaterialPersistence'
import { videoEditClipMedia, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { VideoEditCodeCompiler } from './videoEditCodeCompiler'
import type { VideoEditCodeGpu, VideoEditCodePicture } from './videoEditCodeGpu'
import type { VideoEditCodeImageInput } from './videoEditCodeGpu'
import { codeMaterialImageIds } from '@/core/videoEdit/codeMaterialResources'
import { evaluateVideoEditGraphic, prepareVideoEditGraphic } from '@/core/videoEdit/graphics'
import type { PreparedVideoEditGraphic, VideoEditGraphic, VideoEditGraphicDraw } from '@/core/videoEdit/graphics'
import type { VideoEditBuiltinEffectInstance, VideoEditEffect } from '@/core/videoEdit/compositing'
import { activeVideoEditEffects, videoEditEffectCodes } from '@/core/videoEdit/compositing'
import type { VideoEditTransitionWindow } from '@/core/videoEdit/transitions'
import type { VideoEditSmartRegionMask } from './videoEditSmartRegionMasks'
import { videoEditTrackerKey } from '@/core/videoEdit/tracking'
import { videoEditEffectMask } from './videoEditEffectMasks'
import { videoEditClipPictureSize } from '@/core/videoEdit/clipGeometry'
import { DEFAULT_STYLE_TOKENS, resolveVideoEditStyleKit, styleKitRenderKey } from '@/core/videoEdit/styleKit'
import { bindCodeMaterialStyle } from '@/core/videoEdit/codeMaterial/style'
import { evaluateCodeElementOverride } from '@/core/videoEdit/codeElementOverrides'
import { videoEditTextResolution } from './videoEditTextSurface'

const logger = createLogger('features.videoEdit.codeSources')
/** Soft cache budgets: the current frame's working set is pinned regardless of chain length. */
const CACHED_PROGRAMS = 32; const CACHED_PROGRAM_BYTES = 16 * 1024 ** 2
type CodeRuntime = Pick<VideoEditCodeGpu, 'generator' | 'releaseUnused'> & Partial<Pick<VideoEditCodeGpu, 'draw' | 'retainProgramVersions'>>
type Compiler = Pick<VideoEditCodeCompiler, 'compile' | 'dispose'> & Partial<Pick<VideoEditCodeCompiler, 'diagnostics'>>
interface KnownVersion { source: string; apiVersion: number; languageVersion: number; bytes: number }
interface CachedProgram { source: string; program: CodeMaterialProgram; bytes: number }
interface Plan { clip: VideoEditClip; key: string; static: boolean; program?: CodeMaterialProgram; draws?: VideoEditGraphicDraw[]; parameters: CodeParameterValues; context: ReturnType<typeof codeMaterialContextForFrame>; transitionHandles: boolean }
export interface PreparedVideoEditCodeEffect { effect: VideoEditEffect; builtin?: undefined; version: string; program: CodeMaterialProgram; parameters: CodeParameterValues; context: ReturnType<typeof codeMaterialContextForFrame>; transitionHandles: boolean }
/** 内置效果不需要编译源码，直接交给合成器的 GPU 实现（4.7）；`mask` 是这一帧的智能区域蒙版（4.7d）。 */
export interface PreparedVideoEditBuiltinEffect { effect: VideoEditEffect; builtin: VideoEditBuiltinEffectInstance; mask?: VideoEditSmartRegionMask }
export type PreparedVideoEditEffect = PreparedVideoEditCodeEffect | PreparedVideoEditBuiltinEffect
export interface PreparedCodeSources { pictures: Map<string, VideoEditCodePicture | ImageBitmap>; effects: Map<string, PreparedVideoEditEffect[]>; sourceTimestamps: number[]; cacheHits: number }
export interface VideoEditCodePrepareOptions { transitions?: readonly VideoEditTransitionWindow[]; surfaceKeys?: ReadonlySet<string>; onEffectError?: (effect: VideoEditEffect, error: unknown) => void }
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
  private readonly known = new Map<string, KnownVersion>()
  private knownBytes = 0
  private readonly programs = new Map<string, CachedProgram>()
  private programBytes = 0
  private readonly staticPictures = new Map<string, VideoEditCodePicture | ImageBitmap>()
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
    for (const [key, picture] of this.staticPictures) if (!keys.has(key)) { if (typeof ImageBitmap !== 'undefined' && picture instanceof ImageBitmap) picture.close(); this.staticPictures.delete(key) }
  }
  constructor(private document: VideoEditComposition, private readonly acquireRuntime: () => Promise<CodeRuntime>, private readonly compiler: Compiler = new VideoEditCodeCompiler()) { this.checkVersions(document) }
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
  updateDocument(document: VideoEditComposition): void {
    if (this.disposed) throw new Error('代码素材源会话已关闭。')
    if (document.id !== this.document.id) throw new Error('代码素材源目标序列已改变。')
    this.checkVersions(document); this.cancel(); this.document = document
  }
  cancel(): void { this.epoch++; this.controller?.abort(); this.controller = undefined }
  private async program(key: string, version: CodeMaterialVersion, signal: AbortSignal, pinned: ReadonlySet<string>): Promise<CodeMaterialProgram> {
    await loadCodeSourceReferences(version); signal.throwIfAborted()
    const resolver = documentCodeSourceResolver(); const files = expandPinnedCodeComponents(resolveCodeMaterialFiles(version, resolver), version.imports ?? [], resolver); const source = codeMaterialFilesKey(files)
    const cached = this.programs.get(key)
    if (cached) {
      if (cached.source !== source) throw new CodeMaterialError('COMPATIBILITY', '不可变代码版本被改写，请创建新版本。')
      this.programs.delete(key); this.programs.set(key, cached); return cached.program
    }
    logger.debug('可见代码源码检查开始', { event: 'video_edit.code.compile.start', context: { sequenceId: this.document.id, version: key } })
    try {
      const program = await this.compiler.compile(files, signal); signal.throwIfAborted()
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
    const animated = (clip: VideoEditClip, instance: CodeMaterialInstance, program: CodeMaterialProgram): Pick<Plan, 'context' | 'parameters' | 'transitionHandles'> => {
      let animation = this.parameters.get(instance)
      if (!animation || animation.program !== program) { animation = { program, prepared: prepareCodeMaterialParameters(program, instance) }; this.parameters.set(instance, animation) }
      const window = transitionByClip.get(clip.id)
      const context = window ? codeMaterialContextForTransitionFrame(clip, frame, document.frameRate, program, window) : codeMaterialContextForFrame(clip, frame, document.frameRate, program)
      context.style = resolveVideoEditStyleKit(document, document, clip)?.tokens ?? DEFAULT_STYLE_TOKENS
      const parameters = evaluateCodeMaterialParameters(animation.prepared, videoEditClipSourceTimeAt(clip, frame - clip.start, document.frameRate, Boolean(window) && program.mode === 'static'))
      return { context, parameters, transitionHandles: Boolean(window) }
    }
    try {
      for (const clip of clips) {
        assertCurrent()
        const chain: PreparedVideoEditEffect[] = []
        for (const effect of activeVideoEditEffects(clip)) {
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
            const animation = animated(clip, effect.code, program)
            const styleKey = styleKitRenderKey(resolveVideoEditStyleKit(document, document, clip))
            chain.push({ effect, version: JSON.stringify([key, styleKey]), program: bindCodeMaterialStyle(program, animation.context.style), ...animation })
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
        const { parameters, context, transitionHandles } = animated(clip, clip.code, program)
        const imageSources = [...codeMaterialImageIds(clip.code)].map(id => { const media = document.media.find(media => media.id === id && media.kind === 'image'); if (!media) throw new Error('代码图片引用不存在。'); return [id, media.path, media.sourceRevision, media.width, media.height] })
        const styleKey = styleKitRenderKey(resolveVideoEditStyleKit(document, document, clip))
        const sourceTime = videoEditClipSourceTimeAt(clip, frame - clip.start, document.frameRate, transitionHandles && program.mode === 'static')
        const overrideValues = clip.elementOverrides ? Object.fromEntries(Object.entries(clip.elementOverrides).map(([id, value]) => [id, evaluateCodeElementOverride(value, sourceTime)])) : undefined
        const target = program.mode === 'static' ? `code:static:${JSON.stringify([key, parameters, imageSources, styleKey, documentFontRevision(), overrideValues])}` : `code:dynamic:${clip.id}`
        keys.add(target)
        plans.push({ clip, key: target, static: program.mode === 'static', program, parameters, context, transitionHandles })
      }
      if (plans.filter(plan => !plan.draws).length > 16) throw new CodeMaterialError('BUDGET', '代码素材同时最多16个渲染目标。')
      assertCurrent(); this.protectedKeys = keys
      const result: PreparedCodeSources = { pictures: new Map(), effects, sourceTimestamps: plans.map(plan => plan.context.time), cacheHits: 0 }
      // Serialize GPU mutations, including a generator whose readiness resolves after cancellation.
      const work = this.gpuWork.then(async () => {
        assertCurrent()
        if (plans.length || effects.size || keys.size) { this.runtime ??= await this.acquireRuntime(); assertCurrent() }
        this.runtime?.retainProgramVersions?.(new Set([...this.programs.keys(), ...[...effects.values()].flatMap(chain => chain.flatMap(effect => effect.builtin ? [] : [effect.version]))]))
        const outcome = (await imageOutcome)?.[0]
        if (outcome?.status === 'rejected') throw outcome.reason
        const inputs = outcome?.status === 'fulfilled' ? outcome.value : undefined; assertCurrent()
        this.releaseUnused(keys)
        for (const plan of plans) {
          assertCurrent()
          let picture = plan.static ? this.staticPictures.get(plan.key) : undefined
          if (picture) result.cacheHits++
          else {
            if (plan.draws) {
              if (!this.runtime!.draw) throw new Error('当前GPU会话不支持结构化图形绘制。')
              picture = await this.runtime!.draw(plan.key, plan.context.width, plan.context.height, plan.draws, undefined, Math.min(document.width / plan.context.width, document.height / plan.context.height) * plan.clip.scale)
            } else picture = await this.runtime!.generator(plan.key, plan.program!, plan.context, plan.parameters, inputs, plan.transitionHandles, plan.clip.elementOverrides ? { elementOverrides: plan.clip.elementOverrides, sourceTime: videoEditClipSourceTimeAt(plan.clip, frame - plan.clip.start, document.frameRate, plan.transitionHandles && plan.program!.mode === 'static') } : undefined)
            assertCurrent()
            if (plan.static) this.staticPictures.set(plan.key, picture)
          }
          result.pictures.set(plan.clip.id, picture)
        }
      })
      this.gpuWork = work.catch(() => { this.releaseUnused(this.protectedKeys) })
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
    try { return await videoEditEffectMask(mask, { trackerKeys: Object.fromEntries((clip.trackers ?? []).map(tracker => [tracker.id, videoEditTrackerKey(media?.id ?? '', tracker)])), mediaUrl: visual?.path, picture: videoEditClipPictureSize(document, clip), timeUs }) } catch (error) {
      logger.warn('作用区域蒙版读取失败', { event: 'video_edit.smart_region.mask_failed', error, context: { sequenceId: document.id, clipId: clip.id, region: mask.regionId } })
      return undefined
    }
  }
  diagnostics() { return { programs: this.programs.size, programBytes: this.programBytes, staticPictures: this.staticPictures.size, seenVersions: this.known.size, seenManifestBytes: this.knownBytes, compiler: this.compiler.diagnostics?.() } }
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true; this.cancel(); this.compiler.dispose(); this.protectedKeys.clear()
    await Promise.allSettled([this.gpuWork])
    try { this.runtime?.releaseUnused(new Set()) }
    finally { for (const picture of this.staticPictures.values()) if (typeof ImageBitmap !== 'undefined' && picture instanceof ImageBitmap) picture.close(); this.programs.clear(); this.programBytes = 0; this.staticPictures.clear(); this.known.clear(); this.knownBytes = 0 }
  }
}
