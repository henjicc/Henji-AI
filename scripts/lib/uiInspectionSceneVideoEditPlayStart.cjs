const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { observeWorkers, waitReleased } = require('./uiInspectionSceneVideoEditLayout.cjs')
const { openVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')
const { videoEditFixtureProject } = require('./uiInspectionSceneVideoEditProbe.cjs')
const button = (page, name) => page.getByRole('button', { name, exact: true })

/**
 * 节目起播延迟：从按下播放到画面开始走、以及起播后第一秒是否跑满帧。
 * 停在长 GOP 的中间起播（解码器要从关键帧解到播放头），带声音（要备好 AudioContext 与第一块混音）。
 */
function createVideoEditPlayStartScene() {
  return {
    id: 'video-edit-play-start', surface: '剪辑', name: '剪辑-节目起播延迟与起播帧率', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-play-start'); fs.mkdirSync(root, { recursive: true })
      const { ffmpegPath } = require('./mediaBinaries.cjs')
      const source = path.join(root, '1080p60-gop240-aac.mp4')
      if (!fs.existsSync(source)) execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=60', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '20', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-g', '240', '-keyint_min', '240', '-sc_threshold', '0', '-bf', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source], { windowsHide: true })
      const clip = { id: 'v', mediaId: 'source', name: '画面', kind: 'video', track: 1, start: 0, duration: 1200, sourceInUs: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: '' }
      const project = videoEditFixtureProject({ id: 'play-start', name: '起播验证', revision: 0, width: 1920, height: 1080, fps: 60, media: [{ id: 'source', name: path.basename(source), path: source, kind: 'video', durationSeconds: 20, width: 1920, height: 1080, hasAudio: true }], clips: [clip, { ...clip, id: 'a', name: '声音', kind: 'audio', sourceComponent: 'audio', track: 0 }], annotations: [] })
      const file = path.join(root, 'play-start.henji-video'); fs.writeFileSync(file, JSON.stringify(project))
      await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, file)
      await observeWorkers(page)
      await button(page, '剪辑').click(); await openVideoEditFile(page, file)
      const canvas = page.getByLabel('剪辑画面', { exact: true })
      const presented = async frame => {
        try { await page.waitForFunction(frame => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === String(frame), frame, { timeout: 30000 }) }
        catch (error) { console.error('[play-start] 等待画面', frame, JSON.stringify(await page.evaluate(() => ({ data: { ...document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset }, playhead: document.querySelector('[aria-label="剪辑时间定位"]')?.getAttribute('aria-valuenow'), monitor: document.body.innerText.slice(-600) })))); throw error }
      }
      await presented(0)
      const ruler = page.getByRole('slider', { name: '剪辑时间定位' }); const box = await ruler.boundingBox()
      const evidence = { runs: [] }
      // 两次：首次起播（含首次建 AudioContext）与暂停后换位置再起播。播放头都落在 GOP 中段（240 帧一个关键帧，标尺约每像素一帧）。
      for (const offset of [370, 130]) {
        await page.mouse.click(box.x + offset + .1, box.y + 12)
        const start = Number(await ruler.getAttribute('aria-valuenow')); await presented(start); await page.waitForTimeout(1500)
        await canvas.evaluate(canvas => {
          window.__playStart = { frames: [] }
          window.__playStartObserver = new MutationObserver(() => window.__playStart.frames.push({ at: performance.now(), frame: Number(canvas.dataset.presentedFrame), requestedAt: Number(canvas.dataset.requestedAt), decodeMs: Number(canvas.dataset.decodeMs), gpuMs: Number(canvas.dataset.gpuMs) }))
          window.__playStartObserver.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] })
          window.addEventListener('pointerdown', () => { window.__playStart.pressedAt ??= performance.now() }, { capture: true, once: true })
        })
        await button(page, '播放／暂停').click()
        await page.waitForFunction(frame => Number(document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame) >= frame, start + 120, { timeout: 30000 })
        const data = await canvas.evaluate(canvas => { window.__playStartObserver.disconnect(); return { ...window.__playStart, phases: JSON.parse(canvas.dataset.playStartPhases || 'null'), clockStartAt: Number(canvas.dataset.playClockStartAt) } })
        await button(page, '播放／暂停').click()
        const moving = data.frames.filter(sample => sample.frame > start)
        const firstMove = moving[0]
        const firstSecond = moving.filter(sample => sample.at - firstMove.at <= 1000)
        const gaps = firstSecond.slice(1).map((sample, i) => sample.at - firstSecond[i].at)
        const run = { start, pressToMoveMs: firstMove.at - data.pressedAt, pressToClockMs: data.clockStartAt - data.pressedAt, phases: data.phases, firstSecondUpdates: firstSecond.length, firstSecondFramesAdvanced: firstSecond.at(-1).frame - start, gapMaxMs: Math.max(...gaps), gapsOver25: gaps.filter(gap => gap > 25).length, steadyGapsOver25: (() => { const steady = moving.filter(sample => sample.frame - start > 60); return steady.slice(1).filter((sample, i) => sample.at - steady[i].at > 25).length })(), early: firstSecond.slice(0, 24).map(sample => `${sample.frame - start}@${(sample.at - data.clockStartAt).toFixed(0)}[req${(sample.requestedAt - data.clockStartAt).toFixed(0)} dec${sample.decodeMs.toFixed(0)} gpu${sample.gpuMs.toFixed(0)}]`).join(' ') }
        evidence.runs.push(run); fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
        console.log('[play-start]', JSON.stringify(run))
      }
      // 刚拖完标尺就按播放：拖动中途停住、松手后立刻按、松手后隔一个人手反应时间再按。
      for (const [index, [rest, delay]] of [[0, 0], [0, 150], [200, 0]].entries()) {
        const from = index % 2 ? 140 : 380; const to = index % 2 ? 420 : 160
        await page.mouse.move(box.x + from + .1, box.y + 12); await page.mouse.down()
        for (let step = 1; step <= 20; step++) { await page.mouse.move(box.x + from + (to - from) * step / 20 + .1, box.y + 12); await page.waitForTimeout(16) }
        if (rest) await page.waitForTimeout(rest)
        await page.mouse.up()
        const start = Number(await ruler.getAttribute('aria-valuenow')); await presented(start)
        await canvas.evaluate(canvas => {
          window.__playStart = { frames: [] }
          window.__playStartObserver = new MutationObserver(() => window.__playStart.frames.push({ at: performance.now(), frame: Number(canvas.dataset.presentedFrame) }))
          window.__playStartObserver.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] })
          window.addEventListener('pointerdown', () => { window.__playStart.pressedAt ??= performance.now() }, { capture: true, once: true })
        })
        if (delay) await page.waitForTimeout(delay)
        await button(page, '播放／暂停').click()
        await page.waitForFunction(frame => Number(document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame) >= frame, start + 60, { timeout: 30000 })
        const data = await canvas.evaluate(() => { window.__playStartObserver.disconnect(); return window.__playStart })
        await button(page, '播放／暂停').click()
        const firstMove = data.frames.find(sample => sample.frame > start)
        const run = { afterDrag: { rest, delay }, start, pressToMoveMs: firstMove.at - data.pressedAt }
        evidence.afterDrag = [...(evidence.afterDrag ?? []), run]; fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
        console.log('[play-start]', JSON.stringify(run))
      }
      await capture('play-start')
      await button(page, '关闭项目').click(); await waitReleased(page)
      for (const run of evidence.runs) {
        assert.ok(run.firstSecondUpdates >= 58, `起播第一秒只有 ${run.firstSecondUpdates} 次画面更新`)
        // 暂停停稳后起播已预热（解码定位、声音设备与第一块混音），按下到画面开始走不再等解码。
        assert.ok(run.pressToMoveMs < 150, `按下播放 ${run.pressToMoveMs.toFixed(0)}ms 后画面才开始走`)
      }
      // 刚松手就按：预热已在松手（或拖动停住）时开始解码，只等从关键帧解到播放头剩下的部分。改前三种情况都要 380–450ms。
      for (const run of evidence.afterDrag) assert.ok(run.pressToMoveMs < (run.afterDrag.delay || run.afterDrag.rest ? 250 : 350), `拖完按播放 ${run.pressToMoveMs.toFixed(0)}ms 后画面才开始走`)
    },
  }
}

module.exports = { createVideoEditPlayStartScene }
