const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const button = (page, name) => page.getByRole('button', { name, exact: true })
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))] ?? 0

/**
 * 片段缩略图条（任务 2.4）：120 个 4K60 片段铺在 4 条画面轨上（缩放 1.5 时视口内约 50 个）。
 * - 首次打开：缩略帧在低优先级进程里生成的同时播放 3 秒，与全部生成完后的播放对照，证明取帧不抢预览播放；
 * - 可见片段的缩略图全部就绪的耗时（首次 / 关闭重开命中磁盘缓存）；
 * - 时间线横向滚动、缩放期间的动画帧间隔与长任务（主线程耗时）。
 * 只有画面轨 1 输出画面（2–4 隐藏），播放负载与“只有一层 4K60”相同；隐藏轨的片段照样显示缩略图条。
 */
/** 960×640 下时间线只露出约 2 条画面轨、10 个片段；低于这个数说明时间线没铺开，不是缩略图慢。 */
const MIN_VISIBLE_STRIPS = 8

function createVideoEditFilmstripScene() {
  return {
    id: 'video-edit-filmstrip', surface: '剪辑', name: '剪辑-片段缩略图条生成、缓存与滚动缩放', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-filmstrip'); fs.mkdirSync(root, { recursive: true })
      const { ffmpegPath, ffprobePath } = require('./mediaBinaries.cjs')
      const source = path.join(root, '4k60-gop120-20s.mp4')
      if (!fs.existsSync(source)) execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=60', '-t', '20', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-g', '120', '-keyint_min', '120', '-sc_threshold', '0', '-bf', '2', '-pix_fmt', 'yuv420p', source], { windowsHide: true })
      const probe = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-of', 'json', source], { windowsHide: true, encoding: 'utf8' })).streams.find(stream => stream.codec_type === 'video')
      assert.equal(probe.width, 3840); assert.equal(probe.avg_frame_rate, '60/1')
      const durationSeconds = Number(probe.duration)
      const clips = Array.from({ length: 120 }, (_, index) => {
        const track = 1 + Math.floor(index / 30); const slot = index % 30
        return { id: `strip-${index}`, mediaId: 'source', name: `4K60 片段 ${index + 1}`, kind: 'video', track, start: slot * 60, duration: 60, sourceInUs: ((index * 7) % 18) * 1_000_000, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, brightness: 1, text: '' }
      })
      const fixture = { id: 'filmstrip-4k60', name: '缩略图条验证', revision: 0, width: 3840, height: 2160, fps: 60, media: [{ id: 'source', name: path.basename(source), path: source, kind: 'video', durationSeconds, width: 3840, height: 2160, frameRate: { numerator: 60, denominator: 1 }, hasAudio: false }], clips, annotations: [] }
      const project = require('./uiInspectionSceneVideoEditProbe.cjs').videoEditFixtureProject(fixture)
      project.sequences[0].tracks.forEach(track => { if (track.index >= 2) track.enabled = false; if (track.kind === 'video') track.height = 48 })
      const file = path.join(root, 'filmstrip.henji-video'); fs.writeFileSync(file, JSON.stringify(project))
      const evidence = { machine: { cpu: os.cpus()[0].model, cores: os.cpus().length, memoryBytes: os.totalmem() }, clips: clips.length, media: probe }
      const canvas = page.getByLabel('剪辑画面', { exact: true })
      const presented = async (frame, label) => {
        try { await page.waitForFunction(frame => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === String(frame), frame, { timeout: 90000 }) }
        catch (error) { await capture(label); throw error }
      }
      const open = async () => {
        await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, file)
        await button(page, '打开项目文件').click(); await presented(0, 'filmstrip-open-failed')
      }
      const rewind = async label => {
        const ruler = page.getByRole('slider', { name: '剪辑时间定位' })
        await ruler.click({ position: { x: 6, y: 12 } })
        for (let step = 0; step < 60 && Number(await ruler.getAttribute('aria-valuenow')) > 0; step++) await ruler.press('ArrowLeft')
        await presented(0, label)
      }
      const setZoom = value => page.evaluate(value => {
        const zoom = document.querySelector('input[aria-label="时间线缩放"]')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(zoom, String(value)); zoom.dispatchEvent(new Event('input', { bubbles: true }))
      }, value)
      /** 当前已挂载缩略图条的就绪情况（失败诊断用）。 */
      const strips = () => page.evaluate(() => [...document.querySelectorAll('[data-video-edit-filmstrip]')].map(node => ({ tiles: Number(node.getAttribute('data-filmstrip-tiles')), ready: Number(node.getAttribute('data-filmstrip-ready')) })))
      const waitFilled = async label => {
        const began = Date.now()
        // 判据：时间线可见区（标尺以下）里的每个片段都有缩略图条且全部就绪。可见片段数随窗口而变
        // （1440 约 50、960 约 10），所以不写死数量，只要求至少铺满 MIN_VISIBLE_STRIPS 个、且没有漏铺。
        try { await page.waitForFunction(minimum => {
          const viewport = document.querySelector('[data-video-edit-timeline-viewport]'); if (!viewport) return false
          const view = viewport.getBoundingClientRect(); const top = viewport.querySelector('[data-video-edit-ruler]')?.getBoundingClientRect().bottom ?? view.top
          const visible = [...viewport.querySelectorAll('[data-video-edit-clip]')].filter(clip => { const box = clip.getBoundingClientRect(); return box.right > view.left && box.left < view.right && box.bottom > top && box.top < view.bottom })
          return visible.length >= minimum && visible.every(clip => { const node = clip.querySelector('[data-video-edit-filmstrip]'); return node && Number(node.getAttribute('data-filmstrip-tiles')) > 0 && node.getAttribute('data-filmstrip-ready') === node.getAttribute('data-filmstrip-tiles') })
        }, MIN_VISIBLE_STRIPS, { timeout: 180000, polling: 50 }) }
        catch (error) { evidence[`${label}Strips`] = await strips(); await capture(`${label}-failed`); throw error }
        return Date.now() - began
      }
      /** 播放 0→179 帧，返回实际更新数、遗漏与时长。 */
      const play = async () => {
        await canvas.evaluate(canvas => {
          window.__stripFrames = []
          window.__stripObserver = new MutationObserver(() => window.__stripFrames.push({ at: performance.now(), frame: Number(canvas.dataset.presentedFrame) }))
          window.__stripObserver.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] })
        })
        await button(page, '播放／暂停').click()
        await page.waitForFunction(() => window.__stripFrames.some(sample => sample.frame >= 179), null, { timeout: 60000 })
        await button(page, '播放／暂停').click()
        const samples = await page.evaluate(() => { window.__stripObserver.disconnect(); return window.__stripFrames })
        const wanted = Array.from({ length: 179 }, (_, index) => index + 1)
        const seen = new Map(samples.filter(sample => wanted.includes(sample.frame)).map(sample => [sample.frame, sample]))
        const clockStart = await canvas.evaluate(canvas => Number(canvas.dataset.playClockStartAt))
        const durationMs = [...seen.values()].at(-1).at - clockStart
        return { updates: seen.size, missing: wanted.filter(frame => !seen.has(frame)), durationMs, updatesPerSecond: seen.size * 1000 / durationMs }
      }
      /** 在页面内按动画帧驱动 `step`，统计帧间隔与长任务。 */
      const animate = (kind, frames) => page.evaluate(async ({ kind, frames }) => {
        const host = document.querySelector('[data-video-edit-timeline-viewport]')
        const zoom = document.querySelector('input[aria-label="时间线缩放"]')
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        const long = []
        const observer = PerformanceObserver.supportedEntryTypes?.includes('longtask') ? new PerformanceObserver(list => { for (const entry of list.getEntries()) long.push(entry.duration) }) : null
        observer?.observe({ type: 'longtask', buffered: false })
        const intervals = []
        let last = performance.now()
        for (let frame = 0; frame < frames; frame++) {
          if (kind === 'scroll') host.scrollLeft += 10
          else {
            // Zoom in then back out in 0.1 steps through the formal range input.
            const next = Math.max(0.1, Math.min(20, Number(zoom.value) + (frame < frames / 2 ? 0.1 : -0.1)))
            setter.call(zoom, next.toFixed(1)); zoom.dispatchEvent(new Event('input', { bubbles: true }))
          }
          await new Promise(resolve => requestAnimationFrame(resolve))
          const now = performance.now(); intervals.push(now - last); last = now
        }
        await new Promise(resolve => setTimeout(resolve, 200))
        observer?.disconnect()
        return { frames, intervals, longTasks: long }
      }, { kind, frames })
      const summary = result => ({ frames: result.frames, p50Ms: quantile(result.intervals, .5), p95Ms: quantile(result.intervals, .95), maxMs: Math.max(...result.intervals), longTasks: result.longTasks.length, longTaskMs: result.longTasks.reduce((sum, value) => sum + value, 0), longestTaskMs: Math.max(0, ...result.longTasks) })
      try {
        await button(page, '剪辑').click()
        if (await button(page, '关闭项目').isVisible()) await button(page, '关闭项目').click()
        const openedAt = Date.now(); await open()
        await setZoom(1.5)
        // (a) play while the visible filmstrips are still being generated in the background.
        evidence.playbackDuringGeneration = await play()
        evidence.stripsAfterFirstPlayback = await strips()
        evidence.coldFillMs = (Date.now() - openedAt)
        evidence.coldFillMs += await waitFilled('cold')
        evidence.visibleStrips = await strips()
        // (b) the same playback once every visible frame is cached.
        await rewind('filmstrip-rewind-failed')
        evidence.playbackAfterGeneration = await play()
        await rewind('filmstrip-rewind2-failed')
        await capture('filmstrip-timeline')
        evidence.scroll = summary(await animate('scroll', 180))
        evidence.zoom = summary(await animate('zoom', 60))
        evidence.afterInteraction = await strips()
        await capture('filmstrip-after-zoom')
        // Reopen: every visible frame comes from the disk cache.
        await button(page, '关闭项目').click()
        const reopenedAt = Date.now(); await open()
        await setZoom(1.5)
        evidence.warmFillMs = (Date.now() - reopenedAt) + await waitFilled('warm')
        const userData = await app.evaluate(({ app }) => app.getPath('userData'))
        const cacheDirectory = path.join(userData, 'HenjiCache', 'Filmstrip')
        const cached = fs.readdirSync(cacheDirectory).filter(name => name.endsWith('.webp'))
        evidence.cache = { files: cached.length, bytes: cached.reduce((sum, name) => sum + fs.statSync(path.join(cacheDirectory, name)).size, 0), leftoverTemporary: fs.readdirSync(cacheDirectory).filter(name => name.endsWith('.tmp')).length }
        fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
        // Thumbnail generation runs below normal priority and never on the preview decoder.
        assert.deepEqual(evidence.playbackDuringGeneration.missing, [], '生成缩略帧期间预览播放不得丢帧')
        assert.ok(evidence.playbackDuringGeneration.updatesPerSecond >= evidence.playbackAfterGeneration.updatesPerSecond - 1.5, `生成缩略帧期间播放 ${evidence.playbackDuringGeneration.updatesPerSecond.toFixed(1)} 次/秒，生成后 ${evidence.playbackAfterGeneration.updatesPerSecond.toFixed(1)} 次/秒`)
        assert.ok(evidence.cache.files > 0 && evidence.cache.leftoverTemporary === 0)
        assert.ok(evidence.warmFillMs < Math.max(3000, evidence.coldFillMs / 3), `重开命中缓存应明显快于首次：首次 ${evidence.coldFillMs}ms，重开 ${evidence.warmFillMs}ms`)
        for (const name of ['scroll', 'zoom']) assert.ok(evidence[name].longestTaskMs < 100, `${name} 期间出现 ${evidence[name].longestTaskMs.toFixed(0)}ms 长任务`)
        await button(page, '关闭项目').click()
        evidence.completed = true
      } finally {
        fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      }
    },
  }
}
module.exports = { createVideoEditFilmstripScene }
