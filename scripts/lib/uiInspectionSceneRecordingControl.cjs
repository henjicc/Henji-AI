const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function createRecordingControlScene() {
  return {
    id: 'recording-control', name: '屏幕录制-录制控制', surface: '录制控制', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const fixture = action => page.evaluate(action => window.henjiNative.testFixtures.recordingControl(action), action)
      let control
      try {
        await fixture('setup')
        for (let attempt = 0; attempt < 100; attempt++) {
          control = app.windows().find(candidate => candidate.url().includes('view=recording-control'))
          if (control) break
          await page.waitForTimeout(100)
        }
        assert(control, '录制控制窗口未出现')
        const button = name => control.getByRole('button', { name, exact: true })
        await button('开始录制').waitFor({ state: 'visible' })
        assert.equal((await fixture('read')).protected, true)
        const captureState = await fixture('read')
        // 真 getDisplayMedia 只采集本测试应用窗口，既不触碰麦克风，也不采集其他应用。
        const streamEvidence = await page.evaluate(async ({ sessionId, sourceId }) => {
          const api = window.henjiNative.screenRecording
          await api.grant({ sessionId, userReceipt: crypto.randomUUID(), kinds: ['screen'], selection: { sourceId, excludedSourceIds: [] } })
          let stream
          try {
            stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
            return { videoTracks: stream.getVideoTracks().length, audioTracks: stream.getAudioTracks().length }
          } finally { stream?.getTracks().forEach(track => track.stop()); await api.revoke(sessionId) }
        }, { sessionId: captureState.snapshot.sessionId, sourceId: captureState.sourceId })
        assert.deepEqual(streamEvidence, { videoTracks: 1, audioTracks: 0 })
        await button('开始录制').click()
        await control.getByText('正在录制', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
        await button('添加标记').click()
        await button('暂停录制').click()
        await control.getByText('已暂停', { exact: true }).waitFor({ state: 'visible' })
        const paused = (await fixture('read')).snapshot.elapsedMs
        await page.waitForTimeout(500)
        assert.equal((await fixture('read')).snapshot.elapsedMs, paused)
        await button('继续录制').click()
        await control.getByText('正在录制', { exact: true }).waitFor({ state: 'visible' })
        const clipped = await control.evaluate(() => [...document.querySelectorAll('button')].some(element => { const rect = element.getBoundingClientRect(); return rect.width && (rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight) }))
        assert.equal(clipped, false, '控制条按钮超出窗口')
        const output = path.resolve('.ui-tour/recording-control')
        fs.mkdirSync(output, { recursive: true })
        await control.screenshot({ path: path.join(output, 'recording.png') })
        await capture('recording-control-window', { page: control })
        await button('停止录制').click()
        await control.getByText('录制已停止', { exact: true }).waitFor({ state: 'visible' })
        const result = await fixture('read')
        assert.deepEqual(result.calls, { start: 1, mark: 1, pause: 1, resume: 1, stop: 1 })
        assert.equal(result.snapshot.busy, false)
        fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify({ ...result, clipped, streamEvidence, backend: 'controlled-no-recording' }, null, 2))
      } finally { await fixture('cleanup') }
    },
  }
}

function createRecordingEventsScene(context) {
  return {
    id: 'recording-events', name: '屏幕录制-事件页与真实输入', surface: '录制事件', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const { assignIsolatedMcpPort, authorizeMcpConnection, connectMcpClient, callTool, disableMcp } = require('./uiInspectionMcpClient.cjs')
      const fixture = action => page.evaluate(action => window.henjiNative.testFixtures.recordingControl(action), action)
      let client
      try {
        await context.setupSettings(page)
        await page.keyboard.press('Escape')
        await assignIsolatedMcpPort(page)
        const identity = await authorizeMcpConnection(page, { name: '录制事件隔离验收' })
        client = await connectMcpClient(identity.config, 'Recording events')
        const ready = await fixture('setup-events')
        await page.evaluate(async ({ snapshot, sourceId }) => {
          const api = window.henjiNative.screenRecording
          await api.grant({ sessionId: snapshot.sessionId, userReceipt: crypto.randomUUID(), kinds: ['screen'], selection: { sourceId, excludedSourceIds: [] } })
          window.__recordingEventsTourStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
          await api.control(snapshot.sessionId, 'toggle')
        }, ready)
        const deadline = Date.now() + 10000
        while ((await fixture('read')).snapshot?.phase !== 'recording' && Date.now() < deadline) await page.waitForTimeout(50)
        assert.equal((await fixture('read')).snapshot?.phase, 'recording', '媒体后端尚未实际开始')
        const started = Date.now()
        const expectedClicks = []
        // CDP clicks bypass OS hooks. These Win32 input events really travel through uiohook-napi.
        const nativeClick = async (locator) => {
          const bounds = await locator.boundingBox(); assert(bounds, '目标按钮没有位置')
          const input = await app.evaluate(({ BrowserWindow, screen, app }, point) => {
            if (process.platform !== 'win32') throw new Error('该巡检的真实鼠标注入仅用于 Windows')
            const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === point.url)
            if (!win) throw new Error('没有录制主窗口')
            if (win.isMinimized()) win.restore()
            win.show(); win.focus()
            const load = process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(app.getAppPath(), 'package.json'))
            const koffi = load('koffi'); const lib = koffi.load('user32.dll')
            const setCursor = lib.func('int __stdcall SetCursorPos(int x, int y)')
            const mouse = lib.func('void __stdcall mouse_event(uint32_t flags, uint32_t dx, uint32_t dy, uint32_t data, uintptr_t extra)')
            const origin = win.getContentBounds()
            const zoom = win.webContents.getZoomFactor()
            const local = { x: Math.round(point.x * zoom), y: Math.round(point.y * zoom) }
            const physical = screen.dipToScreenPoint({ x: origin.x + local.x, y: origin.y + local.y })
            if (!setCursor(physical.x, physical.y)) throw new Error('鼠标定位失败')
            mouse(2, 0, 0, 0, 0); mouse(4, 0, 0, 0, 0)
            mouse(2048, 0, 0, 120, 0)
            load('uiohook-napi').uIOhook.keyTap(15)
            const scale = screen.getDisplayMatching(origin).scaleFactor
            return { point: [local.x * scale, local.y * scale], zoom, scale }
          }, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, url: page.url() })
          expectedClicks.push(input)
        }
        for (let index = 0; index < 3; index++) {
          await nativeClick(page.getByRole('button', { name: /^(设置|Settings)$/i }).first())
          await page.getByRole('dialog', { name: /设置|Settings/i }).waitFor({ state: 'visible', timeout: 5000 })
          await callTool(client, 'read_application_entity', { ref: { kind: 'settings.registry', id: 'singleton' }, propertyIds: ['interface.theme_contrast'] })
          await page.keyboard.press('Escape')
          await page.waitForTimeout(200)
        }
        await page.evaluate(async sessionId => {
          await window.henjiNative.screenRecording.control(sessionId, 'mark', '教程重点')
          await window.henjiNative.screenRecording.control(sessionId, 'toggle')
        }, ready.snapshot.sessionId)
        await page.waitForTimeout(500)
        await callTool(client, 'read_application_entity', { ref: { kind: 'settings.registry', id: 'singleton' }, propertyIds: ['interface.theme_contrast'] })
        await page.evaluate(id => window.henjiNative.screenRecording.control(id, 'toggle'), ready.snapshot.sessionId)
        await page.waitForTimeout(Math.max(0, 30500 - (Date.now() - started)))
        const screenTrack = await page.evaluate(() => {
          const tracks = window.__recordingEventsTourStream.getVideoTracks()
          return { count: tracks.length, readyState: tracks[0]?.readyState, settings: tracks[0]?.getSettings() }
        })
        assert.equal(screenTrack.count, 1); assert.equal(screenTrack.readyState, 'live')
        await capture('recording-events')
        await page.evaluate(id => window.henjiNative.screenRecording.control(id, 'stop'), ready.snapshot.sessionId)
        const result = await fixture('events'); const evidence = result.events
        assert(evidence && !evidence.failure, `采集失败：${evidence?.failure}`)
        assert(evidence.cursorCount >= 2500, `30秒采样不足：${evidence.cursorCount}`)
        assert(evidence.cursorShapes.some(shape => shape !== 'unknown'), '没有取得 Windows 光标形状')
        const clicks = evidence.facts.filter(fact => fact.kind === 'click' && fact.phase === 'down')
        assert.equal(clicks.length, 3)
        for (const expected of expectedClicks) assert(clicks.some(click => Math.hypot(click.point[0] - expected.point[0], click.point[1] - expected.point[1]) <= 4), '点击未换算到采集像素位置')
        assert(evidence.facts.some(fact => fact.kind === 'scroll'))
        assert(evidence.facts.some(fact => fact.kind === 'key' && fact.category === 'navigation'))
        const calls = evidence.facts.filter(fact => fact.kind === 'capability' && fact.capability === 'read_application_entity')
        assert.equal(calls.filter(fact => fact.phase === 'started').length, 3)
        assert.equal(calls.filter(fact => fact.phase === 'completed').length, 3)
        for (const start of calls.filter(fact => fact.phase === 'started')) {
          assert.deepEqual(start.targets, [{ kind: 'settings.registry', id: 'singleton' }])
          assert(calls.some(fact => fact.callId === start.callId && fact.phase === 'completed' && fact.monoUs >= start.monoUs))
        }
        assert(evidence.facts.some(fact => fact.kind === 'mark' && fact.note === '教程重点'))
        assert(evidence.gaps > 0); assert.equal(evidence.inputListeners, 0)
        assert.equal(result.snapshot.phase, 'stopped')
        const output = path.resolve('.ui-tour/recording-events'); fs.mkdirSync(output, { recursive: true })
        fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify({ ...result, elapsedMs: Date.now() - started, expectedClicks, screenTrack, recordingBackend: 'controlled-media-no-encoded-file', inputBackend: 'real-uiohook-win32' }, null, 2))
      } finally {
        await page.evaluate(() => { window.__recordingEventsTourStream?.getTracks().forEach(track => track.stop()); delete window.__recordingEventsTourStream }).catch(() => {})
        await client?.close(); await disableMcp(page); await fixture('cleanup')
      }
    },
  }
}

module.exports = { createRecordingControlScene, createRecordingEventsScene }
