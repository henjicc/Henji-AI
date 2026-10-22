const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createAudioEditDocument, removeAudioEditDocument } = require('./audioEditDocumentFixture.cjs')

/**
 * 音频编辑-波形与频谱：没有转写稿的作品直接进波形视图；频谱按屏幕列取数并画出；内容区滚轮缩放时间；
 * 拖出时间选区后出现选区动作；修复画笔在频谱上涂抹一处啸叫，生成修复记录并渲染。
 * 合成素材：两声道 10 秒“人声样”谐波 + 3 秒处一个爆音 + 6–7 秒一段 5 kHz 啸叫。
 */
function writeFixture(file) {
  const rate = 48000, seconds = 10, frames = rate * seconds, channels = 2
  const wav = Buffer.alloc(44 + frames * channels * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(channels, 22)
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * channels * 2, 28); wav.writeUInt16LE(channels * 2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(frames * channels * 2, 40)
  for (let index = 0; index < frames; index += 1) {
    const t = index / rate
    const syllable = Math.max(0, Math.sin(t * Math.PI * 3.2)) ** 2
    let voice = 0
    for (let harmonic = 1; harmonic <= 12; harmonic += 1) voice += Math.sin(t * 2 * Math.PI * 160 * harmonic * (1 + 0.02 * Math.sin(t * 5))) / harmonic
    const whistle = t >= 6 && t < 7 ? 0.25 * Math.sin(t * 2 * Math.PI * 5000) : 0
    const click = index >= rate * 3 && index < rate * 3 + 24 ? (index % 2 ? 0.9 : -0.9) : 0
    const value = 0.22 * voice * syllable + whistle + click
    for (let channel = 0; channel < channels; channel += 1) wav.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(value * (channel ? 0.8 : 1) * 32767))), 44 + (index * channels + channel) * 2)
  }
  fs.writeFileSync(file, wav)
}

function createAudioEditSpectralScene({ setupToolbox, clickNamedButton }) {
  let fixture = null
  return {
    id: 'toolbox-audio-edit-spectral', surface: '工具箱', name: '音频编辑-波形与频谱', writesUserData: true,
    cleanup: async (page) => {
      const current = fixture
      fixture = null
      if (!current) return
      try {
        const leave = page.getByRole('button', { name: '返回音频列表', exact: true })
        if (await leave.isVisible().catch(() => false)) {
          await leave.click()
          await page.getByRole('button', { name: '返回工具', exact: true }).waitFor({ timeout: 10000 })
        }
        await removeAudioEditDocument(page, current.id)
      } finally {
        fs.rmSync(current.directory, { recursive: true, force: true })
      }
    },
    setup: async (page, _app, { capture }) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-audio-spectral-'))
      const file = path.join(directory, 'voice-with-defects.wav')
      writeFixture(file)
      const project = await createAudioEditDocument(page, { sourcePath: file, name: '波形频谱验收' })
      fixture = { id: project.id, directory }
      await setupToolbox(page)
      await clickNamedButton(page, /^(音频编辑)/)
      await page.locator(`[data-project-id="${project.id}"]:visible`).first().click()

      // 没有转写稿：直接是波形视图，频谱按屏幕列取数后画出。
      const editor = page.locator('[data-audio-spectral-editor]')
      await editor.waitFor({ state: 'visible', timeout: 20000 })
      await page.waitForFunction(() => document.querySelector('[data-audio-spectral-editor] canvas[data-spectrogram-state="ready"]'), null, { timeout: 60000 })
      await page.waitForFunction(() => document.querySelector('[data-audio-spectral-editor] canvas[data-waveform-state="ready"]'), null, { timeout: 30000 })
      await capture('spectral-01-overview')

      // 真容器确认着色器成功绘制，并验证同一数据在设备丢失后回退、恢复。
      const gpu = await page.evaluate(() => {
        const canvas = document.querySelector('canvas[data-spectrogram-state="ready"]')
        const gl = canvas.getContext('webgl2')
        if (!gl) return { available: false }
        const error = gl.getError()
        const extension = gl.getExtension('WEBGL_lose_context')
        if (extension) { window.__spectrogramRestore = () => extension.restoreContext(); extension.loseContext() }
        return { available: true, error, canRestore: !!extension }
      })
      assert.ok(gpu.available, '本机应使用 WebGL2 绘制频谱')
      assert.equal(gpu.error, 0, '频谱 WebGL2 不应产生错误')
      if (gpu.canRestore) {
        await page.waitForFunction(() => document.querySelector('canvas[data-spectrogram-state="ready"]')?.getContext('2d'))
        await capture('spectral-01-cpu-fallback')
        await page.evaluate(() => { window.__spectrogramRestore(); delete window.__spectrogramRestore })
        await page.waitForFunction(() => document.querySelector('canvas[data-spectrogram-state="ready"]')?.getContext('webgl2'))
      }

      // 修复画笔：在总览里把整段啸叫（6–7 秒）一笔涂完——修复用涂抹区域前后的干净声音来补，只涂中间一段时两侧仍是啸叫，生成修复记录并重新取已编辑的频谱。
      await page.getByRole('button', { name: '修复画笔 · B', exact: true }).click()
      const spectrum = page.locator('[data-audio-spectral-editor] canvas[data-spectrogram-state]')
      const area = await spectrum.boundingBox()
      assert.ok(area, '频谱可见')
      // 找到当前视口里 5 kHz 所在的高度：读刻度“5k”的位置。
      const tick = await page.locator('[data-ruler="frequency"] span', { hasText: /^5k$/ }).first().boundingBox()
      const y = tick ? tick.y + tick.height / 2 : area.y + area.height * 0.35
      await page.mouse.move(area.x + area.width * 0.59, y)
      await page.mouse.down()
      await page.mouse.move(area.x + area.width * 0.71, y, { steps: 16 })
      await page.mouse.up()
      await page.waitForFunction(() => document.querySelectorAll('[data-audio-spectral-editor] .border-dashed').length > 0, null, { timeout: 60000 })
      // 修复后改取“已编辑”的频谱；等新数据到了再截图。
      await page.waitForFunction(() => document.querySelector('[data-spectrogram-mode="edited"] [data-audio-spectral-editor][data-spectrogram-status="ready"]'), null, { timeout: 120000 })
      await page.waitForTimeout(800)
      await capture('spectral-04-healed')
      // 数值核对：6.4–6.6 秒处 5 kHz 附近的能量，修复后应明显下降；同一时刻 300 Hz 的人声保持。
      const levels = await page.evaluate(async (id) => {
        const rate = 48000
        const read = async (mode) => {
          const chunk = await window.henjiNative.audio.editSpectrogram({ projectId: id, startFrame: Math.round(rate * 6.4), endFrame: Math.round(rate * 6.6), mode, fftSize: 2048, hop: 2048, channel: 0 })
          // 返回值覆盖固定块，统计仍只取请求的 6.4–6.6 秒，不能把整块平均进来。
          const first = Math.max(0, Math.ceil((Math.round(rate * 6.4) - chunk.startFrame) / chunk.hop))
          const last = Math.min(chunk.timeBins, Math.ceil((Math.round(rate * 6.6) - chunk.startFrame) / chunk.hop))
          const mean = (low, high) => { let total = 0, count = 0; for (let t = first; t < last; t += 1) for (let bin = low; bin <= high; bin += 1) { total += chunk.values[t * chunk.frequencyBins + bin]; count += 1 } return total / count }
          return { whistle: mean(211, 216), voice: mean(12, 14) }
        }
        return { source: await read('source'), edited: await read('edited') }
      }, project.id)
      console.log(`频谱修复核对：${JSON.stringify(levels)}`)
      assert.ok(levels.source.whistle - levels.edited.whistle >= 40, `5 kHz 啸叫应下降至少约 19 dB：${JSON.stringify(levels)}`)
      assert.ok(Math.abs(levels.source.voice - levels.edited.voice) <= 6, `人声频段应基本不变：${JSON.stringify(levels)}`)
      await page.getByRole('button', { name: '时间选区 · V', exact: true }).click()

      const content = page.getByRole('application', { name: '音频波形与频谱编辑区' })
      const box = await content.boundingBox()
      assert.ok(box && box.height > 200, '编辑区应占满主区')
      // 内容区滚轮：以指针为中心放大时间（对准 6.5 秒的啸叫）。
      await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.3)
      for (let step = 0; step < 4; step += 1) await page.mouse.wheel(0, -240)
      await page.waitForTimeout(400)
      await page.waitForFunction(() => document.querySelector('[data-audio-spectral-editor] canvas[data-spectrogram-state="ready"]'), null, { timeout: 60000 })
      await page.waitForTimeout(800)
      await capture('spectral-02-zoomed')

      // 时间选区：在波形上拖动，命令带下的从属带出现选区动作。
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.2, { steps: 6 })
      await page.mouse.up()
      await page.getByRole('button', { name: '淡入', exact: true }).waitFor({ state: 'visible' })
      await capture('spectral-03-selection')
      await page.keyboard.press('Escape')

      // 按住滚轮拖动：任何工具下都是平移；播放位置不变。
      const view = () => editor.evaluate(element => ({ start: Number(element.dataset.viewStart), end: Number(element.dataset.viewEnd) }))
      const handle = page.getByRole('slider', { name: '播放位置' })
      const before = await view()
      const position = await handle.getAttribute('aria-valuenow')
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.3)
      await page.mouse.down({ button: 'middle' })
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3, { steps: 8 })
      await page.mouse.up({ button: 'middle' })
      await page.waitForFunction((start) => Number(document.querySelector('[data-audio-spectral-editor]').dataset.viewStart) > start, before.start)
      assert.equal(await handle.getAttribute('aria-valuenow'), position, '中键平移不能移动播放头')

      // 导航条：点空白处把可见区移过去，框住的范围跟着走。
      const navigator = page.locator('[data-navigator-edge="move"]')
      const strip = await navigator.evaluate(element => element.parentElement.getBoundingClientRect().toJSON())
      await page.mouse.click(strip.x + strip.width * 0.05, strip.y + strip.height / 2)
      await page.waitForFunction(() => Number(document.querySelector('[data-audio-spectral-editor]').dataset.viewStart) < 48000 * 1.5)
      // 刻度上拖动播放头：按下定位、拖动跟随。
      const ruler = await handle.evaluate(element => element.parentElement.getBoundingClientRect().toJSON())
      await page.mouse.move(ruler.x + ruler.width * 0.2, ruler.y + ruler.height / 2)
      await page.mouse.down()
      await page.mouse.move(ruler.x + ruler.width * 0.5, ruler.y + ruler.height / 2, { steps: 6 })
      await page.mouse.up()
      const range = await view()
      const frame = Number(await handle.getAttribute('aria-valuenow'))
      assert.ok(Math.abs(frame - (range.start + (range.end - range.start) * 0.5)) < (range.end - range.start) * 0.03, `拖动播放头应停在刻度中间：${frame}`)
      await capture('spectral-05-playhead')

      // 工作区布局：三种内置布局切换，每种都完整显示七个面板的标签。
      for (const name of ['口播', '专注', '经典']) {
        await page.getByRole('button', { name: /^(工作区|经典|口播|专注)$/ }).click()
        await page.getByRole('menuitemradio', { name, exact: true }).click()
        await page.waitForTimeout(400)
        assert.equal(await page.locator('.dv-tab').count(), 7, `${name}布局应有七个面板`)
        await editor.waitFor({ state: 'visible' })
        await capture(`spectral-layout-${name}`)
      }

    },
  }
}

module.exports = { createAudioEditSpectralScene }
