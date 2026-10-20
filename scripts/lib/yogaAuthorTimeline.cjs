const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const sharp = require('sharp')
const { stable, sourceTime } = require('./premiereMigration.cjs')
const { readYogaAuthors, yogaInstanceParameters } = require('./yogaAuthorMigration.cjs')
const { loadTypeScript } = require('../check-persistence-compat.cjs')

/** Assemble the actual PR instances using the already verified author bundles. */
async function buildYogaAuthorTimeline(base, graph, sourceRoot, preparedRoot) {
  const document = structuredClone(base.document)
  document.id = stable('document', `yoga-author:${graph.source.sha256}`)
  document.name = '联想YOGA · 作者原代码'
  const effects = await readYogaAuthors(sourceRoot)
  const { videoEditDocumentSchema, videoEditTransitionAlignmentFields } = loadTypeScript('scripts/lib/premiereMigrationModel.ts')
  const packages = [], instances = []
  const restoredTransitions = new Set()
  const restoredVolume = new Set()
  document.codeMaterials = []
  document.bins.push({ id: 'yoga-authors', name: '原代码效果' })
  for (const rawSequence of graph.sequences) {
    const sequence = document.sequences.find(value => value.id === stable('sequence', rawSequence.id))
    if (!sequence) continue
    const fps = sequence.frameRate.numerator / sequence.frameRate.denominator
    for (const track of rawSequence.tracks) for (const raw of track.clips) {
      const bridges = raw.effects.filter(effect => effect.matchName === 'AE.FrameFlow Bridge')
      if (!bridges.length) continue
      const nativeTrack = sequence.tracks.find(value => value.id === stable('track', track.id))
      assert.ok(nativeTrack && track.kind === 'video')
      let clip = sequence.clips.find(value => value.id === stable('clip', raw.id))
      if (!clip) {
        assert.equal(raw.name, '调整图层', `未知虚拟载体：${raw.name}`)
        const itemId = stable('adjustment', raw.id)
        document.items.push({ id: itemId, name: raw.name, kind: 'adjustment', binId: 'yoga-authors' })
        clip = { id: stable('clip', raw.id), itemId, name: raw.name, kind: 'adjustment', track: nativeTrack.index,
          start: Math.round(Number(raw.start) / 254016000000 * fps),
          duration: Math.round(Number(raw.end) / 254016000000 * fps) - Math.round(Number(raw.start) / 254016000000 * fps),
          ...sourceTime(raw.in), x: 0, y: 0, scale: 1, rotation: 0, opacity: raw.muted ? 0 : 1, volume: 0, text: '',
          adjustment: { fromTrack: Math.min(...sequence.tracks.filter(value => value.kind === 'video').map(value => value.index)) } }
        sequence.clips.push(clip)
      }
      for (const [index, bridge] of bridges.entries()) {
        const id = bridge.parameters.find(parameter => parameter.Name === '实例 ID')?.StartKeyframe.split(',')[1]
        const effect = effects.find(value => value.id === id)
        assert.ok(effect, `原代码包缺失：${id}`)
        const spec = JSON.parse(fs.readFileSync(path.join(preparedRoot, id, 'input.json'), 'utf8').replace(/^\uFEFF/, ''))
        const files = Object.fromEntries(Object.entries(spec.sourceFiles).map(([name, file]) => [name, fs.readFileSync(file, 'utf8')]))
        assert.equal(files['original.js'], effect.source, `已验证原包已过期：${id}`)
        const definitionId = stable('author', `${rawSequence.id}:${raw.id}:${index}`)
        const versionId = stable('version', definitionId)
        // Filters retain the carrier's source range (often starting at 3600s).
        // Their rendering clock is adapted below, but metadata must cover that source range.
        const seconds = effect.kind === 'filter'
          ? Math.max(Number(raw.out) / 254016000000, Number(raw.in) / 254016000000 + clip.duration / fps) + 1 / fps
          : clip.duration / fps
        const dimensions = `width:${sequence.width},height:${sequence.height},durationSeconds:${seconds}`
        // PR CUDA receives sequence time; the formal effect receives source time.
        // Adapt the clock at the author boundary without touching the original shader tables.
        files['timeline.js'] = effect.kind === 'filter'
          ? `import effect from './${spec.entry}';export default {...effect,${dimensions},async createWebGPU(device){const runtime=await effect.createWebGPU(device);return {...runtime,draw(target,t,p,w,h,a,info,inputs){const time=info.clip.time+${clip.start / fps};return runtime.draw(target,time,p,w,h,a,{...info,time},inputs);}};}};`
          : `import effect from './${spec.entry}';export default {...effect,${dimensions}};`
        const bindings = yogaInstanceParameters(effect, bridge, sourceRoot)
        const parameters = { ...bindings.params }
        for (const [key, file] of Object.entries(bindings.assets)) {
          let media = document.media.find(value => path.resolve(value.path) === path.resolve(file))
          if (!media) {
            const metadata = await sharp(file).metadata()
            media = { id: stable('media', file), name: path.basename(file), path: file, kind: 'image', width: metadata.width, height: metadata.height, durationSeconds: 0 }
            document.media.push(media)
            document.items.push({ id: stable('item', file), name: media.name, kind: 'image', mediaId: media.id, binId: 'yoga-authors' })
          }
          parameters[key] = { kind: 'image', mediaId: media.id }
        }
        const code = { definitionId, versionId, parameters }
        // Temporary absolute references are replaced by writeCodeVersion before publication.
        const references = Object.entries(files).map(([name, source]) => ({ path: name, location: path.resolve(preparedRoot, id, name), hash: crypto.createHash('sha256').update(source).digest('hex') }))
        document.codeMaterials.push({ id: definitionId, name: effect.name, defaultVersionId: versionId,
          versions: [{ id: versionId, apiVersion: 4, languageVersion: 4, entry: 'timeline.js', files: references }] })
        packages.push({ definitionId, name: effect.name, contents: { entry: 'timeline.js', files } })
        if (effect.kind === 'generator') {
          assert.equal(bridges.length, 1, '多个生成器需要明确合成顺序')
          assert.equal(clip.kind, 'image', '生成器只能替换已核对的透明载体')
          const itemId = stable('author-item', definitionId)
          document.items.push({ id: itemId, name: effect.name, kind: 'code', code: structuredClone(code), binId: 'yoga-authors' })
          Object.assign(clip, { itemId, name: effect.name, kind: 'code', code, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } })
        } else {
          ;(clip.effects ??= []).push({ id: stable('effect', definitionId), name: effect.name, enabled: true, amount: 1, code })
        }
        instances.push({ sourceId: id, sourceClipId: raw.id, sequenceId: sequence.id, clipId: clip.id, kind: effect.kind,
          clock: effect.kind === 'filter' ? 'sequence' : 'clip-local', originalHash: effect.hash, definitionId })
      }
      sequence.annotations = sequence.annotations.filter(annotation => !annotation.text.startsWith('待迁移代码画面') && !(annotation.frame === clip.start && annotation.text.startsWith('待重建生成画面')))
    }
    for (const track of rawSequence.tracks) for (const raw of track.transitions) {
      if (raw.matchName !== 'AE.ADBE Cross Dissolve New') continue
      const left = track.clips.find(value => value.tailTransition === raw.id)
      const right = track.clips.find(value => value.headTransition === raw.id)
      const leftClip = left && sequence.clips.find(value => value.id === stable('clip', left.id))
      const rightClip = right && sequence.clips.find(value => value.id === stable('clip', right.id))
      assert.ok(leftClip || rightClip, `交叉溶解缺少片段：${raw.id}`)
      const frames = ticks => Math.round(Number(ticks) / 254016000000 * fps)
      const durationFrames = frames(raw.end) - frames(raw.start)
      ;(sequence.transitions ??= []).push({
        id: stable('transition', raw.id), kind: 'cross_dissolve', durationFrames,
        ...videoEditTransitionAlignmentFields(durationFrames, frames(raw.alignment)),
        ...(leftClip ? { leftClipId: leftClip.id } : {}), ...(rightClip ? { rightClipId: rightClip.id } : {}),
      })
      restoredTransitions.add(raw.id)
      sequence.annotations = sequence.annotations.filter(value => value.id !== stable('annotation', `${sequence.id}:${raw.id}:待还原原工程转场。:${frames(raw.start)}`))
    }
    for (const track of rawSequence.tracks.filter(value => value.kind === 'audio')) for (const raw of track.clips) {
      const level = raw.effects.find(value => value.matchName === 'Internal Volume Stereo')?.parameters.find(value => value.Name === '级别')
      if (!level?.Keyframes) continue
      const clip = sequence.clips.find(value => value.id === stable('clip', raw.id))
      assert.ok(clip, `音量自动化未找到直接声音片段：${raw.id}`)
      const rows = level.Keyframes.split(';').filter(Boolean).map(row => row.split(',').map(Number))
      assert.equal(rows.length, 2, '当前 YOGA 音量包络应为两个关键帧')
      const slope = (rows[1][1] - rows[0][1]) / ((rows[1][0] - rows[0][0]) / 254016000000)
      assert.ok(Math.abs(rows[0][6] - slope) < 1e-9 && Math.abs(rows[1][4] - slope) < 1e-9, '非线性音量曲线需要另行适配')
      const gain = clip.volume / Number(level.StartKeyframe.split(',')[1])
      clip.curves = { ...clip.curves, volume: rows.map(row => ({
        time: Math.round((row[0] - Number(raw.in)) / 254016000000 * fps),
        value: row[1] * gain, interpolation: 'linear',
      })) }
      restoredVolume.add(raw.id)
      sequence.annotations = sequence.annotations.filter(value => value.clipId !== clip.id || !value.text.startsWith('音乐音量自动化'))
    }
  }
  return { document: videoEditDocumentSchema.parse(document), packages, instances,
    remaining: base.evidence.limitations.filter(value => !/待迁移代码画面|待重建生成画面/.test(value.text) && !restoredTransitions.has(value.sourceClipId) && !restoredVolume.has(value.sourceClipId)), source: graph.source }
}

module.exports = { buildYogaAuthorTimeline }
