const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')
const { execFileSync } = require('node:child_process')
const { ffmpegPath, ffprobePath } = require('./mediaBinaries.cjs')
const { openVideoEditFixture, readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope, readAllMedia } = require('./uiInspectionMcpClient.cjs')
const { observeWorkers, workerSnapshot } = require('./uiInspectionSceneVideoEditLayout.cjs')

/** Exercise production creation, monitor, observation and export, without a second renderer. */
async function runAuthorTimeline(page, app, { capture, root, spec, project, sourceFiles, source, adaptations }) {
  assert.ok(await app.evaluate(() => Boolean(process.env.HENJI_ISOLATED_APP_DATA)), '正式作者验收必须使用隔离资料目录')
  const evidence = { adaptations, completed: false }
  const store = () => fs.writeFileSync(path.join(root, 'formal-evidence.json'), JSON.stringify(evidence, null, 2))
  const parameters = { ...spec.params }
  for (const [key, file] of Object.entries({ ...spec.assets, ...(spec.filterInput ? { input: spec.filterInput } : {}) })) {
    const metadata = await sharp(file).metadata()
    const mediaId = `author-${key}`
    project.media.push({ id: mediaId, name: key, path: file, kind: 'image', width: metadata.width, height: metadata.height, durationSeconds: 0 })
    project.items.push({ id: `${mediaId}-item`, name: key, kind: 'image', mediaId })
    if (!spec.filterInput) parameters[key] = { kind: 'image', mediaId }
  }
  await observeWorkers(page)
  const seeded = await openVideoEditFixture(page, project)
  evidence.project = seeded
  const documentRef = { kind: 'video_edit.document', id: seeded.documentId }
  const sequenceRef = { kind: 'video_edit.sequence', id: `${seeded.documentId}:${project.sequences[0].id}` }
  let client
  try {
    const identity = await authorizeMcpConnection(page, { name: '作者 JS 正式链路', allowWrites: true, allowDestructive: true })
    client = await connectMcpClient(identity.config, 'Henji author timeline Reality')
    const change = async changes => {
      const refs = [...new Map(changes.map(change => { const ref = change.target ?? change.parent; return [`${ref.kind}:${ref.id}`, ref] })).values()]
      const baselines = await Promise.all(refs.map(ref => callTool(client, 'read_application_entity', { ref })))
      const result = await callTool(client, 'change_application_entities', operationEnvelope(baselines, { summary: '作者 JS 正式链路验收', changes }))
      assert.equal(result.verificationState, 'verified', JSON.stringify(result))
      return result
    }
    const files = sourceFiles ?? { entry: 'effect.js', files: { 'effect.js': source } }
    files.files['timeline.js'] = `import effect from './${files.entry}'; export default {...effect,width:${spec.width},height:${spec.height},durationSeconds:${spec.duration}};`
    const started = performance.now()
    await change([{ kind: 'create_items', entityType: 'video_edit.code_material', parent: documentRef, items: [{ properties: { 'video_edit.code_material.files': files.files, 'video_edit.code_material.entry': 'timeline.js' } }] }])
    evidence.creationMs = performance.now() - started
    const createdDocument = readVideoEditFile(seeded.file)
    const material = createdDocument.items.find(item => spec.filterInput ? item.id === 'author-input-item' : item.kind === 'code')
    assert.ok(material, '正式创建未写入代码素材')
    await change([{ kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: [{ properties: {
      'video_edit.clip.item_id': material.id, 'video_edit.clip.name': material.name, 'video_edit.clip.kind': material.kind,
      'video_edit.clip.start': 0, 'video_edit.clip.duration': Math.ceil(spec.duration * 60), 'video_edit.clip.track': 1,
      ...(!spec.filterInput ? { 'video_edit.clip.code_parameters': parameters } : {}),
    } }] }])
    if (spec.filterInput) {
      const clip = readVideoEditFile(seeded.file).sequences[0].clips.find(value => value.itemId === material.id)
      const parent = { kind: 'video_edit.clip', id: `${seeded.documentId}:${clip.id}` }
      await change([{ kind: 'create_items', entityType: 'video_edit.effect', parent, items: [{ properties: { 'video_edit.effect.definition_id': createdDocument.codeMaterials[0].id, 'video_edit.effect.parameters': parameters } }] }])
    }
    const frame = Math.round(spec.time * 60)
    const playback = (frame, playing) => change([{ kind: 'set_properties', entityType: documentRef.kind, target: documentRef, properties: { 'video_edit.document.program_playback': { frame, playing, playbackDirection: 1 } } }])
    await playback(frame, false)
    const canvas = page.locator('canvas[aria-label="剪辑画面"]')
    await page.waitForFunction(frame => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === String(frame), frame, { timeout: 60000 })
    const png = await canvas.evaluate(canvas => canvas.toDataURL('image/png'))
    fs.writeFileSync(path.join(root, 'formal-preview.png'), Buffer.from(png.split(',')[1], 'base64'))
    evidence.preview = await canvas.evaluate(canvas => ({ width: canvas.width, height: canvas.height, frame: canvas.dataset.presentedFrame, divisor: canvas.dataset.renderDivisor }))
    assert.equal(evidence.preview.width, spec.width); assert.equal(evidence.preview.height, spec.height)
    await capture('author-formal-preview')
    if (spec.parameterChange) {
      const clip = readVideoEditFile(seeded.file).sequences[0].clips.find(value => value.itemId === material.id)
      const target = { kind: 'video_edit.clip', id: `${seeded.documentId}:${clip.id}` }
      await change([{ kind: 'set_properties', entityType: target.kind, target, properties: { 'video_edit.clip.code_parameters': spec.parameterChange } }])
      await page.waitForFunction(previous => document.querySelector('canvas[aria-label="剪辑画面"]')?.toDataURL('image/png') !== previous, png, { timeout: 30000 })
      evidence.parameterChange = true
      await change([{ kind: 'set_properties', entityType: target.kind, target, properties: { 'video_edit.clip.code_parameters': parameters } }])
      await page.waitForFunction(previous => document.querySelector('canvas[aria-label="剪辑画面"]')?.toDataURL('image/png') === previous, png, { timeout: 30000 })
    }
    const observed = await callTool(client, 'observe_video_edit_frame', { documentRef, target: { kind: 'program', sequenceRef, frame }, maxWidth: spec.width })
    assert.ok(observed.data?.verification?.verified, JSON.stringify(observed))
    const media = await readAllMedia(client, observed.data.resultRef, { chunkBytes: 65536 })
    fs.writeFileSync(path.join(root, 'formal-observation.png'), media.bytes)
    evidence.observation = observed.data
    const marker = await page.evaluate(() => performance.now())
    await playback(frame, true)
    await page.waitForFunction(last => Number(document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame) >= last, frame + spec.frames - 1, { timeout: 60000 })
    await playback(frame, false)
    const snapshot = await workerSnapshot(page)
    const owners = new Set(snapshot.workers.filter(worker => worker.direct && worker.sequenceId === project.sequences[0].id).map(worker => worker.id))
    const samples = snapshot.events.filter(event => owners.has(event.worker) && event.kind === 'render.completed' && event.at >= marker && event.frame > frame && event.frame < frame + spec.frames && event.presented)
    const unique = [...new Map(samples.map(sample => [sample.frame, sample])).values()]
    assert.ok(unique.length >= spec.frames - 2, '正式回放未完成预期帧')
    const durations = unique.map(sample => sample.elapsedMs).sort((a, b) => a - b)
    const ordered = [...unique].sort((a, b) => a.at - b.at)
    const intervals = ordered.slice(1).map((sample, index) => sample.at - ordered[index].at).sort((a, b) => a - b)
    evidence.playback = { samples: unique, warmP95Ms: durations[Math.ceil(durations.length * .95) - 1], completionIntervalP95Ms: intervals[Math.ceil(intervals.length * .95) - 1], completedFps: (ordered.length - 1) * 1000 / (ordered.at(-1).at - ordered[0].at), note: '请求到 GPU 完成延迟与连续完成间隔分开报告，非物理屏幕呈现' }
    store()
    const baseline = await callTool(client, 'read_application_entity', { ref: documentRef })
    const exportStarted = performance.now()
    const exported = await callTool(client, 'export_video_edit', operationEnvelope([baseline], { documentRef, range: { startFrame: frame, endFrame: frame + spec.frames }, settings: { format: 'mp4', width: spec.width, height: spec.height, fps: 60, videoBitrateMbps: 60, audioBitrateKbps: 192, fit: 'fit', loudness: null, encoderPreference: 'software', audioEnabled: false, addToLibrary: false } }))
    const jobId = (exported.data ?? exported.result?.data)?.queue?.[0]?.id; assert.ok(jobId, JSON.stringify(exported))
    let job
    for (let attempt = 0; attempt < 240; attempt++) {
      job = (await callTool(client, 'query_video_edit_export', { documentRef, taskId: jobId, detail: 'full' })).data.queue.find(value => value.id === jobId)
      if (job && ['completed', 'failed', 'cancelled'].includes(job.state)) break
      await page.waitForTimeout(500)
    }
    assert.equal(job?.state, 'completed', JSON.stringify(job))
    assert.ok(job.path && fs.existsSync(job.path))
    const output = path.join(root, 'formal-export.mp4')
    fs.copyFileSync(job.path, output)
    const video = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-of', 'json', output], { encoding: 'utf8', windowsHide: true })).streams.find(stream => stream.codec_type === 'video')
    assert.equal(Number(video.nb_frames), spec.frames); assert.equal(video.width, spec.width); assert.equal(video.height, spec.height)
    const exportFrame = path.join(root, 'formal-export.png')
    execFileSync(ffmpegPath, ['-v', 'error', '-y', '-i', output, '-frames:v', '1', exportFrame], { windowsHide: true, timeout: 60000 })
    evidence.export = { ...job, path: output, elapsedMs: performance.now() - exportStarted, video }
    evidence.previewObservation = await compareFrames(path.join(root, 'formal-preview.png'), path.join(root, 'formal-observation.png'))
    evidence.exportDifference = await compareFrames(exportFrame, path.join(root, 'formal-observation.png'))
    if (spec.reference) {
      evidence.candidateDifference = await compareFrames(path.join(root, 'formal-observation.png'), spec.reference)
    }
    if (spec.prReference) evidence.prDifference = await compareFrames(path.join(root, 'formal-observation.png'), spec.prReference)
    // Keep all comparisons when one fails, so the failure can be localized without rerendering.
    store()
    assert.ok(internalComparisonPasses(evidence.previewObservation), '内部一致性超出用户标准：最大差 2/255、差异像素 0.01%')
    assert.ok(evidence.exportDifference.psnr === null || evidence.exportDifference.psnr >= 30, '有损成片应与正式观察保持同帧内容')
    if (spec.reference) assert.ok(internalComparisonPasses(evidence.candidateDifference), '候选与正式链路超出用户内部一致性标准')
    if (spec.prReference) assert.ok(prComparisonPasses(evidence.prDifference), 'PR 对照超出用户数值标准；仍需检查边缘分布、目视画面及正常速度播放')
    evidence.completed = true; store()
  } finally { store(); await client?.close(); await disableMcp(page) }
}
async function compareFrames(actual, expected) {
  const read = file => sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const [a, b] = await Promise.all([read(actual), read(expected)])
  assert.deepEqual(a.info, b.info)
  let maximumDelta = 0, absolute = 0, squared = 0, equalPixels = 0
  for (let index = 0; index < a.data.length; index += 4) {
    let equal = true
    for (let channel = 0; channel < 3; channel++) {
      // Candidate PNGs retain alpha, whereas the program monitor composites on
      // opaque black. Compare the same displayed RGB, not straight-alpha RGB.
      const delta = Math.abs(Math.round(a.data[index + channel] * a.data[index + 3] / 255) - Math.round(b.data[index + channel] * b.data[index + 3] / 255))
      maximumDelta = Math.max(maximumDelta, delta); absolute += delta; squared += delta * delta
      if (delta) equal = false
    }
    if (equal) equalPixels++
  }
  const channels = a.data.length * 3 / 4
  return { comparison: 'RGB composited over opaque black (nearest 8-bit)', maximumDelta, meanAbsoluteDelta: absolute / channels, identicalPixelPercent: equalPixels * 400 / a.data.length, psnr: squared ? 10 * Math.log10(255 ** 2 / (squared / channels)) : null }
}
// User-authorized 2026-10-20 tolerances. These numeric gates do not certify
// spatial visibility, normal-speed flicker or unmeasured encoded-export fidelity.
function internalComparisonPasses(value) {
  return value.maximumDelta <= 2 && value.identicalPixelPercent >= 99.99
}
function prComparisonPasses(value) {
  return value.meanAbsoluteDelta <= .1 && value.identicalPixelPercent >= 95 && value.maximumDelta <= 16
}
module.exports = { runAuthorTimeline, compareFrames, internalComparisonPasses, prComparisonPasses }
