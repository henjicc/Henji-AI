// 显式专项：隔离正式应用的Worker、可靠网页取帧、身份区还原与精确导出顺手发布。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { launchElectronApp } = require('./lib/electronLaunch.cjs')
const { loadTypeScript } = require('./check-persistence-compat.cjs')

async function main() {
  const root = path.resolve(__dirname, '..')
  const [width, height] = (process.argv.find(value => value.startsWith('--size='))?.slice(7) ?? '320x180').split('x').map(Number)
  const heavy = process.argv.includes('--heavy-page'), compare = process.argv.includes('--compare')
  const noCache = process.env.PROBE_NO_CACHE === '1'
  const output = path.join(root, '.artifacts', 'web-time-export', new Date().toISOString().replace(/[:.]/g, '-'))
  const site = path.join(output, 'site')
  fs.mkdirSync(site, { recursive: true })
  fs.writeFileSync(path.join(site, 'index.html'), heavy
    ? `<!doctype html><style>html,body{margin:0;overflow:hidden;background:rgb(17,83,129)}#s{width:100vw;height:100vh;display:grid;grid-template-columns:repeat(12,1fr);gap:6px;color:white;font:12px sans-serif}.card{padding:6px;background:linear-gradient(120deg,#25364e,#162132);border:1px solid #5988aa;box-shadow:0 3px 8px #050810}.chart{display:flex;align-items:end;height:56px;gap:2px}.bar{flex:1;background:linear-gradient(#40d9d0,#367be1)}#guard{position:fixed;left:0;top:0;width:8px;height:4px;background:rgb(17,83,129)}</style><div id="s" data-henji-stage>${Array.from({ length: 144 }, (_, index) => `<div class="card"><span>动态指标 ${index}</span><div class="chart">${'<div class="bar"></div>'.repeat(12)}</div></div>`).join('')}</div><div id="guard"></div><script>const bars=[...document.querySelectorAll('.bar')],labels=[...document.querySelectorAll('span')];window.henjiWeb={ready:Promise.resolve(),duration:2,seek(t){bars.forEach((bar,i)=>{bar.style.height=(8+Math.round((Math.sin(i*.13+t*2)+1)*24))+'px';bar.style.filter='drop-shadow(0 0 '+(1+Math.round((Math.cos(i+t)+1)*2))+'px hsl('+((i*7+Math.round(t*30))%360)+',80%,50%))'});labels.forEach((label,i)=>label.textContent='动态指标 '+i+' / '+(100+Math.sin(i+t)*80).toFixed(2))}}</script>`
    : `<!doctype html><style>html,body{margin:0}#s{width:${width}px;height:${height}px;background:rgb(17,83,129);color:white;font:30px sans-serif;display:grid;place-items:center}</style><div id="s" data-henji-stage></div><script>window.seekCalls=0;window.henjiWeb={ready:Promise.resolve(),duration:2,seek(t){window.seekCalls++;document.getElementById("s").textContent=t.toFixed(3)}}</script>`)
  const source = `export default {name:"网页写缓存验收",kind:"generator",mode:"dynamic",width:${width},height:${height},durationSeconds:2,params:[{key:"page",type:"image",title:"网页"}],draw(ctx,t,p,w,h,assets){if(assets.page)ctx.drawImage(assets.page,0,0,w,h)}}`
  const hash = createHash('sha256').update(source).digest('hex')
  const { createVideoEditTestDocument } = loadTypeScript('src/core/videoEdit/testFixtures.ts')
  const { videoEditComposition } = loadTypeScript('src/core/videoEdit/document.ts')
  const { makeVideoEditItemClip } = loadTypeScript('src/core/videoEdit/projectItems.ts')
  const doc = createVideoEditTestDocument('网页精确导出缓存验收'), sequence = doc.sequences[0]
  Object.assign(sequence, { width, height, frameRate: { numerator: 30, denominator: 1 } })
  const code = { definitionId: 'web-source', versionId: 'web-code', parameters: { page: { kind: 'web', path: site, width, height, scale: 1 } } }
  doc.codeMaterials = [{ id: 'web-source', name: '网页', defaultVersionId: 'web-code', versions: [{ id: 'web-code', apiVersion: 4, languageVersion: 4, entry: 'main.js', files: [{ path: 'main.js', location: `asset:${hash}`, hash }] }] }]
  doc.items.push({ id: 'web-item', name: '网页', kind: 'code', code })
  // 片段工厂要源码检查结果：这里只需要它据此定时长的动态模式与秒数（与源码声明一致）。
  sequence.clips.push(makeVideoEditItemClip(doc, 'web-item', sequence.id, { frame: 0, duration: 60, track: 1 }, () => ({ mode: 'dynamic', durationSeconds: 2, width, height, parameters: [] })))
  const composition = videoEditComposition(doc, sequence.id)
  const workerName = fs.readdirSync(path.join(root, 'out/renderer/assets')).find(name => /^videoEditWorker-[\w-]+(?:\.worker)?\.js$/.test(name))
  assert.ok(workerName)
  const instance = await launchElectronApp({ mainEntry: path.join(root, 'out/main/index.cjs'), cwd: root, isolateUserData: true, useElectronApi: true, skipOnboarding: true, extraArgs: ['--background'] })
  const timeout = setTimeout(() => { void instance.close() }, 180000)
  // 应用窗口的预加载桥在页面导航完成后才可用。
  await instance.page.waitForFunction(() => Boolean(window.henjiNative?.videoFrames), null, { timeout: 30000 })
  const evidence = { output, size: { width, height }, heavy, compare, scope: '自造网页→正式Worker整帧合成；本地自造ES模块，编译传输回复只承载该固定模块；未测物理上屏', frames: [] }
  await instance.app.evaluate(({ sharedTexture }) => {
    const imports = new WeakMap(), imported = sharedTexture.importSharedTexture.bind(sharedTexture), send = sharedTexture.sendSharedTexture.bind(sharedTexture)
    globalThis.__webExportSnapshots = []
    sharedTexture.importSharedTexture = input => { const texture = imported(input); imports.set(texture, input.textureInfo); return texture }
    sharedTexture.sendSharedTexture = (input, ...args) => {
      if (args[0]?.snapshot) globalThis.__webExportSnapshots.push({ texture: imports.get(input.importedSharedTexture), snapshot: { ...args[0].snapshot, restore: { length: args[0].snapshot.restore?.length } } })
      return send(input, ...args)
    }
  })
  try {
    const exportPass = (precision = 'exact', write = !noCache) => instance.page.evaluate(async ({ composition, workerName, source, hash, write, precision, width, height, bitmapMode }) => {
      const worker = new Worker(new URL(`./assets/${workerName}`, location.href), { type: 'module' })
      const moduleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      const pending = new Map(); let nextId = 0
      worker.onmessage = ({ data }) => {
        if (data.kind === 'code.read') { worker.postMessage({ kind: 'code.source', token: data.token, source }); return }
        if (data.kind === 'code.modules') { worker.postMessage({ kind: 'code.moduleUrls', token: data.token, url: moduleUrl }); return }
        if (data.kind === 'code.metadata') { worker.postMessage({ kind: 'code.metadataResult', token: data.token }); return }
        if (data.kind === 'code.trust') { worker.postMessage({ kind: 'code.trustResult', token: data.token }); return }
        if (!data.phase && !pending.has(data.id)) (window.__unhandled ??= []).push(data.kind === 'log' ? JSON.stringify(data).slice(0, 400) : data.kind)
        if (data.phase || !pending.has(data.id)) return
        const entry = pending.get(data.id); pending.delete(data.id)
        if (data.error) entry.reject(new Error(data.error)); else entry.resolve(data)
      }
      const request = body => new Promise((resolve, reject) => {
        const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Worker超时 ${body.kind}；未应答的Worker消息：${(window.__unhandled ?? []).slice(-6).join(' | ')}`)) }, 45000)
        pending.set(id, { resolve: data => { clearTimeout(timer); resolve(data) }, reject: error => { clearTimeout(timer); reject(error) } })
        worker.postMessage({ ...body, id })
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
      const frames = []
      try {
        await native.webCacheForeground(true)
        await request({ kind: 'init', document: composition, codeSources: { [hash]: source }, cacheWebOutput: write, decode: { nativeAvailable: true, forced: 'native', localPaths: {} } })
        for (let frame = 0; frame < 60; frame++) {
          const start = performance.now()
          const result = await request({ kind: 'render', frame, sequential: true, ...(precision === 'exact' && !bitmapMode ? { readRgb: { width, height } } : {}), precision, quality: 'final' })
          if (result.approximate || precision === 'exact' && result.provenance !== 'live') throw new Error(`精确导出没有拿到实时画面：${frame}`)
          const guard = []
          if (result.rgb) {
            const rgb = result.rgb
            for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) guard.push(...rgb.slice((y * width + x) * 3, (y * width + x) * 3 + 3))
          } else if (result.bitmap) {
            const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d')
            context.drawImage(result.bitmap, 0, 0); result.bitmap.close()
            const rgba = context.getImageData(0, 0, 8, 4).data
            for (let pixel = 0; pixel < 32; pixel++) guard.push(...rgba.slice(pixel * 4, pixel * 4 + 3))
          } else throw new Error('整帧画面未交付')
          if (guard.some((value, index) => Math.abs(value - [17, 83, 129][index % 3]) > 1)) throw new Error(`身份区未还原：${frame} ${guard.slice(0, 12)}`)
          frames.push({ frame, provenance: result.provenance, ms: performance.now() - start, renderElapsedMs: result.renderElapsedMs, guardRestored: true })
        }
        return frames
      } finally { await request({ kind: 'dispose' }).catch(() => {}); worker.terminate(); native.disconnect(route); URL.revokeObjectURL(moduleUrl); await native.webCacheForeground(false) }
    }, { composition, workerName, source, hash, write, precision, width, height, bitmapMode: compare })
    const capabilityLogs = () => instance.page.evaluate(async () => (await window.henjiNative.logging.queryLogEvents({ date: new Date().toISOString().slice(0, 10), domainPrefix: 'main.web_source', keyword: 'capability', limit: 2000 })).events)
    // 第一遍：硬件链路尚未实探，导出照常实时取帧并在后台实探；等实探有结论后第二遍才写缓存。
    evidence.firstPass = await exportPass()
    for (let waited = 0; !noCache && waited < 120000 && !(await capabilityLogs()).some(entry => /capability\.(completed|failed)$/.test(entry.event)); waited += 1000) await new Promise(resolve => setTimeout(resolve, 1000))
    evidence.capability = (await capabilityLogs()).map(entry => ({ at: entry.timestamp, event: entry.event, context: entry.context, error: entry.error?.message })); evidence.waitEndedAt = new Date().toISOString()
    evidence.frames = await exportPass()
    evidence.logs = await instance.page.evaluate(async () => (await window.henjiNative.logging.queryLogEvents({ date: new Date().toISOString().slice(0, 10), domainPrefix: 'main.web_source', keyword: 'export_cache', limit: 2000 })).events)
    assert.equal(evidence.frames.length, 60)
    if (!noCache) assert.ok(evidence.logs.some(entry => entry.event === 'web_source.export_cache.completed'))
    assert.ok(!evidence.logs.some(entry => entry.event === 'web_source.export_cache.failed'))
    if (compare) {
      evidence.liveBaseline = await exportPass('exact', false)
      evidence.cachedExport = await exportPass('web-cache', false)
      assert.ok(evidence.cachedExport.every(frame => frame.provenance === 'web-cache'), '缓存导出必须每帧实际命中')
      const summary = frames => { const times = frames.map(frame => frame.ms).sort((a, b) => a - b); return { count: times.length, meanMs: times.reduce((sum, value) => sum + value, 0) / times.length, p50Ms: times[Math.floor(times.length * .5)], p95Ms: times[Math.floor(times.length * .95)], totalMs: times.reduce((sum, value) => sum + value, 0) } }
      evidence.performance = { live: summary(evidence.liveBaseline), cached: summary(evidence.cachedExport), exactWriting: summary(evidence.frames) }
    }
    evidence.status = 'passed'
  } catch (error) {
    evidence.status = 'failed'; evidence.error = String(error.stack ?? error)
    evidence.failureLogs = await instance.page.evaluate(async () => (await window.henjiNative.logging.queryLogEvents({ date: new Date().toISOString().slice(0, 10), domainPrefix: 'main.web_source', limit: 2000 })).events.filter(entry => entry.level !== 'debug' || /capability|export_cache/.test(entry.event))).catch(reason => String(reason))
    throw error
  }
  finally { clearTimeout(timeout); evidence.snapshots = await instance.app.evaluate(() => globalThis.__webExportSnapshots).catch(() => []); fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2)); await instance.close(); console.log(JSON.stringify({ output, status: evidence.status })) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
