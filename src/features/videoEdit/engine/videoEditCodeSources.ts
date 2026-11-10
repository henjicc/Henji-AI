import { videoEditGpuOutputEpoch, type VideoEditFrameGpu } from './videoEditGpuErrorScope'
import { CODE_AUTHOR_SPATIAL_MIN_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'
import { authorBundleShapesText, authorTextMetadataKey } from './videoEditAuthorTextResources'
import { codeOutputInputs, codeOutputKey, codeOutputSignature } from './videoEditCodeOutputKey'
import { codeElementEdits } from '@/core/videoEdit/codeEdits'
import { VIDEO_EDIT_RENDER_ENGINE_VERSION } from 'virtual:video-edit-render-engine'
import { codeSimulationIdentity, codeSimulationRelativeTime, codeSimulationSourceTime, type CodeSimulationInput } from '@/core/videoEdit/codeSimulation'
import { renderSceneRecordFingerprint } from '@/core/videoEdit/renderFingerprint'
import { recordVideoEditPreparation } from './videoEditPreparationTiming'
import { authorEffectEnvironmentForClip } from '@/core/videoEdit/authorEffects'
import { readAuthorMetadataCache, writeAuthorMetadataCache } from './videoEditAuthorMetadataCache'
import { codeMediaFrameParameters, codeMediaInputClipSeconds, codeMediaInputReference, CodeMediaInputReferenceError } from '@/core/videoEdit/codeMediaInput'
import type { CodeMaterialContext } from '@/core/videoEdit/codeMaterial/contract'
import { VideoEditRecordingCursorSource } from './videoEditRecordingCursorSource'
import { RECORDING_CURSOR_EFFECT, sampleRecordingCursor } from '@/core/videoEdit/recordingCursor'
import { recordingCursorDraws, type RecordingCursorRenderInput } from './videoEditRecordingCursorPlan'
import { evaluateRecordingZoom, RECORDING_ZOOM_EFFECT, recordingZoomParams, recordingZoomPointerSpans } from '@/core/videoEdit/recordingZoom'
import { RECORDING_FRAME_EFFECT } from '@/core/videoEdit/recordingFrame'
import { recordingFrameContent, recordingZoomDraw, type RecordingEffectsRenderInput } from './videoEditRecordingZoomPlan'
import { VideoEditRecordingZoomPointers } from './videoEditRecordingZoomSource'
import { evaluateVideoEditEffect } from '@/core/videoEdit/keyframes'
import { resolveVideoEditBuiltinParams, videoEditEffectUsesSubject } from '@/core/videoEdit/builtinEffects'
import { expandPinnedCodeComponents } from '@/core/videoEdit/codeMaterial/components'
import { codeMaterialFilesKey, codeVersionContentKey, documentCodeSourceResolver, resolveCodeMaterialFiles, loadCodeSourceReferences } from '@/core/videoEdit/codeMaterial/sources'
import { documentFontRevision } from '@/platform/fontFaces'
import { createLogger } from '@/core/logging'
import { sha256HexString } from '@/utils/save/hash'
import { codeMaterialVersion as codeMaterialSource } from '@/core/videoEdit/codeMaterialDocument'
import { CodeMaterialError, isCodeImageReference } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeParameterDeclaration, CodeParameterValues } from '@/core/videoEdit/codeMaterial/contract'
import { videoEditCodeAuthorParameters, videoEditCodeInputs, videoEditCodeSceneKeys, videoEditCodeSceneUserMessages, type VideoEditCodeInputs } from '@/core/videoEdit/codeInputParameters'
import type { CodeAuthorApiVersion, CodeAuthorProgram as CodeMaterialProgram } from '@/core/videoEdit/codeAuthorProgram'
import type { AuthorAssets, AuthorFrameInfo, AuthorGpuImage } from './videoEditAuthorModule'
import { evaluateCodeMaterialParameters, prepareCodeMaterialParameters } from '@/core/videoEdit/codeMaterialAnimation'
import type { PreparedCodeMaterialParameters } from '@/core/videoEdit/codeMaterialAnimation'
import type { CodeMaterialInstance } from '@/core/videoEdit/codeMaterialPersistence'
import { offsetVideoEditSource, videoEditSourceSeconds } from '@/core/videoEdit/time'
import { videoEditClipSourceTimeAt } from '@/core/videoEdit/clipSpeed'
import { videoEditCodeMotionBlur } from '@/core/videoEdit/motionBlur'
import { codeMaterialContextForFrame, codeMaterialContextForTransitionFrame, codeMaterialSize } from '@/core/videoEdit/codeMaterialTiming'
import type { CodeMotionClock } from '@/core/videoEdit/codeMaterial/motionSampling'
import type { CodeMaterialVersion } from '@/core/videoEdit/codeMaterialPersistence'
import { videoEditClipMedia, videoEditPictureTransitionsAt, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { VideoEditCodeCompiler } from './videoEditCodeCompiler'
import type { VideoEditCodeGpu } from './videoEditCodeGpu'
import { VideoEditCodePicture } from './videoEditCodePicture'
import type { VideoEditCodeImageInput } from './videoEditCodeGpu'
import { codeMaterialImageParameterKeys } from '@/core/videoEdit/codeMaterialResources'
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
import { videoEditRenderSize } from '@/core/videoEdit/playbackResolution'
import { authorSpaceInfo } from './videoEditAuthorThree'
import { preparedSpatialBrand, type PreparedSpatialFrame, type SpatialCodeSources, type SpatialPrepareRequest, type SpatialPictureLease, type SpatialSceneSample, type SpatialSourceDescriptor } from './videoEditSpatialContracts'
import type { AuthorEffectMetadata } from './videoEditAuthorParameters'
import { WEB_TEXT_AUTHOR_API_VERSION, type WebTextDeclaration } from '@/core/videoEdit/webTextGeometry'

const logger = createLogger('features.videoEdit.codeSources')
/** 人物蒙版取分析结果原样（不羽化、不扩展），收缩与柔化由效果自己按画面高度在 GPU 上做。 */
const SUBJECT_MATTE: NonNullable<VideoEditEffect['mask']> = { regionId: 'person', feather: 0, expand: 0 }
/** Soft cache budgets: the current frame's working set is pinned regardless of chain length. */
const CACHED_PROGRAMS = 32; const CACHED_PROGRAM_BYTES = 16 * 1024 ** 2
type CodeRuntime = Pick<VideoEditCodeGpu, 'authorGenerator' | 'inspectAuthor' | 'retainAuthorInstances' | 'observeAuthor' | 'releaseUnused'> & Partial<Pick<VideoEditCodeGpu, 'authorTextIdentity' | 'authorFrameKey' | 'stageAuthorScene' | 'draw' | 'generatorTargetCapacity' | 'spillGeneratorTarget' | 'resetFramePerformance' | 'warmAuthor' | 'protectAuthorInstances' | 'renderDivisor'>>
type Compiler = Pick<VideoEditCodeCompiler, 'bundle' | 'dispose'> & Partial<Pick<VideoEditCodeCompiler, 'diagnostics'>>
interface KnownVersion { source: string; apiVersion: number; languageVersion: number; bytes: number }
interface CodeOutputFrame { sourceTime: ReturnType<typeof videoEditClipSourceTimeAt>; info: AuthorFrameInfo; overrides: Parameters<VideoEditCodeGpu['authorGenerator']>[7]; environment: ReturnType<typeof authorEffectEnvironmentForClip> }
interface CachedProgram { source: string; outputIdentity: string; program: CodeMaterialProgram; bytes: number }
/**
 * `divisor`：这一帧代码生成器的回放分辨率缩小倍数，与缓存键一起取，画面与键始终一致。
 * `imageKeys` 是帧期画面绑定，资源别名不受持久媒体 ID 的长度限制；`author` 是交给作者代码的 params。
 */
export interface VideoEditCodePlan { simulation?: CodeSimulationInput; clip: VideoEditClip; key: string; static: boolean; sourceTime?: ReturnType<typeof videoEditClipSourceTimeAt>; outputIdentity?: string; outputFrame?: CodeOutputFrame; program?: CodeMaterialProgram; draws?: VideoEditGraphicDraw[]; parameters: CodeParameterValues; inputParameters?: CodeParameterValues; imageKeys: ReadonlyMap<string, string>; author: Readonly<Record<string, unknown>>; context: ReturnType<typeof codeMaterialContextForFrame>; transitionHandles: boolean; motion?: CodeMotionClock; divisor?: number }
/** `parameters`：交给作者滤镜的 params（scene 参数已换成解析结果）。 */
export interface PreparedVideoEditCodeEffect { simulation?: CodeSimulationInput; effect: VideoEditEffect; builtin?: undefined; version: string; instanceKey: string; info: AuthorFrameInfo; program: CodeMaterialProgram; parameters: Readonly<Record<string, unknown>>; context: ReturnType<typeof codeMaterialContextForFrame>; transitionHandles: boolean }
/** 内置效果不需要编译源码，直接交给合成器的 GPU 实现；`mask` 是这一帧的智能区域蒙版，`subject` 是声明 `subjectMatte` 的效果要的人物蒙版。 */
interface PreparedVideoEditBuiltinEffect { effect: VideoEditEffect; builtin: VideoEditBuiltinEffectInstance & RecordingCursorRenderInput & RecordingEffectsRenderInput; mask?: VideoEditSmartRegionMask; subject?: VideoEditSmartRegionMask }
export type PreparedVideoEditEffect = PreparedVideoEditCodeEffect | PreparedVideoEditBuiltinEffect
/** `sceneIssues`：这一帧的片子数据或画面参数中需要用户处理的问题，由渲染器和效果错误一起呈现。 */
export interface PreparedCodeSources { pictures: Map<string, VideoEditCodePicture | ImageBitmap>; effects: Map<string, PreparedVideoEditEffect[]>; sourceTimestamps: number[]; cacheHits: number; sceneIssues: string[] }
export interface VideoEditCodePrepareOptions { gpuFrame?: VideoEditFrameGpu; observeElements?: boolean; exactInput?: (input: VideoEditCodeImageInput) => boolean; quality?: import('@/core/imaging/effects/descriptor').EffectQuality; authorPlans?: (plans: readonly VideoEditCodePlan[]) => Promise<void>; preparationOnly?: boolean; transitions?: readonly VideoEditTransitionWindow[]; surfaceKeys?: ReadonlySet<string>; onEffectError?: (effect: VideoEditEffect, error: unknown) => void; audio?: (clip: VideoEditClip, program: CodeMaterialProgram, parameters: CodeParameterValues, signal: AbortSignal) => Promise<Pick<CodeMaterialContext, 'audio' | 'audioTime'>>;
  spatialFrame?: import('@/core/videoEdit/spatialTypes').SpatialFrame
  deferredGenerators?: ReadonlySet<string>
}
/** 渲染与指纹共用时间、动画、片子数据及画面输入求值；编译与不可变参数准备留在帧循环外。 */
function codeFrameValues(document: VideoEditComposition, clip: VideoEditClip, program: CodeMaterialProgram,
  prepared: PreparedCodeMaterialParameters, inputs: VideoEditCodeInputs | undefined, generator: boolean,
  frame: number, window?: VideoEditTransitionWindow) {
  const context = window ? codeMaterialContextForTransitionFrame(clip, frame, document.frameRate, program, window, document) : codeMaterialContextForFrame(clip, frame, document.frameRate, program, document)
  const sourceTime = videoEditClipSourceTimeAt(clip, frame - clip.start, document.frameRate, Boolean(window) && program.mode === 'static')
  const parameters = evaluateCodeMaterialParameters(prepared, sourceTime)
  const derived = generator ? inputs?.derived : undefined
  const imageParameters = codeMaterialImageParameterKeys(program.parameters, derived)
  const frameParameters = codeMediaFrameParameters(clip, derived && Object.keys(derived).length ? { ...parameters, ...derived } : parameters, frame, document.frameRate, imageParameters, document)
  const origin = generator ? undefined : videoEditClipSourceTimeAt(clip, 0, document.frameRate)
  const simulation = program.simulation ? simulationFrameInput(program, prepared, inputs, context, sourceTime, origin, clip.reverse ? -1 : 1) : undefined
  return { context, sourceTime, ...(simulation ? { simulation } : {}), inputParameters: { ...parameters, ...derived }, parameters: frameParameters.parameters, imageKeys: frameParameters.images,
    author: videoEditCodeAuthorParameters(frameParameters.parameters, inputs), transitionHandles: Boolean(window) }
}
const simulationInputs = new WeakMap<PreparedCodeMaterialParameters, { program: CodeMaterialProgram; inputs?: VideoEditCodeInputs; width: number; height: number; originKey: string; input: CodeSimulationInput }>()
function simulationFrameInput(program: CodeMaterialProgram, prepared: PreparedCodeMaterialParameters, inputs: VideoEditCodeInputs | undefined,
  size: { width: number; height: number }, sourceTime: import('@/core/videoEdit/time').VideoEditSourceTime, sourceOrigin?: import('@/core/videoEdit/time').VideoEditSourceTime, sourceDirection: 1 | -1 = 1): CodeSimulationInput {
  const originKey = JSON.stringify([sourceOrigin, sourceDirection])
  let cached = simulationInputs.get(prepared)
  if (!cached || cached.program !== program || cached.inputs !== inputs || cached.width !== size.width || cached.height !== size.height || cached.originKey !== originKey) {
    const scenes = Object.entries(inputs?.scenes ?? {}).map(([key, scene]) => [key, scene.scene, scene.schema,
      scene.records.map(renderSceneRecordFingerprint), scene.timetables.map(table => [table.container?.id, table.kind, String(table.end), table.inputs,
        table.shots.map(({ record, ...shot }) => [record.id, shot])])])
    const source = { engine: VIDEO_EDIT_RENDER_ENGINE_VERSION, apiVersion: program.apiVersion, code: program.bundle.code, modules: program.bundle.modules?.files, libraries: program.bundle.libraries }
    const input: CodeSimulationInput = {
      identity: codeSimulationIdentity(source, [program.parameters, prepared.values, [...prepared.curves], scenes, originKey], size, program.simulation),
      parametersAt: (step, rate) => videoEditCodeAuthorParameters(evaluateCodeMaterialParameters(prepared, sourceOrigin ? offsetVideoEditSource(sourceOrigin, step * sourceDirection, { numerator: rate, denominator: 1 }, true) : codeSimulationSourceTime(step, rate)), inputs),
    }
    cached = { program, inputs, originKey, width: size.width, height: size.height, input }; simulationInputs.set(prepared, cached)
  }
  return { ...cached.input, sourceTime: sourceOrigin ? codeSimulationRelativeTime(sourceTime, sourceOrigin, sourceDirection) : sourceTime, ...(sourceOrigin ? { sourceOrigin, sourceDirection } : {}) }
}
function identity(definitionId: string, versionId: string): string { return JSON.stringify([definitionId, versionId]) }
interface InputFailureScope { sequenceId: string; clipId: string; effectId?: string; frame: number }
function inputFailureInstance(scope: InputFailureScope): string { return JSON.stringify([scope.sequenceId, scope.clipId, scope.effectId ?? null]) }
const frozenScenes = new WeakSet<object>()
const readOnly = (): never => { throw new TypeError('片子数据的解析结果只读，请在自己的对象里保存派生数据。') }
/**
 * 解析结果在同一文档版本的各帧、各片段之间共享，交给作者代码前整份冻结（每个解析结果只冻结一次）：作者误改会立刻报错，
 * 而不是悄悄改掉别的帧、别的片段看到的数据。Map 的增删方法换成报错。用显式栈遍历，嵌套很深的记录也不爆栈。
 */
function freezeScene(root: object): void {
  if (frozenScenes.has(root)) return
  const stack: unknown[] = [root], seen = new WeakSet<object>()
  while (stack.length) {
    const value = stack.pop()
    if (typeof value !== 'object' || value === null || seen.has(value)) continue
    seen.add(value)
    if (value instanceof Map) {
      for (const [key, item] of value) stack.push(key, item)
      for (const name of ['set', 'delete', 'clear']) Object.defineProperty(value, name, { value: readOnly })
    }
    stack.push(...Object.values(value))
    Object.freeze(value)
  }
  frozenScenes.add(root)
}
function freezeProgram(program: CodeMaterialProgram): CodeMaterialProgram {
  const seen = new WeakSet<object>()
  const freeze = (value: unknown): void => {
    if (typeof value !== 'object' || value === null || seen.has(value)) return
    seen.add(value); Object.values(value).forEach(freeze); Object.freeze(value)
  }
  freeze(program); return program
}
/** Visible-code session only. Programs stay in memory; source remains the document truth. */
export interface SpatialAuthorInputs {
  assets: AuthorAssets
  images: Readonly<Record<string, AuthorGpuImage>>
  /** 同一网页票据或已准备的模拟只读视图；禁止在这里推进模拟。 */
  info?: Partial<AuthorFrameInfo>
}
export interface SpatialAuthorHooks {
  prepare?(clip: VideoEditClip, sourceTimes: readonly number[], signal: AbortSignal): Promise<void>
  inputs?(plan: VideoEditCodePlan, sourceTime: number, signal: AbortSignal): Promise<SpatialAuthorInputs>
}
interface PreparedAuthorSpatialFrame {
  request: SpatialPrepareRequest
  epoch: number
  released: boolean
  evaluate: Map<string, (frame: number, window?: VideoEditTransitionWindow) => VideoEditCodePlan>
  inputs: Map<string, SpatialAuthorInputs>
  leases: Set<SpatialPictureLease>
  borrows: Set<SpatialPictureLease>
  centers: Map<string, SpatialPictureLease>
}
export class VideoEditCodeSources implements SpatialCodeSources {
  private spatialHooks: SpatialAuthorHooks = {}
  private readonly spatialFrames = new Map<PreparedSpatialFrame, PreparedAuthorSpatialFrame>()
  /** 模拟准备与媒体输入共用曝光计划的精确源时刻，不能自行推进时间。 */
  setSpatialAuthorHooks(hooks: SpatialAuthorHooks): void { this.spatialHooks = hooks }
  async describeSpatialSources(composition: Readonly<VideoEditComposition>, signal: AbortSignal): Promise<readonly SpatialSourceDescriptor[]> {
    const sources: SpatialSourceDescriptor[] = []
    for (const clip of composition.clips) {
      signal.throwIfAborted()
      if (!clip.code || clip.kind !== 'code') continue
      if (codeMaterialSource(composition, clip.code).apiVersion < CODE_AUTHOR_SPATIAL_MIN_API_VERSION) {
        sources.push({ clipId: clip.id, kind: 'card', spaceDependency: false })
        continue
      }
      const evaluate = await this.prepareGeneratorFrames(clip, signal)
      const program = evaluate(clip.start).program as CodeMaterialProgram & AuthorEffectMetadata
      sources.push({ clipId: clip.id, kind: program.worldScene ? 'worldScene' : 'card', spaceDependency: program.space === true })
    }
    return sources
  }
  private spatialState(prepared: PreparedSpatialFrame): PreparedAuthorSpatialFrame {
    const state = this.spatialFrames.get(prepared)
    if (!state || state.released || state.epoch !== this.epoch || this.disposed) throw new DOMException('空间帧已失效。', 'AbortError')
    state.request.frame.signal.throwIfAborted(); state.request.frame.assertCurrent()
    return state
  }
  async prepareSpatialFrame(request: SpatialPrepareRequest): Promise<PreparedSpatialFrame> {
    logger.debug('空间作者帧准备开始', { event: 'video_edit.spatial_author.prepare.start', context: { requestId: request.frame.requestId } })
    request.frame.signal.throwIfAborted(); request.frame.assertCurrent()
    if (request.frame.composition !== this.document) throw new Error('空间帧必须使用当前代码会话的文档快照。')
    const prepared: PreparedSpatialFrame = { [preparedSpatialBrand]: true }
    const state: PreparedAuthorSpatialFrame = { request, epoch: this.epoch, released: false, evaluate: new Map(), inputs: new Map(), leases: new Set(), borrows: new Set(), centers: new Map() }
    this.spatialFrames.set(prepared, state)
    try {
      this.runtime ??= await this.acquireRuntime()
      for (const source of request.frame.sources) {
        const clip = this.document.clips.find(value => value.id === source.clipId)
        if (!clip?.code) continue
        const evaluate = await this.prepareGeneratorFrames(clip, request.frame.signal)
        this.spatialState(prepared)
        state.evaluate.set(clip.id, evaluate)
        const centerTime = request.plan.samples[0]?.clips.find(value => value.clipId === clip.id)?.centerSourceTime
        const times = [...(centerTime === undefined ? [] : [centerTime]), ...request.plan.samples.flatMap(sample => sample.clips.filter(value => value.clipId === clip.id).map(value => source.kind === 'worldScene' && value.motionBlur ? value.sourceTime : value.centerSourceTime))]
        await this.spatialHooks.prepare?.(clip, [...new Set(times)], request.frame.signal)
        this.spatialState(prepared)
      }
      this.protectSpatialInstances()
      logger.debug('空间作者帧准备完成', { event: 'video_edit.spatial_author.prepare.completed', context: { requestId: request.frame.requestId, sources: state.evaluate.size } })
      return prepared
    } catch (error) {
      logger.warn('空间作者帧准备失败', { event: 'video_edit.spatial_author.prepare.failed', error, context: { requestId: request.frame.requestId } })
      await this.releaseSpatialFrame(prepared); throw error
    }
  }
  private async spatialValues(prepared: PreparedSpatialFrame, clipId: string, sequenceFrame: number, sourceTime: number,
    centerSourceTime: number, frame: import('@/core/videoEdit/spatialTypes').SpatialFrame) {
    const state = this.spatialState(prepared), { request } = state
    const evaluate = state.evaluate.get(clipId)
    if (!evaluate) throw new Error(`空间代码来源 ${clipId} 未准备。`)
    const descriptor = request.frame.sources.find(value => value.clipId === clipId)!
    const center = descriptor.kind !== 'worldScene'
    const evaluatedFrame = center ? request.frame.sequenceFrame : sequenceFrame
    const window = videoEditPictureTransitionsAt(this.document, evaluatedFrame).find(window => window.left.id === clipId || window.right.id === clipId)
    const plan = evaluate(evaluatedFrame, window)
    const clipTime = videoEditClipSourceTimeAt(plan.clip, evaluatedFrame - plan.clip.start, this.document.frameRate, plan.transitionHandles && plan.program!.mode === 'static')
    const overrides = plan.clip.elementOverrides ? Object.fromEntries(Object.entries(plan.clip.elementOverrides).map(([id, value]) => [id, evaluateCodeElementOverride(value, clipTime)])) : undefined
    const time = center ? centerSourceTime : sourceTime
    const inputKey = JSON.stringify([clipId, time])
    let inputs = center ? state.inputs.get(inputKey) : undefined
    if (!inputs) {
      inputs = await this.spatialHooks.inputs?.(plan, time, request.frame.signal)
      if (!inputs && plan.imageKeys.size) throw new Error('空间作者媒体输入尚未接入帧准备器。')
      inputs ??= { assets: {}, images: {} }
      if (center) state.inputs.set(inputKey, inputs)
    }
    this.spatialState(prepared)
    const info: AuthorFrameInfo = { ...inputs.info, time, frameDuration: 1 / this.document.fps,
      clip: { time: plan.context.localTime, duration: plan.clip.duration / this.document.fps },
      ...(descriptor.spaceDependency ? { space: await authorSpaceInfo(center ? request.plan.centerFrame : frame, clipId, time, centerSourceTime, request.plan.centerFrame.sequenceTime) } : {}) }
    return { state, plan, inputs, info, descriptor, overrides }
  }
  /**
   * 统一三维渲染器用：把每个世界场景更新到中心帧（或快门开始那一刻），交出场景根节点、包围框与作者源时间。
   * 根节点是活对象，须在本空间帧释放前、下一次更新之前读完。
   */
  stageSpatialScenes(prepared: PreparedSpatialFrame, moment: 'center' | 'open' = 'center'): Promise<readonly { clipId: string; root: import('three').Group; worldBounds: SpatialSceneSample['worldBounds']; time: number }[]> {
    const work = this.gpuWork.then(async () => {
      const state = this.spatialState(prepared), result: Array<{ clipId: string; root: import('three').Group; worldBounds: SpatialSceneSample['worldBounds']; time: number }> = []
      const { plan: exposure, frame: request } = state.request
      const open = exposure.samples.reduce<typeof exposure.samples[number] | undefined>((first, sample) => !first || sample.sequenceFrame < first.sequenceFrame ? sample : first, undefined)
      for (const source of request.sources) {
        if (source.kind !== 'worldScene') continue
        const sample = moment === 'open' ? open : exposure.samples[0]
        const value = sample?.clips.find(clip => clip.clipId === source.clipId)
        if (!sample || !value) continue
        const { plan, inputs, info } = moment === 'open' && value.motionBlur
          ? await this.spatialValues(prepared, source.clipId, value.sequenceFrame, value.sourceTime, value.centerSourceTime, sample.frame)
          : await this.spatialValues(prepared, source.clipId, request.sequenceFrame, value.centerSourceTime, value.centerSourceTime, exposure.centerFrame)
        if (!this.runtime?.stageAuthorScene) throw new Error('当前 GPU 会话不支持统一三维场景。')
        const staged = await this.runtime.stageAuthorScene(source.clipId, plan.program!, plan.context, plan.author, inputs.assets, info)
        this.spatialState(prepared)
        result.push({ clipId: source.clipId, ...staged })
      }
      return result
    })
    this.gpuWork = work.then(() => undefined, () => undefined)
    return work
  }
  private protectSpatialInstances(): void {
    this.runtime?.protectAuthorInstances?.(new Set([...this.spatialFrames.values()].flatMap(state => [...state.evaluate.keys()])))
  }
  async releaseSpatialFrame(prepared: PreparedSpatialFrame): Promise<void> {
    const state = this.spatialFrames.get(prepared)
    if (!state) return
    state.released = true
    await this.gpuWork
    const borrowed = await Promise.allSettled([...state.borrows].map(lease => lease.release(Promise.resolve())))
    const results = [...borrowed, ...await Promise.allSettled([...state.leases].map(lease => lease.release(Promise.resolve())))]
    this.spatialFrames.delete(prepared)
    this.protectSpatialInstances()
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (errors.length) throw new AggregateError(errors, '空间帧资源释放失败。')
  }
  private readonly cursorSources = new VideoEditRecordingCursorSource()
  private readonly zoomPointers = new VideoEditRecordingZoomPointers(this.cursorSources)
  private readonly known = new Map<string, KnownVersion>()
  private knownBytes = 0
  private readonly programs = new Map<string, CachedProgram>()
  private programBytes = 0
  private readonly lastOutputs = new Map<string, { key: string; picture: VideoEditCodePicture; gpuEpoch: number; gpuOutcome?: VideoEditFrameGpu['outcome'] }>()
  private outputTargetSequence = 0
  private readonly outputReuse = { hits: 0, misses: 0, bypasses: 0 }
  private readonly targetPictures = new Map<string, VideoEditCodePicture | ImageBitmap>()
  private readonly spilledPictures = new Set<ImageBitmap>()
  private readonly parameters = new WeakMap<CodeMaterialInstance, { program: CodeMaterialProgram; prepared: PreparedCodeMaterialParameters }>()
  private readonly graphics = new WeakMap<VideoEditGraphic, PreparedVideoEditGraphic>()
  private runtime?: CodeRuntime
  private controller?: AbortController
  private readonly sceneControllers = new Set<AbortController>()
  /** 已写过日志的片子数据问题：每次编辑都会重新解析，同一个问题只记一次。 */
  private readonly loggedSceneIssues = new Set<string>()
  private readonly loggedSceneInputs = new WeakSet<VideoEditCodeInputs>()
  private readonly inputFailures = new Map<string, Map<string, string>>()
  private epoch = 0
  private disposed = false
  private protectedKeys = new Set<string>()
  private gpuWork: Promise<void> = Promise.resolve()
  private clearInputFailure(scope: InputFailureScope, parameter: string): void {
    const key = inputFailureInstance(scope), failures = this.inputFailures.get(key)
    failures?.delete(parameter)
    if (!failures?.size) this.inputFailures.delete(key)
  }
  private reportInputFailure(error: CodeMediaInputReferenceError, scope: InputFailureScope): void {
    const key = inputFailureInstance(scope), failures = this.inputFailures.get(key) ?? new Map<string, string>()
    if (failures.get(error.parameter) === error.reason) return
    failures.set(error.parameter, error.reason); this.inputFailures.set(key, failures)
    // 去重与帧归属同步确定，摘要计算不能延迟错误呈现或资源清理。
    const report = (digest?: string): void => logger.warn('代码画面参数引用无效，当前帧准备失败', { event: 'video_edit.code_input.failed', context: { ...scope, parameter: { ...(digest ? { digest } : {}), length: error.parameter.length }, reason: error.reason } })
    void sha256HexString(error.parameter).then(report, () => report())
  }
  private releaseUnused(keys: ReadonlySet<string>): void {
    this.runtime?.releaseUnused(keys)
    for (const key of this.targetPictures.keys()) if (!keys.has(key)) this.targetPictures.delete(key)
    for (const key of this.lastOutputs.keys()) if (!keys.has(key)) this.lastOutputs.delete(key)
  }
  constructor(private document: VideoEditComposition, private readonly acquireRuntime: () => Promise<CodeRuntime>, private readonly compiler: Compiler = new VideoEditCodeCompiler(), private readonly onAheadHit?: () => void, private readonly reuseOutputs = true) { this.checkVersions(document) }
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
    this.inputFailures.clear()
    this.protectedKeys.clear(); this.releaseUnused(this.protectedKeys)
    for (const bitmap of this.spilledPictures) bitmap.close()
    this.spilledPictures.clear(); this.targetPictures.clear(); this.lastOutputs.clear()
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
  cancel(): void {
    this.epoch++; this.controller?.abort(); this.controller = undefined
    for (const controller of this.sceneControllers) controller.abort()
    this.sceneControllers.clear()
  }
  /** 已读好的代码声明，不触发编译；片子数据派生的取帧参数按它解析，没读好时为 undefined。 */
  declarations(instance: CodeMaterialInstance): readonly CodeParameterDeclaration[] | undefined {
    return this.programs.get(identity(instance.definitionId, instance.versionId))?.program.parameters
  }
  webText(instance: CodeMaterialInstance): WebTextDeclaration | undefined {
    return this.programs.get(identity(instance.definitionId, instance.versionId))?.program.webText
  }
  /**
   * 片子数据派生参数与网页文本需求来自作者声明，必须在取帧前读好；同一帧的图片与代码准备共用这份编译结果。
   * 都已读好时返回 undefined，不多等一轮。
   */
  prepareInputDeclarations(document: VideoEditComposition, clips: readonly VideoEditClip[]): Promise<void> | undefined {
    const pending = clips.flatMap(clip => clip.kind === 'code' && clip.code && (videoEditCodeSceneKeys(clip.code).length || codeMaterialSource(document, clip.code).apiVersion >= WEB_TEXT_AUTHOR_API_VERSION && Object.values(clip.code.parameters).some(value => isCodeImageReference(value) && value.kind === 'web')) && !this.programs.has(identity(clip.code.definitionId, clip.code.versionId)) ? [clip.code] : [])
    if (!pending.length) return undefined
    const pinned = new Set(clips.flatMap(clip => [...(clip.code ? [clip.code] : []), ...videoEditEffectCodes(activeVideoEditEffects(clip))].map(instance => identity(instance.definitionId, instance.versionId))))
    const controller = new AbortController(); this.sceneControllers.add(controller)
    return (async () => {
      try { for (const instance of pending) await this.program(identity(instance.definitionId, instance.versionId), codeMaterialSource(document, instance), controller.signal, pinned) }
      finally { this.sceneControllers.delete(controller) }
    })()
  }
  /**
   * 片子数据的解析结果（已冻结）；影响这一帧（`frame` 的片段素材时间）、需要用户处理的问题加进 messages，
   * 所有问题按内容只写一次日志。
   */
  private sceneInputs(document: VideoEditComposition, clip: VideoEditClip, frame: number, instance: CodeMaterialInstance, program: CodeMaterialProgram, messages: string[]): VideoEditCodeInputs | undefined {
    const inputs = videoEditCodeInputs(document, instance, () => program.parameters)
    if (!inputs) return undefined
    for (const resolved of Object.values(inputs.scenes)) freezeScene(resolved)
    for (const message of videoEditCodeSceneUserMessages(inputs, codeMediaInputClipSeconds(clip, frame, document.frameRate))) if (!messages.includes(message)) messages.push(message)
    if (this.loggedSceneInputs.has(inputs)) return inputs
    this.loggedSceneInputs.add(inputs)
    if (this.loggedSceneIssues.size > 512) this.loggedSceneIssues.clear()
    const once = (key: unknown[]): boolean => { const text = JSON.stringify(key); if (this.loggedSceneIssues.has(text)) return false; this.loggedSceneIssues.add(text); return true }
    for (const key of inputs.unresolved) if (once(['unresolved', clip.id, key, instance.versionId])) logger.warn('代码参数引用的片子数据没能解析，作者代码拿到 null', { event: 'video_edit.scene.unresolved', context: { sequenceId: document.id, clipId: clip.id, parameter: key, versionId: instance.versionId } })
    for (const { parameter, scene, issue } of inputs.issues) if (once([scene.id, issue.recordId, issue.path, issue.message])) {
      const context = { sequenceId: document.id, clipId: clip.id, parameter, sceneId: scene.id, recordId: issue.recordId, path: issue.path, reason: issue.message }
      if (issue.severity === 'user') logger.warn('片子数据有会让画面缺内容的问题', { event: 'video_edit.scene.issue', context })
      else logger.info('片子数据解析时有需要整理的记录', { event: 'video_edit.scene.issue', context })
    }
    return inputs
  }
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
      const { program } = await this.program(key, codeMaterialSource(document, instance), signal, pinned)
      signal.throwIfAborted()
      await this.runtime!.inspectAuthor(program.bundle)
      signal.throwIfAborted()
      this.preparedAhead.add(key); prepared++
    }
    return prepared
  }
  private async program(key: string, version: CodeMaterialVersion, signal: AbortSignal, pinned: ReadonlySet<string>): Promise<CachedProgram> {
    signal.throwIfAborted()
    const cached = this.programs.get(key)
    if (cached) {
      // checkVersions validates immutable manifests at document updates. Do not
      // reread, parse module imports or serialize bundled libraries every frame.
      if (this.preparedAhead.delete(key)) this.onAheadHit?.()
      this.programs.delete(key); this.programs.set(key, cached); return cached
    }
    await loadCodeSourceReferences(version); signal.throwIfAborted()
    const resolver = documentCodeSourceResolver()
    // 按版本记录编译：作者接口版本与内置库版本都跟着记录走，默认库版本以后变了也不影响这一版。记录的 apiVersion 由持久 schema 校验。
    const files = { ...expandPinnedCodeComponents(resolveCodeMaterialFiles(version, resolver), version.imports ?? [], resolver), apiVersion: version.apiVersion as CodeAuthorApiVersion, ...(version.libraries ? { libraries: version.libraries } : {}), trustContext: version.foreign ? [version.foreign] : [] }
    const source = codeMaterialFilesKey(files)
    logger.debug('可见代码源码检查开始', { event: 'video_edit.code.compile.start', context: { sequenceId: this.document.id, version: key } })
    try {
      const started = performance.now()
      const bundle = await this.compiler.bundle(files, signal); signal.throwIfAborted()
      this.runtime ??= await this.acquireRuntime(); signal.throwIfAborted()
      const metadataKey = await authorTextMetadataKey(bundle, source); signal.throwIfAborted()
      const metadata = await readAuthorMetadataCache(metadataKey); signal.throwIfAborted()
      const program = metadata ? { ...metadata, bundle } : await this.runtime.inspectAuthor(bundle); signal.throwIfAborted()
      if (!metadata) writeAuthorMetadataCache(metadataKey, program)
      recordVideoEditPreparation('sourceCompilation', performance.now() - started)
      if (program.apiVersion !== version.apiVersion || program.languageVersion !== version.languageVersion) throw new CodeMaterialError('COMPATIBILITY', '代码源码协议与固定版本声明不一致。')
      // 同一版本可能同时在准备（帧准备、前瞻、片子数据声明）：先完成的那份入缓存，后到的沿用它，不重复计入字节预算。
      const raced = this.programs.get(key)
      if (raced) return raced
      const bytes = new TextEncoder().encode(source).byteLength + new TextEncoder().encode(JSON.stringify(program)).byteLength
      while (this.programs.size >= CACHED_PROGRAMS || this.programBytes + bytes > CACHED_PROGRAM_BYTES) {
        const oldest = [...this.programs].find(([key]) => !pinned.has(key))
        if (!oldest) break
        this.programs.delete(oldest[0]); this.programBytes -= oldest[1].bytes
      }
      const entry = { source, outputIdentity: codeOutputSignature(source), program: freezeProgram(program), bytes }
      this.programs.set(key, entry); this.programBytes += bytes
      logger.debug('可见代码源码检查完成', { event: 'video_edit.code.compile.completed', context: { sequenceId: this.document.id, version: key } })
      return entry
    } catch (error) {
      if (!signal.aborted) logger.warn('可见代码源码检查失败', { event: 'video_edit.code.compile.failed', error, context: { sequenceId: this.document.id, version: key } })
      throw error
    }
  }
  /** 指纹只需要生成器计划；固定片段的源码、动画声明与场景输入只准备一次，不创建 GPU 或逐帧走 prepare 生命周期。 */
  async prepareGeneratorFrames(clip: VideoEditClip, signal: AbortSignal): Promise<(frame: number, window?: VideoEditTransitionWindow) => VideoEditCodePlan> {
    if (!clip.code) throw new CodeMaterialError('COMPATIBILITY', '代码片段缺少固定源码实例。')
    const key = identity(clip.code.definitionId, clip.code.versionId)
    const { program, outputIdentity } = await this.program(key, codeMaterialSource(this.document, clip.code), signal, new Set([key]))
    if (program.kind !== 'generator') throw new CodeMaterialError('TYPE', '单输入滤镜不能作为生成片段渲染。')
    const prepared = prepareCodeMaterialParameters(program, clip.code)
    const inputs = this.sceneInputs(this.document, clip, clip.start, clip.code, program, [])
    return (frame, window) => ({ clip, key, program, outputIdentity, static: false,
      ...codeFrameValues(this.document, clip, program, prepared, inputs, true, frame, window) })
  }
  async prepare(document: VideoEditComposition, clips: VideoEditClip[], frame: number, shouldPresent: () => boolean, images?: Promise<ReadonlyMap<string, VideoEditCodeImageInput> | undefined>, options: VideoEditCodePrepareOptions = {}): Promise<PreparedCodeSources> {
    this.cancel(); const epoch = this.epoch; const controller = new AbortController(); this.controller = controller
    // A decode can reject while source compilation is still pending.
    const imageOutcome = images ? Promise.allSettled([images]) : undefined
    const assertCurrent = (): void => { if (this.disposed || controller.signal.aborted || this.epoch !== epoch || this.document !== document || !shouldPresent()) throw new DOMException('旧代码画面已取消。', 'AbortError') }
    const plans: VideoEditCodePlan[] = []; const keys = new Set<string>(options.surfaceKeys); const sceneIssues: string[] = []
    const effects = new Map<string, PreparedVideoEditEffect[]>()
    const pinned = new Set(clips.flatMap(clip => [...(clip.code ? [clip.code] : []), ...videoEditEffectCodes(activeVideoEditEffects(clip))].map(instance => identity(instance.definitionId, instance.versionId))))
    const transitionByClip = new Map(options.transitions?.flatMap(window => [[window.left.id, window], [window.right.id, window]] as const))
    /** `generator`：代码片段本身（只有它取派生的画面输入；附加滤镜的 scene 参数只换成解析结果）。 */
    const animated = async (clip: VideoEditClip, instance: CodeMaterialInstance, program: CodeMaterialProgram, generator: boolean, effectId?: string): Promise<Pick<VideoEditCodePlan, 'context' | 'sourceTime' | 'parameters' | 'inputParameters' | 'imageKeys' | 'author' | 'transitionHandles' | 'motion' | 'simulation'>> => {
      const scope = { sequenceId: document.id, clipId: clip.id, ...(effectId ? { effectId } : {}), frame }
      try {
        let animation = this.parameters.get(instance)
        if (!animation || animation.program !== program) {
          // 在声明校验前识别损坏的画面引用，确保它也走同一个可观察的失败出口。
          for (const key of codeMaterialImageParameterKeys(program.parameters)) {
            codeMediaInputReference(instance.parameters[key], key); this.clearInputFailure(scope, key)
          }
          animation = { program, prepared: prepareCodeMaterialParameters(program, instance) }; this.parameters.set(instance, animation)
        }
        const window = transitionByClip.get(clip.id)
        const inputs = this.sceneInputs(document, clip, frame, instance, program, sceneIssues)
        const values = codeFrameValues(document, clip, program, animation.prepared, inputs, generator, frame, window)
        if (options.audio) Object.assign(values.context, await options.audio(clip, program, evaluateCodeMaterialParameters(animation.prepared, values.sourceTime), controller.signal))
        assertCurrent()
        this.inputFailures.delete(inputFailureInstance(scope))
        if (values.simulation) values.simulation = { ...values.simulation, owner: { sequenceId: document.id, clipId: clip.id, ...(effectId ? { effectId } : {}) }, signal: controller.signal, assertCurrent }
        return values
      } catch (error) {
        assertCurrent()
        if (error instanceof CodeMediaInputReferenceError) this.reportInputFailure(error, scope)
        throw error
      }
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
            // 人物蒙版（主体抠像、轮廓来源为主体）与作用区域（4.7d 智能区域、4.10 手绘遮罩）：智能区域还没分析好时先不画这个效果；导出前会等分析完成。
            const subject = videoEditEffectUsesSubject(effect.builtin) ? await this.regionMask(document, clip, SUBJECT_MATTE, frame, options.quality === 'final') : undefined; assertCurrent()
            if (videoEditEffectUsesSubject(effect.builtin) && !subject) continue
            const mask = effect.mask ? await this.regionMask(document, clip, effect.mask, frame, options.quality === 'final') : undefined; assertCurrent()
            if (effect.mask && !mask) continue
            chain.push({ effect, builtin: effect.builtin, ...(mask ? { mask } : {}), ...(subject ? { subject } : {}) })
            continue
          }
          if (!effect.code) continue
          try {
            const key = identity(effect.code.definitionId, effect.code.versionId)
            const { program } = await this.program(key, codeMaterialSource(document, effect.code), controller.signal, pinned); assertCurrent()
            if (program.kind !== 'filter') throw new CodeMaterialError('TYPE', '附加效果必须使用单输入滤镜源码。')
            const { author, context, transitionHandles, simulation } = await animated(clip, effect.code, program, false, effect.id)
            // 回放分辨率降低时滤镜的输入、输出按序列缩小后的尺寸给出（任务 4.9），比例随 info 告诉作者。
            const divisor = this.runtime?.renderDivisor ?? 1
            const renderScale = divisor === 1 ? undefined : videoEditRenderSize(document.width, document.height, divisor).height / document.height
            chain.push({ effect, ...(simulation ? { simulation } : {}), version: key, instanceKey: `${clip.id}:${effect.id}`, info: { audio: context.audio, audioTime: context.audioTime, time: context.time, frameDuration: 1 / document.fps, clip: { time: context.localTime, duration: clip.duration / document.fps }, ...(renderScale ? { renderScale } : {}) }, program, context, transitionHandles, parameters: author })
          } catch (error) {
            assertCurrent()
            if (!options.onEffectError) throw error
            if (error instanceof CodeMediaInputReferenceError) {
              const message = `效果“${effect.name}”无法应用：${error.message}`
              if (!sceneIssues.includes(message)) sceneIssues.push(message)
            } else options.onEffectError(effect, error)
          }
        }
        if (chain.length) effects.set(clip.id, chain)
        if (options.deferredGenerators?.has(clip.id)) continue
        if (clip.kind === 'graphic') {
          if (!clip.graphic) throw new CodeMaterialError('COMPATIBILITY', '图形片段缺少结构化对象。')
          let prepared = this.graphics.get(clip.graphic)
          if (!prepared) { prepared = prepareVideoEditGraphic(clip.graphic); this.graphics.set(clip.graphic, prepared) }
          const time = videoEditClipSourceTimeAt(clip, frame - clip.start, document.frameRate, transitionByClip.has(clip.id))
          const draws = evaluateVideoEditGraphic(prepared, time)
          const moving = prepared.objects.some(object => object.parameters.curves.size > 0)
          const target = moving ? `graphic:dynamic:${clip.id}` : `graphic:static:${JSON.stringify([prepared.width, prepared.height, draws, draws.some(draw => draw.textStyle) ? documentFontRevision() : 0, videoEditTextResolution(Math.min(document.width / prepared.width, document.height / prepared.height) * clip.scale)])}`
          keys.add(target)
          plans.push({ clip, key: target, static: !moving, draws, parameters: {}, imageKeys: new Map(), author: {}, transitionHandles: transitionByClip.has(clip.id), context: { width: prepared.width, height: prepared.height, time: time.sourceInUs / 1e6 + time.sourceRemainder.numerator / time.sourceRemainder.denominator / 1e6, localTime: (frame - clip.start) / document.fps, sequenceTime: frame / document.fps, frame, fps: document.fps } })
          continue
        }
        if (clip.kind !== 'code') continue
        if (!clip.code) throw new CodeMaterialError('COMPATIBILITY', '代码片段缺少固定源码实例。')
        const version = codeMaterialSource(document, clip.code)
        const key = identity(clip.code.definitionId, clip.code.versionId)
        const { program, outputIdentity } = await this.program(key, version, controller.signal, pinned); assertCurrent()
        if (program.kind !== 'generator') throw new CodeMaterialError('TYPE', '单输入滤镜不能作为生成片段渲染。')
        const { parameters, inputParameters, imageKeys, author, context, sourceTime, transitionHandles, motion, simulation } = await animated(clip, clip.code, program, true)
        const divisor = this.runtime?.renderDivisor ?? 1
        const target = `code:output:${clip.id}`
        keys.add(target)
        plans.push({ clip, key: target, static: program.mode === 'static', program, outputIdentity, sourceTime, parameters, inputParameters, imageKeys, author, context, transitionHandles, ...(simulation ? { simulation } : {}), ...(motion ? { motion } : {}), ...(divisor === 1 ? {} : { divisor }) })
      }
      assertCurrent(); if (!options.preparationOnly) this.protectedKeys = keys
      const result: PreparedCodeSources = { pictures: new Map(), effects, sourceTimestamps: plans.map(plan => plan.context.time), cacheHits: 0, sceneIssues }
      if (options.authorPlans) { await options.authorPlans(plans); assertCurrent(); return result }
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
        await this.runtime?.retainAuthorInstances(new Set([...plans.filter(plan => plan.program).map(plan => plan.clip.id), ...options.deferredGenerators ?? [], ...[...effects.values()].flatMap(chain => chain.flatMap(effect => effect.builtin ? [] : [effect.instanceKey]))]))
        const contentKeys = new Map<VideoEditCodePlan, string | undefined>()
        for (const plan of plans) {
          if (plan.program) {
            const sourceTime = plan.sourceTime!
            const overrides = plan.clip.elementOverrides ? Object.fromEntries(Object.entries(plan.clip.elementOverrides).map(([id, value]) => [id, evaluateCodeElementOverride(value, sourceTime)])) : undefined
            const web = Object.fromEntries([...plan.imageKeys].flatMap(([name, key]) => inputs?.get(key)?.web ? [[name, inputs.get(key)!.web!]] : []))
            plan.outputFrame = { sourceTime, overrides, environment: authorEffectEnvironmentForClip(document, plan.clip),
              info: { audio: plan.context.audio, audioTime: plan.context.audioTime, time: plan.context.time, frameDuration: 1 / document.fps,
                clip: { time: plan.context.localTime, duration: plan.clip.duration / document.fps }, ...(Object.keys(web).length ? { web } : {}) } }
            if (options.spatialFrame && (plan.program as CodeMaterialProgram & AuthorEffectMetadata).space) {
              plan.outputFrame.info.space = await authorSpaceInfo(options.spatialFrame, plan.clip.id, plan.context.time, plan.context.time)
            }
          }
          const contentKey = plan.program ? this.reuseOutputs ? await this.outputKey(document, plan, frame, inputs, options) : undefined : plan.static ? plan.key : undefined
          assertCurrent()
          contentKeys.set(plan, contentKey)
        }
        // 内容身份用于共享，物理目标保持稳定；先保住本帧仍会命中的目标，再把闲置目标交给变化的内容。
        const shared = new Map<string, string>()
        const requested = new Set(plans.filter(plan => plan.program && plan.static && !options.observeElements).flatMap(plan => contentKeys.get(plan) ? [contentKeys.get(plan)!] : []))
        for (const [target, output] of this.lastOutputs) if (target.startsWith('code:shared:') && requested.has(output.key) && !shared.has(output.key)) shared.set(output.key, target)
        const used = new Set(shared.values())
        const available = [...this.targetPictures.keys()].filter(key => key.startsWith('code:shared:') && !used.has(key))
        for (const contentKey of requested) if (!shared.has(contentKey)) shared.set(contentKey, available.shift() ?? `code:shared:${++this.outputTargetSequence}`)
        keys.clear()
        for (const key of options.surfaceKeys ?? []) keys.add(key)
        for (const plan of plans) {
          if (plan.program && plan.static && !options.observeElements) plan.key = shared.get(contentKeys.get(plan) ?? '') ?? plan.key
          keys.add(plan.key)
        }
        this.releaseUnused(keys)
        for (const bitmap of this.spilledPictures) bitmap.close()
        this.spilledPictures.clear()
        const resident = this.targetPictures
        const capacity = Math.min(...plans.map(plan => this.runtime?.generatorTargetCapacity?.(plan.context.width, plan.context.height, (this.targetPictures.get(plan.key) as VideoEditCodePicture | undefined)?.textureFormat) ?? Infinity))
        for (const plan of plans) {
          assertCurrent()
          const contentKey = contentKeys.get(plan)
          const previous = this.lastOutputs.get(plan.key)
          let picture = contentKey && !options.observeElements && previous?.key === contentKey && previous.gpuEpoch === videoEditGpuOutputEpoch() ? previous.picture : undefined
          if (picture) { result.cacheHits++; if (plan.program) this.outputReuse.hits++; options.gpuFrame?.reuse(previous?.gpuOutcome) }
          else {
            // 作者可能先写目标再失败；开始覆写前就撤销旧键，取消也不能把半帧登记成命中。
            this.lastOutputs.delete(plan.key)
            if (plan.program) this.outputReuse[contentKey ? 'misses' : 'bypasses']++
            while (!resident.has(plan.key) && resident.size >= capacity && this.runtime?.spillGeneratorTarget) {
              const candidate = [...resident].find(([, picture]) => !('highPrecision' in picture && picture.highPrecision))
              if (!candidate) break
              const [oldKey, oldPicture] = candidate
              const bitmap = await this.runtime.spillGeneratorTarget(oldKey)
              if (!bitmap) break
              this.spilledPictures.add(bitmap); resident.delete(oldKey); this.lastOutputs.delete(oldKey)
              for (const [id, value] of result.pictures) if (value === oldPicture) result.pictures.set(id, bitmap)
              assertCurrent()
            }
            if (plan.draws) {
              if (!this.runtime!.draw) throw new Error('当前GPU会话不支持结构化图形绘制。')
              picture = await this.runtime!.draw(plan.key, plan.context.width, plan.context.height, plan.draws, undefined, Math.min(document.width / plan.context.width, document.height / plan.context.height) * plan.clip.scale)
            } else {
              // GPU 入口直接采样纹理；位图只在作者代码真读 assets 时才生成。
              const assets: Record<string, CanvasImageSource> = {}, images: Record<string, AuthorGpuImage> = {}
              for (const [name, key] of plan.imageKeys) {
                const input = inputs?.get(key)
                if (!input) throw new Error(`作者图片参数 ${name} 没有可绘制的源画面。`)
                images[name] = { texture: input.texture, width: input.width, height: input.height }
                Object.defineProperty(assets, name, { enumerable: true, get: () => {
                  if (!input.source) throw new Error(`作者图片参数 ${name} 没有可绘制的源画面。`)
                  return input.source
                } })
              }
              const { info, overrides, environment } = plan.outputFrame!
              picture = await this.runtime!.authorGenerator(plan.key, plan.clip.id, plan.program!, plan.context, plan.author, assets satisfies AuthorAssets, info, overrides, videoEditCodeMotionBlur(document, plan.clip, plan.program!.apiVersion ?? 0), images, plan.divisor ?? 1, environment, options.quality, assertCurrent, ...(plan.simulation ? [plan.simulation] : []))
            }
            assertCurrent()
            if (contentKey) this.lastOutputs.set(plan.key, { key: contentKey, picture, gpuEpoch: videoEditGpuOutputEpoch(), ...(options.gpuFrame ? { gpuOutcome: options.gpuFrame.outcome } : {}) })
          }
          resident.delete(plan.key); resident.set(plan.key, picture)
          if (picture instanceof VideoEditCodePicture) picture.contentKey = contentKey
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
  private async outputKey(document: VideoEditComposition, plan: VideoEditCodePlan, frame: number,
    inputs: ReadonlyMap<string, VideoEditCodeImageInput> | undefined, options: VideoEditCodePrepareOptions): Promise<string | undefined> {
    const dependencies = codeOutputInputs(document, plan, frame, inputs, options.exactInput ?? (() => false))
    if (!dependencies) return undefined
    const program = plan.program!, context = plan.context
    const { overrides, info, environment } = plan.outputFrame!
    const declared = await this.runtime?.authorFrameKey?.(program, context, plan.author, info, overrides, videoEditCodeMotionBlur(document, plan.clip, program.apiVersion ?? 0), plan.divisor ?? 1, environment, dependencies)
    // 旧接口没有文字身份，逐帧不进入作者运行时取身份。
    const textIdentity = authorBundleShapesText(program.bundle) ? await this.runtime?.authorTextIdentity?.(program, plan.author) : undefined
    return codeOutputKey(document, plan, dependencies, declared, options.quality, textIdentity)
  }
  /** 片段在这一帧的作用区域蒙版（智能区域按素材时间取分析结果，手绘遮罩按几何栅格化）；读取失败只记日志，效果按未就绪跳过。 */
  /**
   * 读取失败时预览只记日志、这一帧先不画这个效果；最终画质（导出、预渲染、录屏成品）报错，不交出缺了效果的画面。
   * 还没有分析结果（返回 undefined）不算失败，导出前由区域分析的等待保证就绪。
   */
  private async regionMask(document: VideoEditComposition, clip: VideoEditClip, mask: NonNullable<VideoEditEffect['mask']>, frame: number, strict: boolean): Promise<VideoEditSmartRegionMask | undefined> {
    const media = videoEditClipMedia(document, clip)
    const visual = media && (media.kind === 'video' || media.kind === 'image') ? media : undefined
    const timeUs = !visual || visual.kind === 'image' ? 0 : Math.round(videoEditSourceSeconds(videoEditClipSourceTimeAt(clip, frame - clip.start, document.frameRate, true)) * 1e6)
    const pathTimeUs = videoEditSourceSeconds(videoEditClipSourceTimeAt(clip, frame - clip.start, document.frameRate, true)) * 1e6
    try { return await videoEditEffectMask(mask, { trackerKeys: Object.fromEntries((clip.trackers ?? []).map(tracker => [tracker.id, videoEditTrackerResultKey(document, clip, media?.id ?? '', tracker)])), mediaUrl: visual?.path, picture: videoEditClipPictureSize(document, clip), timeUs, pathTimeUs }) } catch (error) {
      logger.warn('作用区域蒙版读取失败', { event: 'video_edit.smart_region.mask_failed', error, context: { sequenceId: document.id, clipId: clip.id, region: mask.regionId, strict } })
      if (strict) throw new Error(`区域蒙版读取失败：片段“${clip.name}”的效果要用到的区域分析结果读不出来，请稍后重试导出；多次失败可在效果控件里重新分析。`, { cause: error })
      return undefined
    }
  }
  observeElements(frame: number): import('@/core/videoEdit/codeAuthorProgram').CodeAuthorFrameObservation {
    const clips = this.document.clips.flatMap(clip => {
      if (!clip.code || clip.kind !== 'code' || frame < clip.start || frame >= clip.start + clip.duration) return []
      const program = this.programs.get(identity(clip.code.definitionId, clip.code.versionId))?.program
      if (!program) return []
      return [{ clipId: clip.id, versionId: clip.code.versionId, ...codeMaterialSize(program, this.document), ...(clip.edits ? { edits: clip.edits } : {}), elements: (this.runtime?.observeAuthor(clip.id) ?? []).map(element => ({ ...element, edits: codeElementEdits(clip.edits, element.id, element.parameterKeys) })) }]
    })
    return { sequenceId: this.document.id, revision: this.document.revision, frame, clips }
  }
  diagnostics() { return { programs: this.programs.size, programBytes: this.programBytes, outputPictures: this.lastOutputs.size, outputReuse: { ...this.outputReuse }, seenVersions: this.known.size, seenManifestBytes: this.knownBytes, compiler: this.compiler.diagnostics?.() } }
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true; this.cursorSources.clear(); this.zoomPointers.clear(); this.cancel(); this.compiler.dispose(); this.protectedKeys.clear(); this.inputFailures.clear()
    await Promise.allSettled([this.gpuWork])
    const spatialReleases = await Promise.allSettled([...this.spatialFrames.keys()].map(prepared => this.releaseSpatialFrame(prepared)))
    this.spilledPictures.forEach(bitmap => bitmap.close()); this.spilledPictures.clear(); this.targetPictures.clear()
    try { this.runtime?.releaseUnused(new Set()) }
    finally { this.programs.clear(); this.programBytes = 0; this.lastOutputs.clear(); this.known.clear(); this.knownBytes = 0 }
    const failures = spatialReleases.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (failures.length) throw new AggregateError(failures, '空间代码会话释放失败。')
  }
}
