const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { ffmpegPath } = require('./mediaBinaries.cjs')

/**
 * 高位深合成管线（2.7）：真实 Electron 里由构建产物的正式渲染 Worker（帧通道端口 → 原生服务，或浏览器解码）合成
 * 10 位灰阶渐变，读回量化前的 rgba16float 合成目标一行，统计梯度级数并与 FFmpeg 解出的亮度码值换算的参考比较 PSNR：
 * - 样本（1920×1080，BT.709 有限范围，亮度 64..940 横向渐变，877 个码值）：HEVC Main10 与 VP9 profile 2（原生与
 *   浏览器各一次；浏览器硬解帧经 Chromium 导入只有 8 位精度，走 8 位路径）、ProRes 422 HQ、ProRes 4444（带 alpha，
 *   FFmpeg 按 12 位解码，原生）；8 位 H.264 渐变作对照（不走高精度路径）。
 * - 每个样本两种读取：预览路径（previewWidth，经定位缓存）与导出路径（无 previewWidth，逐帧读取）。
 * - 一个转场（HEVC 10 位 → ProRes 422 HQ 交叉溶解）检验效果/转场表面保持 rgba16float。
 * - 同时记录 8 位画布输出（抖动量化后）的级数。
 */
const ROOT = path.resolve('node_modules/.cache/video-edit-high-precision')
const WIDTH = 1920; const HEIGHT = 1080; const FPS = 30; const ROW = 540
const RAMP10 = "geq=lum='64+X*876/(W-1)':cb=512:cr=512"
const SOURCE10 = (format, extra = '') => ['-f', 'lavfi', '-i', `color=c=black:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=1,format=${format},${RAMP10}${extra}`]
const TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']
const SAMPLES = [
  { file: 'hevc_main10.mp4', depth: 10, backends: ['native', 'browser'], args: out => [...SOURCE10('yuv420p10le'), '-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-x265-params', 'qp=1:log-level=error', '-tag:v', 'hvc1', ...TAGS, out] },
  { file: 'prores_422hq.mov', depth: 10, backends: ['native'], args: out => [...SOURCE10('yuv422p10le'), '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', ...TAGS, out] },
  { file: 'prores_4444.mov', depth: 10, backends: ['native'], args: out => [...SOURCE10('yuva444p10le', ":a='1023'"), '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', ...TAGS, out] },
  { file: 'vp9_profile2.webm', depth: 10, backends: ['native', 'browser'], args: out => [...SOURCE10('yuv420p10le'), '-c:v', 'libvpx-vp9', '-profile:v', '2', '-pix_fmt', 'yuv420p10le', '-crf', '0', '-b:v', '0', '-lossless', '1', '-deadline', 'realtime', '-cpu-used', '8', ...TAGS, out] },
  { file: 'h264_8bit.mp4', depth: 8, backends: ['native', 'browser'], args: out => ['-f', 'lavfi', '-i', `color=c=black:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=1,format=yuv420p,geq=lum='16+X*219/(W-1)':cb=128:cr=128`, '-c:v', 'libx264', '-crf', '1', '-pix_fmt', 'yuv420p', ...TAGS, out] },
]

function prepare(sample) {
  const file = path.join(ROOT, sample.file)
  if (!fs.existsSync(file)) execFileSync(ffmpegPath, ['-v', 'error', '-y', ...sample.args(file)], { windowsHide: true, timeout: 300000 })
  // Reference: the decoded luma codes of frame 0 on the sampled row, read from plane 0 of the decoder output; deep
  // material is widened to 16-bit YUV first (ProRes 4444 decodes as 12-bit), so the codes are on one scale. Grey
  // (neutral chroma), so R=G=B=(Y-black)/range.
  const deep = sample.depth > 8
  const raw = execFileSync(ffmpegPath, ['-v', 'error', '-i', file, '-frames:v', '1', ...(deep ? ['-pix_fmt', 'yuv444p16le'] : []), '-f', 'rawvideo', '-'], { windowsHide: true, maxBuffer: 256 * 1024 * 1024 })
  const [black, range] = deep ? [64 * 64, 876 * 64] : [16, 219]
  const code = x => deep ? raw.readUInt16LE((ROW * WIDTH + x) * 2) : raw[ROW * WIDTH + x]
  const reference = Array.from({ length: WIDTH }, (_, x) => Math.min(1, Math.max(0, (code(x) - black) / range)))
  return { ...sample, path: file, reference, referenceLevels: new Set(reference).size }
}

function halfToFloat(half) {
  const sign = half & 0x8000 ? -1 : 1; const exponent = (half >> 10) & 0x1f; const fraction = half & 0x3ff
  if (exponent === 0) return sign * fraction * 2 ** -24
  if (exponent === 31) return fraction ? NaN : sign * Infinity
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15)
}
const psnr = (actual, expected) => {
  const mse = actual.reduce((sum, value, index) => sum + (value - expected[index]) ** 2, 0) / actual.length
  return mse === 0 ? Infinity : 10 * Math.log10(1 / mse)
}

async function installHarness(page) {
  const assets = path.resolve('out/renderer/assets')
  const name = fs.readdirSync(assets).find(file => /^videoEditWorker-[\w-]+\.js$/.test(file))
  assert.ok(name, '构建产物里找不到剪辑渲染 Worker')
  await page.evaluate(async workerUrl => {
    window.__henjiPrecision?.worker.terminate()
    const worker = new Worker(new URL(workerUrl, location.href), { type: 'module' })
    const pending = new Map(); let next = 1
    worker.addEventListener('message', event => {
      const entry = pending.get(event.data?.id)
      if (!entry || event.data.phase) return
      pending.delete(event.data.id)
      if (event.data.error) entry.reject(new Error(event.data.error)); else entry.resolve(event.data)
    })
    const native = window.henjiNative.videoFrames
    let route = null
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('帧通道端口未送达')), 5000)
      const onMessage = event => {
        if (event.data?.type !== 'henji:video-frames-port' || event.data.route !== route || !event.ports[0]) return
        window.removeEventListener('message', onMessage); clearTimeout(timer); resolve(event.ports[0])
      }
      window.addEventListener('message', onMessage)
      route = native.connect()
    })
    worker.postMessage({ kind: 'nativeFrames.attach', port }, [port])
    const request = message => new Promise((resolve, reject) => { const id = next++; pending.set(id, { resolve, reject }); worker.postMessage({ ...message, id }) })
    window.__henjiPrecision = {
      worker, route,
      async render(document, decode, previewWidth, frame, row) {
        await request({ kind: 'init', document, decode, ...(previewWidth ? { previewWidth } : {}) })
        const rendered = await request({ kind: 'render', frame, sequential: false })
        const bitmap = rendered.bitmap
        const canvas = new OffscreenCanvas(bitmap.width, 1); const context = canvas.getContext('2d', { willReadFrequently: true })
        context.drawImage(bitmap, 0, row, bitmap.width, 1, 0, 0, bitmap.width, 1); bitmap.close()
        const output = Array.from(context.getImageData(0, 0, canvas.width, 1).data)
        const precision = (await request({ kind: 'precision', row })).precision
        return { output, counters: precision.counters, row: precision.row ? Array.from(precision.row) : null, sourceTimestamps: rendered.sourceTimestamps }
      },
      /** Source monitor configuration (one clip, previewWidth = media width, 3GiB cache): seek renders in order. */
      async scrub(document, decode, previewWidth, cacheBudgetBytes, frames) {
        await request({ kind: 'init', document, decode, previewWidth, cacheBudgetBytes })
        const results = []
        for (const frame of frames) {
          const at = performance.now()
          const rendered = await request({ kind: 'render', frame, sequential: false, scrubbing: true })
          rendered.bitmap?.close()
          results.push({ frame, ms: performance.now() - at, cacheHits: rendered.cacheHits, cacheBytes: rendered.cacheBytes, timestamps: rendered.sourceTimestamps })
        }
        return results
      },
      async close() { await request({ kind: 'dispose' }); worker.terminate(); native.disconnect(route) },
    }
  }, `./assets/${name}`)
}

function composition(id, revision, clips, transitions) {
  const media = clips.map(({ sample }) => ({ id: `m-${sample.file}`, name: sample.file, path: sample.url, kind: 'video', width: WIDTH, height: HEIGHT, durationSeconds: 1, hasAudio: false, frameRate: { numerator: FPS, denominator: 1 } }))
  return {
    id, name: id, revision, width: WIDTH, height: HEIGHT, frameRate: { numerator: FPS, denominator: 1 }, fps: FPS, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
    media: media.filter((item, index) => media.findIndex(other => other.id === item.id) === index),
    items: clips.map(({ sample }, index) => ({ id: `i${index}`, name: sample.file, kind: 'video', mediaId: `m-${sample.file}` })),
    tracks: [{ id: 'v1', name: '视频 1', index: 1, kind: 'video', locked: false, enabled: true, muted: false, solo: false }],
    clips: clips.map(({ sample, start, duration }, index) => ({ id: `c${index}`, itemId: `i${index}`, name: sample.file, kind: 'video', track: 1, start, duration, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' })),
    ...(transitions ? { transitions } : {}),
    annotations: [],
  }
}

function measure(result, reference) {
  const red = result.row ? Array.from({ length: WIDTH }, (_, x) => halfToFloat(result.row[x * 4])) : null
  const output = Array.from({ length: WIDTH }, (_, x) => result.output[x * 4] / 255)
  return {
    highPrecisionFrames: result.counters?.highPrecisionFrames ?? 0, highPrecisionSnapshots: result.counters?.highPrecisionSnapshots ?? 0, preciseTargetBytes: result.counters?.preciseTargetBytes ?? 0,
    preciseLevels: red ? new Set(red).size : null, precisePsnr: red ? psnr(red, reference) : null, preciseMaxError: red ? Math.max(...red.map((value, x) => Math.abs(value - reference[x]))) : null,
    outputLevels: new Set(output).size, outputPsnr: psnr(output, reference), outputMaxError: Math.max(...output.map((value, x) => Math.abs(value - reference[x]))),
    sourceTimestamps: result.sourceTimestamps,
  }
}

function createVideoEditHighPrecisionScene() {
  return {
    id: 'video-edit-high-precision', surface: '剪辑', name: '剪辑-高位深合成读回梯度级数与参考 PSNR', writesUserData: false,
    setup: async page => {
      fs.mkdirSync(ROOT, { recursive: true })
      const evidence = { width: WIDTH, height: HEIGHT, row: ROW, samples: [] }
      const store = () => fs.writeFileSync(path.join(ROOT, 'evidence.json'), JSON.stringify(evidence, null, 2))
      try {
        const status = await page.evaluate(() => window.henjiNative.videoDecoder.status())
        assert.equal(status.available, true, '本机原生解码服务应可用')
        await page.evaluate(dir => window.henjiNative.media.allowRoot(dir), ROOT)
        const prepared = new Map()
        let revision = 0
        for (const definition of SAMPLES) {
          const sample = prepare(definition); sample.url = `henji-media://local/${encodeURIComponent(sample.path)}`; prepared.set(sample.file, sample)
          const record = { file: sample.file, depth: sample.depth, referenceLevels: sample.referenceLevels, results: [] }
          evidence.samples.push(record); store()
          for (const backend of sample.backends) for (const previewWidth of [WIDTH, undefined]) {
            await installHarness(page)
            const document = composition(`precision-${sample.file}`, ++revision, [{ sample, start: 0, duration: FPS }])
            const decode = { nativeAvailable: true, forced: backend, localPaths: { [sample.url]: sample.path } }
            const result = await page.evaluate(({ document, decode, previewWidth, row }) => window.__henjiPrecision.render(document, decode, previewWidth, 0, row), { document, decode, previewWidth, row: ROW })
            await page.evaluate(() => window.__henjiPrecision.close())
            const measured = { backend, path: previewWidth ? 'preview' : 'export', ...measure(result, sample.reference) }
            record.results.push(measured); store()
            if (sample.depth === 10 && backend === 'browser') {
              // Browser fallback: Chromium imports 10-bit hardware frames at 8-bit precision (254 levels, 44 dB measured),
              // so they stay on the 8-bit path; the 8-bit output is still recorded.
              assert.equal(measured.highPrecisionFrames, 0, `${sample.file}（${backend}）浏览器硬解帧不应走高精度合成`)
            } else if (sample.depth === 10) {
              assert.ok(measured.highPrecisionFrames >= 1, `${sample.file}（${backend}）应走高精度合成`)
              assert.ok(measured.preciseLevels > 256, `${sample.file}（${backend}）量化前梯度级数 ${measured.preciseLevels} 应 >256`)
              assert.ok(measured.precisePsnr >= 45, `${sample.file}（${backend}）量化前 PSNR ${measured.precisePsnr}`)
            } else {
              assert.equal(measured.highPrecisionFrames, 0, `${sample.file}（${backend}）8 位素材不应走高精度合成`)
              assert.equal(measured.preciseLevels, null)
            }
          }
        }
        // Cross dissolve between two 10-bit sources: normalize and mix surfaces keep rgba16float.
        const left = prepared.get('hevc_main10.mp4'); const right = prepared.get('prores_422hq.mov')
        await installHarness(page)
        const document = composition('precision-transition', ++revision, [{ sample: left, start: 0, duration: 15 }, { sample: right, start: 15, duration: 15 }], [{ id: 'dissolve', kind: 'cross_dissolve', leftClipId: 'c0', rightClipId: 'c1', durationFrames: 10 }])
        const decode = { nativeAvailable: true, localPaths: { [left.url]: left.path, [right.url]: right.path } }
        const result = await page.evaluate(({ document, decode, row }) => window.__henjiPrecision.render(document, decode, 1920, 15, row), { document, decode, row: ROW })
        await page.evaluate(() => window.__henjiPrecision.close())
        evidence.transition = measure(result, left.reference.map((value, x) => (value + right.reference[x]) / 2)); store()
        assert.ok(evidence.transition.preciseLevels > 256, `转场量化前梯度级数 ${evidence.transition.preciseLevels} 应 >256`)
        // Source monitor scrub over 4K60 10-bit long GOP (GOP 120, 2 B-frames): native seeks decode one-second windows
        // into the 3GiB source cache. Cold reverse drag, then the same drag again (warm).
        const long = path.join(ROOT, 'scrub_hevc10_4k60_gop120.mp4')
        if (!fs.existsSync(long)) execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=3840x2160:r=60:d=8,format=yuv420p10le', '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le', '-x265-params', 'log-level=error:keyint=120:min-keyint=120:scenecut=0:bframes=2', '-b:v', '40M', '-tag:v', 'hvc1', ...TAGS, long], { windowsHide: true, timeout: 600000 })
        const longUrl = `henji-media://local/${encodeURIComponent(long)}`
        const source = { file: path.basename(long), url: longUrl }
        const sourceDocument = { ...composition('precision-source-scrub', ++revision, [{ sample: source, start: 0, duration: 480 }]), width: 3840, height: 2160, fps: 60, frameRate: { numerator: 60, denominator: 1 } }
        sourceDocument.media[0] = { ...sourceDocument.media[0], width: 3840, height: 2160, durationSeconds: 8, frameRate: { numerator: 60, denominator: 1 } }
        const drag = Array.from({ length: 241 }, (_, index) => 300 - index)
        await installHarness(page)
        const scrubbed = await page.evaluate(({ document, decode, frames }) => window.__henjiPrecision.scrub(document, decode, 3840, 3 * 1024 ** 3, [...frames, ...frames]), { document: sourceDocument, decode: { nativeAvailable: true, localPaths: { [longUrl]: long } }, frames: drag })
        await page.evaluate(() => window.__henjiPrecision.close())
        const summarize = results => {
          const times = results.map(result => result.ms).sort((a, b) => a - b)
          return { renders: results.length, hits: results.filter(result => result.cacheHits > 0).length, p50Ms: times[Math.floor(times.length * 0.5)], p95Ms: times[Math.floor(times.length * 0.95)], maxMs: times.at(-1), over50Ms: times.filter(value => value > 50).length, maxCacheBytes: Math.max(...results.map(result => result.cacheBytes)), wrongTimestamps: results.filter(result => Math.abs(result.timestamps[0] - result.frame / 60) > 1e-5).length }
        }
        evidence.sourceScrub = { cacheBudgetBytes: 3 * 1024 ** 3, cold: summarize(scrubbed.slice(0, drag.length)), warm: summarize(scrubbed.slice(drag.length)) }; store()
        assert.equal(evidence.sourceScrub.cold.wrongTimestamps + evidence.sourceScrub.warm.wrongTimestamps, 0, '源监视器拖动画面时间错误')
        evidence.completed = true; store()
      } catch (error) {
        evidence.error = String(error?.stack ?? error); store()
        throw error
      }
    },
  }
}

module.exports = { createVideoEditHighPrecisionScene }
