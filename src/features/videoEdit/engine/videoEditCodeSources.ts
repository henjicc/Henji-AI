import { createLogger } from '@/core/logging'
import { codeMaterialSource } from '@/core/videoEdit/codeMaterialDocument'
import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeMaterialProgram, CodeParameterValues } from '@/core/videoEdit/codeMaterial/contract'
import { evaluateCodeMaterialParameters, prepareCodeMaterialParameters } from '@/core/videoEdit/codeMaterialAnimation'
import type { PreparedCodeMaterialParameters } from '@/core/videoEdit/codeMaterialAnimation'
import type { CodeMaterialInstance } from '@/core/videoEdit/codeMaterialPersistence'
import { offsetVideoEditSource } from '@/core/videoEdit/time'
import { codeMaterialContextForFrame } from '@/core/videoEdit/codeMaterialTiming'
import type { CodeMaterialVersion } from '@/core/videoEdit/codeMaterialPersistence'
import type { VideoEditClip, VideoEditComposition } from '@/core/videoEdit/document'
import { VideoEditCodeCompiler } from './videoEditCodeCompiler'
import type { VideoEditCodeGpu, VideoEditCodePicture } from './videoEditCodeGpu'
import type { VideoEditCodeImageInput } from './videoEditCodeGpu'
import { codeMaterialImageIds } from '@/core/videoEdit/codeMaterialResources'

const logger = createLogger('features.videoEdit.codeSources')
const MAX_PROGRAMS = 32; const MAX_PROGRAM_BYTES = 16 * 1024 ** 2
const MAX_SEEN_VERSIONS = 4096; const MAX_SEEN_SOURCE_BYTES = 8 * 1024 ** 2
type CodeRuntime = Pick<VideoEditCodeGpu, 'generator' | 'releaseUnused'>
type Compiler = Pick<VideoEditCodeCompiler, 'compile' | 'dispose'> & Partial<Pick<VideoEditCodeCompiler, 'diagnostics'>>
interface KnownVersion { source: string; apiVersion: number; languageVersion: number; bytes: number }
interface CachedProgram { source: string; program: CodeMaterialProgram; bytes: number }
interface Plan { clip: VideoEditClip; key: string; program: CodeMaterialProgram; parameters: CodeParameterValues; context: ReturnType<typeof codeMaterialContextForFrame> }
export interface PreparedCodeSources { pictures: Map<string, VideoEditCodePicture>; sourceTimestamps: number[]; cacheHits: number }
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
  private readonly staticPictures = new Map<string, VideoEditCodePicture>()
  private readonly parameters = new WeakMap<CodeMaterialInstance, { program: CodeMaterialProgram; prepared: PreparedCodeMaterialParameters }>()
  private runtime?: CodeRuntime
  private controller?: AbortController
  private epoch = 0
  private disposed = false
  private protectedKeys = new Set<string>()
  private gpuWork: Promise<void> = Promise.resolve()
  private releaseUnused(keys: ReadonlySet<string>): void {
    this.runtime?.releaseUnused(keys)
    for (const key of this.staticPictures.keys()) if (!keys.has(key)) this.staticPictures.delete(key)
  }
  constructor(private document: VideoEditComposition, private readonly acquireRuntime: () => Promise<CodeRuntime>, private readonly compiler: Compiler = new VideoEditCodeCompiler()) { this.checkVersions(document) }
  private checkVersions(document: VideoEditComposition): void {
    const additions = new Map<string, KnownVersion>(); let bytes = this.knownBytes
    for (const definition of document.codeMaterials ?? []) for (const version of definition.versions) {
      const key = identity(definition.id, version.id); const known = this.known.get(key) ?? additions.get(key)
      if (known) {
        if (known.source !== version.source || known.apiVersion !== version.apiVersion || known.languageVersion !== version.languageVersion) throw new CodeMaterialError('COMPATIBILITY', '不可变代码版本被改写，请创建新版本。')
        continue
      }
      if (typeof version.source !== 'string' || version.source.length > 65536) throw new CodeMaterialError('SOURCE_LIMIT', '源码最多64KiB。')
      const size = new TextEncoder().encode(version.source).byteLength
      if (size > 65536) throw new CodeMaterialError('SOURCE_LIMIT', '源码最多64KiB。')
      bytes += size
      if (this.known.size + additions.size >= MAX_SEEN_VERSIONS || bytes > MAX_SEEN_SOURCE_BYTES) throw new CodeMaterialError('BUDGET', '本次预览已见源码超过4096版本或8MiB，请重新加载预览。')
      additions.set(key, { source: version.source, apiVersion: version.apiVersion, languageVersion: version.languageVersion, bytes: size })
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
    const cached = this.programs.get(key)
    if (cached) {
      if (cached.source !== version.source) throw new CodeMaterialError('COMPATIBILITY', '不可变代码版本被改写，请创建新版本。')
      this.programs.delete(key); this.programs.set(key, cached); return cached.program
    }
    logger.debug('可见代码源码检查开始', { event: 'video_edit.code.compile.start', context: { sequenceId: this.document.id, version: key } })
    try {
      const program = await this.compiler.compile(version.source, signal); signal.throwIfAborted()
      if (program.apiVersion !== version.apiVersion || program.languageVersion !== version.languageVersion) throw new CodeMaterialError('COMPATIBILITY', '代码源码协议与固定版本声明不一致。')
      const bytes = new TextEncoder().encode(version.source).byteLength + new TextEncoder().encode(JSON.stringify(program)).byteLength
      while (this.programs.size >= MAX_PROGRAMS || this.programBytes + bytes > MAX_PROGRAM_BYTES) {
        const oldest = [...this.programs].find(([key]) => !pinned.has(key))
        if (!oldest) throw new CodeMaterialError('BUDGET', '本帧源码编译缓存超过32份或16MiB预算。')
        this.programs.delete(oldest[0]); this.programBytes -= oldest[1].bytes
      }
      this.programs.set(key, { source: version.source, program: freezeProgram(program), bytes }); this.programBytes += bytes
      logger.debug('可见代码源码检查完成', { event: 'video_edit.code.compile.completed', context: { sequenceId: this.document.id, version: key } })
      return program
    } catch (error) {
      if (!signal.aborted) logger.warn('可见代码源码检查失败', { event: 'video_edit.code.compile.failed', error, context: { sequenceId: this.document.id, version: key } })
      throw error
    }
  }
  async prepare(document: VideoEditComposition, clips: VideoEditClip[], frame: number, shouldPresent: () => boolean, images?: Promise<ReadonlyMap<string, VideoEditCodeImageInput> | undefined>): Promise<PreparedCodeSources> {
    this.cancel(); const epoch = this.epoch; const controller = new AbortController(); this.controller = controller
    // A decode can reject while source compilation is still pending.
    const imageOutcome = images ? Promise.allSettled([images]) : undefined
    const assertCurrent = (): void => { if (this.disposed || controller.signal.aborted || this.epoch !== epoch || this.document !== document || !shouldPresent()) throw new DOMException('旧代码画面已取消。', 'AbortError') }
    const plans: Plan[] = []; const keys = new Set<string>()
    const pinned = new Set(clips.flatMap(clip => clip.code ? [identity(clip.code.definitionId, clip.code.versionId)] : []))
    try {
      for (const clip of clips) {
        assertCurrent()
        if (clip.kind !== 'code' || !clip.code) throw new CodeMaterialError('COMPATIBILITY', '代码片段缺少固定源码实例。')
        const version = codeMaterialSource(document, clip.code)
        const key = identity(clip.code.definitionId, clip.code.versionId)
        const program = await this.program(key, version, controller.signal, pinned); assertCurrent()
        if (program.kind !== 'generator') throw new CodeMaterialError('TYPE', '单输入滤镜不能作为生成片段渲染。')
        let animation = this.parameters.get(clip.code)
        if (!animation || animation.program !== program) { animation = { program, prepared: prepareCodeMaterialParameters(program, clip.code) }; this.parameters.set(clip.code, animation) }
        const parameters = evaluateCodeMaterialParameters(animation.prepared, offsetVideoEditSource(clip, frame - clip.start, document.frameRate))
        const context = codeMaterialContextForFrame(clip, frame, document.frameRate, program)
        const imageSources = [...codeMaterialImageIds(clip.code)].map(id => { const media = document.media.find(media => media.id === id && media.kind === 'image'); if (!media) throw new Error('代码图片引用不存在。'); return [id, media.path, media.sourceRevision, media.width, media.height] })
        const target = program.mode === 'static' ? `code:static:${JSON.stringify([key, parameters, imageSources])}` : `code:dynamic:${clip.id}`
        keys.add(target)
        if (keys.size > 16) throw new CodeMaterialError('BUDGET', '代码素材同时最多16个渲染目标。')
        plans.push({ clip, key: target, program, parameters, context })
      }
      assertCurrent(); this.protectedKeys = keys
      const result: PreparedCodeSources = { pictures: new Map(), sourceTimestamps: plans.map(plan => plan.context.time), cacheHits: 0 }
      // Serialize GPU mutations, including a generator whose readiness resolves after cancellation.
      const work = this.gpuWork.then(async () => {
        assertCurrent()
        if (plans.length) { this.runtime ??= await this.acquireRuntime(); assertCurrent() }
        const outcome = (await imageOutcome)?.[0]
        if (outcome?.status === 'rejected') throw outcome.reason
        const inputs = outcome?.status === 'fulfilled' ? outcome.value : undefined; assertCurrent()
        this.releaseUnused(keys)
        for (const plan of plans) {
          assertCurrent()
          let picture = plan.program.mode === 'static' ? this.staticPictures.get(plan.key) : undefined
          if (picture) result.cacheHits++
          else {
            picture = await this.runtime!.generator(plan.key, plan.program, plan.context, plan.parameters, inputs)
            assertCurrent()
            if (plan.program.mode === 'static') this.staticPictures.set(plan.key, picture)
          }
          result.pictures.set(plan.clip.id, picture)
        }
      })
      this.gpuWork = work.catch(() => { this.releaseUnused(this.protectedKeys) })
      await work; assertCurrent(); return result
    } finally { if (this.controller === controller) this.controller = undefined }
  }
  diagnostics() { return { programs: this.programs.size, programBytes: this.programBytes, staticPictures: this.staticPictures.size, seenVersions: this.known.size, seenSourceBytes: this.knownBytes, compiler: this.compiler.diagnostics?.() } }
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true; this.cancel(); this.compiler.dispose(); this.protectedKeys.clear()
    await Promise.allSettled([this.gpuWork])
    try { this.runtime?.releaseUnused(new Set()) }
    finally { this.programs.clear(); this.programBytes = 0; this.staticPictures.clear(); this.known.clear(); this.knownBytes = 0 }
  }
}
