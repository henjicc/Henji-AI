const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function createAudioEditScene({ setupToolbox, clickNamedButton }) {
  return {
    id: 'toolbox-audio-edit-waveform', surface: '工具箱', name: '口播剪辑-波形与连续播放', writesUserData: true,
    setup: async (page) => {
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
      } catch (error) {
        fs.unlinkSync(file)
        fs.rmdirSync(directory)
        throw error
      }
      await setupToolbox(page)
      await clickNamedButton(page, /^(口播剪辑)/)
      // Tap the actual speaker-bound signal, without replacing decoding or playback.
      await page.evaluate(() => {
        const original = AudioNode.prototype.connect
        window.__audioEditRestoreTap = () => { AudioNode.prototype.connect = original }
        AudioNode.prototype.connect = function (...args) {
          const result = original.apply(this, args)
          if (args[0] === this.context.destination) {
            const analyser = this.context.createAnalyser()
            analyser.fftSize = 2048
            original.call(this, analyser)
            window.__audioEditOutputTap = analyser
          }
          return result
        }
      })
      try {
        await page.getByRole('button', { name: /波形交互验收/ }).click()
        await page.waitForFunction(() => Boolean(window.__audioEditOutputTap))
      } finally {
        await page.evaluate(() => { window.__audioEditRestoreTap(); delete window.__audioEditRestoreTap })
      }
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
      // Automated instances run with --mute-audio: Chromium mutes the speaker (isCurrentlyAudible stays false) while
      // the Web Audio graph keeps rendering. Verify the real pipeline instead: the speaker-bound context runs and its
      // clock advances; the output RMS checks below prove the signal reaches the destination.
      const audioClock = await page.evaluate(() => ({ state: window.__audioEditOutputTap.context.state, time: window.__audioEditOutputTap.context.currentTime }))
      assert.equal(audioClock.state, 'running', '播放时音频管线应处于运行状态')
      await page.waitForFunction((time) => window.__audioEditOutputTap.context.currentTime > time + 0.15, audioClock.time, { timeout: 5000 })
      const outputRms = () => page.evaluate(() => {
        const analyser = window.__audioEditOutputTap
        const samples = new Float32Array(analyser.fftSize)
        analyser.getFloatTimeDomainData(samples)
        return Math.sqrt(samples.reduce((total, value) => total + value * value, 0) / samples.length)
      })
      const boosted = await outputRms()
      assert.ok(boosted > 0.1, `小声素材应被实际放大，输出 RMS=${boosted}`)
      await page.getByRole('switch', { name: '试听自动增益' }).click()
      await page.waitForTimeout(300)
      const originalLevel = await outputRms()
      assert.ok(boosted > originalLevel * 3, '关闭自动增益应恢复较小音量')
      await page.getByRole('switch', { name: '试听自动增益' }).click()
      await page.getByRole('slider', { name: '试听音量', exact: true }).focus()
      await page.keyboard.press('Home')
      await page.waitForTimeout(400)
      assert.ok(await outputRms() < 0.001, '音量归零后应静音')
      await page.keyboard.press('End')
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
      // Transcript blocks: double-click edits the caption, right-click deletes the sound.
      await page.locator('[data-audio-word="middle"]').click({ button: 'right' })
      await page.waitForFunction(() => document.querySelector('[data-audio-word="middle"]').className.includes('line-through'))
      await page.waitForFunction((rate) => Number(document.querySelector('[aria-label="口播波形定位"]').getAttribute('aria-valuenow')) >= rate * 8, rate)
      assert.equal(await page.locator('[data-audio-deleted]').count(), 1, '相邻删除区间应合并')
      await page.getByTitle('暂停', { exact: true }).click()
      await page.getByRole('button', { name: '撤销；长按撤销所有修改', exact: true }).click()
      await page.waitForFunction(() => !document.querySelector('[data-audio-word="middle"]').className.includes('line-through'))
      // Tail playback must drain before the transport stops.
      await seek(11.5)
      await page.getByTitle('播放', { exact: true }).click()
      await page.getByTitle('播放', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
      assert.equal(Number(await waveform.getAttribute('aria-valuenow')), project.source.durationFrames)
      await seek(5)
      await page.getByText('正在准备预览…', { exact: true }).waitFor({ state: 'hidden' })
      await page.waitForTimeout(250)
      await verifyDelivery(page)
    },
  }
}
module.exports = { createAudioEditScene }

async function verifyDelivery(page) {
  const directory = path.resolve('.ui-tour', 'audio-edit-fixtures')
  fs.mkdirSync(directory, { recursive: true })
  const cases = [
    { name: '音频 44.1k 单声道 10分钟', rate: 44100, channels: 1, seconds: 600 },
    { name: '音频 48k 双声道 60分钟', rate: 48000, channels: 2, seconds: 3600 },
    ...['25', '30', '30000/1001'].map((fps) => ({ name: `视频 ${fps.replace('/', '-')}`, rate: 48000, channels: 2, seconds: 8, fps })),
  ]
  for (const item of cases) {
    const sourcePath = path.join(directory, `${item.name} & 原素材.${item.fps ? 'mov' : 'flac'}`)
    await (async () => {
      const { spawn } = require('node:child_process')
      const { ffmpegPath } = require('./mediaBinaries.cjs')
      const args = ['-v', 'error', '-y']
      if (item.fps) args.push('-f', 'lavfi', '-i', `color=c=blue:s=320x180:r=${item.fps}:d=${item.seconds}`)
      args.push('-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=${item.rate}:duration=${item.seconds}`, '-af', "volume='if(lt(mod(t,4),2),0.5,0)':eval=frame", '-ac', String(item.channels))
      if (item.fps) args.push('-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'pcm_s16le')
      else args.push('-c:a', 'flac')
      args.push(sourcePath)
      await new Promise((resolve, reject) => {
        const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
        let error = ''; child.stderr.on('data', (chunk) => { error = (error + chunk).slice(-4000) })
        child.once('error', reject); child.once('close', (code) => code ? reject(new Error(error)) : resolve())
      })
    })()
    const targetPath = path.join(directory, `${item.name}.xml`)
    const result = await page.evaluate(async ({ sourcePath, targetPath }) => {
      const api = window.henjiNative.audio
      const document = await api.createEditProject({ sourcePath })
      const detected = await api.detectEditSilence({ projectId: document.id, settings: { silenceThresholdMs: 800, retainedSilenceMs: 350, noiseDb: -40, trimEdges: false, fillers: ['嗯'] } })
      if (!detected.suggestions.length) throw new Error('真实音频未检测到停顿')
      document.cuts = detected.suggestions.map((range) => ({ id: range.id, reason: 'silence', enabled: true, startFrame: range.startFrame + Math.floor(document.source.sampleRate * 0.175), endFrame: range.endFrame - Math.ceil(document.source.sampleRate * 0.175) }))
      const saved = await api.saveEditProject(document)
      const exported = await api.exportEditProject({ projectId: saved.id, targetPath, format: 'xml', includeProcessing: false })
      await api.deleteEditProject(saved.id)
      return { source: document.source, exported, count: detected.suggestions.length }
    }, { sourcePath, targetPath })
    assert.equal(result.source.sourcePath, sourcePath)
    assert.equal(result.source.audioPath, sourcePath)
    assert.equal(result.source.durationFrames, item.rate * item.seconds)
    assert.ok(result.exported.durationFrames < result.source.durationFrames)
    assert.ok(fs.existsSync(sourcePath), '删除工程后原素材仍在')
    const xml = fs.readFileSync(targetPath, 'utf8')
    const parsed = await page.evaluate((xml) => {
      const doc = new DOMParser().parseFromString(xml, 'application/xml')
      return { valid: !doc.querySelector('parsererror'), clips: doc.querySelectorAll('clipitem').length, tracks: doc.querySelectorAll('sequence > media > audio > track').length, pathurl: doc.querySelector('file pathurl')?.textContent }
    }, xml)
    assert.ok(parsed.valid)
    assert.equal(parsed.tracks, item.channels)
    assert.ok(parsed.clips > 1)
    assert.equal(parsed.pathurl, require('node:url').pathToFileURL(sourcePath).href)
    console.log(`口播交付样例：${item.name}；停顿 ${result.count}；XML ${targetPath}`)
  }
}
