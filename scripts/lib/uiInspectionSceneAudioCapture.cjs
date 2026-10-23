const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

/** 真实默认输入设备，禁止用生成的声音或替身替代采集。资料目录由 Reality 隔离。 */
function createAudioCaptureScene({ setupToolbox, clickNamedButton }) {
  return {
    id: 'toolbox-audio-edit-record', surface: '工具箱', name: '音频编辑-原生录音与设置', writesUserData: true,
    setup: async page => {
      fs.mkdirSync(path.resolve('.ui-tour'), { recursive: true })
      await setupToolbox(page)
      await clickNamedButton(page, /^(音频编辑)/)
      await page.getByRole('button', { name: '录音', exact: true }).click()
      await page.getByText('新录音', { exact: true }).waitFor()
      const before = await page.evaluate(async () => {
        const api = window.henjiNative.audioCapture
        window.__captureAudit = { levels: 0, samples: 0, duration: 0, maxPeak: 0 }
        const level = api.onLevel(event => { window.__captureAudit.levels++; window.__captureAudit.duration = event.durationSeconds; window.__captureAudit.maxPeak = Math.max(window.__captureAudit.maxPeak, ...event.peak) })
        const samples = api.onSamples(() => { window.__captureAudit.samples++ })
        window.__captureAuditRelease = () => { level(); samples() }
        return (await window.henjiNative.documents.listDocuments({ kind: 'audio_edit' })).map(document => document.id)
      })
      await page.getByRole('button', { name: '开始录音', exact: true }).click()
      try {
        await page.locator('[data-capture-phase="recording"]').waitFor({ timeout: 15000 })
      } catch (error) {
        await page.screenshot({ path: path.resolve('.ui-tour/audio-capture-failure.png') })
        throw new Error(`${error.message}\n${await page.locator('[data-capture-phase]').innerText()}`)
      }
      await page.waitForFunction(() => window.__captureAudit.duration >= 2, null, { timeout: 15000 })
      await page.screenshot({ path: path.resolve('.ui-tour/audio-capture-recording.png') })
      await page.waitForFunction(() => window.__captureAudit.duration >= 3, null, { timeout: 15000 })
      await page.getByRole('button', { name: '停止', exact: true }).click()
      await page.getByRole('button', { name: '导出', exact: true }).waitFor({ timeout: 30000 })
      const result = await page.evaluate(async ids => {
        const documents = await window.henjiNative.documents.listDocuments({ kind: 'audio_edit' })
        const created = documents.find(document => !ids.includes(document.id))
        if (!created) throw new Error('停止录音后没有新口播草稿')
        const read = await window.henjiNative.documents.readDocument({ id: created.id })
        const source = read.content.source
        const waveform = await window.henjiNative.audio.extractSamples({ source: source.audioPath, bucketCount: 256 })
        window.__captureAuditRelease()
        return { source, audit: window.__captureAudit, peaks: waveform.peak, pending: await window.henjiNative.audioCapture.pendingFiles() }
      }, before)
      const seconds = result.source.durationFrames / result.source.sampleRate
      assert.ok(seconds >= 3 && seconds < 5, `录音应约三秒，实际 ${seconds}`)
      assert.ok(result.audit.levels > 0 && result.audit.samples > 0, '真实电平与采样事件必须到达')
      assert.ok(result.peaks.length > 0 && result.peaks.some(peak => peak > 0), '录音波形应包含真实非零信号')
      assert.equal(result.pending.length, 0, '导入成功后恢复记录应清除')
      fs.writeFileSync(path.resolve('.ui-tour/audio-capture-evidence.json'), JSON.stringify({ seconds, audit: result.audit, waveformBuckets: result.peaks.length }, null, 2))
      await page.screenshot({ path: path.resolve('.ui-tour/audio-capture-editor.png') })
      await page.getByRole('button', { name: '返回音频列表', exact: true }).click()
      await page.getByRole('button', { name: '录音', exact: true }).click()
      await page.getByRole('button', { name: '录音设置', exact: true }).click()
      await page.locator('[data-audio-capture-settings]').waitFor()
      await page.getByRole('radio', { name: '24 位', exact: true }).waitFor()
      await page.waitForFunction(() => document.querySelector('[data-audio-capture-settings] [role="radio"][aria-checked="true"][aria-disabled="true"]') === null)
      await page.screenshot({ path: path.resolve('.ui-tour/audio-capture-settings-panel.png') })
      await page.keyboard.press('Escape')
      await clickNamedButton(page, /^(设置|Settings)$/i)
      const dialog = page.getByRole('dialog', { name: /设置|Settings/i })
      await dialog.waitFor()
      await dialog.getByRole('button', { name: '录音', exact: true }).click()
      await page.locator('#general-recording [data-audio-capture-settings]').waitFor()
      await page.waitForFunction(() => document.querySelector('#general-recording [role="radio"][aria-checked="true"][aria-disabled="true"]') === null)
      await page.locator('#general-recording').scrollIntoViewIfNeeded()
      await page.waitForFunction(() => {
        const section = document.querySelector('#general-recording')
        const dialog = document.querySelector('[role="dialog"]')
        if (!section || !dialog) return false
        const top = section.getBoundingClientRect().top
        const previous = window.__captureSettingsTop
        window.__captureSettingsTop = top
        return previous === top && top > dialog.getBoundingClientRect().top && top < dialog.getBoundingClientRect().top + 200
      })
      await page.screenshot({ path: path.resolve('.ui-tour/audio-capture-settings-page.png') })
    },
  }
}
module.exports = { createAudioCaptureScene }
