const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { observeWorkers, waitReleased } = require('./uiInspectionSceneVideoEditLayout.cjs')
const { dialogs, presented } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const { openVideoEditFile, readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')

const button = (page, name) => page.getByRole('button', { name, exact: true })
/** 4K59.94 相机原片（含 48kHz 声音）；可用 HENJI_TIME_REMAP_SOURCE 换成其他 4K60 素材。 */
const SOURCE = process.env.HENJI_TIME_REMAP_SOURCE || 'D:/视频制作/2026-10-15_联想YOGA/素材/相机/操作工作流的素材可以随便放在合适位置.MP4'
const PROJECT_ID = 'video-edit-time-remap'
const FPS = 60
/** 与 4K60 性能负载同一组预先固定的容差（时间重映射不放宽）。 */
const TOLERANCE = { updatesPerSecond: 59.0, missingRatio: 0.01, maxGapMs: 100, clockDeviation: 0.01 }

function fixture() {
  const track = (index, kind, name) => ({ id: `${kind[0]}${index}`, name, index, kind, locked: false, enabled: true, muted: false, solo: false })
  const base = { track: 1, start: 0, duration: 60, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', linkId: 'pair' }
  return { format: 'henji-video-project', version: 5, id: PROJECT_ID, name: '4K60速度坡道', revision: 0,
    media: [{ id: 'camera', name: '相机原片', path: SOURCE, kind: 'video', durationSeconds: 46, width: 3840, height: 2160, frameRate: { numerator: 60000, denominator: 1001 }, frameRateMode: 'sampled-constant', hasAudio: true }],
    bins: [], items: [{ id: 'camera-item', name: '相机原片', kind: 'video', mediaId: 'camera' }],
    sequences: [{ id: 'main', name: '序列 1', width: 3840, height: 2160, frameRate: { numerator: FPS, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
      tracks: [track(0, 'audio', '音频 1'), track(1, 'video', '视频 1')],
      clips: [{ ...base, id: 'ramp', itemId: 'camera-item', name: '相机原片', kind: 'video', sourceComponent: 'video' },
        { ...base, id: 'ramp-audio', itemId: 'camera-item', name: '相机原片', kind: 'audio', track: 0, sourceComponent: 'audio' }], annotations: [] }] }
}
const quantile = (values, q) => values.length ? values[Math.min(values.length - 1, Math.floor(values.length * q))] : null
async function measure(page, seconds) {
  return page.evaluate(async duration => {
    const canvas = document.querySelector('canvas[aria-label="剪辑画面"]')
    const frames = []; const observer = new MutationObserver(() => frames.push({ at: performance.now(), frame: Number(canvas.dataset.presentedFrame), renderMs: Number(canvas.dataset.renderMs), decodeMs: Number(canvas.dataset.decodeMs), gpuMs: Number(canvas.dataset.gpuMs) }))
    observer.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] })
    await new Promise(resolve => setTimeout(resolve, duration * 1000)); observer.disconnect()
    return frames.filter((value, index) => index === 0 || value.frame !== frames[index - 1].frame)
  }, seconds)
}
function summarize(frames) {
  const gaps = frames.slice(1).map((value, index) => value.at - frames[index].at).sort((a, b) => a - b)
  const span = (frames.at(-1).at - frames[0].at) / 1000; const advanced = frames.at(-1).frame - frames[0].frame
  const skipped = frames.slice(1).map((value, index) => ({ fromFrame: frames[index].frame, toFrame: value.frame, missing: value.frame - frames[index].frame - 1, atSecond: Math.round((frames[index].at - frames[0].at) / 100) / 10, decodeMs: Math.round(value.decodeMs), gpuMs: Math.round(value.gpuMs) })).filter(value => value.missing > 0)
  const missing = skipped.reduce((total, value) => total + value.missing, 0)
  return { updates: frames.length, spanSeconds: span, updatesPerSecond: (frames.length - 1) / span, framesAdvanced: advanced, missing, missingRatio: missing / Math.max(1, advanced), skipped,
    backwards: frames.slice(1).filter((value, index) => value.frame < frames[index].frame).length, clockDeviation: Math.abs(advanced / FPS - span) / span,
    p50GapMs: quantile(gaps, 0.5), p95GapMs: quantile(gaps, 0.95), p99GapMs: quantile(gaps, 0.99), maxGapMs: gaps.at(-1), decodeP95Ms: quantile(frames.map(value => value.decodeMs).sort((a, b) => a - b), .95), gpuP95Ms: quantile(frames.map(value => value.gpuMs).sort((a, b) => a - b), .95) }
}

/**
 * 时间重映射真实验收：4K59.94 相机原片（画面 + 链接声音）用正式 ramp_video_edit_clip_speed 做“100% → 30% 慢放保持 → 200%”的坡道，
 * 帧混合与保持音调；节目监视器从头持续播放，逐帧记录呈现序号（跳帧、帧间隔、时钟偏差），再换帧采样对照帧混合的额外开销。
 * 音画同步的逐样本证据在精确测试（拉伸器闭环纠偏与速度曲线音包定位）；这里核对播放时钟与跳帧。
 */
function createVideoEditTimeRemapScene() {
  return { id: 'video-edit-time-remap', surface: '剪辑', name: '剪辑-4K60速度坡道帧混合持续播放与跳帧数据', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-time-remap'); fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(root, { recursive: true })
      assert.ok(fs.existsSync(SOURCE), `缺少 4K60 素材：${SOURCE}`)
      const file = path.join(root, 'time-remap.hjvid'); fs.writeFileSync(file, JSON.stringify(fixture()))
      const evidence = { completed: false, startedAt: new Date().toISOString(), source: SOURCE, tolerance: TOLERANCE, runs: {} }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const projectRef = { kind: 'video_edit.document', id: PROJECT_ID }
      const clipRef = { kind: 'video_edit.clip', id: `${PROJECT_ID}:ramp` }
      let client; let observed = false
      const playback = async (frame, playing) => {
        const read = await callTool(client, 'read_application_entity', { ref: projectRef, propertyIds: ['video_edit.document.program_playback'] })
        await callTool(client, 'change_application_entities', operationEnvelope([read], { summary: '播放控制', changes: [{ kind: 'set_properties', entityType: 'video_edit.document', target: projectRef, properties: { 'video_edit.document.program_playback': { frame, playing, playbackDirection: 1 } } }] }))
      }
      try {
        evidence.runtime = await app.evaluate(async ({ app }) => ({ versions: { electron: process.versions.electron, chrome: process.versions.chrome }, gpu: await app.getGPUInfo('basic') }))
        await button(page, '剪辑').first().click(); if (await button(page, '关闭项目').isVisible()) await button(page, '关闭项目').click()
        await observeWorkers(page); observed = true
        await dialogs(app, [file], file); await openVideoEditFile(page, file); await presented(page, 0)
        const identity = await authorizeMcpConnection(page, { name: '时间重映射', allowWrites: true }); client = await connectMcpClient(identity.config, 'Henji time remap Reality')
        // 片段先拉到 12 秒原速，再在 3 秒处做 30% 慢放（保持 1.5 秒）、在 9 秒处加速到 200%。
        let read = await callTool(client, 'read_application_entity', { ref: clipRef })
        const widened = await callTool(client, 'change_application_entities', operationEnvelope([read], { summary: '拉长片段', changes: [{ kind: 'set_properties', entityType: 'video_edit.clip', target: clipRef, properties: { 'video_edit.clip.duration': 720 } }, { kind: 'set_properties', entityType: 'video_edit.clip', target: { kind: 'video_edit.clip', id: `${PROJECT_ID}:ramp-audio` }, properties: { 'video_edit.clip.duration': 720 } }] }))
        assert.equal(widened.verificationState, 'verified', JSON.stringify(widened))
        read = await callTool(client, 'read_application_entity', { ref: projectRef })
        const ramp = await callTool(client, 'ramp_video_edit_clip_speed', operationEnvelope([read], { documentRef: projectRef, clipRef, ramps: [{ atSeconds: 3, speedPercent: 30, holdSeconds: 1.5, easeInSeconds: .4 }, { atSeconds: 9, speedPercent: 200, holdSeconds: 1, easeInSeconds: .4 }] }))
        evidence.ramp = ramp
        const project = readVideoEditFile(file)
        const clip = project.sequences[0].clips.find(value => value.id === 'ramp')
        const audio = project.sequences[0].clips.find(value => value.id === 'ramp-audio')
        assert.ok(clip.timeRemap && clip.frameInterpolation === 'blend' && clip.preservePitch, JSON.stringify(clip))
        assert.deepEqual(audio.timeRemap, clip.timeRemap)
        evidence.clip = { duration: clip.duration, timeRemap: clip.timeRemap, frameInterpolation: clip.frameInterpolation }
        // 选中片段，效果控件显示“时间重映射”分组（曲线、预设、补帧、变调）。
        await page.getByText('相机原片 [曲线]', { exact: true }).first().click()
        await page.locator('[data-video-edit-time-remap-panel]').waitFor({ state: 'visible', timeout: 30000 })
        await capture('time-remap-panel')
        const run = async (label, seconds) => {
          await playback(0, false); await presented(page, 0); await page.waitForTimeout(800)
          await playback(0, true); await page.waitForTimeout(300)
          const frames = await measure(page, seconds)
          await playback(0, false)
          // 起播（前 1.5 秒）单独记录；容差判断看起播之后的持续播放，与 4K60 性能负载起播后再计时一致。
          const steady = frames.filter(value => value.at - frames[0].at >= 1500)
          evidence.runs[label] = { startup: summarize(frames.filter(value => value.at - frames[0].at < 1600)), steady: summarize(steady), full: summarize(frames) }; store()
          return evidence.runs[label].steady
        }
        const seconds = Math.min(14, clip.duration / FPS - 1)
        // 基线：先撤销坡道（原速同一片段）测一次，区分起播和素材本身的开销。
        read = await callTool(client, 'read_application_entity', { ref: clipRef })
        await callTool(client, 'change_application_entities', operationEnvelope([read], { summary: '基线原速', changes: [{ kind: 'set_properties', entityType: 'video_edit.clip', target: clipRef, properties: { 'video_edit.clip.time_remap': null } }] }))
        evidence.runs.baseline = undefined
        const baseline = await run('baseline', seconds)
        read = await callTool(client, 'read_application_entity', { ref: clipRef })
        await callTool(client, 'change_application_entities', operationEnvelope([read], { summary: '恢复坡道', changes: [{ kind: 'set_properties', entityType: 'video_edit.clip', target: clipRef, properties: { 'video_edit.clip.time_remap': clip.timeRemap } }] }))
        const blend = await run('blend', seconds)
        await capture('time-remap-after-playback')
        // 对照：同一曲线改为帧采样，测帧混合的额外开销。
        read = await callTool(client, 'read_application_entity', { ref: clipRef })
        await callTool(client, 'change_application_entities', operationEnvelope([read], { summary: '帧采样对照', changes: [{ kind: 'set_properties', entityType: 'video_edit.clip', target: clipRef, properties: { 'video_edit.clip.frame_interpolation': 'nearest' } }] }))
        const nearest = await run('nearest', seconds)
        // 诊断：最后再测一次原速基线（帧缓存已热），区分起播跳帧是否只在帧缓存命中后的“先播缓存前缀”路径出现。
        read = await callTool(client, 'read_application_entity', { ref: clipRef })
        await callTool(client, 'change_application_entities', operationEnvelope([read], { summary: '热缓存基线', changes: [{ kind: 'set_properties', entityType: 'video_edit.clip', target: clipRef, properties: { 'video_edit.clip.time_remap': null } }] }))
        await run('baseline-warm', seconds)
        evidence.violations = []
        void baseline
        for (const [label, play] of [['blend', blend], ['nearest', nearest]]) {
          if (play.updatesPerSecond < TOLERANCE.updatesPerSecond) evidence.violations.push(`${label} 实际更新率不达标：${play.updatesPerSecond}`)
          if (play.missingRatio > TOLERANCE.missingRatio) evidence.violations.push(`${label} 跳帧超出容差：${play.missingRatio}`)
          if (play.maxGapMs > TOLERANCE.maxGapMs) evidence.violations.push(`${label} 最大帧间隔超出容差：${play.maxGapMs}ms`)
          if (play.clockDeviation > TOLERANCE.clockDeviation) evidence.violations.push(`${label} 播放时钟偏差超出容差：${play.clockDeviation}`)
          if (play.backwards) evidence.violations.push(`${label} 画面倒退 ${play.backwards} 次`)
        }
        evidence.completed = evidence.violations.length === 0; store()
        assert.deepEqual(evidence.violations, [], '4K60 速度坡道播放未达到预先固定的容差')
      } catch (error) { evidence.failed = { message: String(error.message ?? error), stack: error.stack }; store(); await capture('time-remap-failed').catch(() => {}); throw error }
      finally {
        await client?.close().catch(() => {}); await disableMcp(page).catch(() => {})
        if (await button(page, '关闭项目').isVisible().catch(() => false)) await button(page, '关闭项目').click().catch(() => {})
        if (observed) await waitReleased(page).catch(() => {})
        store()
      }
    },
  }
}
module.exports = { createVideoEditTimeRemapScene }
