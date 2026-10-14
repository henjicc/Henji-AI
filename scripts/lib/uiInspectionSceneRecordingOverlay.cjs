const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

/**
 * Full-screen capture must never contain our own overlays: the highlight frame around the recorded area and the
 * floating control bar. Records the screen the app is on in quick mode and looks for the frame's colour along the
 * picture's edges and the control bar's spot at the top.
 */
function createRecordingOverlayScene() {
  return { id: 'recording-overlay', name: '屏幕录制-整屏录制不含录制提示', surface: '屏幕录制', writesUserData: true,
    launchArgs: ['--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    setup: async (page, app) => {
      const { ffmpegPath } = require('./mediaBinaries.cjs')
      const button = name => page.getByRole('button', { name, exact: true })
      await button('工具').click(); await page.getByText('屏幕录制', { exact: true }).first().click()
      const displayId = await app.evaluate(({ BrowserWindow, screen }) => String(screen.getDisplayMatching(BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('view=')).getBounds()).id))
      const source = (await page.evaluate(() => window.henjiNative.screenRecording.sources())).find(value => value.kind === 'screen' && value.displayId === displayId)
      assert(source, '找不到应用所在的屏幕')
      await page.getByRole('radio', { name: '整个屏幕', exact: true }).click()
      await button(source.name).click()
      await page.getByRole('radio', { name: '快速', exact: true }).click()
      await page.getByRole('switch', { name: '麦克风', exact: true }).click()
      await page.getByLabel('会话名称', { exact: true }).fill('整屏提示验收')
      await button('开始录制').click()
      const deadline = Date.now() + 30000
      while ((await page.evaluate(() => window.henjiNative.screenRecording.snapshot()))?.phase !== 'recording') { assert(Date.now() < deadline, '没有开始录制'); await page.waitForTimeout(100) }
      await page.waitForTimeout(1500)
      const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ title: window.getTitle(), url: window.webContents.getURL().slice(-60), bounds: window.getBounds(), visible: window.isVisible(), minimized: window.isMinimized(), protected: window.isContentProtected?.(), handle: window.getNativeWindowHandle().readUInt32LE(0) })))
      fs.writeFileSync(path.resolve('node_modules/.cache/recording-overlay-windows.json'), JSON.stringify(windows, null, 2))
      await page.waitForTimeout(1000)
      await page.evaluate(async () => { const state = await window.henjiNative.screenRecording.snapshot(); await window.henjiNative.screenRecording.control(state.sessionId, 'stop') })
      fs.writeFileSync(path.resolve('node_modules/.cache/recording-overlay-page.txt'), await page.locator('[data-testid="screen-recording-page"]').innerText().catch(error => String(error)))
      const toast = page.getByRole('status').filter({ hasText: '已保存视频' })
      await toast.waitFor({ timeout: 60000 })
      const saved = await page.evaluate(async () => (await window.henjiNative.logging.queryLogEvents({ date: new Date().toISOString().slice(0, 10), level: 'info', keyword: 'recording.quick_export.completed', limit: 1 })).events[0])
      const file = saved.context.file
      const out = path.resolve('node_modules/.cache/recording-overlay.png')
      const kept = path.resolve('node_modules/.cache/recording-overlay.mp4')
      fs.copyFileSync(file, kept)
      const recording = (await page.evaluate(() => window.henjiNative.documents.listDocuments({ kind: 'screen_recording', includeDrafts: true }))).find(value => value.name === '整屏提示验收')
      const logs = await page.evaluate(async () => (await window.henjiNative.logging.queryLogEvents({ date: new Date().toISOString().slice(0, 10), level: 'info', limit: 3000 })).events.reverse())
      fs.writeFileSync(path.resolve('node_modules/.cache/recording-overlay-logs.txt'), logs.filter(event => /recording|capture|ffmpeg/.test(event.event ?? '')).map(event => `${event.timestamp} ${event.level} ${event.event} ${event.message} ${JSON.stringify(event.context ?? {}).slice(0, 300)} ${event.error ? JSON.stringify(event.error).slice(0, 400) : ''}`).join(String.fromCharCode(10)))
      fs.writeFileSync(path.resolve('node_modules/.cache/recording-overlay-session.json'), JSON.stringify((await page.evaluate(id => window.henjiNative.documents.readDocument({ id }), recording.id)).content, null, 2))
      const extracted = spawnSync(ffmpegPath, ['-v', 'error', '-y', '-sseof', '-0.5', '-i', kept, '-frames:v', '1', out], { windowsHide: true })
      assert(fs.existsSync(out), `取帧失败：${extracted.stderr}`)
      // Edge strips of one frame: our danger-coloured border is 4 px wide; scaled to 1920 wide it is still >= 2 px.
      const strip = (filter) => spawnSync(ffmpegPath, ['-v', 'error', '-i', out, '-vf', `${filter},scale=1:1:flags=area,format=rgb24`, '-f', 'rawvideo', 'pipe:1'], { windowsHide: true }).stdout
      const edges = { left: strip('crop=3:ih-40:0:20'), right: strip('crop=3:ih-40:iw-3:20'), bottom: strip('crop=iw-40:3:20:ih-3') }
      const reddish = Object.fromEntries(Object.entries(edges).map(([key, rgb]) => [key, [...rgb]]))
      fs.writeFileSync(path.resolve('node_modules/.cache/recording-overlay.json'), JSON.stringify({ file, frame: out, edges: reddish }, null, 2))
      const red = Object.entries(reddish).filter(([, [r, g, b]]) => r > 120 && r > g * 1.6 && r > b * 1.6)
      assert.equal(red.length, 0, `录制画面边缘出现了录制提示框：${JSON.stringify(reddish)}`)
    },
  }
}

module.exports = { createRecordingOverlayScene }
