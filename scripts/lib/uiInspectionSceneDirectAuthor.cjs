const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { build } = require('esbuild')
const { loadTypeScript } = require('../check-persistence-compat.cjs')

/** Candidate execution only: no user project or original effect is changed. */
function createDirectAuthorScene() {
  return {
    id: 'video-edit-direct-author', surface: '剪辑', name: '剪辑-作者JS原效果候选帧', writesUserData: false,
    async setup(page, app, { capture }) {
      const root = path.resolve(process.env.HENJI_DIRECT_AUTHOR_PROBE)
      const spec = JSON.parse(fs.readFileSync(path.join(root, 'input.json'), 'utf8').replace(/^\uFEFF/, ''))
      const host = await app.evaluate(({ app }) => ({ features: app.getGPUFeatureStatus(), versions: { electron: process.versions.electron, chrome: process.versions.chrome } }))
      const adaptations = [...(spec.adaptations ?? [])]
      const imageSources = Object.fromEntries(Object.entries(spec.assets ?? {}).map(([key, file]) => [key, `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`]))
      const result = await build({ entryPoints: [spec.entry], bundle: true, write: false, sourcemap: 'inline', format: 'esm', platform: 'browser', plugins: [{ name: 'worker-canvas-adapter', setup(build) {
        build.onLoad({ filter: /chip3d\.js$/ }, args => {
          let contents = fs.readFileSync(args.path, 'utf8')
          const before = contents
          contents = contents.replace('document.createElement("canvas")', 'new OffscreenCanvas(w,h)')
          contents = contents.replace('new THREE.WebGLRenderer({', 'new THREE.WebGLRenderer({ canvas: new OffscreenCanvas(1,1),')
          if (contents !== before) adaptations.push({ file: args.path, changes: ['CanvasTexture 使用 OffscreenCanvas(w,h)', 'WebGLRenderer 显式传入 OffscreenCanvas'] })
          return { contents, loader: 'js', resolveDir: path.dirname(args.path) }
        })
      } }] })
      const fixture = loadTypeScript('src/core/videoEdit/testFixtures.ts')
      const { videoEditComposition } = loadTypeScript('src/core/videoEdit/document.ts')
      const project = fixture.createVideoEditTestDocument('作者 JS 候选验证')
      Object.assign(project.sequences[0], { width: spec.width, height: spec.height, frameRate: { numerator: 60, denominator: 1 } })
      const composition = videoEditComposition(project, project.sequences[0].id)
      const assets = path.resolve('out/renderer/assets')
      const workerFile = fs.readdirSync(assets).find(file => /^videoEditWorker-.*\.js$/.test(file))
      assert.ok(workerFile, '缺少最新节目 Worker 产物')
      const evidence = await page.evaluate(async ({ source, composition, workerFile, spec, imageSources }) => {
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
        const worker = new Worker(new URL(`./assets/${workerFile}`, location.href), { type: 'module' })
        let id = 0
        const pending = new Map()
        worker.onmessage = ({ data }) => {
          if (!pending.has(data.id) || data.phase === 'submitted') return
          const job = pending.get(data.id); pending.delete(data.id); clearTimeout(job.timer)
          if (data.error) job.reject(new Error(data.error)); else job.resolve(data)
        }
        worker.onerror = event => { for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error(event.message)) } pending.clear() }
        const request = (data, transfer = []) => new Promise((resolve, reject) => {
          const key = ++id
          const timer = setTimeout(() => { pending.delete(key); reject(new Error(`节目 Worker ${data.kind} 超过60秒`)) }, 60000)
          pending.set(key, { resolve, reject, timer }); worker.postMessage({ ...data, id: key }, transfer)
        })
        const canvas = document.createElement('canvas')
        canvas.width = spec.width; canvas.height = spec.height
        canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;object-fit:contain;z-index:99999;background:black'
        canvas.setAttribute('aria-label', '作者JS候选画面'); document.body.append(canvas)
        const ctx = canvas.getContext('2d')
        const durations = [], snapshots = []
        try {
          await request({ kind: 'init', document: composition, previewWidth: spec.width })
          const images = Object.fromEntries(await Promise.all(Object.entries(imageSources).map(async ([key, source]) => [key, await createImageBitmap(await (await fetch(source)).blob(), { colorSpaceConversion: spec.rawAssets?.includes(key) ? 'none' : 'default' })])))
          for (let index = 0; index < spec.frames; index++) {
            const time = spec.sampleTimes?.[index] ?? spec.time + index / 60
            const result = await request({ kind: 'authorFrame', url, ...(index === 0 ? { assets: images } : {}), params: spec.params ?? {}, info: { time, frameDuration: 1 / 60, clip: { time, duration: spec.duration } } }, index === 0 ? Object.values(images) : [])
            durations.push(result.gpuMs)
            ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(result.bitmap, 0, 0); result.bitmap.close()
            if (spec.captureAll || index === 0 || index === spec.frames - 1) snapshots.push(canvas.toDataURL('image/png'))
          }
          await request({ kind: 'dispose' })
          return { durations, snapshots }
        } finally {
          worker.terminate(); URL.revokeObjectURL(url)
          for (const job of pending.values()) clearTimeout(job.timer)
        }
      }, { source: result.outputFiles[0].text, composition, workerFile, spec, imageSources })
      for (let index = 0; index < evidence.snapshots.length; index++) fs.writeFileSync(path.join(root, `frame-${index}.png`), Buffer.from(evidence.snapshots[index].split(',')[1], 'base64'))
      const warm = evidence.durations.slice(1).sort((a, b) => a - b)
      fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify({ host, adaptations, durations: evidence.durations, warmP95Ms: warm[Math.ceil(warm.length * .95) - 1], note: '同一节目Worker/GPU的逐帧候选执行；不代表正式时间线热播放或PR对比通过。' }, null, 2))
      await capture('direct-author-frame')
    },
  }
}
module.exports = { createDirectAuthorScene }
