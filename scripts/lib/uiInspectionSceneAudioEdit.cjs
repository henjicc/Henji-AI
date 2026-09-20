const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function createAudioEditScene({ setupToolbox, clickNamedButton }) {
  return {
    id: 'toolbox-audio-edit-waveform', surface: '工具箱', name: '口播剪辑-波形与连续播放', writesUserData: true,
    setup: async (page, electronApp) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-audio-waveform-'))
      const file = path.join(directory, 'waveform.wav')
      const rate = 48000
      const frames = rate * 12
      const wav = Buffer.alloc(44 + frames * 2)
      wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
      wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
      wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
      wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40)
      for (let index = 0; index < frames; index += 1) wav.writeInt16LE(Math.round(Math.sin(index / rate * 440 * Math.PI * 2) * 2500 * (0.3 + 0.7 * Math.abs(Math.sin(index / rate * 3)))), 44 + index * 2)
      fs.writeFileSync(file, wav)
      let project
      try {
        project = await page.evaluate(async ({ sourcePath, rate }) => {
          const audio = window.henjiNative.audio
          const project = await audio.createEditProject({ sourcePath, name: '波形交互验收' })
          project.transcript = [
            ['intro', '开场保留', 0, 2, true], ['removed', '这句已经删除', 2, 4, false],
            ['middle', '跳过后继续播放', 4, 8, true], ['ending', '结尾也应完整播放', 8, 12, true],
          ].map(([id, text, start, end, included]) => ({ id, text, startFrame: start * rate, endFrame: end * rate, included, locked: false, granularity: 'segment' }))
          return audio.saveEditProject(project)
        }, { sourcePath: file, rate })
      } finally {
        fs.unlinkSync(file)
        fs.rmdirSync(directory)
      }
      await setupToolbox(page)
      await clickNamedButton(page, /^(口播剪辑)/)
      await page.getByRole('button', { name: /波形交互验收/ }).click()
      const waveform = page.getByRole('slider', { name: '口播波形定位' })
      await waveform.waitFor({ state: 'visible' })
      await page.waitForFunction(() => document.querySelector('[aria-label="口播波形定位"] svg rect'))
      assert.equal(await page.locator('[data-audio-deleted]').count(), 1)
      const bounds = await waveform.boundingBox()
      assert.ok(bounds && bounds.height >= 120)
      const seek = async (seconds) => page.mouse.click(bounds.x + bounds.width * seconds / 12, bounds.y + bounds.height / 2)
      // Clicking a deletion seeks to the next retained source interval.
      await seek(3)
      await page.waitForFunction((rate) => Number(document.querySelector('[role="slider"][aria-label="口播波形定位"]').getAttribute('aria-valuenow')) === rate * 4, rate)
      await seek(1.8)
      await page.getByTitle('播放', { exact: true }).click()
      await page.waitForFunction((rate) => Number(document.querySelector('[aria-label="口播波形定位"]').getAttribute('aria-valuenow')) > rate * 4.1, rate)
      assert.equal(await page.locator('[data-audio-word="middle"]').getAttribute('aria-current'), 'true')
      assert.ok(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.webContents.isCurrentlyAudible())), '真实 Electron 应输出音频')
      await page.getByTitle('暂停', { exact: true }).click()
      const paused = await waveform.getAttribute('aria-valuenow')
      await page.waitForTimeout(250)
      assert.equal(await waveform.getAttribute('aria-valuenow'), paused, '暂停后时间不能前进')
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      await page.keyboard.down('Control'); await page.mouse.wheel(0, -500); await page.keyboard.up('Control')
      await page.waitForFunction((frames) => Number(document.querySelector('[aria-label="口播波形定位"]').dataset.viewEnd) - Number(document.querySelector('[aria-label="口播波形定位"]').dataset.viewStart) < frames * 0.9, frames)
      const start = Number(await waveform.getAttribute('data-view-start'))
      await page.mouse.down({ button: 'middle' }); await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height / 2, { steps: 5 }); await page.mouse.up({ button: 'middle' })
      assert.ok(Number(await waveform.getAttribute('data-view-start')) < start, '中键拖动应移动可见区间')
      assert.equal(await waveform.getAttribute('aria-valuenow'), paused, '平移不能改变播放位置')
      await page.getByRole('button', { name: '显示全部', exact: true }).click()
      await seek(5)
      await page.getByTitle('播放', { exact: true }).click()
      await page.locator('[data-audio-word="middle"]').dblclick()
      await page.waitForFunction((rate) => Number(document.querySelector('[aria-label="口播波形定位"]').getAttribute('aria-valuenow')) >= rate * 8, rate)
      assert.equal(await page.locator('[data-audio-deleted]').count(), 1, '相邻删除区间应合并')
      await page.getByTitle('暂停', { exact: true }).click()
      await page.getByTitle('撤销', { exact: true }).click()
      await page.waitForFunction(() => !document.querySelector('[data-audio-word="middle"]').className.includes('line-through'))
      // Tail playback must drain before the transport stops.
      await seek(11.5)
      await page.getByTitle('播放', { exact: true }).click()
      await page.getByTitle('播放', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
      assert.equal(Number(await waveform.getAttribute('aria-valuenow')), project.source.durationFrames)
      await seek(5)
      await page.getByText('正在准备预览…', { exact: true }).waitFor({ state: 'hidden' })
      await page.waitForTimeout(250)
    },
  }
}
module.exports = { createAudioEditScene }
