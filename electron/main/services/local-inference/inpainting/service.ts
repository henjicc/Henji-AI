import { randomUUID } from 'node:crypto'
import type { LocalModelId } from '../../../../../src/platform/contracts/localModels'
import type { LocalInferenceHost } from '../host'
import { LocalInferenceFailure } from '../host'
import type { LocalInferenceLog, LocalExecutionProvider } from '../providers'
import { assertInpaintRoi, type ImageInpaintJob, type ImageInpaintQuality, type ImageInpaintResult, type InpaintRoi } from './protocol'

/** 资源引用只在宿主内部解析；不接受本地路径、远程 URL 或任意张量。 */
export interface InpaintImageRef { id: string }
export interface InpaintResourceLease { path: string; release(): Promise<void> }
export interface ImageInpaintInput { image: InpaintImageRef; mask: InpaintImageRef; roi: InpaintRoi; quality: ImageInpaintQuality }
export interface ImageInpaintOutput extends Omit<ImageInpaintResult, 'outputPath'> { patch: InpaintImageRef }
export interface ImageInpaintProgress { stage: 'resolving' | 'downloading' | 'processing' | 'publishing'; done: number; total: number }
export interface InpaintResourceAccess {
  /** 获得不可变快照/lease；在后台作业真正结束前保留，即使调用方已经取消等待。 */
  acquire(ref: InpaintImageRef): Promise<InpaintResourceLease>
  /** 将临时 PNG 复制/导入调用方正式资源库后返回引用；不能只返回临时路径的别名。 */
  publishCopy(file: string): Promise<InpaintImageRef>
  /** 发布过程中取消时回收尚未交给调用方的结果。 */
  discard(ref: InpaintImageRef): Promise<void>
}
export interface ImageInpaintServiceDependencies {
  resources: InpaintResourceAccess
  inference: Pick<LocalInferenceHost, 'inpaint' | 'cancel'>
  ensureModel(id: LocalModelId): Promise<string>
  temporaryPath(id: string): Promise<string>
  removeTemporary(file: string): Promise<void>
  providers: LocalExecutionProvider[]
  log: LocalInferenceLog
}

/** 取消只结束调用者的等待，不杀共享 utility、不取消其他消费者共用的模型下载。 */
function cancellable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(new LocalInferenceFailure('cancelled', '图片修补已取消。'))
    if (signal.aborted) { abort(); void promise.catch(() => undefined); return }
    signal.addEventListener('abort', abort, { once: true })
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export class ImageInpaintService {
  private readonly active = new Map<string, AbortController>()
  private disposed = false
  constructor(private readonly deps: ImageInpaintServiceDependencies) {}
  hasActiveJobs(): boolean { return this.active.size > 0 }

  run(input: ImageInpaintInput, options: { signal?: AbortSignal; progress?: (value: ImageInpaintProgress) => void } = {}): Promise<ImageInpaintOutput> {
    if (this.disposed) return Promise.reject(new LocalInferenceFailure('cancelled', '图片修补服务已关闭。'))
    try {
      assertInpaintRoi(input.roi)
      for (const [field, ref] of Object.entries({ image: input.image, mask: input.mask })) {
        if (!ref || typeof ref.id !== 'string' || !ref.id.trim() || Object.keys(ref).some(key => key !== 'id')) throw new Error(`${field} 必须是图片资源引用。`)
      }
      if (!['fast', 'fine', 'blemish'].includes(input.quality)) throw new Error('quality 必须是 fast、fine 或 blemish。')
      if (Object.keys(input).some(key => !['image', 'mask', 'roi', 'quality'].includes(key))) throw new Error('图片修补输入包含未知字段。')
    } catch (error) { return Promise.reject(error) }
    // 避免调用者拖动选区或切换质量档改变已经提交的作业。
    const snapshot: ImageInpaintInput = { image: { ...input.image }, mask: { ...input.mask }, roi: { ...input.roi }, quality: input.quality }
    const id = randomUUID(); const controller = new AbortController()
    const abort = (): void => { controller.abort(); this.deps.inference.cancel(id) }
    if (options.signal?.aborted) return Promise.reject(new LocalInferenceFailure('cancelled', '图片修补已取消。'))
    options.signal?.addEventListener('abort', abort, { once: true })
    this.active.set(id, controller)
    const work = this.execute(id, snapshot, controller.signal, options.progress).finally(() => {
      this.active.delete(id); options.signal?.removeEventListener('abort', abort)
    })
    return cancellable(work, controller.signal)
  }

  private async execute(id: string, input: ImageInpaintInput, signal: AbortSignal, progress?: (value: ImageInpaintProgress) => void): Promise<ImageInpaintOutput> {
    const leases: InpaintResourceLease[] = []
    let file: string | undefined
    let published: InpaintImageRef | undefined
    const check = (): void => { if (signal.aborted) throw new LocalInferenceFailure('cancelled', '图片修补已取消。') }
    const report = (stage: ImageInpaintProgress['stage'], done = 0, total = 1): void => { if (!signal.aborted) progress?.({ stage, done, total }) }
    this.deps.log('info', '图片修补作业开始', 'image_inpaint.job.start', { requestId: id, quality: input.quality })
    try {
      report('resolving')
      for (const ref of [input.image, input.mask]) { check(); leases.push(await this.deps.resources.acquire(ref)) }
      check()
      const algorithm = input.quality === 'fine' ? 'lama' : input.quality === 'blemish' ? 'telea' : 'migan'
      let model: ImageInpaintJob['model']
      if (algorithm !== 'telea') {
        report('downloading')
        const modelPath = await this.deps.ensureModel(algorithm === 'lama' ? 'image_inpainting_lama' : 'image_inpainting_migan')
        check(); model = { name: algorithm, path: modelPath }
      }
      file = await this.deps.temporaryPath(id)
      check()
      const result = await this.deps.inference.inpaint({ id, sourcePath: leases[0].path, maskPath: leases[1].path, roi: input.roi,
        quality: input.quality, algorithm, model,
        // 固定 Carve FP32 图的 Fourier MatMul 在本机 DML 真跑失败；直接选 CPU，避免每次冷启动编译后再失败。
        // 保留其他平台现有 EP 顺序；图版本改变时需重新跑同输入对照再开放 DML。
        providers: algorithm === 'lama' ? [...this.deps.providers.filter(provider => provider !== 'dml'), 'cpu' as const].filter((provider, index, all) => all.indexOf(provider) === index) : this.deps.providers,
        outputPath: file }, (done, total) => report('processing', done, total))
      check()
      if (result.outputPath !== file || result.roi.left !== input.roi.left || result.roi.top !== input.roi.top
        || result.roi.width !== input.roi.width || result.roi.height !== input.roi.height || result.algorithm !== algorithm) throw new Error('图片修补后台回执与冻结作业不一致。')
      report('publishing')
      published = await this.deps.resources.publishCopy(file)
      check()
      const { outputPath: _outputPath, ...metrics } = result
      this.deps.log('info', '图片修补作业完成', 'image_inpaint.job.completed', { requestId: id, algorithm, provider: result.provider, durationMs: result.durationMs })
      return { ...metrics, patch: published }
    } catch (error) {
      if (published) {
        try { await this.deps.resources.discard(published) }
        catch (cleanupError) { this.deps.log('warn', '未交付的修补结果回收失败', 'image_inpaint.cleanup.failed', { requestId: id, reason: String(cleanupError) }) }
      }
      this.deps.log('warn', '图片修补作业失败', 'image_inpaint.job.failed', { requestId: id, cancelled: signal.aborted, reason: error instanceof Error ? error.message : String(error) })
      throw error
    } finally {
      // 失败也必须释放所有资源；清理错误写现有日志，不覆盖原来的推理失败。
      const cleanup = await Promise.allSettled([...leases.map(lease => lease.release()), ...(file ? [this.deps.removeTemporary(file)] : [])])
      for (const result of cleanup) if (result.status === 'rejected') this.deps.log('warn', '图片修补临时资源清理失败', 'image_inpaint.cleanup.failed', { requestId: id, reason: String(result.reason) })
    }
  }

  dispose(): void { this.disposed = true; for (const [id, controller] of this.active) { controller.abort(); this.deps.inference.cancel(id) } }
}
