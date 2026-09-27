import { spawn } from 'node:child_process'

/** Bounded diagnostics and cancellable subprocesses; PCM never accumulates here. */
export function runAudioEditProcess(binary: string, args: string[], signal?: AbortSignal, onLine?: (line: string) => void, onOutputLine?: (line: string) => void): Promise<string> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, signal })
    let output = ''
    let errors = ''
    let pending = ''
    let outputPending = ''
    child.stdout.on('data', (chunk: Buffer) => {
      if (!onOutputLine) { output = (output + chunk.toString()).slice(-8 * 1024 * 1024); return }
      outputPending += chunk.toString()
      const lines = outputPending.split(/[\r\n]+/)
      outputPending = lines.pop() ?? ''
      for (const line of lines) onOutputLine(line)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      errors = (errors + text).slice(-16_384)
      if (onLine) {
        pending += text
        const lines = pending.split(/[\r\n]+/)
        pending = lines.pop() ?? ''
        for (const line of lines) onLine(line)
      }
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (outputPending && onOutputLine) onOutputLine(outputPending)
      if (pending && onLine) onLine(pending)
      if (signal?.aborted) reject(new Error('操作已取消'))
      else if (code !== 0) reject(new Error(`音频处理失败：${errors}`))
      else resolve(output)
    })
  })
}
