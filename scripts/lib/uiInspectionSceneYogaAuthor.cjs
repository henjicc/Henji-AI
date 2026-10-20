const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { ffprobePath } = require('./mediaBinaries.cjs')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { openVideoEditProjectCard, leaveVideoEditProject, readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope, readAllMedia } = require('./uiInspectionMcpClient.cjs')
const { compareFrames, internalComparisonPasses, prComparisonPasses } = require('./uiInspectionSceneAuthorTimeline.cjs')
const { observeWorkers, workerSnapshot } = require('./uiInspectionSceneVideoEditLayout.cjs')

/** Whole-project acceptance through the same persisted sources and native application APIs. */
async function runYogaAuthorTimeline(page, app, { capture, root, spec }) {
  assert.ok(await app.evaluate(() => Boolean(process.env.HENJI_ISOLATED_APP_DATA)), '先在隔离资料目录验收完整工程')
  const prepared = JSON.parse(fs.readFileSync(spec.yogaTimeline, 'utf8'))
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(prepared.source.path)).digest('hex'), prepared.source.sha256, 'PR 原工程已变化')
  const model = prepared.document
  const { createVideoEditDocument } = loadTypeScript('scripts/lib/premiereMigrationModel.ts')
  const empty = createVideoEditDocument(model.name)
  const { format: _f, version: _v, id: _id, revision: _r, name: _n, ...emptyContent } = empty
  const evidence = { completed: false, frames: [], instances: prepared.instances, remaining: prepared.remaining }
  const save = () => fs.writeFileSync(path.join(root, 'timeline-evidence.json'), JSON.stringify(evidence, null, 2))
  let client
  try {
    const created = await page.evaluate(async ({ model, emptyContent, packages }) => {
      const api = window.henjiNative.documents
      const project = await api.createProject({ name: model.name })
      const result = await api.createDocument({ id: model.id, kind: 'video_edit', container: { kind: 'project', projectId: project.id }, name: model.name, content: emptyContent })
      for (const pkg of packages) {
        const written = await api.writeCodeVersion({ target: { id: model.id }, ...pkg })
        const definition = model.codeMaterials.find(value => value.id === pkg.definitionId)
        definition.folder = written.folder
        definition.versions[0].files = written.files
      }
      const { format, version, id, name, revision, ...content } = model
      await api.saveDocument({ target: { id }, expectedRevision: result.meta.revision, content })
      await api.setProjectMainDocument({ projectId: project.id, documentId: id })
      return { projectId: project.id, documentId: id, file: result.meta.path, projectPath: project.path }
    }, { model, emptyContent, packages: prepared.packages })
    evidence.project = created; save()
    if (spec.playFullTimeline) await observeWorkers(page)
    try { await openVideoEditProjectCard(page, created.projectId) } catch (error) {
      await capture('yoga-open-failed')
      evidence.openText = await page.locator('body').innerText()
      throw error
    }
    if (spec.mcpPort) {
      await disableMcp(page)
      await page.evaluate(port => window.henjiNative.mcp.configure({ enabled: true, port }), spec.mcpPort)
    }
    const identity = await authorizeMcpConnection(page, { name: 'YOGA 完整时间线验收', allowWrites: true, allowDestructive: false })
    client = await connectMcpClient(identity.config, 'Henji YOGA author timeline')
    const documentRef = { kind: 'video_edit.document', id: created.documentId }
    const sequenceRef = { kind: 'video_edit.sequence', id: `${created.documentId}:${model.sequences[0].id}` }
    const playback = async (frame, playing = false) => {
      const baseline = await callTool(client, 'read_application_entity', { ref: documentRef })
      return callTool(client, 'change_application_entities', operationEnvelope([baseline], { summary: '核对 YOGA 实际时间线', changes: [{
        kind: 'set_properties', entityType: documentRef.kind, target: documentRef,
        properties: { 'video_edit.document.program_playback': { frame, playing, playbackDirection: 1 } },
      }] }))
    }
    for (const frame of spec.timelineFrames) {
      try {
      await playback(frame)
      await page.waitForFunction(frame => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === String(frame), frame, { timeout: 120000 })
      const canvas = page.locator('canvas[aria-label="剪辑画面"]')
      const png = await canvas.evaluate(canvas => canvas.toDataURL('image/png'))
      const output = path.join(root, `preview-${frame}.png`)
      fs.writeFileSync(output, Buffer.from(png.split(',')[1], 'base64'))
      await capture(`yoga-${frame}`)
      const entry = { frame, preview: output }
      evidence.frames.push(entry); save()
      if (spec.observe) {
        const observed = await callTool(client, 'observe_video_edit_frame', { documentRef, target: { kind: 'program', sequenceRef, frame }, maxWidth: 3840 })
        assert.ok(observed.data?.verification?.verified, JSON.stringify(observed))
        const media = await readAllMedia(client, observed.data.resultRef, { chunkBytes: 65536 })
        const file = path.join(root, `observation-${frame}.png`)
        fs.writeFileSync(file, media.bytes)
        entry.observation = observed.data
        entry.difference = await compareFrames(output, file)
        entry.internalPass = internalComparisonPasses(entry.difference)
        save()
        if (!spec.collectDifferences) assert.ok(entry.internalPass, `第 ${frame} 帧内部一致性超出用户标准`)
      }
      if (spec.prReferences) {
        const reference = path.join(spec.prReferences, `caption-${frame}0.png`)
        entry.prDifference = await compareFrames(output, reference)
        entry.prNumericPass = prComparisonPasses(entry.prDifference)
        save()
      }
      } catch (error) {
        if (!spec.collectDifferences) throw error
        let entry = evidence.frames.find(value => value.frame === frame)
        if (!entry) { entry = { frame }; evidence.frames.push(entry) }
        entry.error = String(error); entry.internalPass = false
        await capture(`yoga-failed-${frame}`)
        save()
      }
    }
    if (spec.checkFrameHoldMenu) {
      const original = model.sequences[0].clips.find(clip => clip.kind === 'sequence' && clip.start === 0 && clip.duration > 60)
      assert.ok(original)
      await playback(30)
      const baseline = await callTool(client, 'read_application_entity', { ref: documentRef })
      const view = baseline.data.properties['video_edit.document.timeline_view']
      await callTool(client, 'change_application_entities', operationEnvelope([baseline], { summary: '检查帧定格右键入口', changes: [{
        kind: 'set_properties', entityType: documentRef.kind, target: documentRef,
        properties: { 'video_edit.document.timeline_view': { ...view, zoom: 2, selectedClipIds: [original.id] } },
      }] }))
      await page.locator(`[data-video-edit-clip="${original.id}"]`).click({ button: 'right' })
      await page.getByText('添加帧定格', { exact: true }).click()
      const saveCurrent = async () => {
        for (let attempt = 0; attempt < 4; attempt++) {
          await page.waitForTimeout(300)
          const baseline = await callTool(client, 'read_application_entity', { ref: documentRef, propertyIds: [] })
          try {
            await callTool(client, 'save_video_edit', operationEnvelope([baseline], { documentRef }))
            return readVideoEditFile(created.file)
          } catch (error) {
            if (!String(error).includes('CONFLICT') || attempt === 3) throw error
          }
        }
      }
      const split = await saveCurrent()
      const pieces = split.sequences[0].clips.filter(clip => clip.track === original.track && clip.start < original.duration).sort((a, b) => a.start - b.start)
      assert.deepEqual(pieces.map(clip => [clip.start, clip.duration]), [[0, 30], [30, 1], [31, original.duration - 31]])
      assert.equal(pieces[1].frameHold, true)
      assert.ok(pieces.every(clip => clip.itemId === original.itemId && clip.kind === 'sequence'))
      const clipRef = clip => ({ kind: 'video_edit.clip', id: `${created.documentId}:${clip.id}` })
      const heldRef = clipRef(pieces[1]), tailRef = clipRef(pieces[2])
      const baselines = await Promise.all([heldRef, tailRef].map(ref => callTool(client, 'read_application_entity', { ref })))
      await callTool(client, 'change_application_entities', operationEnvelope(baselines, { summary: '独立移动后段并延长定格', changes: [
        { kind: 'set_properties', entityType: tailRef.kind, target: tailRef, properties: { 'video_edit.clip.start': 61, 'video_edit.clip.duration': original.duration - 61 } },
        { kind: 'set_properties', entityType: heldRef.kind, target: heldRef, properties: { 'video_edit.clip.duration': 31 } },
      ] }))
      const extended = await saveCurrent()
      assert.equal(extended.sequences[0].clips.find(clip => clip.id === pieces[1].id).duration, 31)
      await playback(45)
      await page.waitForFunction(() => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === '45')
      await capture('frame-hold-extended')
      evidence.frameHoldMenu = { split: pieces.map(clip => ({ id: clip.id, start: clip.start, duration: clip.duration, frameHold: clip.frameHold })), extended: true }
      for (let i = 0; i < 2; i++) {
        const baseline = await callTool(client, 'read_application_entity', { ref: documentRef })
        await callTool(client, 'undo_video_edit', operationEnvelope([baseline], { documentRef }))
      }
      const restored = await saveCurrent()
      assert.deepEqual(restored.sequences[0].clips, model.sequences[0].clips)
      evidence.frameHoldMenu.undoRestored = true; save()
    }
    const before = readVideoEditFile(created.file)
    await leaveVideoEditProject(page, null)
    await openVideoEditProjectCard(page, created.projectId)
    assert.deepEqual(readVideoEditFile(created.file), before, '关闭重开改变工程内容')
    evidence.reopened = true
    if (spec.playFullTimeline) {
      const endFrame = Math.max(...model.sequences[0].clips.map(clip => clip.start + clip.duration))
      await playback(0)
      await page.waitForFunction(() => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === '0')
      await page.evaluate(() => {
        window.__videoLayoutEvidence.frames.length = 0
        window.__videoLayoutEvidence.events.length = 0
        window.__videoLayoutWatchCanvas(document.querySelector('canvas[aria-label="剪辑画面"]'))
      })
      const started = performance.now()
      await playback(0, true)
      let nextCapture = 30000
      while (performance.now() - started < endFrame / 60 * 1000 + 30000) {
        await page.waitForTimeout(1000)
        const frame = await page.locator('canvas[aria-label="剪辑画面"]').getAttribute('data-presented-frame')
        evidence.playbackProgress = { frame: Number(frame), elapsedMs: performance.now() - started }; save()
        if (performance.now() - started >= nextCapture) {
          await capture(`yoga-playing-${Math.round(nextCapture / 1000)}`)
          nextCapture += 30000
        }
        if (Number(frame) >= endFrame - 1) break
      }
      const elapsedMs = performance.now() - started
      const trace = await workerSnapshot(page)
      fs.writeFileSync(path.join(root, 'playback-trace.json'), JSON.stringify(trace))
      const frames = trace.frames.filter(value => !value.initial && Number.isFinite(value.frame))
      let skippedFrames = 0
      for (let i = 1; i < frames.length; i++) skippedFrames += Math.max(0, frames[i].frame - frames[i - 1].frame - 1)
      evidence.fullPlayback = { elapsedMs, presentedFrames: frames.length, skippedFrames, endFrame,
        lastPresentedFrame: frames.at(-1)?.frame, renderErrors: trace.events.filter(value => value.error),
        noSkippedFrames: skippedFrames === 0 && frames.length >= endFrame - 1 }
      save()
      await playback(Math.min(endFrame - 1, frames.at(-1)?.frame ?? 0), false)
    }
    if (spec.exportTimeline) {
      const baseline = await callTool(client, 'read_application_entity', { ref: documentRef })
      const endFrame = Math.max(...model.sequences[0].clips.map(clip => clip.start + clip.duration))
      const range = spec.exportRange ?? { startFrame: 0, endFrame }
      assert.ok(Number.isSafeInteger(range.startFrame) && Number.isSafeInteger(range.endFrame)
        && range.startFrame >= 0 && range.endFrame > range.startFrame && range.endFrame <= endFrame, '验收导出范围无效')
      const started = performance.now()
      const afterTimestamp = new Date().toISOString()
      const videoBitrateMbps = spec.videoBitrateMbps ?? 60
      const exported = await callTool(client, 'export_video_edit', operationEnvelope([baseline], {
        documentRef, range,
        settings: { format: 'mp4', width: 3840, height: 2160, fps: 60, videoBitrateMbps, bitrateMode: spec.bitrateMode ?? 'vbr',
          audioBitrateKbps: 192, fit: 'fit', loudness: null, encoderPreference: spec.encoderPreference ?? 'software',
          audioEnabled: true, captionMode: 'burn', addToLibrary: false },
      }))
      const jobId = (exported.data ?? exported.result?.data)?.queue?.[0]?.id
      assert.ok(jobId, JSON.stringify(exported))
      for (;;) {
        const result = await callTool(client, 'query_video_edit_export', { documentRef, taskId: jobId, detail: 'full' })
        const job = result.data.queue.find(value => value.id === jobId)
        assert.ok(job, '正式导出队列丢失本次任务')
        evidence.export = { ...job, elapsedMs: performance.now() - started }; save()
        if (job && ['completed', 'failed', 'cancelled'].includes(job.state)) {
          assert.equal(job.state, 'completed', JSON.stringify(job))
          const output = path.join(root, 'YOGA-author-timeline.mp4')
          fs.copyFileSync(job.path, output); evidence.export.output = output
          const streams = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-of', 'json', output], { encoding: 'utf8', windowsHide: true, timeout: 60000 })).streams
          const video = streams.find(stream => stream.codec_type === 'video')
          assert.ok(video, '导出文件缺少视频轨')
          assert.equal(Number(video.nb_frames), range.endFrame - range.startFrame)
          assert.equal(video.width, 3840); assert.equal(video.height, 2160)
          assert.equal(video.avg_frame_rate, '60/1')
          assert.ok(Math.abs(Number(video.duration) - (range.endFrame - range.startFrame) / 60) < 0.001, '导出时长不符合帧范围')
          evidence.export.bitrateDeviation = Number(video.bit_rate) / (videoBitrateMbps * 1_000_000) - 1
          evidence.export.encoderPreference = spec.encoderPreference ?? 'software'
          evidence.export.encoderLogs = await page.evaluate(async afterTimestamp => {
            const result = await window.henjiNative.logging.queryLogEvents({
              date: afterTimestamp.slice(0, 10), afterTimestamp,
              domainPrefix: 'features.videoEdit.exportEncoder', limit: 500,
            })
            return result.events.filter(event => event.event === 'video_edit.export.encoder_config')
          }, afterTimestamp)
          assert.ok(evidence.export.encoderLogs.some(event => event.context?.configuration?.hardwareAcceleration ===
            (spec.encoderPreference === 'hardware' ? 'prefer-hardware' : 'prefer-software')), '缺少实际编码配置日志')
          assert.ok(streams.some(stream => stream.codec_type === 'audio'), '导出文件缺少音轨')
          evidence.export.video = video
          evidence.export.fullTimeline = range.startFrame === 0 && range.endFrame === endFrame
          save()
          if (spec.bitrateMode === 'cbr') assert.ok(Math.abs(evidence.export.bitrateDeviation) <= .2, '恒定码率偏差超过20%')
          break
        }
        assert.ok(performance.now() - started < 2 * 60 * 60 * 1000, '完整导出超过两小时，保留任务状态供排查')
        await page.waitForTimeout(5000)
      }
    }
    evidence.completed = true
  } finally { save(); await client?.close(); await disableMcp(page) }
}

module.exports = { runYogaAuthorTimeline }
