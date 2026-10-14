const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function createRecordingTracksScene() {
  return {
    id: 'recording-tracks', name: '屏幕录制-多轨声音摄像头', surface: '录制控制', writesUserData: true,
    launchArgs: ['--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    setup: async (page, app, { capture }) => {
      const fixture = action => page.evaluate(action => window.henjiNative.testFixtures.recordingControl(action), action)
      const tracks = action => page.evaluate(action => window.__recordingTracksTour[action](), action)
      try {
        await page.waitForFunction(() => Boolean(window.__recordingTracksTour))
        await fixture('setup-tracks')
        const state = await fixture('read')
        const control = await app.waitForEvent('window', { predicate: candidate => candidate.url().includes('view=recording-control'), timeout: 5000 }).catch(() => app.windows().find(candidate => candidate.url().includes('view=recording-control')))
        assert(control, '录制控制窗口未出现')
        await control.getByRole('button', { name: '开始录制', exact: true }).waitFor({ state: 'visible' })
        assert.equal((await fixture('read')).protected, true, '首次加载完成后控制条必须受保护')
        await page.evaluate(async id => { await window.henjiNative.screenRecording.control(id, 'toggle') }, state.snapshot.sessionId)
        await control.getByText('正在录制', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
        await tracks('start')
        await control.getByRole('img', { name: '摄像头预览' }).waitFor({ state: 'visible', timeout: 10000 })
        await page.waitForTimeout(30_000)
        await tracks('pause')
        await page.evaluate(async id => { await window.henjiNative.screenRecording.control(id, 'toggle') }, state.snapshot.sessionId)
        await page.waitForTimeout(500)
        await page.evaluate(async id => { await window.henjiNative.screenRecording.control(id, 'toggle') }, state.snapshot.sessionId)
        await tracks('resume')
        await page.waitForTimeout(30_000)
        const clipped = await control.evaluate(() => [...document.querySelectorAll('button, img, [role="status"]')].some(element => { const rect = element.getBoundingClientRect(); return rect.width && (rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight) }))
        assert.equal(clipped, false, '预览或控制条越界')
        const output = path.resolve('.ui-tour/recording-tracks'); fs.mkdirSync(output, { recursive: true })
        await control.screenshot({ path: path.join(output, 'preview.png') })
        await capture('recording-tracks-preview', { page: control })
        await tracks('stop')
        await page.evaluate(async id => { await window.henjiNative.screenRecording.control(id, 'stop') }, state.snapshot.sessionId)
        const evidence = await tracks('read')
        const events = await fixture('events')
        assert.equal(events.events.failure, undefined)
        assert.deepEqual(evidence.data.tracks.map(track => track.kind), ['microphone', 'systemAudio', 'camera'])
        for (const track of evidence.data.tracks) {
          assert(track.segments.length >= 10, `${track.kind} 没有完整分段`)
          if (track.kind === 'camera') assert(track.segments.length <= 14, '摄像头发生不必要的编码器重启，分段数异常')
          assert(track.gaps.some(gap => gap.reason === 'pause'), `${track.kind} 缺少暂停空档`)
        }
        for (const file of evidence.files) {
          assert(file.duration > 0 && file.duration < 6, '分段时长无效')
          assert(file.placementErrorUs <= 1_000_000 / 30, '剪辑定位误差超过一帧')
          assert.equal(file.video, file.kind === 'camera'); assert.equal(file.audio, file.kind !== 'camera')
          assert(file.startUs <= evidence.clockUs - evidence.data.originUs, '轨道超出共享主时钟')
        }
        fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify({ ...evidence, eventCount: events.events.count, clipped, mediaBackend: 'real-worklet-webcodecs-mediabunny', devices: 'Chromium-virtual-mic-camera-and-oscillator-system-audio', import: 'placement-mapping-only-1.5-owns-project-import' }, null, 2))
      } finally { await tracks('cleanup').catch(() => {}); await fixture('cleanup') }
    },
  }
}
module.exports = { createRecordingTracksScene }
