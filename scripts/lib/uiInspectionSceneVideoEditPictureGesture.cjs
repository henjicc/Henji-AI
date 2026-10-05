const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { isDeepStrictEqual } = require('node:util')
const sharp = require('sharp')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { observeWorkers, workerSnapshot, waitReleased } = require('./uiInspectionSceneVideoEditLayout.cjs')

const button = (page, name) => page.getByRole('button', { name, exact: true })
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))] ?? 0
const readProject = file => JSON.parse(fs.readFileSync(file, 'utf8'))
async function saved(page, file, matches) {
  for (let attempt = 0; attempt < 160; attempt++) {
    const value = readProject(file)
    if (matches(value)) return value
    await page.waitForTimeout(50)
  }
  assert.fail('画面移动没有静默保存到预期工程状态')
}
async function presented(page, frame) {
  await page.waitForFunction(frame => {
    const canvas = document.querySelector('canvas[aria-label="剪辑画面"]')
    return canvas?.dataset.presentedFrame === String(frame) && canvas.dataset.scrubbing !== 'true'
  }, frame, { timeout: 90000 })
}
async function png(page, file) {
  const value = await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => ({ width: canvas.width, height: canvas.height, data: { ...canvas.dataset }, bytes: canvas.toDataURL('image/png').split(',')[1] }))
  assert.equal(value.width, 3840); assert.equal(value.height, 2160)
  fs.writeFileSync(file, Buffer.from(value.bytes, 'base64'))
  delete value.bytes
  return { file, ...value }
}
async function comparePng(a, b) {
  const [left, right] = await Promise.all([sharp(a).removeAlpha().raw().toBuffer(), sharp(b).removeAlpha().raw().toBuffer()])
  assert.equal(left.length, right.length)
  let changed = 0; let square = 0; let maximum = 0
  for (let index = 0; index < left.length; index++) {
    const delta = Math.abs(left[index] - right[index])
    if (delta) changed++
    square += delta * delta; maximum = Math.max(maximum, delta)
  }
  return { equal: changed === 0, changedChannels: changed, maximumDelta: maximum, rms: Math.sqrt(square / left.length) }
}

/** Count successful publication through the existing atomic writer, without replacing its work. */
async function observeSaves(app, file) {
  await app.evaluate((_electron, file) => {
    const io = process.getBuiltinModule('node:fs/promises')
    const paths = process.getBuiltinModule('node:path')
    const nativeRename = io.rename
    const state = { target: paths.resolve(file).toLowerCase(), events: [] }
    const rename = function (...args) {
      const tracked = typeof args[1] === 'string' && paths.resolve(args[1]).toLowerCase() === state.target
      const startedAt = performance.now()
      return Reflect.apply(nativeRename, this, args).then(value => {
        if (tracked) state.events.push({ startedAt, completedAt: performance.now() })
        return value
      })
    }
    globalThis.__pictureGestureSaves = { io, nativeRename, rename, state }
    io.rename = rename
  }, file)
}
const saveSnapshot = app => app.evaluate(() => globalThis.__pictureGestureSaves.state.events)

/** Observe the same native Render Worker; retain exact submitted transforms alongside receipts. */
async function observePicture(page, sequenceId, clip) {
  await page.evaluate(({ sequenceId, clip }) => {
    const ObservedWorker = window.Worker
    const evidence = { inputs: [], frames: [], requests: [], errors: [], down: null, stage: 'idle', latest: null }
    window.__pictureGestureEvidence = evidence
    window.__pictureGesturePreviousWorker = ObservedWorker
    window.Worker = class PictureObservedWorker extends ObservedWorker {
      constructor(url, options) {
        super(url, options)
        this.picture = { position: null, pending: new Map() }
        this.addEventListener('message', event => {
          const request = this.picture.pending.get(event.data?.id)
          if (!request || event.data.phase === 'submitted') return
          this.picture.pending.delete(event.data.id)
          const value = { ...request, at: performance.now(), presented: event.data.presented, cacheHits: event.data.cacheHits, cacheBytes: event.data.cacheBytes, decodeMs: event.data.decodeMs, gpuMs: event.data.gpuMs }
          if (event.data.error) evidence.errors.push({ ...value, error: event.data.error })
          else if (event.data.presented !== false) evidence.latest = value
        })
      }
      postMessage(message, transfer) {
        if (message?.document?.id === sequenceId && ['init', 'update'].includes(message.kind)) {
          const target = message.document.clips.find(value => value.id === clip.id)
          this.picture.position = target ? { x: target.x, y: target.y } : null
        }
        if (message?.kind === 'render' && this.picture.position) {
          const request = { id: message.id, frame: message.frame, submittedAt: performance.now(), position: { ...this.picture.position } }
          this.picture.pending.set(message.id, request); evidence.requests.push(request)
        }
        return transfer === undefined ? super.postMessage(message) : super.postMessage(message, transfer)
      }
    }
    window.__pictureGestureWorker = window.Worker
  }, { sequenceId, clip })
}

function createVideoEditPictureGestureScene() {
  return { id: 'video-edit-picture-gesture', surface: '剪辑', name: '剪辑-32轨500片段原4K画面移动与一次撤销', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-picture-gesture'); fs.mkdirSync(root, { recursive: true })
      const fixture = path.resolve('node_modules/.cache/video-edit-monitor/pressure.henji-video')
      assert.ok(fs.existsSync(fixture), '先通过正式monitor生成原4K压力工程')
      const project = readProject(fixture)
      project.id = 'picture-gesture-pressure'; project.name = '原4K画面移动'; project.revision = 0
      const sequence = project.sequences[0]
      assert.equal(project.sequences.length, 1); assert.equal(sequence.width, 3840); assert.equal(sequence.height, 2160)
      assert.equal(sequence.frameRate.numerator / sequence.frameRate.denominator, 60)
      assert.equal(sequence.tracks.length, 32); assert.equal(sequence.clips.length, 500)
      const target = sequence.clips.filter(clip => clip.kind === 'video' && clip.start <= 0 && clip.start + clip.duration > 0
        && sequence.tracks.some(track => track.index === clip.track && track.enabled && !track.locked)).sort((a, b) => b.track - a.track)[0]
      assert.ok(target, '原frame0必须有可编辑的真实视频片段')
      const file = path.join(root, 'picture-gesture.henji-video'); fs.writeFileSync(file, JSON.stringify(project))
      const originals = [...new Set(project.media.map(media => media.path))].map(file => ({ file, size: fs.statSync(file).size, mtimeMs: fs.statSync(file).mtimeMs }))
      const evidence = { completed: false, fixture, file, target: { id: target.id, track: target.track, sourceInUs: target.sourceInUs }, originalPaths: originals, captures: [] }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const shot = async name => { evidence.captures.push({ name }); await capture(name) }
      let client; let inputSession; let nativePointer = { x: 0, y: 0 }; let resourcesObserved = false; let savesObserved = false
      try {
        const preferredPoint = process.env.HENJI_DEV_DISPLAY_POINT
        evidence.display = await app.evaluate(({ BrowserWindow, screen }, { point, hostContentsId }) => {
          const window = (BrowserWindow.getAllWindows().find(window => window.webContents.id === hostContentsId) ?? BrowserWindow.getAllWindows()[0])
          const bounds = window.getBounds(); const current = screen.getDisplayMatching(bounds)
          const coordinates = point?.split(',').map(Number)
          const selected = coordinates ? screen.getAllDisplays().find(display => coordinates[0] >= display.bounds.x && coordinates[0] < display.bounds.x + display.bounds.width && coordinates[1] >= display.bounds.y && coordinates[1] < display.bounds.y + display.bounds.height) : undefined
          return { windowBounds: bounds, id: current.id, primary: current.id === screen.getPrimaryDisplay().id, bounds: current.bounds, scaleFactor: current.scaleFactor, preferredId: selected?.id }
        }, { point: preferredPoint, hostContentsId: await (await app.browserWindow(page)).evaluate((window) => window.webContents.id) })
        if (preferredPoint) { assert.ok(evidence.display.preferredId !== undefined); assert.equal(evidence.display.id, evidence.display.preferredId) }
        evidence.currentPhase = '原4K首次呈现与正式MCP原目标'; store()
        await observeWorkers(page); resourcesObserved = true
        await observePicture(page, sequence.id, target)
        await observeSaves(app, file); savesObserved = true
        await button(page, '剪辑').click()
        await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, file)
        const openedAt = performance.now(); await button(page, '打开项目文件').click(); await presented(page, 0)
        const canvas = page.getByLabel('剪辑画面', { exact: true })
        evidence.firstDecode = { openToPresentedMs: performance.now() - openedAt, ...(await canvas.evaluate(canvas => ({ width: canvas.width, height: canvas.height, ...canvas.dataset }))) }
        assert.equal(evidence.firstDecode.width, 3840); assert.equal(evidence.firstDecode.height, 2160)
        const identity = await authorizeMcpConnection(page, { name: '原4K画面移动回环', allowWrites: true, allowDestructive: true })
        client = await connectMcpClient(identity.config, 'Henji picture gesture Reality')
        const projectRef = { kind: 'video_edit.project', id: project.id }; const clipRef = { kind: 'video_edit.clip', id: `${project.id}:${target.id}` }
        const read = (ref, propertyIds) => callTool(client, 'read_application_entity', { ref, propertyIds })
        const frame = async value => {
          const baseline = await read(projectRef, ['video_edit.project.program_playback'])
          const result = await callTool(client, 'change_application_entities', operationEnvelope([baseline], { summary: '原4K画面移动验收', changes: [{ kind: 'set_properties', entityType: projectRef.kind, target: projectRef, properties: { 'video_edit.project.program_playback': { frame: value, playing: false, playbackDirection: 1 } } }] }))
          assert.equal(result.executionState, 'completed', JSON.stringify(result)); assert.equal(result.verificationState, 'verified', JSON.stringify(result))
          await presented(page, value)
        }
        await frame(1); await frame(0)
        const focus = await callTool(client, 'focus_application_entity', operationEnvelope([], { ref: clipRef }))
        assert.equal(focus.executionState, 'completed', JSON.stringify(focus))
        const selection = await read(projectRef, ['video_edit.project.selection', 'video_edit.project.timeline_view'])
        assert.equal(selection.data.properties['video_edit.project.selection'], target.id)
        assert.deepEqual(selection.data.properties['video_edit.project.timeline_view'].selectedClipIds, [target.id])
        const program = page.locator('[data-video-edit-panel="program"]').first()
        await button(program, '移动画面').click(); await presented(page, 0)
        const beforeFile = fs.readFileSync(file, 'utf8'); const before = readProject(file)
        evidence.before = await png(page, path.join(root, 'before.png')); await shot('picture-gesture-before')
        evidence.resourcesBefore = await workerSnapshot(page)
        const baselineSaves = (await saveSnapshot(app)).length
        evidence.baselineSaves = baselineSaves
        const display = page.locator('[data-video-edit-program-display]').first(); const box = await display.boundingBox()
        assert.ok(box && box.width > 100 && box.height > 100, '必须按实际节目显示面计算归一化位移')
        evidence.displayBounds = box
        await canvas.evaluate((canvas, clip) => {
          const value = window.__pictureGestureEvidence; const host = canvas.parentElement
          const down = event => {
            if (value.stage !== 'drag') return
            const rect = host.getBoundingClientRect()
            value.down = { at: performance.now(), clientX: event.clientX, clientY: event.clientY, width: rect.width, height: rect.height, offsetX: clip.x, offsetY: clip.y }
          }
          const move = event => {
            if (value.stage !== 'drag' || !value.down || !(event.buttons & 1)) return
            value.inputs.push({ index: value.inputs.length + 1, at: performance.now(), clientX: event.clientX, clientY: event.clientY,
              x: value.down.offsetX + (event.clientX - value.down.clientX) / value.down.width, y: value.down.offsetY + (event.clientY - value.down.clientY) / value.down.height })
          }
          host.addEventListener('pointerdown', down, true); host.addEventListener('pointermove', move, true)
          window.__pictureGestureInputCleanup = () => { host.removeEventListener('pointerdown', down, true); host.removeEventListener('pointermove', move, true) }
          window.__pictureGestureObserver = new MutationObserver(() => {
            const receipt = value.latest
            if (!receipt) return
            value.frames.push({ ...receipt, at: performance.now(), requestedAt: Number(canvas.dataset.requestedAt), width: canvas.width, height: canvas.height,
              actualFrame: Number(canvas.dataset.presentedFrame), timestamps: canvas.dataset.sourceTimestamps, canvasCacheHits: Number(canvas.dataset.cacheHits), canvasCacheBytes: Number(canvas.dataset.cacheBytes) })
          })
          window.__pictureGestureObserver.observe(canvas, { attributes: true, attributeFilter: ['data-requested-at'] })
        }, target)
        evidence.currentPhase = '180次60Hz真实画面移动与实际正确画面回执'; store()
        const start = { x: box.x + box.width * .45, y: box.y + box.height * .45 }
        await page.mouse.move(start.x, start.y)
        inputSession = await page.context().newCDPSession(page)
        const input = async (type, point, buttons) => {
          nativePointer = point
          await inputSession.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', buttons, force: buttons ? .5 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 })
        }
        await page.evaluate(() => { window.__pictureGestureEvidence.stage = 'drag'; window.__pictureGestureEvidence.frames = [] })
        await input('mousePressed', start, 1)
        const cadenceStart = performance.now()
        const inputCount = 180
        for (let index = 1; index <= inputCount; index++) {
          // Same trusted Chromium input as Playwright, without its per-move HTML drag interception.
          await input('mouseMoved', { x: start.x + box.width * .3 * index / inputCount, y: start.y + box.height * .2 * index / inputCount }, 1)
          const delay = cadenceStart + index * 1000 / 60 - performance.now()
          if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
          if (index % 60 === 0) assert.equal(fs.readFileSync(file, 'utf8'), beforeFile, '领域拖动草稿期间不能写入工程')
        }
        const endedAt = await page.evaluate(() => performance.now())
        assert.equal(fs.readFileSync(file, 'utf8'), beforeFile)
        assert.equal((await saveSnapshot(app)).length, baselineSaves, '连续更新期间原子发布次数必须为0')
        const lastInput = await page.evaluate(() => window.__pictureGestureEvidence.inputs.at(-1))
        assert.ok(lastInput)
        await input('mouseReleased', nativePointer, 0)
        const releasedAt = await page.evaluate(() => performance.now())
        await page.waitForFunction(expected => {
          const value = window.__pictureGestureEvidence.frames.at(-1)
          return value && value.actualFrame === 0 && Math.abs(value.position.x - expected.x) < 1e-7 && Math.abs(value.position.y - expected.y) < 1e-7
        }, lastInput, { timeout: 1000 })
        const measured = await page.evaluate(() => { window.__pictureGestureEvidence.stage = 'done'; return window.__pictureGestureEvidence })
        evidence.drag = { data: measured, endedAt, releasedAt }
        const during = measured.frames.filter(sample => sample.at <= endedAt && sample.at >= measured.down.at)
        const matched = during.map(sample => {
          const input = measured.inputs.find(input => input.at <= sample.submittedAt && Math.abs(input.x - sample.position.x) < 1e-7 && Math.abs(input.y - sample.position.y) < 1e-7)
          return input ? { inputIndex: input.index, sample, latencyMs: sample.at - input.at } : null
        }).filter(Boolean)
        const distinct = [...new Map(matched.map(value => [value.inputIndex, value])).values()]
        const final = measured.frames.filter(sample => Math.abs(sample.position.x - lastInput.x) < 1e-7 && Math.abs(sample.position.y - lastInput.y) < 1e-7).at(-1)
        Object.assign(evidence.drag, { driver: { kind: 'trusted Chromium Input.dispatchMouseEvent', sampleCount: inputCount, targetUpdatesPerSecond: 60, moveBeforeWait: true, normalizedDisplacement: { x: .3, y: .2 }, warmupInputs: 0 },
          inputCount: measured.inputs.length, inputIntervalsMs: measured.inputs.slice(1).map((input, index) => input.at - measured.inputs[index].at),
          inputUpdatesPerSecond: (measured.inputs.length - 1) * 1000 / (lastInput.at - measured.inputs[0].at), actualUpdates: distinct.length,
          actualUpdatesPerSecond: distinct.length * 1000 / (endedAt - measured.down.at), latencyP95Ms: quantile(distinct.map(value => value.latencyMs), .95), settleMs: Math.max(0, final.at - releasedAt) })
        store()
        assert.equal(measured.errors.length, 0, JSON.stringify(measured.errors)); assert.equal(measured.inputs.length, inputCount)
        assert.ok(evidence.drag.inputUpdatesPerSecond >= 58, '实际输入节奏不足，不能把驱动停顿当产品性能')
        assert.ok(evidence.drag.actualUpdatesPerSecond >= 58, JSON.stringify({ actualUpdates: evidence.drag.actualUpdates, actualUpdatesPerSecond: evidence.drag.actualUpdatesPerSecond, latencyP95Ms: evidence.drag.latencyP95Ms, settleMs: evidence.drag.settleMs }))
        assert.ok(evidence.drag.latencyP95Ms < 100); assert.ok(evidence.drag.settleMs < 100)
        assert.ok(distinct.length > 0 && distinct.every(value => value.sample.width === 3840 && value.sample.height === 2160 && value.sample.actualFrame === 0))
        assert.ok(distinct.every(value => value.sample.canvasCacheHits > 0 && value.sample.canvasCacheBytes > 0 && value.sample.canvasCacheBytes <= 3 * 1024 ** 3), '移动期间须复用原帧有界缓存')
        assert.ok(distinct.every(value => value.sample.timestamps === evidence.before.data.sourceTimestamps), '移动不能误播其他原素材帧')
        const expectedClips = before.sequences[0].clips.map(clip => clip.id === target.id ? { ...clip, x: lastInput.x, y: lastInput.y } : clip)
        const committed = await saved(page, file, document => { const clip = document.sequences[0].clips.find(clip => clip.id === target.id); return Math.abs(clip.x - lastInput.x) < 1e-7 && Math.abs(clip.y - lastInput.y) < 1e-7 })
        assert.deepEqual(committed.sequences[0].clips, expectedClips)
        await page.waitForTimeout(250); evidence.savesAfterMove = await saveSnapshot(app)
        assert.equal(evidence.savesAfterMove.length - baselineSaves, 1, '释放只发布一次完整编辑')
        evidence.moved = await png(page, path.join(root, 'moved.png')); await shot('picture-gesture-moved')
        evidence.resourcesAfterMove = await workerSnapshot(page)
        assert.equal(evidence.resourcesAfterMove.workers.length, evidence.resourcesBefore.workers.length, '参数草稿不得重建渲染Worker')
        assert.ok(evidence.resourcesAfterMove.workers.every(worker => !worker.terminated))
        evidence.currentPhase = '一次Undo精确恢复500片段与原4K像素'; store()
        const requestedBeforeUndo = Number(evidence.moved.data.requestedAt)
        await button(page, '撤销').click()
        const restored = await saved(page, file, document => isDeepStrictEqual(document.sequences[0].clips, before.sequences[0].clips))
        assert.deepEqual(restored.sequences[0].clips, before.sequences[0].clips)
        await page.waitForFunction(({ x, y, after }) => {
          const frame = window.__pictureGestureEvidence.frames.at(-1)
          return frame && frame.requestedAt > after && frame.actualFrame === 0 && Math.abs(frame.position.x - x) < 1e-7 && Math.abs(frame.position.y - y) < 1e-7
        }, { x: target.x, y: target.y, after: requestedBeforeUndo }, { timeout: 5000 })
        await page.waitForTimeout(250); evidence.savesAfterUndo = await saveSnapshot(app)
        assert.equal(evidence.savesAfterUndo.length - baselineSaves, 2)
        evidence.undo = await png(page, path.join(root, 'undo.png')); await shot('picture-gesture-undo')
        evidence.pixels = { moved: await comparePng(evidence.before.file, evidence.moved.file), undo: await comparePng(evidence.before.file, evidence.undo.file) }
        assert.ok(evidence.pixels.moved.changedChannels > 1000 && evidence.pixels.moved.rms > .2, '全分辨率像素须实际随画面移动变化')
        assert.equal(evidence.pixels.undo.equal, true, '一次Undo应精确恢复原4K像素')
        await button(page, '关闭项目').click(); await waitReleased(page)
        evidence.resources = await workerSnapshot(page); assert.equal(evidence.resources.live, 0)
        for (const original of originals) { const stat = fs.statSync(original.file); assert.equal(stat.size, original.size); assert.equal(stat.mtimeMs, original.mtimeMs) }
        evidence.originalFilesUnchanged = true; evidence.completed = true; delete evidence.currentPhase; store()
      } catch (error) {
        evidence.failed = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }
        evidence.partialDrag = await page.evaluate(() => window.__pictureGestureEvidence).catch(() => null)
        store(); await shot('video-edit-picture-gesture-failed').catch(() => {}); throw error
      } finally {
        await inputSession?.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...nativePointer, button: 'left', buttons: 0, clickCount: 1 }).catch(() => {})
        await inputSession?.detach().catch(() => {})
        await page.mouse.up().catch(() => {})
        await client?.close().catch(() => {}); await disableMcp(page).catch(() => {})
        await button(page, '关闭项目').click().catch(() => {})
        if (resourcesObserved) { await waitReleased(page).catch(error => { evidence.releaseFailure = String(error); evidence.completed = false }); evidence.resources = await workerSnapshot(page).catch(() => evidence.resources) }
        if (savesObserved) {
          evidence.saves = await saveSnapshot(app).catch(() => evidence.saves)
          await app.evaluate(() => { const value = globalThis.__pictureGestureSaves; if (value?.io.rename === value?.rename) value.io.rename = value.nativeRename; delete globalThis.__pictureGestureSaves }).catch(() => {})
        }
        await page.evaluate(() => {
          window.__pictureGestureObserver?.disconnect(); window.__pictureGestureInputCleanup?.()
          window.__videoLayoutObservers?.forEach(observer => observer.disconnect())
          if (window.__videoLayoutNativeWorker) window.Worker = window.__videoLayoutNativeWorker
        }).catch(() => {})
        store()
      }
    },
  }
}
module.exports = { createVideoEditPictureGestureScene }
