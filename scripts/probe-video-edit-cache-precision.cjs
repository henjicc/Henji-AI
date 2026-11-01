// 显式真实 GPU 专项：正式 Worker 的派生缓存精度，不使用用户资料或现有开发实例。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { launchElectronApp } = require('./lib/electronLaunch.cjs')
const { loadTypeScript } = require('./check-persistence-compat.cjs')

async function main() {
  const root = path.resolve(__dirname, '..')
  const output = path.join(root, '.artifacts', 'web-cache-precision', new Date().toISOString().replace(/[:.]/g, '-'))
  fs.mkdirSync(output, { recursive: true })
  const ffmpeg = path.join(root, 'native/video-decoder/target/release/ffmpeg.exe')
  const files = ['red', 'green'].map(color => {
    const file = path.join(output, `${color}.mp4`)
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=${color}:s=320x180:r=30:d=2`, '-c:v', 'h264_nvenc', '-g', '2', '-bf', '0', '-pix_fmt', 'yuv420p', file], { windowsHide: true })
    return file
  })
  const { createVideoEditTestDocument } = loadTypeScript('src/core/videoEdit/testFixtures.ts')
  const { videoEditComposition } = loadTypeScript('src/core/videoEdit/document.ts')
  const doc = createVideoEditTestDocument('派生缓存精度')
  Object.assign(doc.sequences[0], { width: 320, height: 180, frameRate: { numerator: 30, denominator: 1 } })
  const composition = videoEditComposition(doc, doc.sequences[0].id)
  const workerName = fs.readdirSync(path.join(root, 'out/renderer/assets')).find(name => /^videoEditWorker-[\w-]+(?:\.worker)?\.js$/.test(name))
  assert.ok(workerName)
  const instance = await launchElectronApp({ mainEntry: path.join(root, 'out/main/index.cjs'), cwd: root, isolateUserData: true, useElectronApi: true, skipOnboarding: true, extraArgs: ['--background'] })
  const timeout = setTimeout(() => { void instance.close() }, 180000)
  const evidence = { scope: '正式 Worker/原生解码/派生缓存合成；自造纯色文件，不代表网页播放性能', output, files }
  try {
    assert.ok(await instance.app.evaluate(() => Boolean(process.env.HENJI_ISOLATED_APP_DATA)))
    evidence.runtime = await instance.app.evaluate(async ({ app }) => ({ versions: process.versions, gpu: await app.getGPUInfo('basic') }))
    evidence.frames = await instance.page.evaluate(async ({ workerName, composition, files }) => {
      const worker = new Worker(new URL(`./assets/${workerName}`, location.href), { type: 'module' })
      const pending = new Map(); let nextId = 0
      worker.onmessage = ({ data }) => {
        if (data.phase || !pending.has(data.id)) return
        const entry = pending.get(data.id); pending.delete(data.id)
        if (data.error) entry.reject(new Error(data.error)); else entry.resolve(data)
      }
      const request = (body, transfer = []) => new Promise((resolve, reject) => {
        const id = ++nextId
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Worker 超时 ${body.kind}`)) }, 30000)
        pending.set(id, { resolve: data => { clearTimeout(timer); resolve(data) }, reject: error => { clearTimeout(timer); reject(error) } })
        worker.postMessage({ ...body, id }, transfer)
      })
      const native = window.henjiNative.videoFrames
      let route
      const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('帧通道未到达')), 10000)
        const receive = event => {
          if (event.data?.type !== 'henji:video-frames-port' || event.data.route !== route) return
          window.removeEventListener('message', receive); clearTimeout(timer); resolve(event.ports[0])
        }
        window.addEventListener('message', receive); route = native.connect()
      })
      worker.postMessage({ kind: 'nativeFrames.attach', port }, [port])
      const urls = files.map(file => `henji-media://local/${encodeURIComponent(file)}`)
      const localPaths = Object.fromEntries(urls.map((url, i) => [url, files[i]]))
      const frames = []
      const surface = document.createElement('canvas'); surface.width = 320; surface.height = 180; document.body.append(surface)
      const offscreen = surface.transferControlToOffscreen()
      const cache = (index, provenance) => {
        worker.postMessage({ id: 0, kind: 'renderCache', localPaths, windows: [{ key: 'same-content', startFrame: 0, endFrame: 60, url: urls[index], width: 320, height: 180, fps: 30, ...(provenance ? { provenance } : {}) }] })
      }
      const read = async (frame, precision, sequential = true) => {
        const start = performance.now()
        const result = await request({ kind: 'render', frame, sequential, scrubbing: !sequential, ...(precision ? { precision } : {}) })
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const canvas = new OffscreenCanvas(1, 1), context = canvas.getContext('2d')
        context.drawImage(surface, 0, 0, 1, 1)
        frames.push({ frame, requested: precision ?? 'exact', provenance: result.provenance, renderCached: result.renderCached, rgb: Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3), ms: performance.now() - start })
      }
      try {
        await request({ kind: 'init', document: composition, previewWidth: 320, surface: offscreen, decode: { nativeAvailable: true, forced: 'native', localPaths } }, [offscreen])
        cache(0, 'web-cache')
        await read(0, 'web-cache')
        await read(1)
        await read(2, 'web-cache', false)
        cache(1, 'live')
        await read(3)
        cache(1)
        await read(4)
        return frames
      } finally { await request({ kind: 'dispose' }); worker.terminate(); native.disconnect(route); surface.remove() }
    }, { workerName, composition, files })
    const [cached, exact, paused, upgraded, historical] = evidence.frames
    // 只辨认读的是哪份纯色文件：4:2:0 解码后纯红的绿色分量约 24。
    const red = rgb => rgb[0] > 200 && rgb[1] < 60 && rgb[2] < 60
    assert.equal(cached.provenance, 'web-cache'); assert.ok(red(cached.rgb))
    assert.equal(exact.provenance, 'live'); assert.equal(exact.renderCached, false); assert.ok(exact.rgb.every(value => value < 5))
    assert.equal(paused.provenance, 'web-cache'); assert.ok(red(paused.rgb))
    for (const result of [upgraded, historical]) { assert.equal(result.provenance, 'live'); assert.equal(result.renderCached, true); assert.ok(result.rgb[1] > 90 && result.rgb[0] < 20) }
    evidence.status = 'passed'
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error.stack ?? error); throw error }
  finally { clearTimeout(timeout); fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2)); await instance.close(); console.log(JSON.stringify({ output, status: evidence.status })) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
