import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import esbuild from 'esbuild-wasm'

const out = path.resolve('.tmp/text-layout-acceptance')
await esbuild.build({ entryPoints: ['electron/main/services/fonts/worker.ts'], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: path.join(out, 'font-io-worker.mjs') })
const { parseFontFile } = await import(pathToFileURL(path.join(out, 'font-metadata.mjs')).href)
const worker = new Worker(pathToFileURL(path.join(out, 'font-io-worker.mjs')), { workerData: { library: path.join(out, 'font-library') } })
const results = [], pending = new Map()
worker.on('message', message => { const request = pending.get(message.id); pending.delete(message.id); if (message.error) request.reject(new Error(message.error)); else request.resolve(message.result) })
worker.on('error', error => { for (const request of pending.values()) request.reject(error); pending.clear() })
let next = 0
const stats = values => { const sorted = [...values].sort((a, b) => a - b); return { p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) } }
try {
  for (const filename of ['C:/Windows/Fonts/simhei.ttf', 'C:/Windows/Fonts/simsunb.ttf', 'C:/Windows/Fonts/NotoSansJP-Regular.otf', 'C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/seguiemj.ttf', 'node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2']) {
    const info = await fs.stat(filename), bytes = await fs.readFile(filename), parsed = parseFontFile(bytes)[0]
    const face = { ...parsed, path: path.resolve(filename), signature: `${info.size}:${info.mtimeMs}`, face: { ...parsed.face, id: filename, imported: false } }
    const times = [], eventLoop = monitorEventLoopDelay({ resolution: 1 }); let normalizedBytes = 0
    for (let sample = 0; sample < 35; sample++) {
      if (sample === 5) eventLoop.enable()
      const id = ++next, started = performance.now()
      const result = await new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, kind: 'read', face }) })
      normalizedBytes = result.byteLength
      if (sample >= 5) times.push(performance.now() - started)
    }
    eventLoop.disable()
    results.push({ filename, originalBytes: bytes.length, normalizedBytes, timings: stats(times), samples: times, coordinatorEventLoopMs: { p50: eventLoop.percentile(50) / 1e6, p95: eventLoop.percentile(95) / 1e6, max: eventLoop.max / 1e6, samples: eventLoop.count } })
  }
  await fs.writeFile(path.join(out, 'font-io-report.json'), JSON.stringify({ pipeline: '正式 fonts/worker.ts → FontScanner.read → standaloneFont', cache: '同一线程；磁盘缓存未清理；5次预热30次计量', results, memory: process.memoryUsage() }, null, 2))
  console.log(JSON.stringify(results.map(({ samples, ...result }) => result)))
} finally { await worker.terminate() }
