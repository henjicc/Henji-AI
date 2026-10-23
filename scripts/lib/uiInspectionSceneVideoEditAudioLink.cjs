const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { openVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')

/**
 * 剪辑与音频编辑的动态链接：剪辑里右键音频片段“在音频编辑中编辑”，以嵌入模式打开音频编辑；
 * 在波形上删掉一段后返回剪辑，片段改用编辑后的声音且结尾截短（不移动后面的片段），无需导出。
 */
const ROOT = path.resolve('node_modules/.cache/video-edit-audio-link')
const FPS = 30
const SECONDS = 8

function fixture() {
  fs.mkdirSync(ROOT, { recursive: true })
  const audio = path.join(ROOT, 'tone.wav')
  if (!fs.existsSync(audio)) {
    const { ffmpegPath } = require('./mediaBinaries.cjs')
    execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc='0.4*sin(2*PI*220*t)*(0.4+0.6*abs(sin(PI*t)))':s=48000:d=${SECONDS}`, '-ac', '2', '-c:a', 'pcm_s16le', audio], { windowsHide: true, timeout: 120000 })
  }
  const value = { format: 'henji-video-project', version: 5, id: 'reality-audio-link', name: '音频动态链接验收', revision: 0, media: [], bins: [], items: [], sequences: [] }
  value.media.push({ id: 'tone', name: 'tone', path: audio, kind: 'audio', width: 0, height: 0, durationSeconds: SECONDS, hasAudio: true })
  value.items.push({ id: 'tone-item', name: '旁白', kind: 'audio', mediaId: 'tone' })
  value.sequences.push({ id: 'link-sequence', name: '序列 1', width: 1280, height: 720, frameRate: { numerator: FPS, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
    tracks: [{ id: 'v1', name: '视频 1', index: 1, kind: 'video', locked: false, enabled: true, muted: false, solo: false }, { id: 'a1', name: '音频 1', index: 0, kind: 'audio', locked: false, enabled: true, muted: false, solo: false }],
    clips: [{ id: 'voice-clip', itemId: 'tone-item', name: '旁白', kind: 'audio', track: 0, start: 0, duration: SECONDS * FPS, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }],
    annotations: [] })
  const file = path.join(ROOT, 'audio-link.hjvid')
  fs.writeFileSync(file, JSON.stringify(value))
  return file
}

function createVideoEditAudioLinkScene() {
  return {
    id: 'video-edit-audio-link', surface: '剪辑', name: '剪辑-音频编辑动态链接', writesUserData: true,
    setup: async (page, _app, { capture }) => {
      await openVideoEditFile(page, fixture())
      const clip = page.locator('[data-video-edit-clip]').first()
      await clip.waitFor({ state: 'visible', timeout: 30000 })
      const before = await clip.boundingBox()
      assert.ok(before, '片段可见')
      const startBefore = await clip.getAttribute('data-clip-start')
      await clip.click({ button: 'right' })
      await page.getByRole('menuitem', { name: '在音频编辑中编辑' }).click()

      // 嵌入模式：命令带左端是“返回剪辑 · 项目名”；没有转写稿时直接进波形视图。
      const back = page.getByRole('button', { name: /^返回剪辑/ })
      await back.waitFor({ state: 'visible', timeout: 60000 })
      await page.waitForFunction(() => document.querySelector('[data-audio-spectral-editor] canvas[data-waveform-state="ready"]'), null, { timeout: 60000 })
      await capture('audio-link-01-editor')

      // 删掉 2–4 秒（1/4 到 1/2 的位置），作品从 8 秒变成 6 秒。
      const content = page.getByRole('application', { name: '音频波形与频谱编辑区' })
      const box = await content.boundingBox()
      await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.2, { steps: 8 })
      await page.mouse.up()
      await page.getByRole('button', { name: '删除', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('[data-audio-spectral-editor] [data-audio-overlay="deleted"]'), null, { timeout: 10000 })
      await capture('audio-link-02-deleted')

      await back.click()
      await clip.waitFor({ state: 'visible', timeout: 60000 })
      // 片段改用编辑后的声音：结尾截到 6 秒，开头不动。
      await page.waitForFunction((width) => {
        const element = document.querySelector('[data-video-edit-clip]')
        return element && element.getBoundingClientRect().width < width * 0.85
      }, before.width, { timeout: 60000 })
      const after = await clip.boundingBox()
      const ratio = after.width / before.width
      console.log(`动态链接截短：片段宽度 ${before.width.toFixed(1)} → ${after.width.toFixed(1)}（${ratio.toFixed(3)}）`)
      assert.ok(Math.abs(ratio - 0.75) < 0.04, `片段应截到原长的 3/4：${ratio}`)
      assert.equal(await clip.getAttribute('data-clip-start'), startBefore, '片段开头不应移动')
      await capture('audio-link-03-returned')
    },
  }
}

module.exports = { createVideoEditAudioLinkScene }
