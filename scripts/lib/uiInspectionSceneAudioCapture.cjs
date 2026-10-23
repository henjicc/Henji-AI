const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { readAudioEditDocument, waitForAudioEditContent } = require('./audioEditDocumentFixture.cjs')

/** 真实默认输入设备；草稿与恢复登记只写 Reality 隔离资料目录。 */
function createAudioCaptureScene({ setupToolbox, clickNamedButton }) {
  return {
    id: 'toolbox-audio-edit-record', surface: '工具箱', name: '音频编辑-就地录音、暂停编辑与恢复', writesUserData: true,
    setup: async (page, _app, { capture }) => {
      const home = async () => { await setupToolbox(page); await clickNamedButton(page, /^(音频编辑)/) }
      await home()
      const before = await page.evaluate(async () => (await window.henjiNative.documents.listDocuments({ kind: 'audio_edit' })).map(doc => doc.id))
      await page.getByRole('button', { name: '录音', exact: true }).click()
      await page.getByText('按 Shift+空格 开始录音', { exact: true }).waitFor()
      const id = await page.evaluate(async ids => (await window.henjiNative.documents.listDocuments({ kind: 'audio_edit' })).find(doc => !ids.includes(doc.id)).id, before)
      assert.equal((await readAudioEditDocument(page, id)).content.source, null)
      const subscribe = () => page.evaluate(() => {
        window.__captureAuditRelease?.()
        window.__captureAudit = { levels: 0, samples: 0, duration: 0, maxPeak: 0 }
        const api = window.henjiNative.audioCapture
        const level = api.onLevel(event => { window.__captureAudit.levels++; window.__captureAudit.duration = event.durationSeconds; window.__captureAudit.maxPeak = Math.max(window.__captureAudit.maxPeak, ...event.peak) })
        const samples = api.onSamples(() => { window.__captureAudit.samples++ })
        window.__captureAuditRelease = () => { level(); samples() }
      })
      const waitSeconds = seconds => page.waitForFunction(seconds => window.__captureAudit.duration >= seconds, seconds, { timeout: 20000 })
      const phase = value => page.locator(`[data-capture-phase="${value}"]`).waitFor({ timeout: 60000 })
      const saved = predicate => waitForAudioEditContent(page, id, predicate, { timeout: 60000 })
      const wave = () => page.locator('[data-audio-spectral-editor] canvas[data-waveform-state="ready"]').last()
      const settled = async () => {
        await wave().waitFor({ timeout: 30000 })
        await page.locator('[data-audio-spectral-editor][data-spectrogram-status="ready"]').waitFor({ timeout: 30000 })
      }
      const select = async (start, end) => {
        await page.getByRole('button', { name: '时间选区 · V', exact: true }).click()
        const box = await wave().boundingBox()
        assert.ok(box, '已保存波形可见')
        const view = await page.locator('[data-audio-spectral-editor]').evaluate(el => ({ start: +el.dataset.viewStart, end: +el.dataset.viewEnd }))
        const x = frame => box.x + (frame - view.start) / (view.end - view.start) * box.width
        await page.mouse.move(x(start), box.y + box.height * .3)
        await page.mouse.down()
        await page.mouse.move(x(end), box.y + box.height * .3, { steps: 8 })
        await page.mouse.up()
        await page.locator('[data-audio-selection]').waitFor()
      }
      const seekMiddle = async () => {
        await page.keyboard.press('Escape')
        const handle = page.getByRole('slider', { name: '播放位置' })
        const ruler = await handle.evaluate(el => el.parentElement.getBoundingClientRect().toJSON())
        await page.mouse.click(ruler.x + ruler.width * .5, ruler.y + ruler.height / 2)
        return Number(await handle.getAttribute('aria-valuenow'))
      }
      await subscribe()
      await page.keyboard.press('Shift+Space')
      await phase('recording')
      await waitSeconds(2)
      assert.equal(await page.getByRole('button', { name: '时间选区 · V', exact: true }).isDisabled(), true)
      assert.equal(await page.locator('[data-capture-preview]').count(), 2)
      await capture('audio-capture-recording')
      await page.getByRole('button', { name: '录音设置', exact: true }).click()
      await page.locator('[data-audio-capture-settings]').waitFor()
      // 浮层入场动画结束后取证，避免截到透明度过渡态。
      await page.waitForTimeout(300)
      await capture('audio-capture-settings-panel')
      await page.keyboard.press('Escape')
      await waitSeconds(3)
      await page.getByRole('button', { name: '暂停录音', exact: true }).click()
      await phase('paused')
      const first = await saved(content => content.source?.durationFrames > 0)
      const rate = first.source.sampleRate
      assert.ok(first.source.durationFrames / rate >= 3)
      await wave().waitFor({ timeout: 30000 })
      await select(0, rate / 2)
      await page.keyboard.press('Delete')
      const edited = await saved(content => content.cuts?.length > 0)
      const removed = edited.cuts[0].endFrame - edited.cuts[0].startFrame
      assert.ok(Math.abs(removed / rate - .5) < .03, '暂停时删除半秒')
      const resumeAt = await seekMiddle()
      await subscribe()
      await page.getByRole('button', { name: '继续录音', exact: true }).click()
      await phase('recording')
      await waitSeconds(2)
      await page.getByRole('button', { name: '停止录音', exact: true }).click()
      await phase('idle')
      const second = await saved(content => content.source?.sourcePath !== first.source.sourcePath)
      const added = second.source.durationFrames - first.source.durationFrames
      assert.ok(added / rate >= 2 && added / rate < 3.5, '继续录音约两秒')
      assert.deepEqual(second.cuts, edited.cuts)
      assert.ok(resumeAt > 0 && resumeAt < first.source.durationFrames)
      const evidence = { firstSeconds: first.source.durationFrames / rate, addedSeconds: added / rate, deletedSeconds: removed / rate, finalSeconds: (second.source.durationFrames - removed) / rate, audit: await page.evaluate(() => window.__captureAudit) }
      assert.ok(evidence.audit.levels > 0 && evidence.audit.samples > 0)
      const peaks = await page.evaluate(async id => {
        const read = await window.henjiNative.documents.readDocument({ id })
        return (await window.henjiNative.audio.extractSamples({ source: read.content.source.audioPath, bucketCount: 256 })).peak
      }, id)
      assert.ok(peaks.some(value => value > 0), '拼接波形含真实信号')
      await settled()
      await capture('audio-capture-edited')

      // 未手动保存或命名：重新加载后从继续编辑找回，并在已有作品里插入、覆盖。
      await page.reload()
      await home()
      await page.locator(`[data-project-id="${id}"]:visible`).first().click()
      await wave().waitFor({ timeout: 30000 })
      assert.equal((await readAudioEditDocument(page, id)).content.source.sourcePath, second.source.sourcePath)
      await seekMiddle()
      await subscribe()
      await page.keyboard.press('r')
      await phase('recording')
      await waitSeconds(1)
      await page.keyboard.press('r')
      await phase('idle')
      const inserted = await saved(content => content.source.sourcePath !== second.source.sourcePath)
      assert.ok(inserted.source.durationFrames > second.source.durationFrames)
      await wave().waitFor()
      await select(rate, 2 * rate)
      await subscribe()
      await page.keyboard.press('Shift+Space')
      await phase('recording')
      await phase('idle')
      const replaced = await saved(content => content.source.sourcePath !== inserted.source.sourcePath)
      assert.equal(replaced.source.durationFrames, inserted.source.durationFrames, '选区末尾自动停止并等长覆盖')
      await page.keyboard.press('Control+z')
      await saved(content => content.source.sourcePath === inserted.source.sourcePath)
      await settled()
      await capture('audio-capture-replace-undo')

      // 真录音落盘但未拼接的崩溃窗口：重载只消费持久恢复登记。
      const recovery = await page.evaluate(async id => {
        const read = await window.henjiNative.documents.readDocument({ id })
        const api = window.henjiNative.audioCapture
        const file = await api.prepareFile({ projectId: id, startFrame: 0, endFrame: 0, revision: read.meta.revision, spliceId: crypto.randomUUID() })
        const status = await api.start({ outputPath: file.outputPath, streamSamples: false })
        return { file, sessionId: status.sessionId }
      }, id)
      await page.waitForTimeout(1200)
      await page.evaluate(id => window.henjiNative.audioCapture.stop(id), recovery.sessionId)
      await page.reload()
      await home()
      await page.getByRole('button', { name: '拼回原位置', exact: true }).click()
      await saved(content => content.source.durationFrames > inserted.source.durationFrames)
      await page.locator('[data-audio-spectral-editor]').waitFor()
      assert.equal((await page.evaluate(() => window.henjiNative.audioCapture.pendingFiles())).length, 0)
      await settled()
      await capture('audio-capture-recovered')
      fs.mkdirSync(path.resolve('.ui-tour'), { recursive: true })
      fs.writeFileSync(path.resolve('.ui-tour/audio-capture-evidence.json'), JSON.stringify(evidence, null, 2))
    },
  }
}
module.exports = { createAudioCaptureScene }
