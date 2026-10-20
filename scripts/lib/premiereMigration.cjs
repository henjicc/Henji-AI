const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const runFile = promisify(execFile)
const TICKS = 254016000000n
const api = () => loadTypeScript('scripts/lib/premiereMigrationModel.ts')
const stable = (prefix, value) => `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`
const seconds = ticks => Number(BigInt(ticks)) / Number(TICKS)
const rateOf = seq => ({ numerator: 254016000000 / Number(seq.frameTicks), denominator: 1 })
const frameAt = (ticks, rate) => Math.round(seconds(ticks) * rate.numerator / rate.denominator)
const initial = (parameter, fallback) => parameter?.StartKeyframe?.split(',')[1] ?? fallback
const trackMuted = track => /<(?:IsMuted|Mute)>true<\//.test(track.xml)
  || (track.effects ?? []).some(effect => effect.matchName === 'AudioFader'
    && initial(effect.parameters.find(parameter => parameter.Name === '静音'), 'false') === 'true')

function sourceTime(ticks) {
  const scaled = BigInt(ticks) * 1000000n
  let numerator = scaled % TICKS, denominator = TICKS
  const gcd = (a, b) => b ? gcd(b, a % b) : a
  const divisor = gcd(numerator, denominator); numerator /= divisor; denominator /= divisor
  return { sourceInUs: Number(scaled / TICKS), sourceRemainder: { numerator: Number(numerator), denominator: Number(denominator) } }
}

/** Probe real files, bounded to four processes; deduplicate aliases by absolute path. */
async function probeMigrationMedia(graph, cacheFile) {
  const { ffprobePath } = require('./mediaBinaries.cjs')
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {}
  const paths = [...new Set(graph.media.map(media => media.path).filter(file => file && path.isAbsolute(file)))]
  const result = new Map()
  let cursor = 0
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < paths.length) {
      const file = paths[cursor++], stat = fs.statSync(file), key = `${stat.size}:${stat.mtimeMs}`
      let probe = cache[file]?.key === key ? cache[file].probe : undefined
      if (!probe) {
        const { stdout } = await runFile(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 })
        probe = JSON.parse(stdout); cache[file] = { key, probe }
      }
      result.set(file, probe)
    }
  }))
  fs.writeFileSync(cacheFile, JSON.stringify(cache))
  return result
}

function buildPremiereMigration(graph, probes, options) {
  const { createVideoEditDocument, createVideoEditSequence, videoEditDocumentSchema, videoEditSpeedRatio, videoEditTransitionAlignmentFields } = api()
  const document = createVideoEditDocument(options.name)
  document.id = options.documentId
  document.bins = [{ id: 'migration-sources', name: '原始素材' }, { id: 'migration-sequences', name: '可编辑场景' }, { id: 'migration-reference', name: '成片对照' }]
  const rawSequences = new Map(graph.sequences.map(seq => [seq.id, seq]))
  const rawMedia = new Map(graph.media.map(media => [media.id, media]))
  const sequenceId = id => stable('sequence', id)
  const clipId = id => stable('clip', id)
  const itemByPath = new Map(), mediaByRaw = new Map()
  const evidence = { source: graph.source, limitations: [], timing: [], statistics: {}, globalLimitations: [
    '字幕正文与时间来自最终PR工程；字体、字号、描边与排版尚未映射，当前使用原生默认字幕样式。',
    '尚未将既有转写的词时间绑定到剪后的声音来源；当前可按字幕文字定位，不能据此声称词级内容剪辑已验收。',
    '原始素材保持外部引用；尚未收集为可整体搬走的独立素材包。',
    '时间线和嵌套基础结构保留供核对；尚未把所有PR载体与效果整理为最终的原生语义对象。',
    '声音的最终响度、音乐自动化和拼接接缝尚未对照最终成片完成试听验收。',
  ] }
  const createdAt = new Date().toISOString()
  const mark = (sequence, raw, text, clip, frame, end) => {
    const startFrame = frame ?? frameAt(raw.start, sequence.frameRate)
    const endFrame = end ?? Math.max(startFrame, frameAt(raw.end, sequence.frameRate) - 1)
    const id = stable('annotation', `${sequence.id}:${raw.id}:${text}:${startFrame}`)
    if (sequence.annotations.some(item => item.id === id)) return
    sequence.annotations.push({ id, ...(clip ? { clipId: clip.id } : {}), frame: startFrame, endFrame,
      space: 'composition-normalized', target: { kind: 'range', startFrame, endFrame, ...(clip ? { clipIds: [clip.id] } : {}) },
      text, status: 'open', author: { kind: 'external', name: '工程迁移' }, createdAt, thread: [] })
    evidence.limitations.push({ sequenceId: sequence.id, sourceClipId: raw.id, frame: startFrame, text })
  }
  for (const raw of graph.media) {
    if (!raw.path || !path.isAbsolute(raw.path)) continue
    const probe = probes.get(raw.path)
    if (!probe) throw new Error(`Missing media probe: ${raw.path}`)
    let item = itemByPath.get(raw.path)
    if (!item) {
      const video = probe.streams.find(stream => stream.codec_type === 'video')
      const hasAudio = probe.streams.some(stream => stream.codec_type === 'audio')
      const still = raw.streams.VideoStream?.IsStill === 'true'
      const kind = video ? still ? 'image' : 'video' : 'audio'
      const media = { id: stable('media', raw.path), name: raw.name, path: raw.path, kind,
        durationSeconds: kind === 'image' ? 0 : Number(probe.format.duration ?? video?.duration),
        width: video?.width ?? 0, height: video?.height ?? 0, hasAudio }
      if (kind === 'video') {
        const [numerator, denominator] = (video.avg_frame_rate !== '0/0' ? video.avg_frame_rate : video.r_frame_rate).split('/').map(Number)
        media.frameRate = { numerator, denominator }; media.frameRateMode = 'unknown'
      }
      document.media.push(media)
      item = { id: stable('item', raw.path), name: raw.name, kind, mediaId: media.id, binId: 'migration-sources' }
      document.items.push(item); itemByPath.set(raw.path, item)
    }
    mediaByRaw.set(raw.id, document.media.find(media => media.id === item.mediaId))
  }
  // Audio-only nested compositions are flattened to grouped editable sound
  // clips: the formal model places sequence clips on visual tracks only.
  const visuals = graph.sequences.filter(seq => seq.id === graph.mainSequenceId || seq.tracks.some(track => track.kind === 'video'))
  for (const raw of visuals) {
    const sequence = createVideoEditSequence(raw.name)
    const rect = raw.frameRect.split(',').map(Number)
    sequence.id = sequenceId(raw.id); sequence.width = rect[2] - rect[0]; sequence.height = rect[3] - rect[1]
    sequence.frameRate = rateOf(raw); sequence.binId = 'migration-sequences'
    sequence.tracks = raw.tracks.filter(track => track.kind !== 'caption').map(track => ({
      id: stable('track', track.id), index: track.kind === 'audio' ? track.index : raw.tracks.filter(value => value.kind === 'audio').length + track.index,
      name: track.name ?? `${track.kind === 'audio' ? '声音' : '画面'} ${track.index + 1}`, kind: track.kind,
      enabled: true, locked: false, muted: trackMuted(track), solo: false,
    }))
    document.sequences.push(sequence)
    document.items.push({ id: stable('sequence-item', raw.id), name: raw.name, kind: 'sequence', sequenceId: sequence.id, binId: 'migration-sequences' })
  }
  const applyEffects = (sequence, raw, clip, picture) => {
    let volume = raw.muted ? 0 : 1
    for (const effect of raw.effects) {
      if (effect.matchName === 'AE.ADBE Motion') {
        const params = effect.parameters, get = (label, fallback) => initial(params.find(param => param.Name === label), fallback)
        const fit = Math.min(sequence.width / picture.width, sequence.height / picture.height)
        const [x, y] = get('位置', '0.5:0.5').split(':').map(Number)
        const [anchorX, anchorY] = get('锚点', '0.5:0.5').split(':').map(Number)
        Object.assign(clip, { x: x - .5, y: y - .5, anchorX, anchorY, scale: Number(get('缩放', '100')) / 100 / fit, rotation: Number(get('旋转', '0')) })
        if (params.some(param => param.Keyframes) || get(' ', 'true') !== 'true' || params.some(param => param.Name?.startsWith('裁剪') && Number(initial(param, '0')) !== 0)) mark(sequence, raw, '复核原运动效果的动画、裁剪或非等比缩放。', clip)
      } else if (effect.matchName === 'AE.ADBE Lumetri') {
        const basic = { 7: 'temperature', 8: 'tint', 11: 'exposure', 12: 'contrast', 13: 'highlights', 14: 'shadows', 15: 'whites', 16: 'blacks', 20: 'saturation' }
        const params = {}
        for (const [id, key] of Object.entries(basic)) {
          const parameter = effect.parameters.find(value => value.ParameterID === id)
          const value = Number(initial(parameter, key === 'saturation' ? '100' : '0'))
          if (!Number.isFinite(value)) throw new Error(`Invalid Lumetri ${id} on ${raw.id}`)
          params[key] = key === 'saturation' ? value - 100 : value
          if (parameter?.Keyframes) mark(sequence, raw, `Lumetri ${parameter.Name} 动画尚待还原。`, clip)
        }
        ;(clip.effects ??= []).push({ id: stable('effect', effect.id), name: '全能调色', enabled: true, amount: 1, builtin: { id: 'color_grade', params } })
      } else if (effect.matchName === 'Internal Volume Stereo') {
        const level = effect.parameters.find(param => param.Name === '级别')
        volume *= Number(initial(level, '1'))
        if (level?.Keyframes) mark(sequence, raw, '音乐音量自动化尚待还原，目前保留起始音量。', clip)
      } else if (effect.matchName === 'Internal Channel Volume Stereo') {
        const left = Number(initial(effect.parameters.find(param => param.Name === '左侧'), '1'))
        const right = Number(initial(effect.parameters.find(param => param.Name === '右侧'), '1'))
        if (left !== right) mark(sequence, raw, '左右声道音量不同，尚待还原声道平衡。', clip)
        volume *= left
      } else mark(sequence, raw, effect.matchName === 'AE.FrameFlow Bridge' ? '待迁移代码画面：保留原始素材与时间，尚未还原此处的生成画面或聚焦效果。' : `待适配画面效果：${effect.name}。`, clip)
    }
    clip.volume = raw.muted ? 0 : volume
    if (raw.muted) clip.opacity = 0
  }
  const makeClip = (sequence, raw, trackIndex, identity = raw.id) => {
    let item, picture
    if (raw.sequenceId) {
      item = document.items.find(item => item.sequenceId === sequenceId(raw.sequenceId))
      const nested = document.sequences.find(seq => seq.id === sequenceId(raw.sequenceId)); picture = nested
    } else {
      const media = mediaByRaw.get(raw.mediaId)
      item = media && document.items.find(item => item.mediaId === media.id); picture = media
    }
    if (!item) {
      mark(sequence, raw, `待重建生成画面：${raw.name}。原工程中的虚拟载体保留为空白，尚未还原代码效果。`)
      return undefined
    }
    const start = frameAt(raw.start, sequence.frameRate), end = frameAt(raw.end, sequence.frameRate)
    if (end <= start) throw new Error(`Clip ${raw.id} is shorter than a sequence frame`)
    const isAudio = raw.type === 'AudioClipTrackItem'
    const kind = isAudio && item.kind === 'video' ? 'audio' : item.kind
    const clip = { id: clipId(identity), itemId: item.id, name: raw.name, kind, track: trackIndex, start, duration: end - start,
      ...sourceTime(raw.reverse ? raw.out : raw.in), x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }
    if (item.kind === 'video') clip.sourceComponent = isAudio ? 'audio' : 'video'
    if (!isAudio && picture?.width) clip.scale = 1 / Math.min(sequence.width / picture.width, sequence.height / picture.height)
    const speed = Number(raw.speed)
    if (speed !== 1) clip.speed = videoEditSpeedRatio(Math.abs(speed))
    if (raw.reverse) clip.reverse = true
    if (raw.preservePitch) clip.preservePitch = true
    if (raw.muted) { clip.opacity = 0; clip.volume = 0 }
    applyEffects(sequence, raw, clip, picture)
    // A PR video sequence source never also plays the sequence's sound.
    if (item.kind === 'sequence' && !isAudio) clip.volume = 0
    sequence.clips.push(clip)
    for (const [field, ticks, actual] of [['start', raw.start, start], ['end', raw.end, end]]) {
      const errorMs = (actual / sequence.frameRate.numerator - seconds(ticks)) * 1000
      if (Math.abs(errorMs) > .001) evidence.timing.push({ sourceClipId: raw.id, field, errorMs })
    }
    return clip
  }
  const addTransitions = (sequence, rawTrack, byRaw, suffix = '') => {
    for (const raw of rawTrack.transitions) {
      const left = rawTrack.clips.find(clip => clip.tailTransition === raw.id)
      const right = rawTrack.clips.find(clip => clip.headTransition === raw.id)
      const leftClip = left && byRaw.get(left.id), rightClip = right && byRaw.get(right.id)
      const kind = { 'Constant Power': 'constant_power', 'ADBE Cross Dissolve': 'cross_dissolve' }[raw.matchName]
      if (!kind || !leftClip && !rightClip) { mark(sequence, raw, '待还原原工程转场。'); continue }
      const durationFrames = frameAt(raw.end, sequence.frameRate) - frameAt(raw.start, sequence.frameRate)
      if (durationFrames < 2) { mark(sequence, raw, '原转场短于两帧，待核对。'); continue }
      const alignment = videoEditTransitionAlignmentFields(durationFrames, Math.max(0, Math.min(durationFrames, frameAt(raw.alignment, sequence.frameRate))))
      ;(sequence.transitions ??= []).push({ id: stable('transition', `${raw.id}${suffix}`), kind, durationFrames, ...alignment,
        ...(leftClip ? { leftClipId: leftClip.id } : {}), ...(rightClip ? { rightClipId: rightClip.id } : {}) })
    }
  }
  for (const rawSeq of visuals) {
    const sequence = document.sequences.find(seq => seq.id === sequenceId(rawSeq.id))
    for (const track of rawSeq.tracks) {
      if (track.kind === 'caption') {
        sequence.captions = track.clips.map(raw => ({ id: stable('caption', raw.id), start: frameAt(raw.start, sequence.frameRate), duration: frameAt(raw.end, sequence.frameRate) - frameAt(raw.start, sequence.frameRate), text: raw.text }))
        continue
      }
      const nativeTrack = sequence.tracks.find(value => value.id === stable('track', track.id))
      const byRaw = new Map()
      for (const raw of track.clips) {
        if (track.kind === 'audio' && raw.sequenceId) {
          // Flatten only simple one-track, unity-speed audio compositions. Any
          // other shape fails explicitly, instead of accidentally doubling audio.
          const nested = rawSequences.get(raw.sequenceId)
          const children = nested.tracks.filter(value => value.kind === 'audio' && value.clips.length)
          if (children.length > 1 || Number(raw.speed) !== 1 || raw.reverse) throw new Error(`Audio nesting needs explicit adaptation: ${raw.id}`)
          const childTrack = children[0], childByRaw = new Map()
          if (!childTrack) continue
          const inTick = BigInt(raw.in), endTick = inTick + BigInt(raw.end) - BigInt(raw.start)
          for (const child of childTrack.clips) {
            const from = BigInt(child.start) > inTick ? BigInt(child.start) : inTick
            const to = BigInt(child.end) < endTick ? BigInt(child.end) : endTick
            if (to <= from) continue
            if (child.sequenceId || Number(child.speed) !== 1 || child.reverse) throw new Error(`Recursive/retimed audio nesting needs explicit adaptation: ${child.id}`)
            const moved = { ...child, muted: child.muted || raw.muted || trackMuted(childTrack), start: String(BigInt(raw.start) + from - inTick), end: String(BigInt(raw.start) + to - inTick), in: String(BigInt(child.in) + from - BigInt(child.start)), effects: [...child.effects, ...raw.effects] }
            const clip = makeClip(sequence, moved, nativeTrack.index, `${raw.id}:${child.id}`)
            if (clip) { clip.groupId = stable('music-group', raw.id); childByRaw.set(child.id, clip) }
          }
          addTransitions(sequence, childTrack, childByRaw, raw.id)
          mark(sequence, raw, '已转为可编辑的音乐拼接组；内部切点与交叉淡化按序列帧对齐，需对照成片试听。')
          continue
        }
        const clip = makeClip(sequence, raw, nativeTrack.index)
        if (clip) byRaw.set(raw.id, clip)
      }
      addTransitions(sequence, track, byRaw)
    }
    sequence.markers = rawSeq.markers.map(marker => ({ id: stable('marker', `${rawSeq.id}:${marker.mMarkerID}`), frame: frameAt(String(marker.mStartTime.ticks), sequence.frameRate), name: (marker.mName || marker.mComment || '原工程标记').slice(0, 200) }))
  }
  // Keep the main sequence first. V4 can be added as a separate reference item,
  // never as a substitute clip in the editable timeline.
  document.sequences.sort((a, b) => a.id === sequenceId(graph.mainSequenceId) ? -1 : b.id === sequenceId(graph.mainSequenceId) ? 1 : 0)
  if (options.referencePath) {
    const item = itemByPath.get(options.referencePath)
    if (!item || item.kind !== 'video') throw new Error('The comparison movie must be a probed video file')
    item.binId = 'migration-reference'
    const media = document.media.find(media => media.id === item.mediaId)
    const reference = createVideoEditSequence('V4 成片对照')
    reference.id = 'migration-v4-reference'; reference.width = media.width; reference.height = media.height
    reference.frameRate = media.frameRate; reference.binId = 'migration-reference'
    reference.clips = [{ id: 'migration-v4-reference-clip', itemId: item.id, name: item.name, kind: 'video', track: 1, start: 0,
      duration: Math.round(media.durationSeconds * reference.frameRate.numerator / reference.frameRate.denominator), sourceInUs: 0,
      sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }]
    document.sequences.push(reference)
    document.items.push({ id: 'migration-v4-reference-item', name: reference.name, kind: 'sequence', sequenceId: reference.id, binId: 'migration-reference' })
  }
  const parsed = videoEditDocumentSchema.parse(document)
  evidence.statistics = { media: parsed.media.length, sequences: parsed.sequences.length, clips: parsed.sequences.reduce((sum, seq) => sum + seq.clips.length, 0), captions: parsed.sequences[0].captions?.length ?? 0, mainDurationFrames: Math.max(0, ...parsed.sequences[0].clips.map(clip => clip.start + clip.duration)), pending: evidence.limitations.length }
  return { document: parsed, evidence }
}

module.exports = { buildPremiereMigration, probeMigrationMedia, sourceTime, stable }
