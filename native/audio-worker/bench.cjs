// 显式性能专项：node native/audio-worker/bench.cjs <WAV>，不进入普通单测。
const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const readline = require('node:readline')
async function main() {
  const input = path.resolve(process.argv[2])
  await fs.stat(input)
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-spectral-bench-'))
  const worker = spawn(path.join(__dirname, 'target/release', process.platform === 'win32' ? 'henji-audio-worker.exe' : 'henji-audio-worker'), ['--spectral-server'], { windowsHide: true })
  const pending = new Map()
  let sequence = 0
  readline.createInterface({ input: worker.stdout }).on('line', line => {
    const reply = JSON.parse(line)
    if (reply.event) return
    const task = pending.get(reply.id)
    if (!task) return
    pending.delete(reply.id)
    if (reply.ok) task.resolve(reply.result)
    else task.reject(new Error(reply.error))
  })
  worker.stderr.pipe(process.stderr)
  worker.on('close', () => { for (const p of pending.values()) p.reject(new Error('进程退出')) })
  function request(command) {
    const id = String(++sequence)
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      worker.stdin.write(JSON.stringify({ version: 1, id, ...command }) + '\n')
    })
  }
  try {
    for (let level = -5; level <= 2; level++) {
      const times = []
      for (let run = 0; run < 4; run++) {
        const result = await request({ type: 'spectral_tile', input_path: input, output_path: path.join(directory, `tile-${level}-${run}.rg`), level, column_start: 1024, column_count: 1024 })
        times.push(result.elapsedMs)
      }
      console.log(JSON.stringify({ level, coldMs: times[0], warmMs: times.slice(1) }))
    }
    for (let run = 0; run < 3; run++) {
      const output = path.join(directory, `pyramid-${run}`)
      const result = await request({ type: 'spectral_build', input_path: input, output_directory: output })
      console.log(JSON.stringify({ wholeFileMs: result.elapsedMs, directory: output, frames: result.durationFrames, channels: result.channels, sampleRate: result.sampleRate }))
    }
  } finally { worker.stdin.end() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
