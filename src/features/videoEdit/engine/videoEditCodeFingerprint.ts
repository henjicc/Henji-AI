import { videoEditCodeInputs } from '@/core/videoEdit/codeInputParameters'
import { videoEditSceneFootprints, videoEditSceneRecordsInRange } from '@/core/videoEdit/scene/sceneFootprint'
import type { CodeAuthorBundle, CodeAuthorProgram } from '@/core/videoEdit/codeAuthorProgram'
import { codeMaterialUsesAudio } from '@/core/videoEdit/codeMaterialResources'
import { codeMaterialVersion } from '@/core/videoEdit/codeMaterialDocument'
import { codeVersionContentKey, documentCodeSourceResolver, resolveCodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { codeMediaInputSample, codeMediaInputReference, codeMediaInputClipSeconds } from '@/core/videoEdit/codeMediaInput'
import { codeWebPixelSize, codeWebView } from '@/core/videoEdit/codeMaterial/webSource'
import { evaluateCodeElementOverride } from '@/core/videoEdit/codeElementOverrides'
import { videoEditClipSourceTimeAt } from '@/core/videoEdit/clipSpeed'
import { videoEditPictureTransitionWindows, type VideoEditComposition } from '@/core/videoEdit/document'
import { renderFingerprintHash, renderSceneRecordFingerprint, type VideoEditFrameFingerprint } from '@/core/videoEdit/renderFingerprint'
import { VideoEditCodeSources, type VideoEditCodePlan } from './videoEditCodeSources'
import { loadAuthorModule, type AuthorModule, type AuthorFrameInfo } from './videoEditAuthorModule'
import { authorEffectMetadata, authorParameterValues } from './videoEditAuthorParameters'
import { prepareAuthorModuleUrls } from './videoEditAuthorModules'
import { authorEffectEnvironmentForClip } from '@/core/videoEdit/authorEffects'
import { authorFrameCodeIdentity, fingerprintAuthorFrame, fingerprintAuthorFrameKey, type AuthorFingerprintInput } from './videoEditAuthorFingerprint'

/** 属于预渲染会话的 Worker；使用正式编译、信任、参数与时间求值入口，完全不获取 GPU。 */
export class VideoEditCodeFingerprint {
  private readonly modules = new Map<CodeAuthorBundle, Promise<AuthorModule>>()
  private readonly releases: Array<() => void> = []
  private readonly sources: VideoEditCodeSources
  private readonly plans = new Map<string, ReturnType<VideoEditCodeSources['prepareGeneratorFrames']>>()
  private readonly transitions
  private readonly clips
  private readonly controller = new AbortController()
  private measure?: OffscreenCanvasRenderingContext2D
  private readonly media: Map<string, VideoEditComposition['media'][number]>
  private readonly mediaDigests = new Map<string, string>()
  private readonly codeIdentities = new WeakMap<CodeAuthorBundle, string>()
  constructor(private readonly document: VideoEditComposition) {
    this.transitions = videoEditPictureTransitionWindows(document)
    this.clips = new Map(document.clips.map(clip => [clip.id, clip]))
    this.media = new Map(document.media.map(media => [media.id, media]))
    this.sources = new VideoEditCodeSources(document, async () => ({
      inspectAuthor: async bundle => this.inspect(bundle),
      authorGenerator: async () => { throw new Error('指纹计算不能进入栅格化') },
      retainAuthorInstances: async () => undefined, observeAuthor: () => [], releaseUnused: () => undefined,
    }))
  }
  private module(bundle: CodeAuthorBundle): Promise<AuthorModule> {
    let module = this.modules.get(bundle)
    if (!module) {
      module = prepareAuthorModuleUrls(bundle).then(async urls => {
        this.releases.push(urls.dispose)
        return loadAuthorModule(urls.url, [...bundle.trustContext ?? bundle.modules?.trustContext ?? [], ...this.document.foreign ? [this.document.foreign] : []])
      })
      this.modules.set(bundle, module)
    }
    return module
  }
  private async inspect(bundle: CodeAuthorBundle): Promise<CodeAuthorProgram> {
    return { ...authorEffectMetadata(await this.module(bundle), bundle.apiVersion), seed: 0, apiVersion: bundle.apiVersion ?? 4, languageVersion: 4, bundle }
  }
  /** 一次消息处理一个受预算约束的连续区间；下一批由宿主让出后再发，不占用节目渲染队列。 */
  async frames(clipId: string, start: number, end: number, webContent: Readonly<Record<string, string>>, budgetMs: number): Promise<Array<[number, VideoEditFrameFingerprint]>> {
    const result: Array<[number, VideoEditFrameFingerprint]> = [], started = performance.now()
    for (let frame = start; frame < end; frame++) {
      result.push([frame, await this.frame(clipId, frame, webContent)])
      if (performance.now() - started >= budgetMs) break
    }
    return result
  }
  async frame(clipId: string, frame: number, webContent: Readonly<Record<string, string>>): Promise<VideoEditFrameFingerprint> {
    const clip = this.clips.get(clipId)
    if (!clip?.code || clip.kind !== 'code') return { fallback: 'not-code-generator' }
    try {
      let prepared = this.plans.get(clipId)
      if (!prepared) { prepared = this.sources.prepareGeneratorFrames(clip, this.controller.signal); this.plans.set(clipId, prepared) }
      const evaluate = await prepared
      const window = this.transitions.find(window => (window.left.id === clipId || window.right.id === clipId) && frame >= window.start && frame < window.end)
      return await this.plan(evaluate(frame, window), frame, webContent)
    } catch (error) { return { fallback: `author-error:${error instanceof Error ? error.message : String(error)}` } }
  }
  private async plan(plan: VideoEditCodePlan | undefined, frame: number, webContent: Readonly<Record<string, string>>): Promise<VideoEditFrameFingerprint> {
    if (!plan?.program) return { fallback: 'missing-program' }
    const program = plan.program
    if (codeMaterialUsesAudio(program)) return { fallback: 'audio-dependent' }
    const effect = await this.module(program.bundle)
    const declared = typeof effect.frameKey === 'function'
    if (!declared && (effect.createWebGPU || effect.createWebGL)) return { fallback: 'native-gpu' }
    const inputs: Record<string, AuthorFingerprintInput> = {}
    let hasWeb = false
    for (const [key] of plan.imageKeys) {
      const reference = codeMediaInputReference(plan.inputParameters?.[key], key)
      if (!reference) return { fallback: 'missing-input' }
      if (reference.kind === 'sequence') return { fallback: 'sequence-input' }
      const sample = reference.kind === 'image' ? undefined : codeMediaInputSample(plan.clip, reference, frame, this.document.frameRate)
      if (reference.kind === 'web') {
        const content = webContent[reference.path]
        if (!content || content === 'unknown' || content === 'unavailable') return { fallback: 'unknown-web-content' }
        hasWeb = true
        inputs[key] = { ...codeWebPixelSize(codeWebView(reference)), identity: JSON.stringify([reference, content, sample]) }
      } else {
        const media = this.media.get(reference.mediaId)
        if (!media) return { fallback: 'missing-media' }
        let identity = this.mediaDigests.get(media.id)
        if (!identity) { identity = renderFingerprintHash(JSON.stringify(media)); this.mediaDigests.set(media.id, identity) }
        inputs[key] = { width: media.width, height: media.height, dimensionsKnown: false, identity: JSON.stringify([identity, sample]) }
      }
    }
    const info: AuthorFrameInfo = { time: plan.context.time, frameDuration: 1 / this.document.fps, clip: { time: plan.context.localTime, duration: plan.clip.duration / this.document.fps } }
    // 页面几何与 duration 只能执行网页后得知；只画网页截图可以按内容和时间寻址，读页面信息则保守回退。
    if (hasWeb) Object.defineProperty(info, 'web', { enumerable: true, get: () => { throw new Error('web-layout-required') } })
    const sourceTime = videoEditClipSourceTimeAt(plan.clip, frame - plan.clip.start, this.document.frameRate, plan.transitionHandles && program.mode === 'static')
    const overrides = plan.clip.elementOverrides ? Object.fromEntries(Object.entries(plan.clip.elementOverrides).map(([id, value]) => [id, evaluateCodeElementOverride(value, sourceTime)])) : undefined
    const params = authorParameterValues({ ...program, types: program.types ?? {} }, plan.author)
    let result: VideoEditFrameFingerprint
    if (declared) {
      let identity = this.codeIdentities.get(program.bundle)
      if (!identity) {
        const version = codeMaterialVersion(this.document, plan.clip.code!)
        const files = { ...resolveCodeMaterialFiles(version, documentCodeSourceResolver()), apiVersion: program.apiVersion, libraries: version.libraries }
        identity = authorFrameCodeIdentity(files, effect, codeVersionContentKey({ ...version, files: [] }))
        this.codeIdentities.set(program.bundle, identity)
      }
      result = fingerprintAuthorFrameKey(effect, plan.context, params, info, inputs, identity, plan.parameters, overrides, this.document.motionBlur === true, authorEffectEnvironmentForClip(this.document, plan.clip), program.apiVersion)
    } else {
      const measure = this.measure ??= new OffscreenCanvas(1, 1).getContext('2d') ?? undefined
      if (!measure) return { fallback: 'canvas-unavailable' }
      result = fingerprintAuthorFrame(effect, plan.context, params, info, inputs, measure, overrides, this.document.motionBlur === true, authorEffectEnvironmentForClip(this.document, plan.clip), program.apiVersion)
    }
    if (!result.digest) return result
    const scenes = videoEditCodeInputs(this.document, plan.clip.code, () => program.parameters)?.scenes
    const time = codeMediaInputClipSeconds(plan.clip, frame, this.document.frameRate)
    const records = Object.entries(scenes ?? {}).map(([key, scene]) => [key, videoEditSceneRecordsInRange(videoEditSceneFootprints(scene), time, time + 1 / this.document.fps).map(renderSceneRecordFingerprint)])
    return records.length ? { ...result, digest: renderFingerprintHash(JSON.stringify([result.digest, records])) } : result
  }
  async dispose(): Promise<void> {
    this.controller.abort()
    await this.sources.dispose()
    try { await Promise.allSettled([...this.modules.values()].map(async module => (await module).dispose?.())) }
    finally { this.releases.forEach(release => release()); this.modules.clear(); this.releases.length = 0 }
  }
}
