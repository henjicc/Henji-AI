const { spawn } = require('node:child_process')

/**
 * Keep NVIDIA's sampler alive for the measurement. On Windows, even asynchronous
 * execFile/spawn blocks the calling thread while CreateProcess runs; starting it
 * on every sampling tick stalls Playwright's pointer input (about 30ms per tick).
 * --loop-ms is NVIDIA's own continuous sampling path, with no repeated launches.
 */
async function startGpuSampler({ onReading, onError = () => {}, intervalMs = 500, spawnProcess = spawn }) {
  const child = spawnProcess('nvidia-smi', [
    '--query-gpu=utilization.gpu,utilization.decoder,memory.used',
    '--format=csv,noheader,nounits', `--loop-ms=${intervalMs}`,
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let pending = ''; let closed = false; let stopped = false; let readyTimer
  let ready; let exited
  const firstReading = new Promise(resolve => { ready = resolve })
  const finished = new Promise(resolve => { exited = resolve })
  const markReady = () => { clearTimeout(readyTimer); ready() }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    pending += chunk
    const lines = pending.split(/\r?\n/); pending = lines.pop()
    for (const values of lines) {
      if (!/^\s*\d+\s*,\s*\d+\s*,\s*\d+\s*$/.test(values)) continue
      if (!stopped) onReading({ at: Date.now(), values: values.trim() })
      markReady()
    }
  })
  child.stderr.resume()
  child.on('error', error => { onError(error); markReady() })
  child.on('close', code => {
    closed = true; markReady(); exited()
    if (!stopped && code !== 0) onError(new Error(`nvidia-smi exited with code ${code}`))
  })
  readyTimer = setTimeout(markReady, 3000)
  // Process creation/driver initialization must finish before pointer timing starts.
  await firstReading
  return async () => {
    stopped = true
    if (!closed) child.kill()
    await finished
  }
}

module.exports = { startGpuSampler }
