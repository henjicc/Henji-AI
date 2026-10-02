const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { videoEditFixtureProject } = require('./uiInspectionSceneVideoEditProbe.cjs')

const STORAGE_KEY = 'henji.videoEdit.dockLayout.v1'
const button = (page, name) => page.getByRole('button', { name, exact: true })
const tab = (page, title) => page.locator('.dv-tab').filter({ has: button(page, `关闭${title}`) })
const group = (page, title) => page.locator('.dv-groupview').filter({ has: button(page, `关闭${title}`) })

async function pointerDrag(page, source, target, position) {
  const from = await source.boundingBox(); const to = await target.boundingBox()
  assert.ok(from && to, '实际拖动对象必须在窗口中')
  const startedAt = performance.now()
  await page.mouse.move(from.x + 12, from.y + 14); await page.mouse.down()
  try {
    await page.mouse.move(from.x + 22, from.y + 14, { steps: 4 })
    await page.mouse.move(to.x + position.x, to.y + position.y, { steps: 24 })
    await page.waitForTimeout(100)
  } finally { await page.mouse.up() }
  return { from, to, position, milliseconds: performance.now() - startedAt }
}

async function menuAction(page, title, action) {
  await group(page, title).getByRole('button', { name: '面板菜单', exact: true }).click()
  await button(page, action).click()
  // PanelTrigger keeps the closing menu mounted for its registered 200ms exit animation.
  await page.waitForTimeout(250)
}
async function layoutAction(page, action) {
  await button(page, '面板').click(); await button(page, action).click(); await page.waitForTimeout(250)
}
async function presented(page, frame) {
  await page.waitForFunction(frame => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === String(frame), frame, { timeout: 20000 })
}
async function savedLayout(page) {
  await page.waitForTimeout(250)
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY)
}
function layoutSignature(layout) {
  const groups = []
  const collect = node => { if (node.type === 'leaf') groups.push([...node.data.views]); else node.data.forEach(collect) }
  collect(layout.grid.root)
  const floating = (layout.floatingGroups ?? []).map(value => {
    const views = []
    const walk = node => { if (node.type === 'leaf') views.push(...node.data.views); else node.data.forEach(walk) }
    if (value.grid) walk(value.grid.root); else views.push(...value.data.views)
    return views
  })
  return { panels: Object.keys(layout.panels).sort(), gridGroups: groups, floatingGroups: floating }
}

/** Observes native Workers without substituting decoding, rendering, timers or messages. */
async function observeWorkers(page) {
  await page.evaluate(() => {
    const NativeWorker = window.Worker
    const evidence = { workers: [], events: [], peakLive: 0, frames: [], sequence: 0 }
    window.__videoLayoutEvidence = evidence
    window.__videoLayoutNativeWorker = NativeWorker
    window.__videoLayoutObservers = []
    window.__videoLayoutWatchCanvas = canvas => {
      const canvasId = window.__videoLayoutObservers.length + 1
      const recordFrame = initial => evidence.frames.push({ canvasId, initial, at: performance.now(), frame: Number(canvas.dataset.presentedFrame), width: canvas.width, height: canvas.height,
        requestedAt: Number(canvas.dataset.requestedAt), renderMs: Number(canvas.dataset.renderMs), decodeMs: Number(canvas.dataset.decodeMs), gpuMs: Number(canvas.dataset.gpuMs), cacheHits: Number(canvas.dataset.cacheHits) })
      recordFrame(true)
      const observer = new MutationObserver(() => recordFrame(false))
      observer.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] })
      window.__videoLayoutObservers.push(observer)
    }
    window.Worker = class ObservedVideoWorker extends NativeWorker {
      constructor(url, options) {
        super(url, options)
        if (!String(url).includes('videoEditWorker')) return
        const record = { id: ++evidence.sequence, url: String(url), createdAt: performance.now(), initialized: false, terminated: false, pending: new Map() }
        this.__videoLayoutRecord = record
        evidence.workers.push(record)
        evidence.peakLive = Math.max(evidence.peakLive, evidence.workers.filter(worker => !worker.terminated).length)
        evidence.events.push({ worker: record.id, kind: 'created', at: record.createdAt })
        this.addEventListener('message', event => {
          const request = record.pending.get(event.data?.id)
          if (!request || event.data.phase === 'submitted') return
          record.pending.delete(event.data.id)
          const receivedAt = performance.now()
          if (request.kind === 'init') record.initialized = true
          if (request.kind === 'dispose') record.disposedAt = receivedAt
          evidence.events.push({ worker: record.id, kind: `${request.kind}.completed`, frame: request.frame, at: receivedAt, elapsedMs: receivedAt - request.at, error: event.data.error,
            presented: event.data.presented, decodeMs: event.data.decodeMs, gpuMs: event.data.gpuMs, cacheHits: event.data.cacheHits, codeResources: event.data.codeResources })
        })
      }
      postMessage(message, transfer) {
        const record = this.__videoLayoutRecord
        if (record && message && typeof message === 'object') {
          const request = { kind: message.kind, frame: message.frame, at: performance.now() }
          record.pending.set(message.id, request)
          evidence.events.push({ worker: record.id, ...request })
          if (message.kind === 'init') record.renderSize = { width: message.document.width, height: message.document.height, fps: message.document.fps, previewWidth: message.previewWidth }
        }
        return transfer === undefined ? super.postMessage(message) : super.postMessage(message, transfer)
      }
      terminate() {
        const record = this.__videoLayoutRecord
        if (record && !record.terminated) { record.terminated = true; record.terminatedAt = performance.now(); evidence.events.push({ worker: record.id, kind: 'terminated', at: record.terminatedAt }) }
        return super.terminate()
      }
    }
  })
}
async function workerSnapshot(page) {
  return page.evaluate(() => {
    const value = window.__videoLayoutEvidence
    return { live: value.workers.filter(worker => !worker.terminated).length, peakLive: value.peakLive,
      workers: value.workers.map(({ pending, ...worker }) => ({ ...worker, pendingCount: pending.size })), events: value.events, frames: value.frames }
  })
}
async function waitReleased(page) {
  await page.waitForFunction(() => window.__videoLayoutEvidence.workers.every(worker => worker.terminated), null, { timeout: 10000 })
}

function createVideoEditLayoutScene() {
  return {
    id: 'video-edit-layout', surface: '剪辑', name: '剪辑-停靠布局与真实渲染会话生命周期', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-layout'); fs.mkdirSync(root, { recursive: true })
      const file = path.join(root, 'layout.henji-video')
      const project = videoEditFixtureProject({ id: 'reality-video-layout', name: '剪辑布局验收', revision: 0, width: 3840, height: 2160, fps: 60, media: [], annotations: [],
        clips: [{ id: 'layout-title', name: '布局验收文字', kind: 'text', track: 1, start: 0, duration: 360, sourceInUs: 0, x: 0, y: 0, scale: 0.8, rotation: 0, opacity: 1, volume: 0, brightness: 1, text: 'Henji · 4K60 布局验收' }] })
      const originalSource = process.env.HENJI_VIDEO_EDIT_LAYOUT_SOURCE
      if (originalSource) {
        const source = path.resolve(originalSource); assert.ok(fs.existsSync(source))
        const { ffprobePath } = require('./mediaBinaries.cjs')
        const metadata = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-of', 'json', source], { windowsHide: true, encoding: 'utf8' }))
        const video = metadata.streams.find(stream => stream.codec_type === 'video')
        assert.equal(video.width, 3840); assert.equal(video.height, 2160); assert.equal(video.avg_frame_rate, '60/1')
        project.media.push({ id: 'layout-source', name: path.basename(source), path: source, kind: 'video', width: 3840, height: 2160, durationSeconds: Number(video.duration) })
        project.items.push({ id: 'layout-source-item', name: '原素材', kind: 'video', mediaId: 'layout-source' })
        const title = project.sequences[0].clips[0]; title.track = 3
        const picture = { ...title, id: 'layout-original', itemId: 'layout-source-item', kind: 'video', name: '原素材主画面', track: 1, scale: 1, text: '', sourceRemainder: { numerator: 0, denominator: 1 } }
        project.sequences[0].clips.unshift(picture, { ...picture, id: 'layout-overlay', name: '原素材叠加', track: 2, sourceInUs: 1000000, x: .3, y: .3, scale: .3 })
      }
      const originalJson = JSON.stringify(project); fs.writeFileSync(file, originalJson)
      const evidence = { project: file, renderSize: { width: 3840, height: 2160, fps: 60 }, fixture: originalSource ? '原路径4K60双视频与文字' : '本地文字工程，无媒体解码或转码', steps: [], restoration: { pageRoundTrip: false, coldRestart: '未运行；页面往返不替代冷启动' } }
      await button(page, '生成').click()
      const previousLayout = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)
      // Release any prior scenario's project before beginning this scene's Worker accounting.
      await button(page, '剪辑').click()
      if (await button(page, '关闭工程').isVisible()) await button(page, '关闭工程').click()
      await button(page, '生成').click()
      await page.evaluate(key => localStorage.removeItem(key), STORAGE_KEY)
      await observeWorkers(page)
      try {
        await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, file)
        await button(page, '剪辑').click()
        const openedAt = performance.now(); await button(page, '打开工程').click(); await presented(page, 0)
        evidence.firstPresentedMs = performance.now() - openedAt
        await page.evaluate(() => window.__videoLayoutWatchCanvas(document.querySelector('canvas[aria-label="剪辑画面"]')))
        await page.getByTitle('布局验收文字', { exact: true }).click()
        await page.getByRole('slider', { name: '剪辑时间定位' }).click({ position: { x: 120.1, y: 12 } }); await presented(page, 120)
        await page.evaluate(() => { window.__videoLayoutOriginalCanvas = document.querySelector('canvas[aria-label="剪辑画面"]') })
        const baseline = { frame: await page.getByRole('slider', { name: '剪辑时间定位' }).getAttribute('aria-valuenow'), selection: await page.getByLabel('片段名称', { exact: true }).inputValue() }
        const stable = async (name, sameCanvas = true) => {
          const current = await page.evaluate(() => ({ sameCanvas: window.__videoLayoutOriginalCanvas === document.querySelector('canvas[aria-label="剪辑画面"]'), canvasCount: document.querySelectorAll('canvas[aria-label="剪辑画面"]').length,
            width: document.querySelector('canvas[aria-label="剪辑画面"]')?.width, height: document.querySelector('canvas[aria-label="剪辑画面"]')?.height }))
          if (sameCanvas) assert.equal(current.sameCanvas, true, `${name} 不应重建节目画面`)
          assert.equal(current.canvasCount, 1, `${name} 只能有一份节目画面`)
          assert.equal(current.width, 3840); assert.equal(current.height, 2160)
          assert.equal(await page.getByRole('slider', { name: '剪辑时间定位', includeHidden: true }).getAttribute('aria-valuenow'), baseline.frame, `${name} 保持播放位置`)
          assert.equal(await page.getByLabel('片段名称', { exact: true }).inputValue(), baseline.selection, `${name} 保持片段选区`)
          assert.equal(await button(page, '撤销').isDisabled(), true, `${name} 不产生剪辑历史`)
          assert.equal(fs.readFileSync(file, 'utf8'), originalJson, `${name} 不修改工程 JSON`)
          const worker = await workerSnapshot(page)
          assert.equal(worker.live, 1, `${name} 保持一个真实渲染 Worker`)
          assert.equal(worker.peakLive, 1, `${name} 不并行运行重复预览`)
          evidence.steps.push({ name, ...current, frame: baseline.frame, selection: baseline.selection, workerIds: worker.workers.filter(item => !item.terminated).map(item => item.id) })
        }
        await stable('默认布局'); await capture('video-layout-default')

        // Real mouse movement drives Dockview's pointer DnD inside the Electron host.
        // Always-rendered views live in Dockview's overlay beside its empty ARIA tabpanel.
        // The visible group is the real mouse target; the empty tabpanel is covered by its canvas.
        let target = group(page, '节目画面'); let box = await target.boundingBox()
        evidence.centerDrag = await pointerDrag(page, tab(page, '项目素材'), target, { x: box.width / 2, y: box.height / 2 })
        assert.equal(await tab(page, '项目素材').getAttribute('aria-controls'), await tab(page, '节目画面').getAttribute('aria-controls'), '中心拖入合并为同一标签组')
        await tab(page, '项目素材').click({ position: { x: 12, y: 14 } })
        assert.equal(await page.getByLabel('剪辑画面', { exact: true }).isVisible(), false, '切换组内标签隐藏节目画面')
        await stable('中心分组与标签隐藏'); await capture('video-layout-grouped-hidden')
        await tab(page, '节目画面').click({ position: { x: 12, y: 14 } })

        // The same real drag at the content's edge must split the group again.
        target = group(page, '节目画面'); box = await target.boundingBox()
        evidence.edgeDrag = await pointerDrag(page, tab(page, '项目素材'), target, { x: 8, y: box.height / 2 })
        assert.notEqual(await tab(page, '项目素材').getAttribute('aria-controls'), await tab(page, '节目画面').getAttribute('aria-controls'), '边缘拖入拆分面板')
        await stable('边缘拆分'); await capture('video-layout-edge-split')

        const beforeResize = await group(page, '节目画面').boundingBox()
        const projectBox = await group(page, '项目素材').boundingBox()
        const sashes = await page.locator('[aria-label="剪辑面板工作区"] .dv-sash').evaluateAll(elements => elements.map(element => {
          const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        }).filter(rect => rect.width > 0 && rect.width <= 12 && rect.height > 80))
        const boundary = projectBox.x + projectBox.width
        const sash = sashes.sort((a, b) => Math.abs(a.x - boundary) - Math.abs(b.x - boundary))[0]
        assert.ok(sash, '当前布局应存在可操作的列分隔线')
        const dragBegan = performance.now()
        await page.mouse.move(sash.x + sash.width / 2, sash.y + Math.min(sash.height / 2, 100)); await page.mouse.down()
        await page.mouse.move(sash.x + sash.width / 2 + 48, sash.y + Math.min(sash.height / 2, 100), { steps: 12 }); await page.mouse.up()
        const afterResize = await group(page, '节目画面').boundingBox()
        assert.ok(Math.abs(afterResize.width - beforeResize.width) > 16, '拖动分隔线应实际改变面板尺寸')
        evidence.resize = { milliseconds: performance.now() - dragBegan, before: beforeResize, after: afterResize }
        await stable('拖动分隔线'); await capture('video-layout-resized')

        await menuAction(page, '节目画面', '浮动面板')
        assert.equal(await group(page, '节目画面').evaluate(element => element.classList.contains('dv-groupview-floating')), true)
        const floatingBox = await group(page, '节目画面').boundingBox(); const workspaceBox = await page.getByLabel('剪辑面板工作区', { exact: true }).boundingBox()
        assert.ok(floatingBox.x >= workspaceBox.x - 1 && floatingBox.y >= workspaceBox.y - 1 && floatingBox.x + floatingBox.width <= workspaceBox.x + workspaceBox.width + 1 && floatingBox.y + floatingBox.height <= workspaceBox.y + workspaceBox.height + 1, '浮动面板在工作区可见范围内')
        await stable('浮动面板'); await capture('video-layout-floating')
        await menuAction(page, '节目画面', '贴回面板')
        assert.equal(await group(page, '节目画面').evaluate(element => element.classList.contains('dv-groupview-floating')), false)
        await stable('贴回面板')
        await group(page, '节目画面').getByRole('button', { name: '放大面板', exact: true }).click()
        await group(page, '节目画面').getByRole('button', { name: '还原面板', exact: true }).waitFor({ state: 'visible' })
        await stable('放大面板'); await capture('video-layout-maximized')
        await group(page, '节目画面').getByRole('button', { name: '还原面板', exact: true }).click()
        await stable('还原面板')
        await layoutAction(page, '重置布局'); await stable('重置布局'); await capture('video-layout-reset')
        const beforeCloseWorkers = await workerSnapshot(page)
        assert.equal(beforeCloseWorkers.workers.length, 1, '移动、隐藏和重置整个过程不创建新 Worker')

        await button(page, '关闭节目画面').click(); await waitReleased(page)
        assert.equal(await page.getByLabel('剪辑画面', { exact: true }).count(), 0, '关闭节目面板卸载画面')
        const released = await workerSnapshot(page)
        assert.ok(released.workers[0].disposedAt && released.workers[0].terminatedAt, '关闭面板等待资源释放回执并终止 Worker')
        evidence.panelRelease = released.workers[0]
        await layoutAction(page, '节目画面'); await presented(page, 120)
        await page.evaluate(() => window.__videoLayoutWatchCanvas(document.querySelector('canvas[aria-label="剪辑画面"]')))
        await stable('关闭恢复', false)
        await page.evaluate(() => { window.__videoLayoutOriginalCanvas = document.querySelector('canvas[aria-label="剪辑画面"]') })
        await capture('video-layout-reopened')

        // Persist a deliberately non-default layout, then exercise the actual workspace unmount/remount.
        await button(page, '关闭效果控件').click(); await menuAction(page, '项目素材', '浮动整组')
        const beforeRoundTrip = await savedLayout(page); evidence.restoration.before = layoutSignature(beforeRoundTrip)
        await button(page, '生成').click(); await waitReleased(page)
        assert.equal(await page.getByLabel('剪辑画面', { exact: true }).count(), 0)
        await button(page, '剪辑').click(); await presented(page, 120)
        await page.evaluate(() => window.__videoLayoutWatchCanvas(document.querySelector('canvas[aria-label="剪辑画面"]')))
        assert.equal(await button(page, '关闭效果控件').count(), 0, '页面往返保持关闭的效果面板')
        assert.equal(await group(page, '项目素材').evaluate(element => element.classList.contains('dv-groupview-floating')), true, '页面往返恢复浮动分组')
        const afterRoundTrip = await savedLayout(page); evidence.restoration.after = layoutSignature(afterRoundTrip)
        assert.deepEqual(evidence.restoration.after, evidence.restoration.before)
        // Restore the effects view so the selected clip can be observed again.
        await layoutAction(page, '效果控件'); await stable('页面往返恢复', false)
        evidence.restoration.pageRoundTrip = true; await capture('video-layout-page-restored')
        await layoutAction(page, '重置布局'); await stable('最终重置', false)
        await button(page, '关闭工程').click(); await waitReleased(page)
        evidence.resources = await workerSnapshot(page)
        assert.equal(evidence.resources.live, 0); assert.equal(evidence.resources.peakLive, 1)
        assert.ok(evidence.resources.workers.every(worker => worker.disposedAt && worker.terminatedAt), '所有节目 Worker 均完成资源释放与终止')
        assert.equal(fs.readFileSync(file, 'utf8'), originalJson, '完整布局场景没有改写工程')
        evidence.completed = true
      } catch (error) {
        evidence.failed = String(error)
        fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
        await capture('video-layout-failed').catch(() => {}); throw error
      } finally {
        if (await button(page, '关闭工程').isVisible().catch(() => false)) { await button(page, '关闭工程').click({ timeout: 10000 }).catch(() => {}); await waitReleased(page).catch(() => {}) }
        evidence.resources = await workerSnapshot(page).catch(() => evidence.resources)
        fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
        await page.evaluate(({ key, previousLayout }) => {
          window.__videoLayoutObservers.forEach(observer => observer.disconnect())
          window.Worker = window.__videoLayoutNativeWorker
          if (previousLayout === null) localStorage.removeItem(key); else localStorage.setItem(key, previousLayout)
        }, { key: STORAGE_KEY, previousLayout }).catch(() => {})
      }
    },
  }
}

module.exports = { createVideoEditLayoutScene, observeWorkers, workerSnapshot, waitReleased }
