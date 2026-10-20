const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { openVideoEditProjectCard, leaveVideoEditProject, readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope, readAllMedia } = require('./uiInspectionMcpClient.cjs')
const { compareFrames, internalComparisonPasses } = require('./uiInspectionSceneAuthorTimeline.cjs')

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
    try { await openVideoEditProjectCard(page, created.projectId) } catch (error) {
      await capture('yoga-open-failed')
      evidence.openText = await page.locator('body').innerText()
      throw error
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
      }
    }
    const before = readVideoEditFile(created.file)
    await leaveVideoEditProject(page, null)
    await openVideoEditProjectCard(page, created.projectId)
    assert.deepEqual(readVideoEditFile(created.file), before, '关闭重开改变工程内容')
    evidence.reopened = true
    evidence.completed = true
  } finally { save(); await client?.close(); await disableMcp(page) }
}

module.exports = { runYogaAuthorTimeline }
