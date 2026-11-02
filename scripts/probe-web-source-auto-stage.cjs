/** 显式真机探针：node scripts/probe-web-source-auto-stage.cjs；证据写入 .tmp/web-source-auto-stage。 */
/* eslint-disable @typescript-eslint/no-var-requires -- .cjs 探针在 Node 中启动 Electron。 */
/* global Page, host, source, fallbacks, WebCacheSubmissions, GpuFrameCapture */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')
const pixelmatch = require('pixelmatch').default
const { buildSync } = require('esbuild')
const { launchElectronApp } = require('./lib/electronLaunch.cjs')

const root = path.resolve(__dirname, '..')
const output = path.join(root, '.tmp/web-source-auto-stage')
fs.mkdirSync(output, { recursive: true })
buildSync({ entryPoints: [path.join(root, 'electron/main/services/web-source/page.ts')], bundle: true,
  platform: 'node', format: 'cjs', packages: 'external', outfile: path.join(output, 'page.cjs') })
buildSync({ stdin: { contents: "export { WebCacheSubmissions } from './electron/main/services/web-source/submissions'; export { GpuFrameCapture } from './electron/main/services/web-replay/player/gpuCapture'", resolveDir: root },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: path.join(output, 'recording.cjs') })
fs.mkdirSync(path.join(output, '../preload'), { recursive: true })
fs.copyFileSync(path.join(root, 'out/preload/web-replay.cjs'), path.join(output, '../preload/web-replay.cjs'))
fs.writeFileSync(path.join(output, 'main.cjs'), `const {app,BrowserWindow}=require('electron');
app.whenReady().then(()=>{globalThis.Page=require('./page.cjs').WebSourcePage;
Object.assign(globalThis,require('./recording.cjs'));
globalThis.host=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false}});
host.loadURL('about:blank')})`)

function quantiles(samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  return { frames: sorted.length, p50: sorted[Math.ceil(sorted.length * .5) - 1], p90: sorted[Math.ceil(sorted.length * .9) - 1] }
}
async function difference(left, right) {
  const [a, b] = await Promise.all([left, right].map(file => sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })))
  assert.equal(a.data.length, b.data.length)
  let differing = 0, maximumDelta = 0, total = 0
  for (let i = 0; i < a.data.length; i += 4) {
    let delta = 0
    for (let c = 0; c < 3; c++) { const d = Math.abs(a.data[i + c] - b.data[i + c]); delta = Math.max(delta, d); total += d }
    if (delta) differing++
    maximumDelta = Math.max(maximumDelta, delta)
  }
  const significant = pixelmatch(a.data, b.data, null, a.info.width, a.info.height, { threshold: .1 })
  return { differingPixels: differing, differingPercent: differing / (a.data.length / 4) * 100, maximumDelta,
    meanAbsoluteChannelDelta: total / (a.data.length / 4 * 3), significantPixelPercent: significant / (a.data.length / 4) * 100 }
}

(async () => {
  const instance = await launchElectronApp({ mainEntry: path.join(output, 'main.cjs'), cwd: root, isolateUserData: true, useElectronApi: true })
  const app = instance.app
  const evidence = { completed: false, scope: '真实 Electron WebSourcePage，从 seek 到主进程收到共享纹理；不含向剪辑窗口交付和合成', cases: [] }
  const store = () => fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2))
  const open = async (folder, width, height, mode) => app.evaluate(async (_, args) => {
    globalThis.source?.close()
    const { folder, width, height, mode } = args
    globalThis.fallbacks = []
    globalThis.source = new Page('probe', { id: host.webContents.id, mainFrame: host.webContents.mainFrame, isDestroyed: () => false, send: () => {}, onGone: () => () => {} },
      'probe', { root: folder }, { width, height, region: [0, 0, width, height], scale: 1 }, 'probe', () => {}, reason => fallbacks.push(reason))
    // 计时止于主进程拿到纹理；不把跨窗口交付和读回 PNG 计入取帧耗时。
    source.deliver = async texture => texture.release()
    if (mode === 'compositor') source.snapshotFailure = 'probe-compositor'
    if (mode === 'missing' || mode === 'move-failure' || mode === 'top-layer-probe') {
      const create = source.createWindow.bind(source)
      source.createWindow = () => {
        create()
        const contents = source.window.webContents, execute = contents.executeJavaScriptInIsolatedWorld.bind(contents)
        contents.executeJavaScriptInIsolatedWorld = (world, scripts, ...args) => execute(world, scripts.map(item => ({ ...item, code: item.code.includes('requestAdapter')
          ? mode === 'top-layer-probe' ? item.code.replace("if (document.fullscreenElement || document.querySelector(':modal, :popover-open'))", 'if (false)')
            : mode === 'missing' ? item.code.replace("typeof HTMLCanvasElement.prototype.requestPaint", "typeof undefined")
            : "const move = Element.prototype.moveBefore; Element.prototype.moveBefore = function() { Element.prototype.moveBefore = move; throw new Error('probe-move-failure') };\n" + item.code : item.code })), ...args)
      }
    }
    await source.open()
    return source.capturePath
  }, { folder, width, height, mode })
  const capture = time => app.evaluate(async (_, time) => {
    const start = performance.now(), result = await source.capture(time, `probe-${time}`, ['header', '#modal', '#scroll', '#animated'])
    return { time, elapsedMs: performance.now() - start, boxes: result.boxes, capturePath: source.capturePath }
  }, time)
  const script = code => app.evaluate((_, code) => source.window.webContents.executeJavaScript(code), code)
  const isolated = code => app.evaluate((_, code) => source.window.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code }], false), code)
  const fixture = (name, style, markup, seek, ready = 'Promise.resolve()') => {
    const folder = path.join(output, name)
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, 'index.html'), `<!doctype html><style>html,body{margin:0} ${style}</style><body>${markup}<script>henjiWeb={ready:${ready},seek:async(t)=>{${seek}},duration:3}</script></body>`)
    return folder
  }
  const screenshot = async name => {
    const file = path.join(output, `${name}.png`)
    fs.writeFileSync(file, Buffer.from(await app.evaluate(async () => Array.from((await source.window.webContents.capturePage()).toPNG()))))
    return file
  }
  try {
    evidence.environment = await app.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome, isolatedData: !!process.env.HENJI_ISOLATED_APP_DATA }))
    assert.equal(evidence.environment.isolatedData, true)
    const cases = [
      { name: 'ordinary', folder: path.join(root, 'tests/fixtures/web-source/ordinary'), width: 960, height: 540 },
      { name: 'existing-unmarked', folder: path.join(output, 'unmarked'), width: 1920, height: 1080 },
    ]
    fs.mkdirSync(cases[1].folder, { recursive: true })
    fs.writeFileSync(path.join(cases[1].folder, 'index.html'), fs.readFileSync(path.join(root, 'tests/fixtures/web-source/index.html'), 'utf8').replaceAll('data-henji-stage', 'data-page-root'))
    for (const item of cases) {
      const row = { name: item.name, comparisons: [], timings: {} }
      evidence.cases.push(row)
      for (const mode of ['automatic', 'compositor']) {
        assert.equal((await open(item.folder, item.width, item.height, mode)).captureMode, mode === 'automatic' ? 'html-in-canvas' : 'compositor')
        for (const t of [0, .5, 1.5, 3, .5]) await capture(t)
        const times = []
        for (let i = 0; i < 40; i++) times.push((await capture((i % 20) / 6)).elapsedMs)
        row.timings[mode] = quantiles(times)
        for (const t of [0, .5, 1.5, 3]) {
          const result = await capture(t), file = await screenshot(`${item.name}-${mode}-${t}`)
          if (mode === 'automatic') row.comparisons.push({ time: t, automatic: file, boxes: result.boxes })
          else {
            const comparison = row.comparisons.find(value => value.time === t)
            comparison.compositor = file
            comparison.difference = await difference(comparison.automatic, file)
            // 快照采用灰度抗锯齿；另看感知差与全图误差，禁止只靠矩形相同判成功。
            assert.ok(comparison.difference.meanAbsoluteChannelDelta <= 1 && comparison.difference.significantPixelPercent <= .5, JSON.stringify(comparison.difference))
            assert.deepEqual(result.boxes, comparison.boxes, `布局位置不一致：${item.name} @ ${t}`)
          }
        }
        store()
      }
    }
    await open(path.join(root, 'tests/fixtures/web-source'), 1920, 1080, 'automatic')
    await capture(1.5)
    evidence.markedComparison = await difference(await screenshot('existing-marked-1.5'), path.join(output, 'existing-unmarked-automatic-1.5.png'))
    assert.ok(evidence.markedComparison.maximumDelta <= 1, JSON.stringify(evidence.markedComparison))
    await open(cases[0].folder, 960, 540, 'automatic')
    await script(`fixture.field.value='保留输入'; fixture.field.focus(); fixture.button.click();`)
    await capture(2)
    evidence.state = await script(`({sameField:fixture.field===document.querySelector('#field'),value:fixture.field.value,clicks:document.querySelector('#clicks').textContent,scroll:fixture.scrollBox.scrollTop,modal:!!document.querySelector('#modal')})`)
    assert.deepEqual(evidence.state, { sameField: true, value: '保留输入', clicks: '1', scroll: 192, modal: true })
    await isolated(`window.__henjiWebSourceSnapshot.copy=()=>{throw new Error('probe-runtime-failure')}; undefined`)
    assert.equal((await capture(1.5)).capturePath.captureMode, 'compositor')
    assert.equal(await script(`fixture.field.value`), '保留输入')
    evidence.runtimeFallback = await app.evaluate(() => fallbacks)
    assert.equal(evidence.runtimeFallback.length, 1)

    await open(cases[0].folder, 960, 540, 'automatic')
    await script(`document.body.replaceChildren(Object.assign(document.createElement('main'),{id:'replacement',textContent:'新正文'})); henjiWeb.seek=()=>{}; undefined`)
    assert.equal((await capture(0)).capturePath.captureMode, 'compositor')
    evidence.bodyReplacement = await script(`({replacement:!!document.querySelector('#replacement'),oldField:!!document.querySelector('#field')})`)
    assert.deepEqual(evidence.bodyReplacement, { replacement: true, oldField: false })

    const scrollFolder = path.join(output, 'document-scroll')
    fs.mkdirSync(scrollFolder, { recursive: true })
    fs.writeFileSync(path.join(scrollFolder, 'index.html'), `<!doctype html><main style="height:2000px">长页面</main><script>henjiWeb={ready:Promise.resolve().then(()=>scrollTo(0,500)),seek(){},duration:1}</script>`)
    assert.equal((await open(scrollFolder, 960, 540, 'automatic')).fallbackReason, 'automatic-stage-document-scroll')
    evidence.documentScroll = await script('scrollY')
    assert.equal(evidence.documentScroll, 500)

    const dynamicFolder = path.join(output, 'dynamic-scroll')
    fs.mkdirSync(dynamicFolder, { recursive: true })
    fs.writeFileSync(path.join(dynamicFolder, 'index.html'), `<!doctype html><style>body{margin:0;height:100vh}</style><main id="main" style="height:100px">动态长页面</main><script>henjiWeb={ready:Promise.resolve(),seek(t){main.style.height=t?'2000px':'100px';scrollTo(0,t?500:0)},duration:1}</script>`)
    assert.equal((await open(dynamicFolder, 960, 540, 'automatic')).captureMode, 'html-in-canvas')
    const dynamicCapture = await capture(1).then(result => ({ result }), error => ({ error: error.message.split('\n')[0] }))
    evidence.dynamicScrollCapture = dynamicCapture
    assert.equal(await app.evaluate(() => source.capturePath.captureMode), 'compositor')
    if (dynamicCapture.error) {
      await open(dynamicFolder, 960, 540, 'compositor')
      evidence.dynamicScrollBaseline = await capture(1).then(result => ({ result }), error => ({ error: error.message.split('\n')[0] }))
      assert.equal(evidence.dynamicScrollBaseline.error, dynamicCapture.error, '整页滚动失败必须与未改造的旧链路一致')
    }
    evidence.dynamicDocumentScroll = await script('scrollY')
    assert.equal(evidence.dynamicDocumentScroll, 500)
    for (const mode of ['missing', 'move-failure']) {
      const capturePath = await open(cases[0].folder, 960, 540, mode)
      assert.equal(capturePath.captureMode, 'compositor')
      await capture(2)
      assert.equal(await script(`!!document.querySelector('#modal') && !document.querySelector('henji-web-stage')`), true)
      evidence[mode] = capturePath
    }

    const relativeFolder = path.join(output, 'relative-font')
    fs.mkdirSync(relativeFolder, { recursive: true })
    fs.writeFileSync(path.join(relativeFolder, 'index.html'), `<!doctype html><style>body{font-size:2em}</style><p id="text">相对字号</p><script>henjiWeb={ready:Promise.resolve(),seek(){},duration:1}</script>`)
    await open(relativeFolder, 960, 540, 'automatic')
    evidence.relativeFont = await script(`getComputedStyle(document.querySelector('#text')).fontSize`)
    assert.equal(evidence.relativeFont, '32px')
    const selectorFolder = path.join(output, 'parent-selector')
    fs.mkdirSync(selectorFolder, { recursive: true })
    fs.writeFileSync(path.join(selectorFolder, 'index.html'), `<!doctype html><style>html>body>#root>p{margin-left:80px}</style><main id="root" style="width:400px;height:200px"><p>后代排版</p></main><script>henjiWeb={ready:Promise.resolve(),seek(){},duration:1}</script>`)
    evidence.parentSelector = await open(selectorFolder, 960, 540, 'automatic')
    assert.equal(evidence.parentSelector.captureMode, 'compositor')

    evidence.review = { bodyOperations: [], backgrounds: [], topLayer: [] }
    const operations = {
      remove: "if(t && document.querySelector('#node')) document.body.removeChild(document.querySelector('#node'))",
      insert: "if(t && !document.getElementById('added')) document.body.insertBefore(Object.assign(document.createElement('aside'),{id:'added',textContent:'插入'}),document.querySelector('#node'))",
      replace: "if(t && document.querySelector('#node')) document.body.replaceChild(Object.assign(document.createElement('aside'),{id:'added',textContent:'替换'}),document.querySelector('#node'))",
      children: "if(t) document.body.children[0].id==='node' || (()=>{throw Error('body.children')})()",
      firstElementChild: "if(t) document.body.firstElementChild.id==='node' || (()=>{throw Error('firstElementChild')})()",
      scope: "if(t) document.body.querySelector(':scope > #node').textContent='查询正确'",
      ancestor: "if(t) document.querySelector('html > body > #node').textContent='查询正确'",
      innerHTML: "if(t && !document.getElementById('added')) document.body.innerHTML+='<aside id=added>重写后可见</aside>'",
      frameError: "if(t && document.querySelector('#node')) requestAnimationFrame(()=>{document.body.removeChild(document.querySelector('#node'))})",
      removeFirst: "if(t===1 && document.body.firstElementChild) document.body.firstElementChild.remove()",
      replaceFirst: "if(t===1 && !document.getElementById('added')) document.body.replaceChild(Object.assign(document.createElement('main'),{id:'added',textContent:'替换首节点'}),document.body.firstElementChild)",
      frameRejection: "if(t && document.querySelector('#node')) requestAnimationFrame(()=>{Promise.resolve().then(()=>document.body.removeChild(document.querySelector('#node')))})",
    }
    for (const [name, seek] of Object.entries(operations)) {
      const folder = fixture('review-' + name, 'body{height:100vh}', '<main id="node">正文</main><aside id="remaining">其余正文</aside>', seek)
      assert.equal((await open(folder, 960, 540, 'automatic')).captureMode, 'html-in-canvas', name)
      assert.equal((await capture(1)).capturePath.captureMode, 'compositor', name)
      await capture(2)
      const state = await script(`({host:!!document.querySelector('henji-web-stage,canvas[layoutsubtree]'),height:getComputedStyle(document.body).height,added:!!document.getElementById('added')})`)
      assert.equal(state.host, false, name)
      assert.equal(state.height, '540px', name)
      if (name === 'innerHTML') {
        assert.equal(state.added, true)
        const file = await screenshot('review-innerHTML-restored')
        assert.ok((await sharp(file).stats()).channels.some(channel => channel.min !== channel.max), '重写恢复后不能交空白图')
      }
      if (name === 'removeFirst') assert.equal(await script("!!document.querySelector('#remaining') && !document.querySelector('#node')"), true)
      if (name === 'replaceFirst') assert.equal(await script("!!document.querySelector('#remaining') && !!document.getElementById('added') && !document.querySelector('#node')"), true)
      evidence.review.bodyOperations.push({ name, state, fallbacks: await app.evaluate(() => fallbacks) })
    }
    const unrelated = fixture('review-unrelated-errors', 'body{height:100vh}', '<main id="node">正文</main>', "requestAnimationFrame(()=>{throw Error('第三方脚本失败')});requestAnimationFrame(()=>Promise.reject());requestAnimationFrame(()=>Promise.reject(Error('Failed to fetch')))")
    assert.equal((await open(unrelated, 960, 540, 'automatic')).captureMode, 'html-in-canvas')
    assert.equal(await script("Object.hasOwn(document.body,'replaceChildren')"), false)
    await script("Promise.reject(Error('帧外网络失败'));undefined")
    for (const time of [1, 2]) assert.equal((await capture(time)).capturePath.captureMode, 'html-in-canvas')
    assert.deepEqual(await app.evaluate(() => fallbacks), [])
    evidence.review.unrelatedErrors = { captureMode: 'html-in-canvas', fallbacks: [], bodyOwnReplaceChildren: false }
    evidence.review.recordingRecovery = []
    for (const asynchronous of [false, true]) {
      const operation = "const node=document.getElementById('node');if(node) document.body.removeChild(node)"
      const folder = fixture('review-recording-' + asynchronous, 'body{height:100vh}', '<main id="node">删除正文</main><aside id="remaining">其余正文</aside>', `if(t){${asynchronous ? 'requestAnimationFrame(()=>{' + operation + '})' : operation}}`)
      const recorded = await app.evaluate(async (_, folder) => {
        source?.close()
        globalThis.fallbacks = []
        globalThis.source = new Page('recording-probe', { id: host.webContents.id, mainFrame: host.webContents.mainFrame, isDestroyed: () => false, send: () => {}, onGone: () => () => {} },
          'probe', { root: folder }, { width: 960, height: 540, region: [0, 0, 960, 540], scale: 1 }, 'probe', () => {}, reason => fallbacks.push(reason), new WebCacheSubmissions({ info() {} }))
        const reader = new GpuFrameCapture(8, 'yuv444p')
        try {
          await reader.open(); await source.open()
          const first = await source.captureReliable(1, 'recording-first', reader)
          const next = await source.captureReliable(2, 'recording-next', reader)
          return { firstCurrent: first.isCurrent(), nextValid: await next.validate(), fallbacks, width: next.frame.width, height: next.frame.height,
            remaining: await source.window.webContents.executeJavaScript("!!document.getElementById('remaining')&&!document.getElementById('node')"), captureMode: source.capturePath.captureMode }
        } finally { source.close(); await reader.dispose() }
      }, folder)
      assert.equal(recorded.firstCurrent, true)
      assert.equal(recorded.nextValid, true)
      assert.equal(recorded.remaining, true)
      assert.equal(recorded.fallbacks.length, 1)
      assert.equal(recorded.captureMode, 'html-in-canvas')
      evidence.review.recordingRecovery.push({ asynchronous, ...recorded })
    }
    const events = fixture('review-body-events', 'body{height:100vh}', '<main>事件</main>', "document.body.setAttribute('onresize','window.resizeCount+=2'); window.frameHandler=window.onresize")
    fs.writeFileSync(path.join(events, 'index.html'), fs.readFileSync(path.join(events, 'index.html'), 'utf8').replace('<body>', '<body onresize="window.resizeCount++" onscroll="window.scrollCount++">').replace('henjiWeb=', 'window.resizeCount=0;window.scrollCount=0;window.initialResize=window.onresize;window.initialScroll=window.onscroll;henjiWeb='))
    assert.equal((await open(events, 960, 540, 'automatic')).captureMode, 'html-in-canvas')
    assert.equal(await script('window.initialResize===window.onresize && window.initialScroll===window.onscroll'), true)
    await capture(1)
    evidence.review.bodyEvents = await script(`({same:window.frameHandler===window.onresize && window.initialScroll===window.onscroll,attributes:[...document.querySelector('henji-web-stage body').attributes].map(a=>a.name)})`)
    assert.equal(evidence.review.bodyEvents.same, true)
    assert.ok(!evidence.review.bodyEvents.attributes.some(name => /^on/i.test(name)))

    for (const [name, style] of Object.entries({ gradient: 'html{height:80px;background:linear-gradient(red,blue)}', position: 'html{height:80px;background:linear-gradient(red,blue) 0 50% / 100% 60px repeat}', dark: 'html{color-scheme:dark}' })) {
      const folder = fixture('review-background-' + name, style, '<main>背景</main>', '')
      const prepared = await open(folder, 960, 540, 'automatic')
      assert.equal(prepared.captureMode, 'compositor', name)
      await capture(0)
      const left = await screenshot('review-background-' + name)
      await open(folder, 960, 540, 'compositor'); await capture(0)
      const delta = await difference(left, await screenshot('review-background-' + name + '-baseline'))
      assert.equal(delta.maximumDelta, 0, name)
      evidence.review.backgrounds.push({ name, prepared, delta })
    }
    const hidden = fixture('review-hidden-overflow', 'html{overflow:hidden}body{min-height:100vh}', '<main id="node" style="height:100px">滚动</main>', "document.querySelector('#node').style.height=t?'2000px':'100px';scrollTo(0,t?500:0)")
    assert.equal((await open(hidden, 960, 540, 'automatic')).captureMode, 'html-in-canvas')
    const hiddenResult = await capture(1).then(result => ({ result }), error => ({ error: error.message.split('\n')[0] }))
    assert.equal(await app.evaluate(() => source.capturePath.captureMode), 'compositor')
    assert.equal(await script('scrollY'), 500)
    evidence.review.hiddenOverflow = hiddenResult
    if (hiddenResult.error) {
      await open(hidden, 960, 540, 'compositor')
      const baseline = await capture(1).then(result => ({ result }), error => ({ error: error.message.split('\n')[0] }))
      assert.equal(baseline.error, hiddenResult.error)
    }

    for (const kind of ['dialog', 'popover', 'fullscreen']) {
      const show = kind === 'dialog' ? "document.querySelector('#top').showModal()" : kind === 'popover' ? "document.querySelector('#top').showPopover()" : "await document.querySelector('#top').requestFullscreen()"
      const tag = kind === 'dialog' ? 'dialog' : 'div'
      const markup = `<${tag} id="top" ${kind === 'popover' ? 'popover="manual"' : ''}>顶层内容</${tag}>`
      const folder = fixture('review-top-' + kind, 'body{height:100vh;background:white}#top{position:fixed;inset:0;margin:0;width:100%;height:100%;border:0;background:rgb(255,0,0);color:white}', markup, '')
      const showTop = async () => {
        if (kind === 'fullscreen') await app.evaluate(() => source.window.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'fullscreen')))
        await app.evaluate((_, code) => source.window.webContents.executeJavaScript(`(async()=>{${code}})()`, true), show)
        assert.equal(await script("!!(document.fullscreenElement || document.querySelector(':modal, :popover-open'))"), true)
      }
      assert.equal((await open(folder, 960, 540, 'top-layer-probe')).captureMode, 'html-in-canvas')
      await isolated(`(() => {
        const state=window.__henjiWebSourceSnapshot,copy=state.copy
        state.copy=function(source,destination) {
          copy.call(this,source,destination)
          const buffer=state.device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=state.device.createCommandEncoder()
          encoder.copyTextureToBuffer({texture:destination.destination.texture,origin:{x:100,y:100}},{buffer,bytesPerRow:256},[1,1])
          state.device.queue.submit([encoder.finish()])
          state.probeColor=buffer.mapAsync(GPUMapMode.READ).then(()=>{const color=Array.from(new Uint8Array(buffer.getMappedRange()).slice(0,4));buffer.unmap();buffer.destroy();return color})
        }
      })()`)
      await showTop(); await capture(0)
      const rawColor = await isolated('window.__henjiWebSourceSnapshot.probeColor')
      const raw = await screenshot('review-top-' + kind + '-unguarded')
      assert.equal((await open(folder, 960, 540, 'automatic')).captureMode, 'html-in-canvas')
      await showTop()
      assert.equal((await capture(0)).capturePath.captureMode, 'compositor')
      const restored = await screenshot('review-top-' + kind + '-restored')
      await open(folder, 960, 540, 'compositor'); await showTop(); await capture(0)
      const baseline = await screenshot('review-top-' + kind + '-baseline')
      const rawDelta = await difference(raw, baseline), restoredDelta = await difference(restored, baseline)
      const baselineColor = [...await sharp(baseline).extract({ left: 100, top: 100, width: 1, height: 1 }).ensureAlpha().raw().toBuffer()]
      assert.notDeepEqual(rawColor, baselineColor, '必须从实际快照纹理确认顶层漏画：' + kind)
      assert.equal(restoredDelta.maximumDelta, 0, kind)
      evidence.review.topLayer.push({ kind, rawColor, baselineColor, rawDelta, restoredDelta })
      // 准备时已经打开的顶层元素也必须保留在普通绘制中。
      if (kind !== 'fullscreen') {
        const readyFolder = fixture('review-top-ready-' + kind, 'body{height:100vh}', markup, '', `Promise.resolve().then(()=>{${show}})`)
        assert.equal((await open(readyFolder, 960, 540, 'automatic')).captureMode, 'compositor')
      }
    }
    evidence.completed = true
  } finally {
    store()
    await app.evaluate(() => globalThis.source?.close()).catch(() => {})
    await instance.close()
  }
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n')
})().catch(error => { process.stderr.write(String(error.stack || error) + '\n'); process.exitCode = 1 })
