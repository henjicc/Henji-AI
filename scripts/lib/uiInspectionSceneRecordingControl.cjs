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

module.exports = { createRecordingControlScene }
