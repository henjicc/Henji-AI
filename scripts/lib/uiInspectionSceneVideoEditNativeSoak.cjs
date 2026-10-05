const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { waitReleased } = require('./uiInspectionSceneVideoEditLayout.cjs')
const { dialogs, presented } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const { videoEditResourceCycle, memoryInfraSnapshot } = require('./uiInspectionSceneVideoEditPerformance.cjs')

/**
 * 原生解码长时资源曲线（3.1）：4K60 专业格式素材（默认 ProRes 422 HQ，走原生解码）在节目监视器持续播放，总时长
 * `HENJI_SOAK_MINUTES`（默认 60，验收至少 30），平均分成 4 段，每段之后做一轮 5.1 资源循环（切页、节目浮窗、关闭重开）。
 * 每 30 秒采样一次：各进程类型工作集与私有内存、原生服务工作集/私有提交/句柄/显存/预算占用/会话数、帧通道计数、
 * 区间呈现次数。容差在运行前固定（与 5.1 相同的 15%），不随结果调整：
 * - 渲染与 GPU 进程私有占用：第 1 轮循环后到第 4 轮循环后的增长 ≤ 15%（重要记录 017；工作集照常记录，不作门槛）；
 * - 原生服务私有提交、句柄与显存（工作集照常记录）：第一段播放 2 分钟后的首个样本到最后一个播放样本的增长 ≤ 15%，会话数不增加；
 * - 播放不中断（每个采样区间都有新画面），关闭工程后帧流、原生会话、未归还帧、显存预约与渲染 Worker 全部归零。
 * 素材可用 `HENJI_SOAK_SOURCE` 替换（须为 4K60、7 秒）。证据：`node_modules/.cache/video-edit-native-soak/evidence.json`。
 */
const ROOT = path.resolve('node_modules/.cache/video-edit-native-soak')
const SOURCE = path.resolve(process.env.HENJI_SOAK_SOURCE || 'node_modules/.cache/native-decode/prores422hq.mov')
const MINUTES = Number(process.env.HENJI_SOAK_MINUTES) || 60
const PROJECT_ID = 'video-edit-native-soak'
const FPS = 60
const TILE = 420
const SEGMENTS = 4
const SAMPLE_MS = 30_000
const WARMUP_MS = 120_000
const TOLERANCE = Object.freeze({ memoryGrowth: 0.15, minimumMinutes: 30 })
const button = (page, name) => page.getByRole('button', { name, exact: true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function fixture(tiles) {
  const track = { id: 'v1', name: '视频 1', index: 1, kind: 'video', locked: false, enabled: true, muted: false, solo: false }
  const base = { kind: 'video', track: 1, duration: TILE, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: '' }
  return { format: 'henji-video-project', version: 2, id: PROJECT_ID, name: '原生解码长时资源曲线', revision: 0,
    media: [{ id: 'source', name: path.basename(SOURCE), path: SOURCE, kind: 'video', durationSeconds: 7, width: 3840, height: 2160, hasAudio: false, frameRate: { numerator: FPS, denominator: 1 }, frameRateMode: 'sampled-constant' }],
    bins: [], items: [{ id: 'source-item', name: path.basename(SOURCE), kind: 'video', mediaId: 'source' }],
    sequences: [{ id: 'main', name: '序列 1', width: 3840, height: 2160, frameRate: { numerator: FPS, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
      tracks: [track], clips: Array.from({ length: tiles }, (_, index) => ({ ...base, id: `tile-${index}`, itemId: 'source-item', name: `素材${index + 1}`, start: index * TILE })), annotations: [] }] }
}

const byType = (metrics, field) => Object.fromEntries(['Browser', 'Tab', 'GPU', 'Utility'].map(type => [type, metrics.filter(item => item.type === type).reduce((total, item) => total + (item.memory[field] ?? 0), 0)]))
const growth = (first, last) => first ? (last - first) / first : 0

/** Counts live render workers only (the 5.1 observer keeps every message, which would itself grow over an hour). */
async function observeWorkerCount(page) {
  await page.evaluate(() => {
    const NativeWorker = window.Worker
    window.__videoLayoutNativeWorker = NativeWorker
    window.__videoLayoutEvidence = { workers: [] }
    window.Worker = class CountedVideoWorker extends NativeWorker {
      constructor(url, options) {
        super(url, options)
        if (String(url).includes('videoEditWorker')) { this.__soakRecord = { terminated: false }; window.__videoLayoutEvidence.workers.push(this.__soakRecord) }
      }
      terminate() { if (this.__soakRecord) this.__soakRecord.terminated = true; return super.terminate() }
    }
  })
}
/** Counts presented frames of the (current) program monitor canvas. */
async function countPresented(page) {
  await page.evaluate(() => {
    window.__soakObserver?.disconnect()
    const canvas = document.querySelector('canvas[aria-label="剪辑画面"]')
    window.__soakPresented = 0
    window.__soakObserver = new MutationObserver(() => { window.__soakPresented++ })
    window.__soakObserver.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] })
  })
}

async function sample(page, app, startedAt, segment, playing) {
  const metrics = await app.evaluate(({ app }) => app.getAppMetrics())
  const page_ = await page.evaluate(() => {
    const presentedCount = window.__soakPresented ?? 0; window.__soakPresented = 0
    return { presented: presentedCount, frame: Number(document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame ?? -1), workers: window.__videoLayoutEvidence.workers.filter(worker => !worker.terminated).length }
  })
  const frames = await page.evaluate(() => window.henjiNative.videoFrames.stats().then(stats => ({
    streams: stats.streams.length, unreleasedImports: stats.unreleasedImports, orphanHandles: stats.orphanHandles,
    native: stats.native ? { pid: stats.native.pid, cpuMs: stats.native.cpuMs, handleCount: stats.native.handleCount, workingSetBytes: stats.native.workingSetBytes ?? null, privateBytes: stats.native.privateBytes ?? null,
      vramBytes: stats.native.gpuLocalMemory?.currentUsageBytes ?? null, vramReservedBytes: stats.native.budget?.vramReservedBytes ?? null, vramPeakReservedBytes: stats.native.budget?.vramPeakReservedBytes ?? null,
      hardwareSessions: stats.native.budget?.hardwareSessions ?? null, sessions: stats.native.streams.length } : null,
  })).catch(error => ({ error: String(error) })))
  return { minute: Math.round((Date.now() - startedAt) / 600) / 100, segment, playing, ...page_, workingSet: byType(metrics, 'workingSetSize'), privateBytes: byType(metrics, 'privateBytes'), frames }
}

function createVideoEditNativeSoakScene() {
  return {
    id: 'video-edit-native-soak', surface: '剪辑', name: '剪辑-原生解码长时播放与资源循环的资源曲线', writesUserData: true,
    setup: async (page, app, { capture }) => {
      assert.ok(fs.existsSync(SOURCE), `缺少长时曲线素材：${SOURCE}`)
      fs.rmSync(ROOT, { recursive: true, force: true }); fs.mkdirSync(ROOT, { recursive: true })
      const segmentMs = MINUTES * 60_000 / SEGMENTS
      // Each segment plays from frame 0 and never reaches the end (30s of margin).
      const tiles = Math.ceil((segmentMs / 1000 + 30) * FPS / TILE)
      const file = path.join(ROOT, 'soak.henji-video'); fs.writeFileSync(file, JSON.stringify(fixture(tiles)))
      const evidence = { completed: false, acceptance: MINUTES >= TOLERANCE.minimumMinutes, minutes: MINUTES, source: SOURCE, tiles, tolerance: TOLERANCE, startedAt: new Date().toISOString(), samples: [], cycles: [], stalls: [] }
      const store = () => fs.writeFileSync(path.join(ROOT, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const projectRef = { kind: 'video_edit.project', id: PROJECT_ID }
      let client
      const playback = async (frame, playing) => {
        const read = await callTool(client, 'read_application_entity', { ref: projectRef, propertyIds: ['video_edit.project.program_playback'] })
        await callTool(client, 'change_application_entities', operationEnvelope([read], { summary: '长时播放', changes: [{ kind: 'set_properties', entityType: 'video_edit.project', target: projectRef, properties: { 'video_edit.project.program_playback': { frame, playing, playbackDirection: 1 } } }] }))
      }
      try {
        evidence.runtime = await app.evaluate(async ({ app }) => ({ electron: process.versions.electron, chrome: process.versions.chrome, gpu: (await app.getGPUInfo('basic')).gpuDevice }))
        await button(page, '剪辑').first().click(); if (await button(page, '关闭项目').isVisible()) await button(page, '关闭项目').click()
        await observeWorkerCount(page)
        await dialogs(app, [file], file); await button(page, '打开项目文件').click(); await presented(page, 0)
        const identity = await authorizeMcpConnection(page, { name: '长时资源曲线', allowWrites: true }); client = await connectMcpClient(identity.config, 'Henji soak Reality')
        const startedAt = Date.now()
        for (let segment = 0; segment < SEGMENTS; segment++) {
          await countPresented(page)
          await playback(0, true)
          const segmentStart = Date.now()
          let previousFrame = -1
          while (Date.now() - segmentStart < segmentMs) {
            await sleep(Math.min(SAMPLE_MS, segmentMs - (Date.now() - segmentStart)))
            const entry = await sample(page, app, startedAt, segment, true)
            evidence.samples.push(entry)
            // A playback that stopped advancing is recorded and resumed (asserted at the end).
            if (entry.frame === previousFrame || entry.presented === 0) { evidence.stalls.push({ minute: entry.minute, frame: entry.frame }); await playback(Math.max(0, entry.frame), true) }
            previousFrame = entry.frame
            store()
          }
          await playback(0, false); await presented(page, 0)
          await videoEditResourceCycle(page, app, file, 0)
          const metrics = await app.evaluate(({ app }) => app.getAppMetrics())
          const entry = { segment, minute: Math.round((Date.now() - startedAt) / 600) / 100, workingSet: byType(metrics, 'workingSetSize'), privateBytes: byType(metrics, 'privateBytes'), after: await sample(page, app, startedAt, segment, false) }
          // Allocator attribution (task 3.2, record 017): Chromium memory-infra after cycles 1, 2 and 4 (diagnostic record;
          // HENJI_SOAK_MEMORY_DUMPS=0 turns it off). Taken after the metrics above so they are unaffected.
          if (process.env.HENJI_SOAK_MEMORY_DUMPS !== '0' && [0, 1, 3].includes(segment)) entry.memoryInfra = await memoryInfraSnapshot(app, ROOT, `cycle-${segment}`)
          evidence.cycles.push(entry)
          store()
        }
        await capture('native-soak-end')
        await button(page, '关闭项目').click(); await waitReleased(page)
        await sleep(2000)
        evidence.afterClose = await sample(page, app, startedAt, SEGMENTS, false)

        const violations = []
        const check = (ok, message) => { if (!ok) violations.push(message) }
        const first = evidence.cycles[0]; const last = evidence.cycles.at(-1)
        evidence.cycleGrowth = Object.fromEntries(['Tab', 'GPU', 'Browser'].map(type => [type, growth(first.workingSet[type], last.workingSet[type])]))
        // Record 017 (task 3.2): private bytes are the gate; working sets stay recorded (`cycleGrowth`, native `workingSet`).
        evidence.cyclePrivateGrowth = Object.fromEntries(['Tab', 'GPU', 'Browser'].map(type => [type, growth(first.privateBytes[type], last.privateBytes[type])]))
        for (const type of ['Tab', 'GPU']) check(evidence.cyclePrivateGrowth[type] <= TOLERANCE.memoryGrowth, `第1轮到第${evidence.cycles.length}轮循环后${type}进程私有占用增长${evidence.cyclePrivateGrowth[type]}`)
        const playing = evidence.samples.filter(entry => entry.playing && entry.frames.native)
        const warm = playing.find(entry => entry.minute * 60_000 >= WARMUP_MS) ?? playing[0]
        const end = playing.at(-1)
        evidence.nativeGrowth = { fromMinute: warm.minute, toMinute: end.minute,
          workingSet: growth(warm.frames.native.workingSetBytes, end.frames.native.workingSetBytes), privateBytes: growth(warm.frames.native.privateBytes, end.frames.native.privateBytes),
          handles: growth(warm.frames.native.handleCount, end.frames.native.handleCount), vram: growth(warm.frames.native.vramBytes, end.frames.native.vramBytes),
          sessions: { from: warm.frames.native.sessions, to: end.frames.native.sessions } }
        for (const [key, label] of [['privateBytes', '私有提交'], ['handles', '句柄'], ['vram', '显存']]) check(evidence.nativeGrowth[key] <= TOLERANCE.memoryGrowth, `原生服务${label}增长${evidence.nativeGrowth[key]}`)
        check(end.frames.native.sessions <= warm.frames.native.sessions, `原生会话数增长：${warm.frames.native.sessions} → ${end.frames.native.sessions}`)
        check(evidence.stalls.length === 0, `播放中断${evidence.stalls.length}次`)
        const closed = evidence.afterClose
        check(closed.workers === 0, `关闭后仍有${closed.workers}个渲染Worker`)
        check(closed.frames.streams === 0 && closed.frames.unreleasedImports === 0, `关闭后帧流或未归还帧未归零：${JSON.stringify(closed.frames)}`)
        check(!closed.frames.native || (closed.frames.native.sessions === 0 && !closed.frames.native.vramReservedBytes), `关闭后原生会话或显存预约未归零：${JSON.stringify(closed.frames.native)}`)
        evidence.violations = violations
        evidence.completed = evidence.acceptance && violations.length === 0
        store()
        assert.deepEqual(violations, [], '原生解码长时资源曲线未达到预先固定的容差')
      } catch (error) {
        evidence.failed = { message: String(error?.message ?? error), stack: error?.stack }; store(); await capture('native-soak-failed').catch(() => {}); throw error
      } finally {
        await client?.close().catch(() => {}); await disableMcp(page).catch(() => {})
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.getTitle().startsWith('痕迹AI · ')).forEach(window => window.close())).catch(() => {})
        if (await button(page, '关闭项目').isVisible().catch(() => false)) await button(page, '关闭项目').click().catch(() => {})
        await page.evaluate(() => { window.__soakObserver?.disconnect(); if (window.__videoLayoutNativeWorker) window.Worker = window.__videoLayoutNativeWorker; try { localStorage.removeItem('henji.videoEdit.popoutLayout.v1') } catch { /* view convenience only */ } }).catch(() => {})
        store()
      }
    },
  }
}

module.exports = { createVideoEditNativeSoakScene }
