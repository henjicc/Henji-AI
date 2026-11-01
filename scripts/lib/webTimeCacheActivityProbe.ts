import path from 'node:path'
import { VideoDecoderService } from '../../electron/main/services/video-decoder/client'
import { WebCacheActivity } from '../../electron/main/services/web-source/activity'
import { WebCacheSubmissions } from '../../electron/main/services/web-source/submissions'
import { createMainLogger } from '../../electron/main/services/logging/main-logger'

/** 仅结束本专项创建的原生进程；第三个进程只扮演后台，不观察其他应用。 */
export async function activityProbe(ffmpeg: string): Promise<unknown> {
  const logger = createMainLogger('main.web_source')
  const services = Array.from({ length: 3 }, () => new VideoDecoderService({ resolveExecutable: () => path.join(path.dirname(ffmpeg), 'henji-video-decoder.exe'), logger, restart: { maxRestarts: 0 } }))
  const [first, second, worker] = services
  const activity = new WebCacheActivity(worker, logger), submissions = new WebCacheSubmissions(logger, activity)
  const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
  const controller = new AbortController()
  let pending: Promise<number> | undefined
  try {
    for (const service of services) await service.ensureStarted()
    const pids = services.map(service => service.pid)
    await first.webCacheForeground(true); await second.webCacheForeground(true)
    let submitted = 0
    pending = submissions.run(async () => ++submitted, controller.signal)
    void pending.catch(() => undefined)
    await wait(100)
    if (submitted !== 0) throw new Error('前台重叠期间后台仍提交')
    process.kill(first.pid!)
    await wait(100)
    if (submitted !== 0) throw new Error('一个前台退出便忽略另一个前台')
    const started = performance.now()
    await second.webCacheForeground(false)
    const resumed = await pending
    const resumeMs = performance.now() - started
    if (resumed !== 1) throw new Error('所有前台结束后未恢复提交')
    const held = await activity.acquire(controller.signal)
    if (await second.webCacheSubmission('contending').then(result => result.acquired)) throw new Error('后台提交额度未互斥')
    // 前台无需等待已提交工作；令持额度进程异常退出验证内核自动归还。
    await second.webCacheForeground(true)
    const exited = new Promise<void>(resolve => { const stop = worker.onLifecycle(event => { if (event.type === 'exited') { stop(); resolve() } }) })
    process.kill(worker.pid!); await exited
    if (held.current()) throw new Error('旧进程许可未撤销')
    await held.release()
    await second.webCacheForeground(false)
    if (!await second.webCacheSubmission('recovered').then(result => result.acquired)) throw new Error('失主额度没有自动归还')
    await second.webCacheSubmissionRelease('recovered')
    return { pids, foregrounds: 2, blockedMs: 200, submissionsDuringForeground: 0, resumedSubmissions: submitted, resumeMs, abandonedBudgetRecovered: true, stalePermitRejected: true }
  } finally {
    controller.abort(new Error('专项结束'))
    await pending?.catch(() => undefined)
    await activity.dispose().catch(() => undefined)
    for (const service of services) await service.shutdown()
  }
}
