import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { app } from 'electron'

interface WorkerResponse<T> {
  version: number
  id: string
  ok: boolean
  result?: T
  error?: string
}

function executablePath(): string | null {
  const name = process.platform === 'win32' ? 'henji-audio-worker.exe' : 'henji-audio-worker'
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'resources', name)]
    : [
        path.join(process.cwd(), 'native', 'audio-worker', 'target', 'release', name),
        path.join(process.cwd(), 'native', 'audio-worker', 'target', 'debug', name),
      ]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

export async function invokeAudioWorker<T>(command: Record<string, unknown>, timeoutMs = 20_000): Promise<T> {
  const binary = executablePath()
  if (!binary) throw new Error('AUDIO_WORKER_UNAVAILABLE：音频 Worker 尚未安装。')
  const id = crypto.randomUUID()
  const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const stderr: Buffer[] = []
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
  try {
    return await new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        callback()
      }
      const timer = setTimeout(() => {
        child.kill()
        finish(() => reject(new Error('AUDIO_WORKER_TIMEOUT：音频 Worker 响应超时。')))
      }, timeoutMs)
      const lines = readline.createInterface({ input: child.stdout })
      lines.once('line', (line) => {
        try {
          const response = JSON.parse(line) as WorkerResponse<T>
          if (response.id !== id || response.version !== 1) throw new Error('音频 Worker 返回了不匹配的协议响应。')
          if (!response.ok) throw new Error(response.error ?? '音频 Worker 执行失败。')
          finish(() => resolve(response.result as T))
        } catch (error) {
          finish(() => reject(error))
        }
      })
      child.once('error', (error) => {
        finish(() => reject(error))
      })
      child.once('exit', (code) => {
        if (code && code !== 0) {
          finish(() => reject(new Error(`音频 Worker 异常退出（${code}）：${Buffer.concat(stderr).toString('utf8')}`)))
        } else {
          finish(() => reject(new Error('音频 Worker 未返回处理结果。')))
        }
      })
      child.stdin.end(`${JSON.stringify({ version: 1, id, ...command })}\n`)
    })
  } finally {
    if (!child.killed) child.kill()
  }
}
