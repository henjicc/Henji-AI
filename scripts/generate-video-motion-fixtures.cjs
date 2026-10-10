const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { loadTypeScript } = require('./check-persistence-compat.cjs')
const { createMotionFixture } = loadTypeScript('src/core/creativeIntent/fixtures/motionFixtures.ts')
const { optimizeMotionDraft } = loadTypeScript('src/core/creativeIntent/candidates.ts')
const { scoreMotionFixture } = loadTypeScript('src/core/creativeIntent/fixtures/scoring.ts')
const { motionClipBase, motionClipGeometry } = loadTypeScript('src/core/videoEdit/motionDraft.ts')
const root = path.resolve(__dirname, '../tests/fixtures/persistence')
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const encoded = value => Buffer.from(JSON.stringify(value))
if (process.argv.includes('--package')) {
  const { ZipArchive } = require('archiver')
  const { openZip, iterateEntries, readEntryBytes } = loadTypeScript('electron/main/services/zip-archive.ts')
  const filename = path.join(root, 'project-package/v1.henjipack')
  const rewrite = async () => {
    const input = await openZip(filename); let entries = []
    try { for await (const entry of iterateEntries(input)) if (!entry.fileName.endsWith('/')) entries.push({ name: entry.fileName, bytes: await readEntryBytes(input, entry, entry.fileName) }) } finally { input.close() }
    entries = entries.filter(entry => !['content/素材/golden-motion-page.json', 'content/素材/golden-motion-candidate.json'].includes(entry.name))
    const envelope = JSON.parse(fs.readFileSync(path.join(root, 'document.video_edit/v2.json'), 'utf8'))
    const video = entries.find(entry => entry.name.endsWith('.henji-video'))
    const previous = JSON.parse(video.bytes.toString('utf8'))
    // Preserve package-relative code locations and the package document identity.
    envelope.content.codeMaterials = previous.content.codeMaterials; envelope.id = previous.id
    const oldId = envelope.content.creativeIntents.drafts[0].ownerRef.id
    for (const [id, name] of [['creative-intent-page', 'golden-motion-page.json'], ['creative-intent-candidate', 'golden-motion-candidate.json']]) {
      const value = JSON.parse(fs.readFileSync(path.join(root, id, 'v1.json'), 'utf8'))
      entries.push({ name: `content/素材/${name}`, bytes: encoded(value) })
    }
    // Keep the original document ID; rewriting refs would also require re-signing every immutable page.
    envelope.id = oldId; video.bytes = encoded(envelope)
    const manifest = entries.find(entry => entry.name === 'henji-package.json'); const value = JSON.parse(manifest.bytes.toString('utf8'))
    for (const doc of value.documents) if (doc.id === previous.id) doc.id = oldId
    manifest.bytes = encoded(value)
    const project = entries.find(entry => entry.name.endsWith('/.henji/project.json'))
    if (project) { const value = JSON.parse(project.bytes.toString('utf8')); if (value.mainVideoEditId === previous.id) value.mainVideoEditId = oldId; project.bytes = encoded(value) }
    const temporary = `${filename}.t144.tmp`
    await new Promise((resolve, reject) => { const output = fs.createWriteStream(temporary, { flags: 'wx' }); const archive = new ZipArchive(); output.on('close', resolve); output.on('error', reject); archive.on('error', reject); archive.pipe(output); for (const entry of entries) archive.append(entry.bytes, { name: entry.name }); archive.finalize().catch(reject) })
    fs.renameSync(temporary, filename)
  }
  rewrite().catch(error => { console.error(error); process.exitCode = 1 }); return
}
if (process.argv.includes('--baseline')) {
  const { snapshot, updateBaseline, fixtureVersions } = require('./check-persistence-compat.cjs')
  const filename = path.resolve(__dirname, '../src/core/persistence/schemaBaseline.json')
  const baseline = JSON.parse(fs.readFileSync(filename, 'utf8'))
  const ids = ['document.video_edit', 'creative-intent-page', 'creative-intent-candidate']
  const current = snapshot().filter(f => ids.includes(f.id))
  const isolated = { ...baseline, formats: Object.fromEntries(Object.entries(baseline.formats).filter(([id]) => ids.includes(id))), devBreaks: baseline.devBreaks.filter(b => ids.includes(b.format)) }
  const next = updateBaseline(current, isolated, { devBreak: ['document.video_edit'], reason: 't144 剪辑超级关键帧草稿与不可变页接线，开发期采用新格式', waiveBefore: true }, id => fixtureVersions(path.resolve(__dirname, '..'), id))
  baseline.formats = { ...baseline.formats, ...next.formats }; baseline.devBreaks.push(...next.devBreaks.slice(isolated.devBreaks.length))
  fs.writeFileSync(filename, JSON.stringify(baseline, null, 2) + '\n'); process.exit(0)
}
const fixture = createMotionFixture('S15')
console.log(JSON.stringify(scoreMotionFixture(fixture, optimizeMotionDraft(fixture.input).candidates[0])))
const envelope = JSON.parse(fs.readFileSync(path.join(root, 'document.video_edit/v1.json'), 'utf8'))
envelope.kindVersion = 2
const sequence = envelope.content.sequences[0]; const clip = sequence.clips[0]; clip.duration = 420
const oldId = fixture.input.draft.ownerRef.id
const replace = value => {
  if (Array.isArray(value)) return value.map(replace)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, key === 'id' && typeof value.kind === 'string' ? value.kind === 'document.video_edit' ? envelope.id : value.kind === 'video_edit.clip' ? `${envelope.id}:${clip.id}` : value.kind === 'video_edit.sequence' ? `${envelope.id}:${sequence.id}` : entry : key === 'visitRef' && typeof entry === 'string' ? entry.replace(oldId, envelope.id) : replace(entry)]))
}
const draft = replace(fixture.input.draft); const samples = replace(fixture.input.samples)
draft.targets[0].baseDigest = hash(encoded(motionClipBase(clip)))
draft.targets[0].geometryDigest = hash(encoded(motionClipGeometry({ ...sequence, media: envelope.content.media, items: envelope.content.items, sequences: envelope.content.sequences }, clip)))
draft.targets[0].compositionSize = [sequence.width, sequence.height]
const page = { version: 1, kind: 'samples', ownerRef: draft.ownerRef, sourceDigest: draft.sourceDigest, monoSpanUs: [samples[0].monoUs, samples.at(-1).monoUs], seqSpan: [samples[0].seq, samples.at(-1).seq], count: samples.length, entries: samples }
const pageResource = { resourceId: 'golden-motion-page', digest: hash(encoded(page)), bytes: encoded(page).length, path: 'henji:/素材/golden-motion-page.json', kind: 'page', sourceDigest: page.sourceDigest }
draft.takes[0].samplePages = [{ resourceId: pageResource.resourceId, digest: pageResource.digest, bytes: pageResource.bytes, kind: 'samples', count: page.count, monoSpanUs: page.monoSpanUs, seqSpan: page.seqSpan }]
draft.sourceDigest = hash(encoded({ ...draft, sourceDigest: undefined, candidateRefs: [], selectedCandidateRef: undefined, applications: [] }))
const mappings = Object.fromEntries(draft.takes.map(t => [t.id, { positionToNative: [1, 0, 0, 1, -.5, -.5], pivotToNative: [1, 0, 0, 1, 0, 0], clipStart: clip.start, scaleFactor: 1, rotationOffsetDegrees: 0 }]))
const candidate = { version: 1, ...optimizeMotionDraft({ draft, samples, mappings }).candidates[0] }
const resource = { resourceId: 'golden-motion-candidate', digest: hash(encoded(candidate)), bytes: encoded(candidate).length, path: 'henji:/素材/golden-motion-candidate.json', kind: 'candidate' }
draft.candidateRefs = [{ resourceId: resource.resourceId, digest: resource.digest, bytes: resource.bytes }]; draft.selectedCandidateRef = resource.resourceId
envelope.content.creativeIntents = { drafts: [draft], sessions: [], resources: [pageResource, resource] }
for (const [id, version, value] of [['document.video_edit', 2, envelope], ['creative-intent-page', 1, page], ['creative-intent-candidate', 1, candidate]]) {
  const directory = path.join(root, id); fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, `v${version}.json`), JSON.stringify(value, null, 2) + '\n', { flag: process.argv.includes('--refresh') ? 'w' : 'wx' })
}
