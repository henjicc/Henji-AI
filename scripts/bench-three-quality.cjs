'use strict'

/**
 * 三维画质基准：`node scripts/bench-three-quality.cjs [--cases <json 文件>] [--out <目录>] [--images <目录>]`
 *
 * 用源码里的统一三维渲染器（VideoEditThreeSpace）在一个无界面的 Electron 窗口里画固定的代表性场景（墙角、红方块、蓝圆柱、
 * 金属扭结、实心玻璃球，一盏投影聚光 + 摄影棚环境），量实时各档与路径追踪各采样数的每帧耗时，可选存 PNG。
 * 直接打包 src/，不依赖 out/ 构建，也不读写任何资料目录；路径追踪降噪权重取本机已下载的 OIDN 模型（找不到时不降噪）。
 * 不传 --cases 时跑默认清单（4K：实时现状、实时各补充项、路径追踪 16/32/64/256 采样降噪）。
 * 不降噪的追踪要放在清单里所有降噪追踪之前：同一追踪器先降噪后改不降噪会失败（见 docs/task/三维画质/说明.md）。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')

function parseArgs(argv) {
  const options = { cases: null, out: path.join(ROOT, '.bench', 'three-quality'), images: null, weights: null }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index], next = () => { const value = argv[++index]; if (value === undefined) throw new Error(`${arg} 需要一个值`); return value }
    if (arg === '--cases') options.cases = path.resolve(next())
    else if (arg === '--out') options.out = path.resolve(next())
    else if (arg === '--images') options.images = path.resolve(next())
    else if (arg === '--weights') options.weights = path.resolve(next())
    else throw new Error(`未知参数 ${arg}`)
  }
  return options
}

const W = 3840, H = 2160
const DEFAULT_CASES = [
  { name: 'realtime-current', width: W, height: H, mode: 'realtime', image: true },
  { name: 'realtime-ao', width: W, height: H, mode: 'realtime', effects: { ambientOcclusion: .8 } },
  { name: 'realtime-ssr', width: W, height: H, mode: 'realtime', effects: { reflections: .6 } },
  { name: 'realtime-gi', width: W, height: H, mode: 'realtime', effects: { globalIllumination: 1 } },
  { name: 'realtime-enhanced', width: W, height: H, mode: 'realtime', effects: { globalIllumination: 1, ambientOcclusion: .6, reflections: .4 }, image: true },
  // 预热：建追踪器（加速结构、贴图图集）与降噪网络，不计入。
  { name: 'trace-warmup', width: W, height: H, mode: 'trace', samples: 16, denoise: true },
  { name: 'trace-16', width: W, height: H, mode: 'trace', samples: 16, denoise: true, image: true },
  { name: 'trace-32', width: W, height: H, mode: 'trace', samples: 32, denoise: true, image: true },
  { name: 'trace-64', width: W, height: H, mode: 'trace', samples: 64, denoise: true, image: true },
  { name: 'trace-256', width: W, height: H, mode: 'trace', samples: 256, denoise: true, image: true },
]

function defaultWeights() {
  const candidates = [path.join(os.homedir(), '.henji-ai'), 'E:/文档/HenjiAI']
  for (const base of candidates) {
    const file = path.join(base, 'Models', '渲染降噪 OIDN', 'rt_hdr_alb_nrm.tza')
    if (fs.existsSync(file)) return file
  }
  return null
}

function build(work) {
  const esbuild = require('esbuild')
  const logging = path.join(work, 'logging-stub.ts')
  fs.writeFileSync(logging, 'export function createLogger() { const log = (...args: unknown[]) => console.log(...args); return { debug: log, info: log, warn: log, error: log } }\n')
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, 'three-quality', 'entry.ts')], bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    outfile: path.join(work, 'bench.js'), logLevel: 'error', sourcemap: 'inline',
    alias: { '@/core/logging': logging, '@': path.join(ROOT, 'src') },
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.MODE': '"production"' },
  })
  fs.writeFileSync(path.join(work, 'index.html'), '<!doctype html><meta charset="utf-8"><script type="module">import { runBench } from "./bench.js"; window.runBench = runBench; window.benchReady = true</script>')
}

const MAIN = `
const { app, BrowserWindow, protocol } = require('electron')
const fs = require('node:fs'), path = require('node:path')
const [work, root, casesFile, resultFile, weights] = process.argv.slice(-5)
protocol.registerSchemesAsPrivileged([{ scheme: 'henji-media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.wasm': 'application/wasm' }
app.whenReady().then(async () => {
  protocol.handle('henji-media', request => {
    const url = new URL(request.url)
    const relative = decodeURIComponent(url.pathname).replace(/^\\/+/, '')
    const file = url.hostname === 'author-lib' ? path.join(root, 'resources', 'author-libs', relative) : url.hostname === 'model' ? weights : path.join(work, relative)
    if (!file || !fs.existsSync(file)) return new Response('not found', { status: 404 })
    return new Response(fs.readFileSync(file), { headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'access-control-allow-origin': '*' } })
  })
  const window = new BrowserWindow({ show: false, width: 320, height: 240, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } })
  window.webContents.on('console-message', (event) => { const text = event.message ?? ''; if (!/three\\.webgpu|WebGPU/.test(text)) process.stdout.write('[page] ' + text.slice(0, 400) + '\\n') })
  await window.loadURL('henji-media://bench/index.html')
  const cases = fs.readFileSync(casesFile, 'utf8')
  const results = []
  try {
    while (!(await window.webContents.executeJavaScript('window.benchReady === true'))) await new Promise(resolve => setTimeout(resolve, 100))
    await window.webContents.executeJavaScript('window.benchResults = []; window.benchDone = false; window.runBench(' + cases + ', ' + JSON.stringify(weights ? 'henji-media://model/weights.tza' : '') + ', result => window.benchResults.push(result)).then(() => { window.benchDone = true }, error => { window.benchError = String(error && error.stack || error); window.benchDone = true })')
    for (;;) {
      await new Promise(resolve => setTimeout(resolve, 500))
      const batch = await window.webContents.executeJavaScript('window.benchResults.splice(0)')
      for (const result of batch) { results.push(result); process.stdout.write('[result] ' + result.name + ' ' + (result.error ? 'ERROR ' + result.error.split('\\n')[0] : result.meanMs.toFixed(1) + ' ms') + '\\n'); fs.writeFileSync(resultFile, JSON.stringify(results)) }
      if (await window.webContents.executeJavaScript('window.benchDone')) { const error = await window.webContents.executeJavaScript('window.benchError || null'); if (error) process.stdout.write('[error] ' + error + '\\n'); break }
    }
  } finally { app.exit(0) }
})
`

function main() {
  const options = parseArgs(process.argv.slice(2))
  const cases = options.cases ? JSON.parse(fs.readFileSync(options.cases, 'utf8')) : DEFAULT_CASES
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-three-quality-'))
  build(work)
  const casesFile = path.join(work, 'cases.json'), resultFile = path.join(work, 'results.json'), mainFile = path.join(work, 'main.cjs')
  fs.writeFileSync(casesFile, JSON.stringify(cases))
  fs.writeFileSync(mainFile, MAIN)
  const weights = options.weights ?? defaultWeights() ?? ''
  const electron = require('electron')
  const run = spawnSync(electron, ['--enable-unsafe-webgpu', `--user-data-dir=${path.join(work, 'ud')}`, mainFile, work, ROOT, casesFile, resultFile, weights], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } })
  if (run.status !== 0) process.exitCode = run.status ?? 1
  const results = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : []
  fs.mkdirSync(options.out, { recursive: true })
  for (const result of results) {
    if (result.png && options.images) { fs.mkdirSync(options.images, { recursive: true }); fs.writeFileSync(path.join(options.images, `${result.name}.png`), Buffer.from(result.png, 'base64')) }
    else if (result.png) fs.writeFileSync(path.join(options.out, `${result.name}.png`), Buffer.from(result.png, 'base64'))
    delete result.png
  }
  const summary = { gpu: 'see nvidia-smi', results }
  fs.writeFileSync(path.join(options.out, 'results.json'), JSON.stringify(summary, null, 2))
  for (const result of results) console.log(`${result.name.padEnd(24)} ${result.mode.padEnd(9)} ${String(result.width)}x${result.height}  mean ${Number.isFinite(result.meanMs) ? result.meanMs.toFixed(1) : '-'} ms  p95 ${Number.isFinite(result.p95Ms) ? result.p95Ms.toFixed(1) : '-'} ms${result.error ? '  ERROR ' + result.error.split('\n')[0] : ''}`)
  fs.rmSync(work, { recursive: true, force: true })
}

main()
