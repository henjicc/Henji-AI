import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createVideoEditDocument, createVideoEditSequence, videoEditDocumentSchema, type VideoEditMedia } from '../../src/core/videoEdit/document'
import { makeVideoEditItemClip } from '../../src/core/videoEdit/projectItems'
import { compileCodeMaterial } from '../../src/core/videoEdit/codeMaterial/compiler'

/** Rebuild the monitor inputs with the same constructors used by persistence golden fixtures. */
export function createMonitorFixtures(root: string, media: VideoEditMedia[], original: VideoEditMedia, sources: string[]) {
  const project = createVideoEditDocument('源范围与字幕真实混剪')
  project.id = 'monitor-mixed'
  project.media = structuredClone(media)
  project.items = media.map(value => ({ id: `item-${value.id}`, name: value.name, kind: value.kind, mediaId: value.id }))
  const sequence = createVideoEditSequence('4K60 音画与字幕')
  Object.assign(sequence, { id: 'monitor-sequence', width: 3840, height: 2160, frameRate: { numerator: 60, denominator: 1 } })
  sequence.captions = []; sequence.markers = []
  sequence.tracks = Array.from({ length: 8 }, (_, index) => ({ id: `monitor-track-${index}`, index,
    name: index === 0 ? '单声道声音' : index === 1 ? '立体声声音' : index === 7 ? '源声音目标' : index === 6 ? '源画面目标' : `画面 ${index}`,
    kind: [0, 1, 7].includes(index) ? 'audio' : 'video', locked: false, enabled: true, muted: false, solo: false, height: 32, syncLocked: true }))
  project.sequences = [sequence]
  for (const item of project.items) {
    const clip = makeVideoEditItemClip(project, item.id, sequence.id, { frame: 0, duration: 180, track: item.kind === 'audio' ? 0 : item.kind === 'video' ? 2 : 3 })
    if (item.kind === 'video') clip.volume = 0
    if (item.kind === 'image') Object.assign(clip, { scale: .18, x: .32, y: -.3 })
    sequence.clips.push(clip)
  }
  project.codeMaterials = sources.map((source, index) => {
    const program = compileCodeMaterial(source)
    const id = `monitor-code-${index}`; const versionId = `${id}-version`
    const folder = path.join(root, 'code-fixture', id, versionId)
    mkdirSync(folder, { recursive: true })
    const location = path.join(folder, 'main.ts'); writeFileSync(location, source)
    const code = { definitionId: id, versionId, parameters: Object.fromEntries(program.parameters.map(value => [value.key, value.default])) }
    const item = { id: `${id}-item`, name: program.name, kind: 'code' as const, code }
    project.items.push(item)
    sequence.clips.push(makeVideoEditItemClip(project, item.id, sequence.id, { frame: 0, duration: 180, track: 5 - index }, () => program))
    return { id, name: program.name, defaultVersionId: versionId, versions: [{ id: versionId, apiVersion: 1 as const,
      languageVersion: program.languageVersion, entry: 'main.ts', files: [{ path: 'main.ts', location, hash: createHash('sha256').update(source).digest('hex') }] }] }
  })
  const pressure = createVideoEditDocument('监视器32轨500片段原素材4K60')
  pressure.id = 'monitor-pressure'; pressure.media = [structuredClone(original)]
  pressure.items = [{ id: 'pressure-video', name: original.name, kind: 'video', mediaId: original.id }, { id: 'pressure-text', name: '文字', kind: 'text' }]
  const pressureSequence = createVideoEditSequence('原素材4K60')
  Object.assign(pressureSequence, { id: 'monitor-pressure-sequence', width: 3840, height: 2160, frameRate: { numerator: 60, denominator: 1 } })
  pressureSequence.tracks = Array.from({ length: 32 }, (_, index) => ({ id: `monitor-pressure-track-${index}`, name: index ? `视频 ${index}` : '音频 1', index,
    kind: index ? 'video' : 'audio', locked: false, enabled: true, muted: false, solo: false, height: 32, syncLocked: true }))
  pressure.sequences = [pressureSequence]
  const base = makeVideoEditItemClip(pressure, 'pressure-video', pressureSequence.id, { frame: 0, duration: 360, track: 1 })
  Object.assign(base, { id: 'base', volume: 0 })
  const text = makeVideoEditItemClip(pressure, 'pressure-text', pressureSequence.id, { frame: 0, duration: 360, track: 3 })
  Object.assign(text, { id: 'text', text: '4K60', y: -.35, scale: .5 })
  pressureSequence.clips = [base, { ...base, id: 'overlay', name: '4K60 叠加', track: 2, sourceInUs: 1000000, x: .3, y: .3, scale: .3 }, text,
    ...Array.from({ length: 497 }, (_, index) => ({ ...base, id: `monitor-offscreen-${index}`, start: 3600 + index * 4, duration: 2, track: 31 }))]
  pressureSequence.captions = Array.from({ length: 500 }, (_, index) => ({ id: `monitor-caption-${index}`, start: 7200 + index * 2, duration: 1, text: `范围字幕 ${index}` }))
  return { project: videoEditDocumentSchema.parse(project), pressure: videoEditDocumentSchema.parse(pressure) }
}
