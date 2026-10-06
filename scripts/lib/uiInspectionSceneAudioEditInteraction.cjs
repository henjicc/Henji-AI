const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createAudioEditDocument, readAudioEditDocument, removeAudioEditDocument, waitForAudioEditContent } = require('./audioEditDocumentFixture.cjs')

function createAudioEditInteractionScene({ setupToolbox, clickNamedButton }) {
  /** 本场景建的口播与临时音频；截图后由 cleanup 撤掉，后续场景（如口播列表空态）不受影响。 */
  let fixture = null
  return {
    id: 'toolbox-audio-edit-interaction', surface: '工具箱', name: '口播剪辑-直接剪辑', writesUserData: true,
    cleanup: async (page) => {
      const current = fixture
      fixture = null
      if (!current) return
      try {
        // 先经正式入口离开编辑器（会保存），再删口播文件，避免删掉仍在编辑的口播。
        const leave = page.getByRole('button', { name: '返回口播列表', exact: true })
        if (await leave.isVisible().catch(() => false)) {
          await leave.click()
          await page.getByRole('button', { name: '返回工具', exact: true }).waitFor({ timeout: 10000 })
        }
        await removeAudioEditDocument(page, current.id)
      } finally {
        fs.rmSync(current.directory, { recursive: true, force: true })
      }
    },
    setup: async (page) => {
      const initialScale = await page.evaluate(() => document.documentElement.dataset.uiScale)
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-audio-interaction-'))
      fixture = { directory, id: null }
      const sourcePath = path.join(directory, '真实波形测试.wav')
      const rate = 48000
      const wav = Buffer.alloc(44 + rate * 16 * 2)
      wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
      wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
      wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
      wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
      for (let frame = 0; frame < rate * 16; frame++) {
        const t = frame / rate
        const gain = t >= 8 && t < 10 ? 0 : t >= 4 && t < 6 ? 0.02 : 0.2
        wav.writeInt16LE(Math.round(Math.sin(t * 440 * Math.PI * 2) * 32767 * gain), 44 + frame * 2)
      }
      fs.writeFileSync(sourcePath, wav)
      // 3.3：口播是 .henji-audio 文档，经正式接口造数据（audioEditDocumentFixture.cjs）
      const transcript = [[0, 1, '锁定的开场。', true], [1, 4, '在波形上拖动，直接选择需要调整的声音。', false], [6, 8, '嗯', false], [10, 16, '参数可以按需展开，处理结果可以随时撤销。', false]].map(([start, end, text, locked], index) => ({ id: String(index), text, startFrame: start * rate, endFrame: end * rate, included: true, locked, granularity: index === 2 ? 'word' : 'segment' }))
      const { id } = await createAudioEditDocument(page, { sourcePath, name: '口播直接剪辑验收', patch: { transcript } })
      fixture.id = id
      await setupToolbox(page)
      await clickNamedButton(page, /^(口播剪辑)/)
      await page.evaluate(() => {
        const original = AudioNode.prototype.connect
        window.__restoreAudioInteractionTap = () => { AudioNode.prototype.connect = original }
        AudioNode.prototype.connect = function (...args) {
          const result = original.apply(this, args)
          if (args[0] === this.context.destination) {
            const analyser = this.context.createAnalyser(); analyser.fftSize = 2048
            original.call(this, analyser); window.__audioInteractionTap = analyser
          }
          return result
        }
      })
      await page.locator(`[data-project-id="${id}"]:visible`).first().click()
      await page.waitForFunction(() => Boolean(window.__audioInteractionTap))
      await page.evaluate(() => window.__restoreAudioInteractionTap())
      const waveform = page.getByRole('slider', { name: '口播波形定位' })
      await waveform.waitFor()
      const waitPreview = async () => page.waitForFunction(() => !document.body.textContent.includes('正在更新停顿预览…'))
      await waitPreview()
      assert.equal(await page.getByRole('slider', { name: '静音阈值', exact: true }).isVisible(), false, '默认隐藏参数')
      assert.ok(await page.locator('[data-audio-overlay="preview"]').count() >= 1)
      // 时间 → 波形上的点：按波形当前实际显示的区间（data-view-start/end）和实际位置换算，不假设整段 16 秒铺满；
      // 纵向落在字幕带以下、且在窗口可见范围内，并核对该点命中的确实是波形（窄窗口下不被别的层盖住）。
      const pointAt = async (seconds) => {
        await waveform.scrollIntoViewIfNeeded()
        const { x, y, hit } = await waveform.evaluate((element, { seconds, rate }) => {
          const rect = element.getBoundingClientRect()
          const start = Number(element.dataset.viewStart)
          const end = Number(element.dataset.viewEnd)
          const ratio = (seconds * rate - start) / Math.max(1, end - start)
          const px = rect.left + rect.width * Math.min(1, Math.max(0, ratio))
          const py = Math.min(rect.top + rect.height * 0.65, window.innerHeight - 4)
          const target = document.elementFromPoint(px, py)
          return { x: px, y: py, hit: ratio >= 0 && ratio <= 1 && Boolean(target) && element.contains(target) }
        }, { seconds, rate })
        assert.ok(hit, `波形上 ${seconds} 秒处的点不可点击（不在可见区间或被其他层覆盖）`)
        return { x, y }
      }
      const select = async (start, end) => {
        const from = await pointAt(start)
        const to = await pointAt(end)
        await page.mouse.move(from.x, from.y)
        await page.mouse.down()
        await page.mouse.move(to.x, to.y, { steps: 12 })
        await page.mouse.up()
      }
      const playhead = () => waveform.evaluate((element) => Number(element.getAttribute('aria-valuenow')))
      const seek = async (seconds) => {
        const point = await pointAt(seconds)
        await page.mouse.click(point.x, point.y)
        await page.waitForFunction(({ frame, tolerance }) => Math.abs(Number(document.querySelector('[aria-label="口播波形定位"]').getAttribute('aria-valuenow')) - frame) <= tolerance,
          { frame: seconds * rate, tolerance: rate * 0.05 })
      }
      // 点播放后等播放头真的走起来再采样，避免“还没出声”被误判为静音或把起播延迟算进结果
      const playFrom = async (frame) => {
        await page.getByTitle('播放', { exact: true }).click()
        await page.waitForFunction((from) => Number(document.querySelector('[aria-label="口播波形定位"]').getAttribute('aria-valuenow')) > from,
          frame + rate * 0.1, { timeout: 5000 })
        await page.waitForTimeout(80)
      }
      const waitCuts = async (count) => waitForAudioEditContent(page, id, (content) => (content.cuts ?? []).filter((cut) => cut.enabled).length === count, { message: `已启用的区间应为 ${count} 个` })
      await select(2, 3)
      await page.keyboard.press('m')
      await waitCuts(1)
      assert.equal(await page.locator('[data-audio-overlay="mute"]').count(), 1)
      await waveform.focus(); await page.keyboard.press('Delete'); await waitCuts(2)
      assert.equal(await page.locator('[data-audio-deleted]').count(), 1)
      await page.getByRole('button', { name: '撤销；长按撤销所有修改', exact: true }).click(); await waitCuts(1)
      assert.equal(await page.locator('[data-audio-deleted]').count(), 0)
      const rms = () => page.evaluate(() => {
        const samples = new Float32Array(window.__audioInteractionTap.fftSize)
        window.__audioInteractionTap.getFloatTimeDomainData(samples)
        return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
      })
      // 试听点取实际静音区间开头后 0.1 秒（以文档里的区间为准，不按点击位置推算）
      const muted = (await readAudioEditDocument(page, id)).content.cuts.find((cut) => cut.enabled && cut.mode === 'mute')
      assert.ok(muted, '撤销删除后应保留一个静音区间')
      const listenAt = muted.startFrame / rate + 0.1
      await seek(listenAt)
      await playFrom(listenAt * rate)
      const mutedLevel = await rms()
      const mutedPlayhead = await playhead()
      assert.ok(mutedPlayhead >= muted.startFrame && mutedPlayhead < muted.endFrame, `采样时播放头应在静音区间内（${mutedPlayhead} 不在 ${muted.startFrame}–${muted.endFrame}）`)
      assert.ok(mutedLevel < 0.001, `剪后试听应输出真实静音（RMS ${mutedLevel.toFixed(4)}）`)
      await page.getByTitle('暂停', { exact: true }).click()
      await page.getByRole('button', { name: '原始', exact: true }).click(); await seek(listenAt)
      await playFrom(listenAt * rate)
      assert.ok(await rms() > 0.02, '原始对比保留原声音')
      await page.getByTitle('暂停', { exact: true }).click()
      await page.getByRole('button', { name: '剪后', exact: true }).click()
      const targetPath = path.join(directory, '静音导出.wav')
      await page.evaluate(async ({ id, targetPath }) => {
        const result = await window.henjiNative.audio.exportEditProject({ projectId: id, targetPath, format: 'wav', includeProcessing: false })
        if (result.durationFrames !== 48000 * 16) throw new Error('静音不应缩短导出时长')
        await window.henjiNative.audio.exportEditProject({ projectId: id, targetPath: targetPath + '.xml', format: 'xml' })
      }, { id, targetPath })
      assert.ok(fs.readFileSync(targetPath + '.xml', 'utf8').includes('<enabled>FALSE</enabled>'))
      const { execFileSync } = require('node:child_process')
      const { ffmpegPath } = require('./mediaBinaries.cjs')
      const pcm = execFileSync(ffmpegPath, ['-v', 'error', '-ss', '2.15', '-i', targetPath, '-t', '0.6', '-f', 'f32le', '-'], { windowsHide: true })
      assert.ok(pcm.length > 0 && pcm.every((byte) => byte === 0), '导出的静音段必须是零采样')
      await select(2, 3)
      // 在选区里右键（波形中心在 8 秒处，窄窗口下离选区更远）
      const restorePoint = await pointAt(2.5)
      await page.mouse.click(restorePoint.x, restorePoint.y, { button: 'right' })
      await page.getByText('恢复选区', { exact: true }).last().click()
      await waitCuts(0)
      // 窄窗口下选区操作收进播放条右侧的“更多”浮层：放不下时先展开它
      const clearSelection = page.getByRole('button', { name: '取消选区', exact: true })
      if (!await clearSelection.isVisible()) await page.locator('[data-overflow-menu] button').last().click()
      await clearSelection.click()
      await page.getByText('自定义处理参数', { exact: true }).click()
      const threshold = page.getByRole('slider', { name: '静音阈值', exact: true })
      await threshold.focus()
      for (let step = 0; step < 15; step++) await page.keyboard.press('ArrowRight')
      await waitForAudioEditContent(page, id, (content) => content.batchSettings?.noiseDb === -25)
      await waitPreview()
      // 窄窗口下“正在更新停顿预览…”读数会收进“更多”，不能只凭它判断预览已更新：直接等预览区间出现
      assert.ok(await page.waitForFunction(() => document.querySelectorAll('[data-audio-overlay="preview"]').length >= 2, null, { timeout: 15000 }).then(() => true, () => false), '提高阈值应增加低声区间预览')
      assert.equal((await readAudioEditDocument(page, id)).content.cuts.length, 0, '预览不能提交删除')
      await page.getByRole('button', { name: '快速处理', exact: true }).click()
      await page.getByText(/已处理停顿和所选语气词，缩短/).waitFor()
      const processed = await waitForAudioEditContent(page, id, (content) => !content.transcript[2].included)
      assert.ok(processed.cuts.length > 0, '快速处理应同时提交停顿裁切')
      await page.getByRole('button', { name: '撤销；长按撤销所有修改', exact: true }).click(); await waitCuts(0)
      await waitForAudioEditContent(page, id, (content) => content.transcript[2].included)
      await page.getByText('自定义处理参数', { exact: true }).click()
      await page.getByTitle('界面设置', { exact: true }).click()
      const padding = page.getByRole('slider', { name: '文字左右留白', exact: true })
      await padding.focus(); await page.keyboard.press('Home')
      for (let step = 0; step < 8; step++) await page.keyboard.press('ArrowRight')
      await waitForAudioEditContent(page, id, (content) => content.viewSettings?.sidePadding === 80)
      const textSize = page.getByRole('slider', { name: '文字大小', exact: true })
      await textSize.focus(); await page.keyboard.press('End')
      for (let step = 0; step < 8; step++) await page.keyboard.press('ArrowLeft')
      await page.getByRole('switch', { name: '波形上方显示字幕', exact: true }).click()
      assert.equal(await page.locator('[data-audio-captions]').count(), 0)
      await page.getByRole('switch', { name: '波形上方显示字幕', exact: true }).click()
      await pickUiScale(page, '150')
      await page.waitForFunction(() => document.documentElement.dataset.uiScale === '150')
      await pickUiScale(page, initialScale)
      await page.waitForFunction((scale) => document.documentElement.dataset.uiScale === scale, initialScale)
      await page.keyboard.press('Escape')
      await page.waitForFunction(() => !document.querySelector('[role="dialog"]'))
      assert.ok(await page.locator('[data-audio-word]').first().evaluate((element) => parseFloat(getComputedStyle(element).fontSize) >= 28))
      const action = page.getByRole('button', { name: '撤销；长按撤销所有修改', exact: true })
      assert.equal(await action.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', '静息动作不应绘制按钮背景')
      await page.locator('[data-audio-word]').first().hover()
      await page.keyboard.down('Control'); await page.mouse.wheel(0, -300); await page.keyboard.up('Control')
      await page.waitForFunction((scale) => document.documentElement.dataset.uiScale !== scale, initialScale)
      await page.getByTitle('界面设置', { exact: true }).click()
      await pickUiScale(page, initialScale)
      await page.waitForFunction((scale) => document.documentElement.dataset.uiScale === scale, initialScale)
      await page.keyboard.press('Escape')
      await waveform.hover()
      await page.keyboard.down('Control'); await page.mouse.wheel(0, -400); await page.keyboard.up('Control')
      await page.waitForFunction(() => {
        const waveform = document.querySelector('[aria-label="口播波形定位"]')
        return Number(waveform.dataset.viewEnd) - Number(waveform.dataset.viewStart) < 48000 * 16
      })
      assert.equal(await page.evaluate(() => document.documentElement.dataset.uiScale), initialScale, '波形缩放不应改变整个界面大小')
      const viewStart = Number(await waveform.getAttribute('data-view-start'))
      const bounds = await waveform.boundingBox()
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      await page.mouse.down({ button: 'middle' })
      await page.mouse.move(bounds.x + bounds.width / 3, bounds.y + bounds.height / 2, { steps: 8 })
      await page.mouse.up({ button: 'middle' })
      assert.ok(Number(await waveform.getAttribute('data-view-start')) > viewStart, '中键平移必须保留')
      await page.getByRole('button', { name: '显示全部', exact: true }).click()
      await waitPreview()
      // 标准截图需要口播保持打开；口播与临时音频在截图后由 cleanup 删除。
    },
  }
}
// 界面设置里的“整个界面缩放”是共享下拉（第二批由原生选择改成 Dropdown）：点开后按选项名称选择
async function pickUiScale(page, mode) {
  await page.getByRole('button', { name: '整个界面缩放', exact: true }).click()
  await page.getByRole('option', { name: mode === 'auto' ? '自动' : `${mode}%`, exact: true }).click()
}

module.exports = { createAudioEditInteractionScene }
