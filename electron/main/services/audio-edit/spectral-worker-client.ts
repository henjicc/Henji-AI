import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import readline from 'node:readline'
import { app } from 'electron'
import { audioWorkerExecutablePath } from './audio-worker-client'

export interface SpectralWorkerProgress { coveredFrames: number; durationFrames: number; done: boolean }
/** 这个频谱进程支持什么：derive 为按列派生每组的层级（原生 SIDECAR_LEVEL），旧可执行文件没有。 */
export interface SpectralWorkerCapabilities { deriveGroupLevel?: number }
interface Pending {
  finish(error?: Error, value?: unknown): void
  /** 收到该请求的任何进度或心跳就续期无进展计时。 */
  alive(): void
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
  private probe?: { child: ChildProcessWithoutNullStreams; capabilities: Promise<SpectralWorkerCapabilities> }

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
        if (message.event) pending.alive()
        if (message.event === 'alive') return
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

  /**
   * idleTimeoutMs 是无进展超时：worker 计算中报进度、排队或让路时发心跳，每条都续期；
   * 静默超过时限才算卡住。长素材的整段计算因此不受总时长限制。
   */
  request<T>(command: Record<string, unknown>, signal?: AbortSignal, progress?: (value: SpectralWorkerProgress) => void, idleTimeoutMs = 60_000): Promise<T> {
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
      const timer = setTimeout(() => cancel(new Error('AUDIO_WORKER_TIMEOUT：频谱计算长时间没有进展')), idleTimeoutMs)
      timer.unref()
      const pending: Pending = {
        progress,
        alive: () => { if (!pending.cancellation) timer.refresh() },
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

  /**
   * 当前进程的能力（每个进程问一次）：可执行文件可能比主进程旧（开发时没重编原生程序），
   * 不支持的命令不发，免得它回不了请求 ID、只能等无进展超时。问不到按什么都不支持处理。
   */
  capabilities(): Promise<SpectralWorkerCapabilities> {
    const child = this.start()
    if (this.probe?.child !== child) {
      const capabilities = this.request<{ capabilities?: { spectralDerive?: { groupLevel?: unknown } } }>({ type: 'ping' }, undefined, undefined, 10_000).then(result => {
        const level = result?.capabilities?.spectralDerive?.groupLevel
        return typeof level === 'number' && Number.isInteger(level) && level > 0 ? { deriveGroupLevel: level } : {}
      }, () => ({}))
      this.probe = { child, capabilities }
    }
    return this.probe.capabilities
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
