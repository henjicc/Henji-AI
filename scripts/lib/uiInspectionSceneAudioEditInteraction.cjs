const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function createAudioEditInteractionScene({ setupToolbox, clickNamedButton }) {
  return {
    id: 'toolbox-audio-edit-interaction', surface: '工具箱', name: '口播剪辑-直接剪辑', writesUserData: true,
    setup: async (page) => {
      const initialScale = await page.evaluate(() => document.documentElement.dataset.uiScale)
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-audio-interaction-'))
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
      const id = await page.evaluate(async ({ sourcePath, rate }) => {
        const project = await window.henjiNative.audio.createEditProject({ sourcePath, name: '口播直接剪辑验收' })
        project.transcript = [[0, 1, '锁定的开场。', true], [1, 4, '在波形上拖动，直接选择需要调整的声音。', false], [6, 8, '嗯', false], [10, 16, '参数可以按需展开，处理结果可以随时撤销。', false]].map(([start, end, text, locked], index) => ({ id: String(index), text, startFrame: start * rate, endFrame: end * rate, included: true, locked, granularity: index === 2 ? 'word' : 'segment' }))
        await window.henjiNative.audio.saveEditProject(project)
        return project.id
      }, { sourcePath, rate })
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
      await page.getByRole('button', { name: /口播直接剪辑验收/ }).click()
      await page.waitForFunction(() => Boolean(window.__audioInteractionTap))
      await page.evaluate(() => window.__restoreAudioInteractionTap())
      const waveform = page.getByRole('slider', { name: '口播波形定位' })
      await waveform.waitFor()
      const waitPreview = async () => page.waitForFunction(() => !document.body.textContent.includes('正在更新停顿预览…'))
      await waitPreview()
      assert.equal(await page.getByRole('slider', { name: '静音阈值', exact: true }).isVisible(), false, '默认隐藏参数')
      assert.ok(await page.locator('[data-audio-overlay="preview"]').count() >= 1)
      const select = async (start, end) => {
        const bounds = await waveform.boundingBox()
        await page.mouse.move(bounds.x + bounds.width * start / 16, bounds.y + bounds.height * 0.65)
        await page.mouse.down()
        await page.mouse.move(bounds.x + bounds.width * end / 16, bounds.y + bounds.height * 0.65, { steps: 12 })
        await page.mouse.up()
      }
      const seek = async (seconds) => {
        const bounds = await waveform.boundingBox()
        await page.mouse.click(bounds.x + bounds.width * seconds / 16, bounds.y + bounds.height * 0.65)
      }
      const waitCuts = async (count) => page.waitForFunction(async ({ id, count }) => ((await window.henjiNative.audio.getEditProject(id)).cuts ?? []).filter((cut) => cut.enabled).length === count, { id, count })
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
      await seek(2.1)
      await page.getByTitle('播放', { exact: true }).click(); await page.waitForTimeout(250)
      assert.ok(await rms() < 0.001, '剪后试听应输出真实静音')
      await page.getByTitle('暂停', { exact: true }).click()
      await page.getByRole('button', { name: '原始', exact: true }).click(); await seek(2.1)
      await page.getByTitle('播放', { exact: true }).click(); await page.waitForTimeout(250)
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
      await waveform.click({ button: 'right' })
      await page.getByText('恢复选区', { exact: true }).last().click()
      await waitCuts(0)
      await page.getByRole('button', { name: '取消选区', exact: true }).click()
      await page.getByText('自定义处理参数', { exact: true }).click()
      const threshold = page.getByRole('slider', { name: '静音阈值', exact: true })
      await threshold.focus()
      for (let step = 0; step < 15; step++) await page.keyboard.press('ArrowRight')
      await page.waitForFunction(async (id) => (await window.henjiNative.audio.getEditProject(id)).batchSettings?.noiseDb === -25, id)
      await waitPreview()
      assert.ok(await page.locator('[data-audio-overlay="preview"]').count() >= 2, '提高阈值应增加低声区间预览')
      assert.equal((await page.evaluate((id) => window.henjiNative.audio.getEditProject(id), id)).cuts.length, 0, '预览不能提交删除')
      await page.getByRole('button', { name: '快速处理', exact: true }).click()
      await page.getByText(/已处理停顿和所选语气词，缩短/).waitFor()
      await page.waitForFunction(async (id) => !(await window.henjiNative.audio.getEditProject(id)).transcript[2].included, id)
      const processed = await page.evaluate((id) => window.henjiNative.audio.getEditProject(id), id)
      assert.ok(processed.cuts.length > 0, '快速处理应同时提交停顿裁切')
      await page.getByRole('button', { name: '撤销；长按撤销所有修改', exact: true }).click(); await waitCuts(0)
      await page.waitForFunction(async (id) => (await window.henjiNative.audio.getEditProject(id)).transcript[2].included, id)
      await page.getByText('自定义处理参数', { exact: true }).click()
      await page.getByTitle('界面设置', { exact: true }).click()
      const padding = page.getByRole('slider', { name: '文字左右留白', exact: true })
      await padding.focus(); await page.keyboard.press('Home')
      for (let step = 0; step < 8; step++) await page.keyboard.press('ArrowRight')
      await page.waitForFunction(async (id) => (await window.henjiNative.audio.getEditProject(id)).viewSettings?.sidePadding === 80, id)
      const textSize = page.getByRole('slider', { name: '文字大小', exact: true })
      await textSize.focus(); await page.keyboard.press('End')
      for (let step = 0; step < 8; step++) await page.keyboard.press('ArrowLeft')
      await page.getByRole('switch', { name: '波形上方显示字幕', exact: true }).click()
      assert.equal(await page.locator('[data-audio-captions]').count(), 0)
      await page.getByRole('switch', { name: '波形上方显示字幕', exact: true }).click()
      await page.getByRole('combobox', { name: '整个界面缩放', exact: true }).selectOption('150')
      await page.waitForFunction(() => document.documentElement.dataset.uiScale === '150')
      await page.getByRole('combobox', { name: '整个界面缩放', exact: true }).selectOption(initialScale)
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
      await page.getByRole('combobox', { name: '整个界面缩放', exact: true }).selectOption(initialScale)
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
      // The isolated profile owns this fixture; keep the project visible for the standard screenshot.
    },
  }
}
module.exports = { createAudioEditInteractionScene }
