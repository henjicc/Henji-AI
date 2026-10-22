import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import readline from 'node:readline'
import { app } from 'electron'
import { audioWorkerExecutablePath } from './audio-worker-client'

export interface SpectralWorkerProgress { coveredFrames: number; durationFrames: number; done: boolean }
interface Pending {
  finish(error?: Error, value?: unknown): void
  progress?: (value: SpectralWorkerProgress) => void
  cancellation?: Error
}

/** 仅频谱使用常驻实例；VST 与修复仍走单次客户端，保持崩溃隔离。 */
export class SpectralWorkerClient {
  private child?: ChildProcessWithoutNullStreams
  private pending = new Map<string, Pending>()
  private quitting = false
  private lifecycleRegistered = false
  private stop?: (error: Error) => void

  private start(): ChildProcessWithoutNullStreams {
    if (this.quitting) throw new Error('应用正在退出')
    if (this.child) return this.child
    const binary = audioWorkerExecutablePath()
    if (!binary) throw new Error('AUDIO_WORKER_UNAVAILABLE：音频 Worker 尚未安装。')
    if (!this.lifecycleRegistered) {
      this.lifecycleRegistered = true
      app.once('will-quit', () => this.dispose())
    }
    const child = spawn(binary, ['--spectral-server'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    let stderr = ''
    let failure: Error | undefined
    child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString('utf8')).slice(-4096) })
    const lines = readline.createInterface({ input: child.stdout })
    const stop = (error: Error): void => {
      if (failure || this.child !== child) return
      failure = error
      lines.close()
      child.kill()
    }
    this.stop = stop
    child.once('error', stop)
    child.stdin.on('error', stop)
    child.once('close', code => {
      if (this.child !== child) return
      this.child = undefined
      this.stop = undefined
      lines.close()
      const error = failure ?? new Error(`音频频谱进程已退出（${code}）：${stderr}`)
      // close 是文件写入停止屏障，之后主进程才清理半成品。
      for (const request of this.pending.values()) request.finish(request.cancellation ?? error)
    })
    lines.on('line', line => {
      try {
        const message = JSON.parse(line) as { version: number; id: string; event?: string; progress?: SpectralWorkerProgress; ok?: boolean; result?: unknown; error?: string }
        if (message.version !== 1 || typeof message.id !== 'string') throw new Error('频谱进程响应协议不匹配')
        const pending = this.pending.get(message.id)
        if (!pending) return
        if (message.event === 'progress') {
          const p = message.progress
          if (!p || !Number.isSafeInteger(p.coveredFrames) || !Number.isSafeInteger(p.durationFrames) || p.coveredFrames < 0 || p.coveredFrames > p.durationFrames || typeof p.done !== 'boolean') throw new Error('频谱进度无效')
          if (!pending.cancellation) pending.progress?.(p)
        } else {
          pending.finish(pending.cancellation ?? (message.ok === true ? undefined : new Error(message.error ?? '频谱计算失败')), message.result)
        }
      } catch (error) { stop(error instanceof Error ? error : new Error(String(error))) }
    })
    return child
  }

  request<T>(command: Record<string, unknown>, signal?: AbortSignal, progress?: (value: SpectralWorkerProgress) => void, timeoutMs = 120_000): Promise<T> {
    signal?.throwIfAborted()
    const child = this.start()
    const id = randomUUID()
    return new Promise<T>((resolve, reject) => {
      let grace: ReturnType<typeof setTimeout> | undefined
      const cancel = (error: Error): void => {
        if (pending.cancellation) return
        pending.cancellation = error
        child.stdin.write(`${JSON.stringify({ version: 1, id: randomUUID(), type: 'cancel', request_id: id })}\n`)
        // 等 worker 停止写文件再结束请求；失去响应则终止实例并明确失败全部在途请求。
        grace = setTimeout(() => {
          if (this.child === child) this.stop?.(new Error('频谱进程取消超时'))
        }, 2000)
        grace.unref()
      }
      const onAbort = (): void => cancel(new Error('频谱读取已取消'))
      const timer = setTimeout(() => cancel(new Error('AUDIO_WORKER_TIMEOUT：频谱请求超时')), timeoutMs)
      timer.unref()
      const pending: Pending = {
        progress,
        finish: (error, value) => {
          if (!this.pending.delete(id)) return
          clearTimeout(timer)
          clearTimeout(grace)
          signal?.removeEventListener('abort', onAbort)
          if (error) reject(error)
          else resolve(value as T)
        },
      }
      this.pending.set(id, pending)
      signal?.addEventListener('abort', onAbort, { once: true })
      child.stdin.write(`${JSON.stringify({ ...command, version: 1, id })}\n`)
      if (signal?.aborted) onAbort()
    })
  }

  dispose(): void {
    this.quitting = true
    this.child?.kill()
    this.child = undefined
    this.stop = undefined
    for (const request of this.pending.values()) request.finish(new Error('应用退出，频谱计算已停止'))
  }
}

export const spectralWorker = new SpectralWorkerClient()
