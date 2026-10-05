const assert = require('node:assert/strict')
const { VIDEO_EDIT_TRACK_HEADER_WIDTH } = require('./uiInspectionVideoEditGeometry.cjs')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { ffmpegPath, ffprobePath } = require('./mediaBinaries.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { dialogs, presented } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const { installNativeMixHarness } = require('./uiInspectionSceneVideoEditNativeAudio.cjs')

/**
 * 多音轨展开与声道类型（2.6，参照 Premiere Pro“使用文件 / 修改音频声道”）在真实 Electron 中的端到端验收：
 * - 导入 MXF（4 条单声道）、OBS 式 MP4（2 条立体声）、MOV（立体声 + 单声道）、普通 MP4（1 条立体声），素材记录全部声音流；
 * - 经“添加到当前序列”与真实拖放放入时间线：画面 + 每条声音流一个链接音频片段，铺到相邻音频轨，不够时新增音频轨；
 *   单条声音流的普通视频也拆为画面 + 1 个音频片段；轨道头与波形显示声道类型；
 * - 正式渲染 Worker 的 `mixAudio`（原生声音会话）与 FFmpeg soxr 参考 PCM 按同一声道规则合成的期望逐段互相关；
 * - 轨道头静音/独奏与效果控件音量逐轨生效；项目项“音频声道…”预设（立体声两两合成、单声道拆分）只影响之后放入的片段；
 *   时间线片段“音频声道…”改源声道；OBS 与普通 MP4 另用强制浏览器后端混音对照；
 * - 导出音轨与期望互相关；源监视器播放多音轨素材时每条声音流都有原生声音会话且出声；
 * - 2.6 之前的旧工程（无声音流清单、画面声音合一片段）打开不迁移、只播放第一条流。
 * 每条声道是不同频率的正弦，任何串流、串声道都会让互相关失败。
 */
const ROOT = path.resolve('node_modules/.cache/video-edit-multitrack')
const RATE = 48000
const MAX_LAG = Math.round(RATE * 0.01)
const BLOCK_SECONDS = 0.5
// A tone plus a chirp per channel: the frequency identifies the stream and channel, the chirp makes the signal
// aperiodic so the cross-correlation has a single peak (a pure sine repeats every period).
const sine = frequency => ['-f', 'lavfi', '-i', `aevalsrc='0.2*sin(2*PI*${frequency}*t)+0.1*sin(2*PI*(${frequency * 2 + 37}+${50 + frequency / 10}*t)*t)':s=48000:d=4`]
const PICTURE = ['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=4']
const SAMPLES = [
  { key: 'mxf', file: 'four-mono.mxf', streams: [[220], [330], [440], [550]], args: [...PICTURE, ...sine(220), ...sine(330), ...sine(440), ...sine(550), '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:a', '-map', '4:a', '-c:v', 'dnxhd', '-profile:v', 'dnxhr_lb', '-pix_fmt', 'yuv422p', '-c:a', 'pcm_s24le', '-shortest'] },
  { key: 'obs', file: 'obs-two-stereo.mp4', streams: [[300, 600], [700, 900]], args: [...PICTURE, ...sine(300), ...sine(600), ...sine(700), ...sine(900), '-filter_complex', '[1:a][2:a]join=inputs=2:channel_layout=stereo[game];[3:a][4:a]join=inputs=2:channel_layout=stereo[mic]', '-map', '0:v', '-map', '[game]', '-map', '[mic]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest'] },
  { key: 'mov', file: 'stereo-and-mono.mov', streams: [[250, 500], [800]], args: [...PICTURE, ...sine(250), ...sine(500), ...sine(800), '-filter_complex', '[1:a][2:a]join=inputs=2:channel_layout=stereo[pair]', '-map', '0:v', '-map', '[pair]', '-map', '3:a', '-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le', '-c:a', 'pcm_s24le', '-shortest'] },
  { key: 'single', file: 'single-stereo.mp4', streams: [[260, 520]], args: [...PICTURE, ...sine(260), ...sine(520), '-filter_complex', '[1:a][2:a]join=inputs=2:channel_layout=stereo[pair]', '-map', '0:v', '-map', '[pair]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest'] },
]
const button = (scope, name) => scope.getByRole('button', { name, exact: true })
const menuItem = (page, name) => page.getByRole('menuitem', { name, exact: true })
const entry = (page, id) => page.locator(`[data-video-edit-project-entry="${id}"]`)
const clipNode = (page, id) => page.locator(`[data-video-edit-clip="${id}"]`)
const trackRow = (page, index) => page.locator(`[data-video-edit-track][data-track-index="${index}"]`)
/** Scrolls the timeline vertically so a track row is at the top: clips mount only inside the viewport (few rows fit at 960x640). */
const showTrack = (page, index) => page.locator('[data-video-edit-timeline-viewport]').evaluate((host, index) => { const row = host.querySelector(`[data-track-index="${index}"]`); host.scrollTop = Math.max(0, row.offsetTop - 28) }, index)
const readProject = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const mono = (stream, channel = 0) => ({ format: 'mono', sources: [{ stream, channel }] })
const stereo = (left, right) => ({ format: 'stereo', sources: [{ stream: left[0], channel: left[1] }, { stream: right[0], channel: right[1] }] })

async function saved(page, file, matches, message, attempts = 300) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = readProject(file)
    if (matches(value)) return value
    await page.waitForTimeout(50)
  }
  assert.fail(message)
}

/** The samples, their ffprobe facts and every sound stream decoded by FFmpeg with soxr at 48kHz (the reference PCM). */
function prepare() {
  fs.mkdirSync(ROOT, { recursive: true })
  return Object.fromEntries(SAMPLES.map(sample => {
    const file = path.join(ROOT, sample.file)
    if (!fs.existsSync(file)) execFileSync(ffmpegPath, ['-v', 'error', '-y', ...sample.args, file], { windowsHide: true, timeout: 180000 })
    const probe = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true, encoding: 'utf8' }))
    const audio = probe.streams.filter(stream => stream.codec_type === 'audio')
    assert.deepEqual(audio.map(stream => stream.channels), sample.streams.map(stream => stream.length), `${sample.file} 声音流与设计不符`)
    const streams = audio.map((stream, index) => {
      const raw = execFileSync(ffmpegPath, ['-v', 'error', '-i', file, '-map', `0:a:${index}`, '-af', `aresample=${RATE}:resampler=soxr:precision=28`, '-f', 'f32le', '-'], { windowsHide: true, maxBuffer: 256 * 1024 * 1024 })
      // FFmpeg starts the output at the stream's first sample; place it on the absolute source timeline.
      const offset = Math.max(0, Math.round(Number(stream.start_time ?? 0) * RATE))
      const frames = raw.length / 4 / stream.channels
      return Array.from({ length: stream.channels }, (_, channel) => {
        const plane = new Float32Array(offset + frames)
        for (let index = 0; index < frames; index++) plane[offset + index] = raw.readFloatLE((index * stream.channels + channel) * 4)
        return plane
      })
    })
    return [sample.key, { ...sample, path: file, probe, audio, reference: streams }]
  }))
}

/** What the sequence must sound like: reference PCM routed by each clip's channel mapping (task 2.6 rules). */
function expectedMix(project, sequence, samples, totalSamples) {
  assert.equal(sequence.channels, 2)
  const fps = sequence.frameRate.numerator / sequence.frameRate.denominator
  const output = [new Float32Array(totalSamples), new Float32Array(totalSamples)]
  const tracks = new Map(sequence.tracks.map(track => [track.index, track]))
  const candidates = sequence.clips.filter(clip => (clip.kind === 'video' || clip.kind === 'audio') && clip.sourceComponent !== 'video' && clip.volume > 0)
  const solo = candidates.some(clip => { const track = tracks.get(clip.track); return track?.enabled && track.solo })
  for (const clip of candidates) {
    const track = tracks.get(clip.track)
    if (!track?.enabled || track.muted || (solo && !track.solo)) continue
    const media = project.media.find(media => media.id === project.items.find(item => item.id === clip.itemId)?.mediaId)
    const sample = Object.values(samples).find(value => path.resolve(value.path).toLowerCase() === path.resolve(media.path).toLowerCase())
    const plane = (stream, channel) => sample.reference[stream]?.[channel]
    // Per output channel: the source planes it adds (mono clips are centred at full level, as Premiere's standard tracks).
    const routes = clip.audioMapping
      ? clip.audioMapping.format === 'mono' ? [[plane(clip.audioMapping.sources[0].stream, clip.audioMapping.sources[0].channel)], [plane(clip.audioMapping.sources[0].stream, clip.audioMapping.sources[0].channel)]]
        : [[plane(clip.audioMapping.sources[0].stream, clip.audioMapping.sources[0].channel)], [plane(clip.audioMapping.sources[1].stream, clip.audioMapping.sources[1].channel)]]
      : [[plane(0, 0)], [plane(0, Math.min(1, sample.reference[0].length - 1))]]
    const first = Math.ceil(clip.start / fps * RATE - 1e-7); const last = Math.min(totalSamples, Math.ceil((clip.start + clip.duration) / fps * RATE - 1e-7))
    const inPoint = (clip.sourceInUs + clip.sourceRemainder.numerator / clip.sourceRemainder.denominator) / 1e6
    for (let s = first; s < last; s++) {
      const position = Math.floor((inPoint + s / RATE - clip.start / fps) * RATE + 0.5 + 1e-6)
      for (let channel = 0; channel < 2; channel++) for (const source of routes[channel]) if (source && position >= 0 && position < source.length) output[channel][s] += source[position] * clip.volume
    }
  }
  return output
}

/** Per-placement windows (clips placed together share a start). */
function windows(sequence) {
  const fps = sequence.frameRate.numerator / sequence.frameRate.denominator
  const starts = [...new Set(sequence.clips.filter(clip => clip.kind === 'audio' || clip.kind === 'video').map(clip => clip.start))].sort((a, b) => a - b)
  return starts.map(start => {
    const group = sequence.clips.filter(clip => clip.start === start)
    const end = Math.max(...group.map(clip => clip.start + clip.duration))
    return { start, from: Math.ceil(start / fps * RATE - 1e-7) + MAX_LAG, to: Math.ceil(end / fps * RATE - 1e-7) - MAX_LAG, clipSamples: Math.ceil(end / fps * RATE - 1e-7) - Math.ceil(start / fps * RATE - 1e-7), items: [...new Set(group.map(clip => clip.itemId))] }
  })
}

function correlation(actual, expected, lag, from, to, stride = 1) {
  let ab = 0; let aa = 0; let bb = 0
  for (let index = from; index < to; index += stride) {
    const a = actual[index]; const b = expected[index - lag] ?? 0
    ab += a * b; aa += a * a; bb += b * b
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0
}
function compareWindow(actual, expected, window) {
  return [0, 1].map(channel => {
    const a = actual[channel]; const b = expected[channel]
    let energy = 0; let actualPeak = 0
    for (let index = window.from; index < window.to; index++) { energy += b[index] * b[index]; actualPeak = Math.max(actualPeak, Math.abs(a[index])) }
    if (energy === 0) return { channel, silent: true, actualPeak }
    let best = { lag: 0, value: -Infinity }
    for (let lag = -MAX_LAG; lag <= MAX_LAG; lag += 4) { const value = correlation(a, b, lag, window.from, window.to, 4); if (value > best.value) best = { lag, value } }
    for (let lag = best.lag - 4; lag <= best.lag + 4; lag++) { const value = correlation(a, b, lag, window.from, window.to, 4); if (value > best.value) best = { lag, value } }
    let maxError = 0; let firstBad = -1; let lastBad = -1; let bad = 0; const runs = []
    for (let index = window.from; index < window.to; index++) {
      const error = Math.abs(a[index] - b[index]); maxError = Math.max(maxError, error)
      if (error > 1e-3) {
        bad++; if (firstBad < 0) firstBad = index - window.from; lastBad = index - window.from
        const at = index - window.from + MAX_LAG
        if (runs.length && runs.at(-1)[1] >= at - 8) runs.at(-1)[1] = at + 1; else if (runs.length < 32) runs.push([at, at + 1])
      }
    }
    return { channel, runs, badSamples: bad, firstBad, lastBad, windowSamples: window.to - window.from, bestLagSamples: best.lag, bestLagMs: best.lag / RATE * 1000, correlationAtBest: correlation(a, b, best.lag, window.from, window.to), correlationAtZero: correlation(a, b, 0, window.from, window.to), maxErrorAtZero: maxError, expectedRms: Math.sqrt(energy / (window.to - window.from)) }
  })
}
/**
 * Acceptance: correlation >= 0.98 and lag < 10ms everywhere. The native mix must equal the reference sample for sample
 * (zero lag, maximum error < 1e-3), AAC included from the first to the last frame (task 2.10: the native session decodes
 * the priming packet, so the decoder's state matches FFmpeg's full decode). Only an AAC clip whose source in-point lies
 * inside the stream gets `AAC_NOISE_TOLERANCE`: AAC perceptual noise substitution (PNS, on by default in FFmpeg's
 * encoder) fills noise bands from the decoder's random generator, whose state after a seek cannot equal the state of a
 * decode from the stream start (FFmpeg's `-ss` behaves the same); 2.10 measured at most 1.6e-3 on these signals.
 */
const AAC_NOISE_TOLERANCE = 2e-3
function assertMatches(results, label, exact) {
  for (const window of results) for (const channel of window.channels) {
    const where = `${label}：第 ${window.start} 帧起的片段组，声道 ${channel.channel}`
    if (channel.silent) { assert.ok(channel.actualPeak < 1e-4, `${where} 应为静音，实际峰值 ${channel.actualPeak}`); continue }
    assert.ok(channel.correlationAtBest >= 0.98, `${where} 相关系数 ${channel.correlationAtBest}`)
    assert.ok(Math.abs(channel.bestLagMs) < 10, `${where} 时差 ${channel.bestLagMs}ms`)
    if (!exact) continue
    assert.equal(channel.bestLagSamples, 0, `${where} 原生混音应逐样本对齐`)
    const tolerance = window.aacFromInside ? AAC_NOISE_TOLERANCE : 1e-3
    assert.ok(channel.maxErrorAtZero < tolerance, `${where} 最大误差 ${channel.maxErrorAtZero}（阈值 ${tolerance}）`)
  }
}
const unpack = base64 => { const bytes = Buffer.from(base64, 'base64'); return new Float32Array(new Uint8Array(bytes).buffer) }

/** The saved sequence as the render worker's composition: media addressed by fetchable URL, native paths alongside. */
function composition(project, sequence, revision, keep = () => true) {
  const url = media => `henji-media://local/${encodeURIComponent(media.path)}`
  const fps = sequence.frameRate.numerator / sequence.frameRate.denominator
  return {
    document: { ...sequence, clips: sequence.clips.filter(keep), width: Math.round(sequence.width * sequence.pixelAspectRatio.numerator / sequence.pixelAspectRatio.denominator), media: project.media.map(media => ({ ...media, path: url(media) })), items: project.items, revision, fps, ...(project.codeMaterials ? { codeMaterials: project.codeMaterials } : {}) },
    localPaths: Object.fromEntries(project.media.map(media => [url(media), media.path])),
  }
}

function createVideoEditMultitrackScene() {
  return {
    id: 'video-edit-multitrack', surface: '剪辑', name: '剪辑-多音轨铺轨、声道映射与 FFmpeg 参考 PCM 互相关', writesUserData: true,
    setup: async (page, app, { capture }) => {
      fs.mkdirSync(ROOT, { recursive: true })
      const file = path.join(ROOT, `multitrack-${Date.now()}.henji-video`)
      const evidence = { project: file, phases: [], mixes: [], captures: [] }
      const store = () => fs.writeFileSync(path.join(ROOT, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const phase = name => { evidence.currentPhase = name; store() }
      const shot = async name => { evidence.captures.push({ name, result: await capture(name) }); store() }
      let client; let previousLayout; let revision = 0; let harness = false
      // A placement group holding an AAC clip whose source in-point is inside the stream (PNS tolerance, see assertMatches).
      const aacFromInside = (current, clips, window) => clips.filter(clip => clip.start === window.start && (clip.sourceInUs > 0 || clip.sourceRemainder?.numerator > 0)).some(clip => {
        const media = current.media.find(media => media.id === current.items.find(item => item.id === clip.itemId).mediaId)
        return Object.values(samples).find(sample => path.resolve(sample.path).toLowerCase() === path.resolve(media.path).toLowerCase()).audio.some(stream => stream.codec_name === 'aac')
      })
      let samples
      const sessionsNow = async () => (await page.evaluate(() => window.henjiNative.videoFrames.stats())).native?.audioSessions ?? 0
      const closeHarness = async () => { if (harness) { harness = false; await page.evaluate(() => window.__henjiNativeAudio.close()) } }
      const openHarness = async () => { await closeHarness(); await installNativeMixHarness(page); harness = true }
      try {
        phase('生成多音轨样本与 FFmpeg soxr 参考 PCM')
        samples = prepare()
        evidence.samples = Object.values(samples).map(sample => ({ file: sample.path, streams: sample.audio.map(stream => ({ codec: stream.codec_name, channels: stream.channels, layout: stream.channel_layout ?? null, sampleRate: Number(stream.sample_rate), startTime: stream.start_time })) }))
        const originals = Object.values(samples).map(sample => ({ file: sample.path, hash: hash(sample.path) }))
        const status = await page.evaluate(() => window.henjiNative.videoDecoder.status())
        assert.equal(status.available, true, '本机原生解码服务应可用')
        await page.evaluate(dir => window.henjiNative.media.allowRoot(dir), ROOT)

        phase('导入：素材记录全部声音流')
        await button(page, '剪辑').click()
        if (await button(page, '关闭项目').isVisible()) await button(page, '关闭项目').click()
        previousLayout = await page.evaluate(() => localStorage.getItem('henji.videoEdit.dockLayout.v1'))
        await page.evaluate(() => localStorage.removeItem('henji.videoEdit.dockLayout.v1'))
        await dialogs(app, Object.values(samples).map(sample => sample.path), file)
        await button(page, '新建项目').click(); await button(page, '导入').click()
        let project = await saved(page, file, value => value.media.length === 4, '四个多音轨样本未全部导入')
        const itemOf = key => { const media = project.media.find(media => path.resolve(media.path).toLowerCase() === path.resolve(samples[key].path).toLowerCase()); return project.items.find(item => item.mediaId === media.id) }
        const items = Object.fromEntries(SAMPLES.map(sample => [sample.key, itemOf(sample.key)]))
        for (const sample of Object.values(samples)) {
          const media = project.media.find(media => path.resolve(media.path).toLowerCase() === path.resolve(sample.path).toLowerCase())
          assert.equal(media.hasAudio, true)
          assert.deepEqual(media.audioStreams, sample.audio.map(stream => ({ channels: stream.channels, sampleRate: Number(stream.sample_rate) })), `${sample.file} 声音流清单应与 ffprobe 一致`)
        }
        evidence.media = project.media; evidence.phases.push('导入记录全部声音流（与 ffprobe 一致）'); store()

        const identity = await authorizeMcpConnection(page, { name: '多音轨验收', allowWrites: true })
        client = await connectMcpClient(identity.config, 'Henji multitrack Reality')
        const projectRef = { kind: 'video_edit.project', id: project.id }
        const read = (ref, propertyIds) => callTool(client, 'read_application_entity', { ref, propertyIds })
        const change = async (ref, properties) => {
          const result = await callTool(client, 'change_application_entities', operationEnvelope([await read(ref, Object.keys(properties))], { summary: '多音轨验收', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties }] }))
          assert.equal(result.executionState, 'completed', JSON.stringify(result)); return result
        }
        const playhead = async frame => {
          await change(projectRef, { 'video_edit.project.program_playback': { frame, playing: false, playbackDirection: 1 } })
          assert.equal((await read(projectRef, ['video_edit.project.program_playback'])).data.properties['video_edit.project.program_playback'].frame, frame, '播放头未到达放置位置')
        }
        const append = async (key, frame, count) => {
          const before = readProject(file).sequences[0].clips.length
          await playhead(frame)
          await entry(page, items[key].id).click(); await entry(page, items[key].id).click({ button: 'right' }); await menuItem(page, '添加到当前序列').click()
          const value = await saved(page, file, document => document.sequences[0].clips.length === before + count, `${samples[key].file} 放入后应新增 ${count} 个片段`)
          // 5.5 VE-06：执行过的菜单必须立即退出交互（收起动画可能因窗口在后台被节流而停住，但不得再被点中）
          assert.equal(await page.evaluate(() => [...document.querySelectorAll('[role="menu"]')].filter(menu => !menu.closest('[inert]')).length), 0, '菜单项执行后菜单仍可交互')
          return { project: value, group: value.sequences[0].clips.filter(clip => clip.itemId === items[key].id && clip.start === frame) }
        }
        const assertGroup = (group, expected, label) => {
          const picture = group.filter(clip => clip.kind === 'video'); const sound = group.filter(clip => clip.kind === 'audio')
          assert.equal(picture.length, 1, `${label} 应有一个画面片段`); assert.equal(picture[0].sourceComponent, 'video'); assert.equal(picture[0].audioMapping, undefined)
          assert.deepEqual(sound.map(clip => [clip.sourceComponent, clip.track, clip.audioMapping ?? null]), expected, `${label} 音频片段`)
          assert.ok(picture[0].linkId && group.every(clip => clip.linkId === picture[0].linkId), `${label} 画面与全部音频片段应互相链接`)
          assert.ok(group.every(clip => clip.duration === picture[0].duration && clip.sourceInUs === 0), `${label} 各片段源范围应一致`)
        }

        phase('放入时间线：画面加每条声音流一个链接音频片段')
        let placed = await append('mxf', 0, 5)
        assertGroup(placed.group, [['audio', 0, null], ['audio', 8, mono(1)], ['audio', 9, mono(2)], ['audio', 10, mono(3)]], 'MXF 四条单声道')
        assert.deepEqual(placed.project.sequences[0].tracks.filter(track => track.kind === 'audio').map(track => [track.name, track.index]), [['音频 1', 0], ['音频 2', 8], ['音频 3', 9], ['音频 4', 10]])
        // OBS through a real drag onto picture track 1 at frame 135 (2px per frame).
        await trackRow(page, 1).scrollIntoViewIfNeeded()
        await page.locator('[data-video-edit-timeline-viewport]').evaluate(host => { host.scrollLeft = 0 })
        const beforeDrag = readProject(file).sequences[0].clips.length
        await entry(page, items.obs.id).dragTo(trackRow(page, 1), { targetPosition: { x: VIDEO_EDIT_TRACK_HEADER_WIDTH + 270, y: 16 }, timeout: 10000 })
        project = await saved(page, file, value => value.sequences[0].clips.length === beforeDrag + 3, 'OBS 拖入后应新增画面加两个立体声片段')
        assertGroup(project.sequences[0].clips.filter(clip => clip.itemId === items.obs.id), [['audio', 0, null], ['audio', 8, stereo([1, 0], [1, 1])]], 'OBS 双轨立体声（拖放）')
        assert.equal(project.sequences[0].clips.find(clip => clip.itemId === items.obs.id).start, 135)
        placed = await append('mov', 270, 3)
        assertGroup(placed.group, [['audio', 0, null], ['audio', 8, mono(1)]], 'MOV 立体声加单声道')
        placed = await append('single', 405, 2)
        assertGroup(placed.group, [['audio', 0, null]], '单条立体声的普通视频')
        project = placed.project
        assert.equal(project.sequences[0].tracks.length, 11, '只为 MXF 新增了三条音频轨')
        evidence.placements = project.sequences[0].clips.map(clip => ({ item: project.items.find(item => item.id === clip.itemId).name, kind: clip.kind, sourceComponent: clip.sourceComponent, track: clip.track, start: clip.start, linkId: clip.linkId, audioMapping: clip.audioMapping ?? null }))
        evidence.phases.push('四种素材铺轨与链接（菜单与真实拖放）'); store()

        phase('轨道头与波形显示声道类型')
        const viewport = page.locator('[data-video-edit-timeline-viewport]')
        await viewport.evaluate(host => { const row = host.querySelector('[data-track-kind="audio"]'); host.scrollTop = Math.max(0, row.offsetTop - 28); host.scrollLeft = 0 })
        const formatOf = clip => { const media = project.media.find(media => media.id === project.items.find(item => item.id === clip.itemId).mediaId); return clip.kind === 'video' && clip.sourceComponent === 'video' ? undefined : clip.audioMapping?.format ?? (media.audioStreams[0].channels === 1 ? 'mono' : 'stereo') }
        const expectedHeaders = Object.fromEntries(project.sequences[0].tracks.filter(track => track.kind === 'audio').map(track => { const formats = new Set(project.sequences[0].clips.filter(clip => clip.track === track.index).map(formatOf).filter(Boolean)); return [track.id, formats.size > 1 ? 'mixed' : [...formats][0]] }))
        const headers = await page.locator('[data-video-edit-track-channels]').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.closest('[data-video-edit-track]').getAttribute('data-video-edit-track'), node.getAttribute('data-video-edit-track-channels')])))
        assert.deepEqual(headers, expectedHeaders, '轨道头声道类型提示')
        evidence.trackHeaders = headers
        const visibleSound = project.sequences[0].clips.filter(clip => clip.kind === 'audio' && clip.start < 200)
        // The timeline mounts only the clips inside its viewport; a small window (960x640) shows two or three audio rows
        // at a time, so each row is scrolled into view before its waveform is read.
        const lanes = {}
        for (const clip of visibleSound) {
          await viewport.evaluate((host, track) => { const row = host.querySelector(`[data-track-index="${track}"]`); host.scrollTop = Math.max(0, row.offsetTop - 28); host.scrollLeft = 0 }, clip.track)
          const wave = page.locator(`[data-video-edit-waveform="${clip.id}"]`)
          await wave.waitFor({ state: 'attached', timeout: 30000 })
          lanes[clip.id] = Number(await wave.getAttribute('data-waveform-lanes'))
        }
        await viewport.evaluate(host => { const row = host.querySelector('[data-track-kind="audio"]'); host.scrollTop = Math.max(0, row.offsetTop - 28); host.scrollLeft = 0 })
        for (const clip of visibleSound) {
          const media = project.media.find(media => media.id === project.items.find(item => item.id === clip.itemId).mediaId)
          assert.equal(lanes[clip.id], clip.audioMapping ? clip.audioMapping.sources.length : Math.min(2, media.audioStreams[0].channels), `片段 ${clip.id} 波形条数`)
        }
        evidence.waveformLanes = lanes
        await page.waitForTimeout(500); await shot('multitrack-timeline-spread')
        evidence.phases.push('轨道头提示与按片段声道分条的波形'); store()

        const sequenceSeconds = sequence => Math.max(...sequence.clips.map(clip => clip.start + clip.duration)) * sequence.frameRate.denominator / sequence.frameRate.numerator
        const mix = async (label, forced = 'native', keep = () => true, exact = forced === 'native') => {
          const current = readProject(file); const sequence = current.sequences[0]
          const seconds = Math.ceil(sequenceSeconds(sequence) / BLOCK_SECONDS) * BLOCK_SECONDS
          const { document, localPaths } = composition(current, sequence, ++revision, keep)
          await openHarness()
          const mixed = await page.evaluate(({ document, decode, seconds, block }) => window.__henjiNativeAudio.mixPacked(document, decode, seconds, block), { document, decode: { nativeAvailable: true, forced, localPaths }, seconds, block: BLOCK_SECONDS })
          await closeHarness()
          const actual = mixed.channels.map(unpack); const total = actual[0].length
          const expected = expectedMix(current, { ...sequence, clips: sequence.clips.filter(keep) }, samples, total)
          const results = windows({ ...sequence, clips: sequence.clips.filter(keep) }).map(window => ({ start: window.start, clipSamples: window.clipSamples, aacFromInside: aacFromInside(current, sequence.clips.filter(keep), window), items: window.items.map(id => current.items.find(item => item.id === id).name), channels: compareWindow(actual, expected, window) }))
          evidence.mixes.push({ label, backend: forced, seconds, maxSessions: mixed.maxSessions, results }); store()
          assertMatches(results, label, exact)
          return results
        }

        phase('原生混音与 FFmpeg 参考 PCM 互相关（使用文件）')
        await mix('使用文件铺轨后整条序列')

        phase('轨道头静音、独奏与效果控件音量')
        await trackRow(page, 8).scrollIntoViewIfNeeded()
        await button(page, '音频 2静音').click(); await saved(page, file, value => value.sequences[0].tracks.find(track => track.index === 8).muted, '静音音频 2 未保存')
        await mix('静音音频 2')
        await button(page, '音频 2静音').click(); await button(page, '音频 3独奏').click()
        await saved(page, file, value => !value.sequences[0].tracks.find(track => track.index === 8).muted && value.sequences[0].tracks.find(track => track.index === 9).solo, '独奏音频 3 未保存')
        await mix('独奏音频 3')
        await shot('multitrack-solo')
        await button(page, '音频 3独奏').click(); await saved(page, file, value => !value.sequences[0].tracks.some(track => track.solo), '取消独奏未保存')
        const fourth = readProject(file).sequences[0].clips.find(clip => clip.start === 0 && clip.track === 10)
        await showTrack(page, fourth.track); await clipNode(page, fourth.id).scrollIntoViewIfNeeded()
        await page.keyboard.down('Alt')
        try { await clipNode(page, fourth.id).getByRole('button', { name: `选择片段 ${fourth.name}`, exact: true }).click() } finally { await page.keyboard.up('Alt') }
        assert.equal((await read(projectRef, ['video_edit.project.selection'])).data.properties['video_edit.project.selection'], fourth.id, 'Alt 点击应只选中音频 4 的片段')
        await page.locator('[aria-label="效果控件"]').getByLabel('音量', { exact: true }).fill('0.5')
        await saved(page, file, value => value.sequences[0].clips.find(clip => clip.id === fourth.id).volume === .5, '音频 4 片段音量未保存')
        await mix('音频 4 片段音量 0.5')
        evidence.phases.push('逐轨静音、独奏与片段音量在混音中逐一生效'); store()

        phase('项目项音频声道：只影响之后放入的片段')
        const clipsBefore = JSON.stringify(readProject(file).sequences[0].clips)
        await entry(page, items.mxf.id).click(); await entry(page, items.mxf.id).click({ button: 'right' }); await menuItem(page, '音频声道…').click()
        const presetSelect = page.getByLabel('音频声道预设', { exact: true })
        await presetSelect.waitFor({ state: 'visible', timeout: 15000 })
        assert.equal(await presetSelect.inputValue(), 'file')
        await presetSelect.selectOption('stereo')
        assert.equal(await page.getByLabel('音频片段数量', { exact: true }).inputValue(), '2')
        await page.waitForTimeout(300); await shot('multitrack-item-audio-channels')
        await button(page.getByRole('dialog'), '确定').click()
        project = await saved(page, file, value => value.items.find(item => item.id === items.mxf.id).audioChannels, 'MXF 项目项音频声道未保存')
        assert.deepEqual(project.items.find(item => item.id === items.mxf.id).audioChannels, [stereo([0, 0], [1, 0]), stereo([2, 0], [3, 0])])
        assert.equal(JSON.stringify(project.sequences[0].clips), clipsBefore, '已在时间线上的片段不应改变')
        placed = await append('mxf', 540, 3)
        assertGroup(placed.group, [['audio', 0, stereo([0, 0], [1, 0])], ['audio', 8, stereo([2, 0], [3, 0])]], 'MXF 两两合成立体声')
        await entry(page, items.obs.id).click(); await entry(page, items.obs.id).click({ button: 'right' }); await menuItem(page, '音频声道…').click()
        await presetSelect.waitFor({ state: 'visible', timeout: 15000 }); await presetSelect.selectOption('mono')
        await button(page.getByRole('dialog'), '确定').click()
        await saved(page, file, value => value.items.find(item => item.id === items.obs.id).audioChannels?.length === 4, 'OBS 项目项音频声道未保存')
        placed = await append('obs', 675, 5)
        assertGroup(placed.group, [['audio', 0, mono(0, 0)], ['audio', 8, mono(0, 1)], ['audio', 9, mono(1, 0)], ['audio', 10, mono(1, 1)]], 'OBS 两条立体声拆为四个单声道')
        evidence.phases.push('预设立体声两两合成、单声道拆分；已在时间线的片段不变'); store()

        phase('时间线片段音频声道：只改源声道')
        const second = readProject(file).sequences[0].clips.find(clip => clip.start === 0 && clip.track === 8)
        await viewport.evaluate(host => { host.scrollLeft = 0 })
        await showTrack(page, second.track); await clipNode(page, second.id).scrollIntoViewIfNeeded()
        await clipNode(page, second.id).click({ button: 'right' }); await menuItem(page, '音频声道…').click()
        const source = page.getByLabel('单声道源声道', { exact: true })
        await source.waitFor({ state: 'visible', timeout: 15000 })
        assert.equal(await source.inputValue(), '1:0'); assert.equal(await page.getByLabel('音频声道预设', { exact: true }).count(), 0)
        await source.selectOption('3:0'); await page.waitForTimeout(300); await shot('multitrack-clip-audio-channels')
        await button(page.getByRole('dialog'), '确定').click()
        project = await saved(page, file, value => JSON.stringify(value.sequences[0].clips.find(clip => clip.id === second.id).audioMapping) === JSON.stringify(mono(3)), '片段源声道未保存')
        await viewport.evaluate(host => { const row = host.querySelector('[data-track-kind="audio"]'); host.scrollTop = Math.max(0, row.offsetTop - 28) })
        await page.waitForTimeout(800); await shot('multitrack-after-mapping')
        evidence.phases.push('片段源声道改为声音流 4'); store()

        phase('修改映射后的原生混音与强制浏览器对照')
        await mix('修改映射后整条序列')
        const browserItems = new Set([items.obs.id, items.single.id])
        await mix('OBS 与普通 MP4（强制浏览器后端）', 'browser', clip => browserItems.has(clip.itemId))
        evidence.phases.push('原生与浏览器两种后端按同一声音流序号出声'); store()

        phase('导出音轨与期望互相关')
        const output = path.join(ROOT, `export-${Date.now()}.mp4`)
        await dialogs(app, [file], output)
        await button(page, '导出视频').click()
        await page.getByRole('button', { name: /^取消导出/ }).waitFor({ state: 'visible', timeout: 15000 })
        await button(page, '导出视频').waitFor({ state: 'visible', timeout: 300000 })
        const exported = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], { windowsHide: true, encoding: 'utf8' }))
        const exportedAudio = exported.streams.find(stream => stream.codec_type === 'audio'); assert.ok(exportedAudio, '导出文件应有音轨'); assert.equal(exportedAudio.channels, 2)
        const raw = execFileSync(ffmpegPath, ['-v', 'error', '-i', output, '-vn', '-ac', '2', '-ar', String(RATE), '-f', 'f32le', '-'], { windowsHide: true, maxBuffer: 512 * 1024 * 1024 })
        const frames = raw.length / 8; const exportedPlanes = [new Float32Array(frames), new Float32Array(frames)]
        for (let index = 0; index < frames; index++) { exportedPlanes[0][index] = raw.readFloatLE(index * 8); exportedPlanes[1][index] = raw.readFloatLE(index * 8 + 4) }
        project = readProject(file)
        const expectedExport = expectedMix(project, project.sequences[0], samples, frames)
        const exportResults = windows(project.sequences[0]).map(window => ({ start: window.start, clipSamples: window.clipSamples, channels: compareWindow(exportedPlanes, expectedExport, { ...window, to: Math.min(window.to, frames - MAX_LAG) }) }))
        evidence.export = { output, duration: Number(exported.format.duration), codec: exportedAudio.codec_name, sampleRate: Number(exportedAudio.sample_rate), results: exportResults }; store()
        assertMatches(exportResults, '导出', false)
        evidence.phases.push('导出音轨按映射与音量出声'); store()

        phase('源监视器播放多音轨素材的全部声音流')
        await entry(page, items.mxf.id).dblclick()
        await page.waitForFunction(() => document.querySelector('[data-video-edit-source-status]')?.dataset.videoEditSourceStatus === 'ready', undefined, { timeout: 30000 })
        const sourcePanel = page.locator('[data-video-edit-panel="source"]').first()
        await button(sourcePanel, '正向').click()
        await page.waitForFunction(() => [...(document.querySelector('[aria-label="源播放电平"]')?.querySelectorAll('[data-video-edit-level-channel]') ?? [])].some(node => Number(node.dataset.peak) > .01), undefined, { timeout: 15000 })
        let sessions = 0
        for (let attempt = 0; attempt < 100 && sessions < 4; attempt++) { sessions = (await page.evaluate(() => window.henjiNative.videoFrames.stats())).native?.audioSessions ?? 0; if (sessions < 4) await page.waitForTimeout(50) }
        evidence.sourceMonitor = { audioSessions: sessions, levels: await page.locator('[aria-label="源播放电平"] [data-video-edit-level-channel]').evaluateAll(nodes => nodes.map(node => ({ peak: Number(node.dataset.peak), rms: Number(node.dataset.rms) }))) }
        await shot('multitrack-source-monitor')
        assert.ok(sessions >= 4, `源监视器应为 MXF 的四条声音流各开一个原生声音会话，实际 ${sessions}`)
        await button(sourcePanel, '停止').click(); await button(page, '关闭源监视器').click()
        evidence.phases.push('源监视器读取全部四条声音流并出声'); store()

        phase('旧工程：无声音流清单、画面声音合一片段')
        await button(page, '关闭项目').click()
        const legacyFile = path.join(ROOT, 'legacy.henji-video')
        const legacy = {
          format: 'henji-video-project', version: 2, id: 'multitrack-legacy', name: '2.6 之前的旧工程', revision: 0,
          media: [{ id: 'legacy-media', name: samples.mxf.file, path: samples.mxf.path, kind: 'video', width: 1280, height: 720, durationSeconds: 4, hasAudio: true, frameRate: { numerator: 30, denominator: 1 }, frameRateMode: 'sampled-constant' }],
          bins: [], items: [{ id: 'legacy-item', name: samples.mxf.file, kind: 'video', mediaId: 'legacy-media' }],
          sequences: [{ id: 'legacy-sequence', name: '序列 1', width: 1280, height: 720, frameRate: { numerator: 30, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
            tracks: Array.from({ length: 8 }, (_, index) => ({ id: `legacy-track-${index}`, name: index ? `视频 ${index}` : '音频 1', index, kind: index ? 'video' : 'audio', locked: false, enabled: true, muted: false, solo: false })),
            clips: [{ id: 'legacy-clip', itemId: 'legacy-item', name: samples.mxf.file, kind: 'video', track: 1, start: 0, duration: 120, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: '' }], annotations: [] }],
        }
        fs.writeFileSync(legacyFile, JSON.stringify(legacy)); const legacyHash = hash(legacyFile)
        await dialogs(app, [legacyFile], legacyFile); await button(page, '打开项目文件').click(); await presented(page, 0)
        await page.waitForTimeout(1500)
        assert.equal(hash(legacyFile), legacyHash, '打开旧工程不应改写文件')
        const legacyComposition = composition(legacy, legacy.sequences[0], ++revision)
        const baselineSessions = await sessionsNow()
        await openHarness()
        const legacyMix = await page.evaluate(({ document, decode, seconds, block }) => window.__henjiNativeAudio.mixPacked(document, decode, seconds, block), { document: legacyComposition.document, decode: { nativeAvailable: true, forced: 'native', localPaths: legacyComposition.localPaths }, seconds: 4, block: BLOCK_SECONDS })
        await closeHarness()
        const legacyActual = legacyMix.channels.map(unpack)
        const legacyResults = windows(legacy.sequences[0]).map(window => ({ start: window.start, clipSamples: window.clipSamples, channels: compareWindow(legacyActual, expectedMix(legacy, legacy.sequences[0], samples, legacyActual[0].length), window) }))
        evidence.legacy = { file: legacyFile, unchangedAfterOpen: true, baselineSessions, maxSessions: legacyMix.maxSessions, results: legacyResults }; store()
        assertMatches(legacyResults, '旧工程合一片段（只播放第一条声音流）', true)
        assert.equal(legacyMix.maxSessions - baselineSessions, 1, '旧工程合一片段只打开第一条声音流')
        await shot('multitrack-legacy-project')
        await button(page, '关闭项目').click()
        assert.equal(hash(legacyFile), legacyHash, '关闭旧工程后文件不应改变')
        for (const original of originals) assert.equal(hash(original.file), original.hash, `${original.file} 原素材不应改变`)
        let remaining = -1
        for (let attempt = 0; attempt < 100 && remaining !== 0; attempt++) { remaining = await sessionsNow(); if (remaining !== 0) await page.waitForTimeout(50) }
        evidence.sessionsAfterClose = remaining; assert.equal(remaining, 0, '关闭工程与混音后应释放全部原生声音会话')
        evidence.phases.push('旧工程无迁移、只播放第一条声音流；原素材未改变')
        evidence.completed = true; delete evidence.currentPhase; store()
      } catch (error) {
        evidence.failed = { message: String(error.message ?? error), stack: error.stack }; store()
        await capture('multitrack-failed').catch(() => {})
        throw error
      } finally {
        await page.keyboard.up('Alt').catch(() => {})
        await closeHarness().catch(() => {})
        if (client) await client.close().catch(() => {}); await disableMcp(page).catch(() => {})
        if (await button(page, '关闭项目').isVisible().catch(() => false)) await button(page, '关闭项目').click().catch(() => {})
        await page.evaluate(previous => { if (previous === null) localStorage.removeItem('henji.videoEdit.dockLayout.v1'); else if (typeof previous === 'string') localStorage.setItem('henji.videoEdit.dockLayout.v1', previous) }, previousLayout).catch(() => {})
        store()
      }
    },
  }
}
module.exports = { createVideoEditMultitrackScene }
