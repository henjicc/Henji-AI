const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
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
        for (const id of current.ids) await removeAudioEditDocument(page, id)
      } finally {
        fs.rmSync(current.directory, { recursive: true, force: true })
      }
    },
    setup: async (page, _app, { capture }) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-audio-spectral-'))
      const file = path.join(directory, 'voice-with-defects.wav')
      writeFixture(file)
      const project = await createAudioEditDocument(page, { sourcePath: file, name: '波形频谱验收' })
      fixture = { ids: [project.id], directory }
      await setupToolbox(page)
      await clickNamedButton(page, /^(音频编辑)/)
      await page.locator(`[data-project-id="${project.id}"]:visible`).first().click()

      // 没有转写稿：直接是波形视图，频谱按屏幕列取数后画出。
      const editor = page.locator('[data-audio-spectral-editor]')
      await editor.waitFor({ state: 'visible', timeout: 20000 })
      await page.waitForFunction(() => document.querySelector('[data-audio-spectral-editor] canvas[data-spectrogram-state="ready"]'), null, { timeout: 60000 })
      await page.waitForFunction(() => document.querySelector('[data-audio-spectral-editor] canvas[data-waveform-state="ready"]'), null, { timeout: 30000 })
      await capture('spectral-01-overview')

      const { buildSync } = require('esbuild')
      const parityBundle = buildSync({ entryPoints: [path.join(__dirname, 'spectrogramGpuParity.ts')], bundle: true, write: false, format: 'iife', globalName: 'spectrogramParity', platform: 'browser' }).outputFiles[0].text
      const parity = await page.evaluate(source => new Function(`${source}; return spectrogramParity.verifySpectrogramGpuParity();`)(), parityBundle)
      console.log(`频谱 CPU/GPU 一致性：${JSON.stringify(parity)}`)

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
          // 基础层（每列 512 帧）第 0 块覆盖前 10 秒；高频段 2048 窗的频点号与旧接口一致，取 6.4–6.6 秒的列。
          const tile = await window.henjiNative.audio.spectralTile({ projectId: id, mode, level: 0, tile: 0, requestId: `heal-check-${mode}-${Date.now()}` })
          const bins = tile.lowBins + tile.highBins
          const first = Math.ceil(rate * 6.4 / 512), last = Math.floor(rate * 6.6 / 512)
          const mean = (low, high) => { let total = 0, count = 0; for (let t = first; t < last; t += 1) for (let bin = low; bin <= high; bin += 1) { total += tile.values[((t - tile.columnStart) * bins + tile.lowBins + bin) * 2 + 1]; count += 1 } return total / count }
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

      // 精确缩到约 100ms，核对视口实际范围，不能仅凭滚轮次数猜测。
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3)
      for (let step = 0; step < 20; step++) {
        const current = await view(), span = current.end - current.start
        if (Math.abs(span - 4800) <= 4) break
        await page.mouse.wheel(0, Math.log(4800 / span) / 0.0025)
        await page.waitForTimeout(100)
      }
      const closeup = await view()
      assert.ok(Math.abs(closeup.end - closeup.start - 4800) <= 4, '放大截图应覆盖约 0.1 秒')
      await page.waitForFunction(() => document.querySelector('[data-audio-spectral-editor][data-spectrogram-status="ready"] canvas[data-spectrogram-state="ready"]'), null, { timeout: 60000 })
      await page.waitForTimeout(300)
      await capture('spectral-06-100ms')

      // 连续快速来回缩放：界面线程不能被频谱拖住；停手后目标精度要尽快画齐（其间先借相邻精度垫着）。
      await page.evaluate(() => {
        const longTasks = []
        const observer = new PerformanceObserver(list => list.getEntries().forEach(entry => longTasks.push(Math.round(entry.duration))))
        observer.observe({ type: 'longtask' })
        let worst = 0, last = performance.now(), running = true
        const tick = (now) => { worst = Math.max(worst, now - last); last = now; if (running) requestAnimationFrame(tick) }
        requestAnimationFrame(tick)
        window.__spectralStress = () => { running = false; observer.disconnect(); return { worstFrameMs: Math.round(worst), longTasks } }
      })
      for (let step = 0; step < 48; step++) {
        await page.mouse.wheel(0, Math.floor(step / 6) % 2 === 0 ? 320 : -320)
        await page.waitForTimeout(25)
      }
      const stress = await page.evaluate(() => window.__spectralStress())
      const settleStart = Date.now()
      await page.waitForFunction(() => document.querySelector('[data-audio-spectral-editor] canvas[data-spectrogram-detail="exact"]'), null, { timeout: 30000 })
      const settleMs = Date.now() - settleStart
      console.log(`频谱连续缩放：${JSON.stringify({ ...stress, settleMs })}`)
      assert.ok(stress.worstFrameMs < 120, `连续缩放时最长一帧应低于 120ms：${JSON.stringify(stress)}`)
      assert.ok(stress.longTasks.every(duration => duration < 120), `连续缩放时不应有超过 120ms 的界面长任务：${JSON.stringify(stress)}`)
      assert.ok(settleMs < 1500, `停手后应在 1.5 秒内画齐目标精度：${settleMs}ms`)

      // 工作区布局：三种内置布局切换，每种都完整显示七个面板的标签。
      for (const [name, suffix] of [['口播', 'voice'], ['专注', 'focus'], ['经典', 'classic']]) {
        await page.getByRole('button', { name: /^(工作区|经典|口播|专注)/ }).click()
        const item = page.getByRole('menuitemradio', { name, exact: true })
        await item.waitFor({ state: 'visible' })
        if (suffix === 'voice') {
          // 菜单按内容定宽、浮层底色比面板高一级；展开时触发器不再冒出悬停说明
          const menu = await page.getByRole('menu', { name: '工作区布局' }).boundingBox()
          assert.ok(menu && menu.width <= 360, `布局菜单应按内容定宽：${menu && menu.width}`)
          assert.equal(await page.locator('[role="tooltip"]').count(), 0, '展开菜单时不应出现悬停说明')
          await page.waitForTimeout(400)
          await capture('spectral-layout-menu')
        }
        await item.click()
        await page.waitForTimeout(400)
        assert.equal(await page.locator('.dv-tab').count(), 7, `${name}布局应有七个面板`)
        await editor.waitFor({ state: 'visible' })
        await capture(`spectral-layout-${suffix}`)
      }

      // 连续 7 分钟谐波与确定种子的底噪，专门暴露总览的低频块状和周期性接缝。
      const longFile = path.join(directory, 'harmonics-noise-7min.wav')
      const { ffmpegPath } = require('./mediaBinaries.cjs')
      await promisify(execFile)(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'aevalsrc=0.15*sin(2*PI*73*t)+0.09*sin(2*PI*146*t)+0.05*sin(2*PI*219*t)+0.025*sin(2*PI*(440*t+20*sin(t/4))):s=48000:d=420', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.008:sample_rate=48000:duration=420:seed=42', '-filter_complex', '[0:a][1:a]amix=inputs=2:normalize=0', '-ac', '2', '-c:a', 'pcm_s16le', longFile], { windowsHide: true, timeout: 60000 })
      const longProject = await createAudioEditDocument(page, { sourcePath: longFile, name: '七分钟频谱验收' })
      fixture.ids.push(longProject.id)
      await page.getByRole('button', { name: '返回音频列表', exact: true }).click()
      const openedAt = Date.now()
      await page.locator(`[data-project-id="${longProject.id}"]:visible`).first().click()
      await page.waitForFunction(() => document.querySelector('[data-audio-spectral-editor][data-spectrogram-status="ready"] canvas[data-spectrogram-state="ready"]'), null, { timeout: 120000 })
      const firstPictureMs = Date.now() - openedAt
      await page.waitForFunction(() => document.querySelector('[data-audio-spectral-editor] canvas[data-spectrogram-detail="exact"]'), null, { timeout: 120000 })
      console.log(`七分钟素材：首次出图 ${firstPictureMs}ms，总览画齐 ${Date.now() - openedAt}ms`)
      assert.ok(Date.now() - openedAt < 8000, '七分钟素材的总览应在 8 秒内画齐（含首次整文件计算）')
      const overview = await view()
      assert.equal(overview.start, 0)
      assert.equal(overview.end, 420 * 48000)
      await page.waitForTimeout(300)
      await capture('spectral-07-full-7min')

    },
  }
}

module.exports = { createAudioEditSpectralScene }
