const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { build } = require('esbuild')
const { loadTypeScript } = require('../check-persistence-compat.cjs')

/** Candidate probes or isolated production-timeline acceptance; original effects stay untouched. */
function createDirectAuthorScene() {
  const formal = JSON.parse(fs.readFileSync(path.join(path.resolve(process.env.HENJI_DIRECT_AUTHOR_PROBE), 'input.json'), 'utf8').replace(/^\uFEFF/, '')).formal === true
  return {
    id: 'video-edit-direct-author', surface: '剪辑', name: formal ? '剪辑-作者JS正式链路' : '剪辑-作者JS原效果候选帧', writesUserData: formal,
    async setup(page, app, { capture }) {
      const root = path.resolve(process.env.HENJI_DIRECT_AUTHOR_PROBE)
      const spec = JSON.parse(fs.readFileSync(path.join(root, 'input.json'), 'utf8').replace(/^\uFEFF/, ''))
      if (spec.yogaTimeline) return require('./uiInspectionSceneYogaAuthor.cjs').runYogaAuthorTimeline(page, app, { capture, root, spec })
      const host = await app.evaluate(({ app }) => ({ features: app.getGPUFeatureStatus(), versions: { electron: process.versions.electron, chrome: process.versions.chrome } }))
      const adaptations = [...(spec.adaptations ?? [])]
      const imageSources = Object.fromEntries(Object.entries(spec.assets ?? {}).map(([key, file]) => [key, `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`]))
      const sourceFiles = spec.sourceFiles ? { entry: spec.entry, files: Object.fromEntries(Object.entries(spec.sourceFiles).map(([name, file]) => [name, fs.readFileSync(file, 'utf8')])) } : undefined
      const result = sourceFiles ? undefined : await build({ entryPoints: [spec.entry], bundle: true, write: false, sourcemap: 'inline', format: 'esm', platform: 'browser', plugins: [{ name: 'worker-canvas-adapter', setup(build) {
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
      const project = fixture.createVideoEditTestDocument(spec.formal ? '作者 JS 正式链路验证' : '作者 JS 候选验证')
      Object.assign(project.sequences[0], { width: spec.width, height: spec.height, frameRate: { numerator: 60, denominator: 1 } })
      const composition = videoEditComposition(project, project.sequences[0].id)
      if (spec.formal) {
        return require('./uiInspectionSceneAuthorTimeline.cjs').runAuthorTimeline(page, app, { capture, root, spec, project, sourceFiles, source: result?.outputFiles[0].text, adaptations })
      }
      const assets = path.resolve('out/renderer/assets')
      const workerFile = fs.readdirSync(assets).find(file => /^videoEditWorker-.*\.js$/.test(file))
      const compilerFile = fs.readdirSync(assets).find(file => /^videoEditCodeCompiler.worker-.*\.js$/.test(file))
      assert.ok(workerFile, '缺少最新节目 Worker 产物')
      const evidence = await page.evaluate(async ({ source, sourceFiles, composition, workerFile, compilerFile, spec, imageSources }) => {
        let locations, compileMs, compileCacheHit
        if (sourceFiles) {
          const compiler = new Worker(new URL(`./assets/${compilerFile}`, location.href), { type: 'module' })
          try {
            const started = performance.now()
            const compile = id => new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error('正式模块打包超过30秒')), 30000)
              compiler.onmessage = ({ data }) => { clearTimeout(timer); data.error ? reject(new Error(data.error.message)) : resolve(data) }
              compiler.onerror = event => { clearTimeout(timer); reject(new Error(event.message)) }
              compiler.postMessage({ id, kind: 'author.bundle', files: sourceFiles })
            })
            const compiled = await compile(1)
            compileMs = performance.now() - started
            source = compiled.bundle.code; locations = compiled.bundle.locations
            compileCacheHit = (await compile(2)).cacheHit
          } finally { compiler.terminate() }
        }
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
        let elements
        try {
          await request({ kind: 'init', document: composition, previewWidth: spec.width })
          const metadata = spec.readMetadata ? (await request({ kind: 'authorMetadata', url, locations })).authorMetadata : undefined
          const images = Object.fromEntries(await Promise.all(Object.entries(imageSources).map(async ([key, source]) => [key, await createImageBitmap(await (await fetch(source)).blob(), { colorSpaceConversion: spec.rawAssets?.includes(key) ? 'none' : 'default' })])))
          for (let index = 0; index < spec.frames; index++) {
            const time = spec.sampleTimes?.[index] ?? spec.time + index / 60
            const result = await request({ kind: 'authorFrame', url, ...(index === 0 ? { assets: images } : {}), params: spec.params ?? {}, info: { time, frameDuration: 1 / 60, clip: { time, duration: spec.duration } }, options: { overrides: spec.overrides, locations, observe: index === 0 && spec.observe === true } }, index === 0 ? Object.values(images) : [])
            if (result.elements) elements = result.elements
            durations.push(result.gpuMs)
            ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(result.bitmap, 0, 0); result.bitmap.close()
            if (spec.captureAll || index === 0 || index === spec.frames - 1) snapshots.push(canvas.toDataURL('image/png'))
          }
          await request({ kind: 'dispose' })
          return { durations, snapshots, elements, metadata, compileMs, compileCacheHit }
        } finally {
          worker.terminate(); URL.revokeObjectURL(url)
          for (const job of pending.values()) clearTimeout(job.timer)
        }
      }, { source: result?.outputFiles[0].text, sourceFiles, composition, workerFile, compilerFile, spec, imageSources })
      if (sourceFiles) assert.equal(evidence.compileCacheHit, true, '正式共享打包缓存未命中')
      if (spec.expectedElements) assert.deepEqual(evidence.elements?.map(element => element.id), spec.expectedElements)
      if (spec.readMetadata) {
        assert.ok(evidence.metadata?.name, '现有渲染 Worker 未读回作者声明')
        if (spec.expectedParameters) assert.deepEqual(evidence.metadata.parameters.map(parameter => parameter.key), spec.expectedParameters)
      }
      for (let index = 0; index < evidence.snapshots.length; index++) fs.writeFileSync(path.join(root, `frame-${index}.png`), Buffer.from(evidence.snapshots[index].split(',')[1], 'base64'))
      const warm = evidence.durations.slice(1).sort((a, b) => a - b)
      fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify({ host, adaptations, durations: evidence.durations, elements: evidence.elements, metadata: evidence.metadata, compileMs: evidence.compileMs, compileCacheHit: evidence.compileCacheHit, warmP95Ms: warm[Math.ceil(warm.length * .95) - 1], note: '同一节目Worker/GPU的逐帧候选执行；不代表正式时间线热播放或PR对比通过。' }, null, 2))
      await capture('direct-author-frame')
    },
  }
}
module.exports = { createDirectAuthorScene }
