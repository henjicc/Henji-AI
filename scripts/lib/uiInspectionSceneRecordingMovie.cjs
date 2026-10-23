const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { fixture } = require('./uiInspectionSceneVideoEditMotionDraft.cjs')
const { seedVideoEditProject } = require('./uiInspectionVideoEditDocuments.cjs')
const { assignIsolatedMcpPort, authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')

function createRecordingMovieScene() {
  return { id: 'recording-movie', name: '录制成片-一分钟采集生成播放导出撤销', surface: '屏幕录制', writesUserData: true,
    launchArgs: ['--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/recording-movie'); fs.mkdirSync(root, { recursive: true })
      const evidence = { devices: 'Chromium virtual microphone/camera; real capture of isolated application window', annotations: 'Deterministic local capture-log and transcript fixtures; no ASR or paid call' }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const button = name => page.getByRole('button', { name, exact: true })
      const list = kind => page.evaluate(kind => window.henjiNative.documents.listDocuments({ kind, includeDrafts: true }), kind)
      const readDocument = id => page.evaluate(id => window.henjiNative.documents.readDocument({ id }), id)
      let client
      try {
        await button('工具').click(); await page.getByText('屏幕录制', { exact: true }).first().click()
        const sourceId = await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('view=')); window.setTitle(`录制场景-${process.pid}`); return window.getMediaSourceId() })
        await button('刷新来源').click()
        const source = (await page.evaluate(() => window.henjiNative.screenRecording.sources())).find(value => value.id === sourceId)
        assert(source, '隔离应用窗口必须可采集')
        await page.getByRole('radio', { name: '单个窗口', exact: true }).click()
        await button(source.name).click(); await page.getByLabel('会话名称', { exact: true }).fill('一分钟成片验收')
        await page.getByRole('switch', { name: '摄像头', exact: true }).click()
        await button('开始录制').click(); await button('暂停').waitFor({ timeout: 30000 })
        for (let index = 0; index < 6; index++) {
          await page.waitForTimeout(10000)
          await page.getByLabel('标记备注', { exact: true }).fill(`演示步骤 ${index + 1}`); await button('打标记').click()
        }
        evidence.capture = await page.evaluate(() => window.henjiNative.screenRecording.snapshot())
        assert(evidence.capture.elapsedMs >= 60000, '必须真实录满一分钟')
        await button('停止并保存').click(); await page.getByLabel('剪辑画面', { exact: true }).waitFor({ timeout: 90000 })
        const session = (await list('screen_recording')).find(value => value.name === '一分钟成片验收')
        const recorded = await readDocument(session.id)
        fs.writeFileSync(path.join(root, 'original-recording.json'), JSON.stringify(recorded, null, 2))
        assert(recorded.content.media.some(value => value.kind === 'camera'))
        assert(recorded.content.media.some(value => value.kind === 'microphone'))
        // Preserve actual media and original logs above; deterministic annotations make visual assertions repeatable.
        const content = recorded.content
        const { recordingRange } = require('../check-persistence-compat.cjs').loadTypeScript('src/core/screenRecording/range.ts')
        const { startUs: origin, endUs: end } = recordingRange(content)
        const { CaptureLogCollector } = require('../check-persistence-compat.cjs').loadTypeScript('src/core/captureLog/collector.ts')
        const pages = []
        const collector = new CaptureLogCollector({ ownerRef: { kind: 'screen_recording.session', id: session.id }, sourceDigest: `sha256:${'c'.repeat(64)}`, originUs: 0, id: randomUUID }, async page => { pages.push(page) }, error => { throw error })
        collector.start(origin)
        for (let second = 0; second < 60; second++) {
          const point = second < 30 ? [700, 350] : [1450, 700], at = origin + second * 1000000
          collector.record(at, { kind: 'cursor', point, shape: 'arrow' })
          if ([1, 4, 32, 55].includes(second)) { collector.record(at + 1000, { kind: 'click', point, button: 'left', phase: 'down' }); collector.record(at + 101000, { kind: 'click', point, button: 'left', phase: 'up' }) }
          await collector.flush()
        }
        await collector.stop(end)
        content.eventPages = pages.map((value, index) => {
          const bytes = Buffer.from(JSON.stringify(value)), hash = createHash('sha256').update(bytes).digest('hex')
          const file = path.join(root, `page-${index}-${hash}.capture.json`); fs.writeFileSync(file, bytes)
          return { path: file, firstSequence: value.seqSpan[0], lastSequence: value.seqSpan[1] }
        })
        content.understanding = {
          operationScript: { steps: [] },
          transcript: [{ id: 'spoken', startUs: origin + 1000000, endUs: origin + 4000000, text: '一分钟录制，自动生成可编辑成片。', granularity: 'segment', audioDocumentId: 'fixture-transcript', mediaId: content.media.find(value => value.kind === 'microphone').id }],
          steps: [{ id: 'step', startUs: origin, endUs: end, title: '录制与生成', description: '测试步骤导航与正式标题素材', signal: 'start', eventIds: [] }],
          candidates: [{ id: 'wait', startUs: origin + 5000000, endUs: end - 3000000, kind: 'wait', status: 'accepted', reason: '巡检夹具：演示等待加速', eventIds: [] }],
          privacy: { warnings: [], candidates: ['confirm-me', 'leave-pending'].map(id => ({ id, mediaId: content.media.find(v => v.kind === 'screen').id, kind: 'email', hint: '邮箱', fingerprint: 'a'.repeat(64), startUs: origin + 1000000, endUs: origin + 4000000, status: 'pending', samples: [{ monoUs: origin + 1000000, box: [.05, .05, .8, .15], confidence: 1 }] })) },
          chapters: [{ id: 'chapter', title: '演示', stepIds: ['step'] }], warnings: [],
        }
        await page.evaluate(async ({ id, revision, content }) => window.henjiNative.documents.saveDocument({ target: { id }, expectedRevision: revision, content }), { id: session.id, revision: recorded.meta.revision, content })
        await assignIsolatedMcpPort(page)
        client = await connectMcpClient((await authorizeMcpConnection(page, { name: '成片隔离验收', allowWrites: true, allowDestructive: true })).config)
        const read = (ref, propertyIds = []) => callTool(client, 'read_application_entity', { ref, propertyIds })
        // 9f7b554df 移除录制工作台；隐私确认与成片仍由正式能力承载。
        evidence.flow = { basis: '9f7b554df / screenRecording/application/applicationDomain.ts', removed: '工作台隐私页、配方页', assertions: '保留确认隔离、成片、播放、导出与一步撤销' }
        const sessionRef = { kind: 'screen_recording.session', id: session.id }
        const understandingRef = { kind: 'screen_recording.understanding', id: session.id }
        content.understanding.privacy.candidates[0].status = 'accepted'
        const confirmed = await callTool(client, 'change_application_entities', operationEnvelope([await read(understandingRef)], { summary: '确认第一项隐私遮挡', changes: [{ kind: 'set_properties', entityType: understandingRef.kind, target: understandingRef, properties: { 'screen_recording.understanding.result': content.understanding } }] }))
        assert.equal(confirmed.executionState, 'completed', JSON.stringify(confirmed))
        assert.deepEqual((await readDocument(session.id)).content.understanding.privacy.candidates.map(c => c.status), ['accepted', 'pending'])
        const target = fixture(); target.name = '一分钟成片验收'; target.media = []; target.items = []; target.sequences = []
        const seeded = await seedVideoEditProject(page, target), editing = { id: seeded.documentId }, documentRef = { kind: 'video_edit.document', id: editing.id }
        const movie = await callTool(client, 'generate_screen_recording_movie', operationEnvelope([], { sessionRef, documentRef, recipe: {} }))
        assert.equal(movie.executionState, 'completed', JSON.stringify(movie)); assert(movie.result.data.verified)
        await callTool(client, 'open_document', operationEnvelope([], { documentId: editing.id }))
        await callTool(client, 'focus_application_entity', operationEnvelope([], { ref: movie.result.data.sequenceRefs[0] }))
        await page.getByLabel('剪辑画面', { exact: true }).waitFor({ timeout: 30000 })
        const generated = await readDocument(editing.id); evidence.generated = generated
        fs.writeFileSync(path.join(root, 'generated.json'), JSON.stringify(generated, null, 2)); store()
        const sequence = generated.content.sequences.find(value => value.name.endsWith('横版'))
        const screen = generated.content.sequences.find(value => value.name.endsWith('屏幕画面'))
        const masks = screen.clips.flatMap(c => c.effects ?? []).filter(e => e.builtin?.id === 'mosaic')
        assert(masks.length > 0); assert(masks.every(e => e.enabled && e.mask.shapes[0].id === 'confirm-me'))
        evidence.confirmedPrivacy = true
        assert(sequence && screen); assert(sequence.captions.length); assert(sequence.markers.length)
        assert(screen.clips.some(value => value.effects?.some(effect => effect.builtin?.id === 'recording_cursor')))
        assert(screen.clips.some(value => value.curves?.scale?.some(key => key.value > 1)))
        assert(sequence.clips.some(value => value.kind === 'audio')); assert(sequence.clips.some(value => value.track === 4))
        const setPlayback = async (frame, playing = false) => {
          const property = 'video_edit.document.program_playback'
          await callTool(client, 'change_application_entities', operationEnvelope([await read(documentRef, [property])], { summary: '验收播放', changes: [{ kind: 'set_properties', entityType: documentRef.kind, target: documentRef, properties: { [property]: { frame, playing, playbackDirection: 1 } } }] }))
        }
        for (const frame of [0, 60, 180]) {
          await setPlayback(frame)
          await page.waitForFunction(frame => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === String(frame), frame, { timeout: 30000 })
          const data = await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => canvas.toDataURL('image/png'))
          fs.writeFileSync(path.join(root, `program-${frame}.png`), Buffer.from(data.split(',')[1], 'base64'))
        }
        await setPlayback(60, true)
        await page.waitForFunction(() => Number(document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame) > 75, null, { timeout: 15000 })
        await setPlayback(90); evidence.played = true
        // Hold beyond the native reference warning threshold: paused prefetch must not borrow pool slots.
        await page.waitForTimeout(4500)
        const submitted = await callTool(client, 'export_video_edit', operationEnvelope([await read(documentRef)], { documentRef, settings: { format: 'mp4', width: 1280, height: 720, fps: 30, videoBitrateMbps: 6, audioBitrateKbps: 192, fit: 'fit', loudness: null, captionMode: 'burn', addToLibrary: false } }))
        assert.equal(submitted.executionState, 'completed', JSON.stringify(submitted))
        const jobId = submitted.result.data.queue[0].id
        let status
        const deadline = Date.now() + 360000
        do { status = await callTool(client, 'query_video_edit_export', { documentRef, taskId: jobId, detail: 'full' }); if (['completed', 'failed', 'cancelled'].includes(status.data.queue[0]?.state)) break; await page.waitForTimeout(500) } while (Date.now() < deadline)
        evidence.export = status; store()
        const job = status.data.queue[0]; assert.equal(job.state, 'completed', JSON.stringify(status)); assert(job.outputReady)
        const output = job.outputPath ?? job.path ?? status.data.task?.outputPath
        assert(output && fs.existsSync(output), '导出文件必须存在')
        fs.copyFileSync(output, path.join(root, 'movie.mp4'))
        const { ffmpegPath, ffprobePath } = require('./mediaBinaries.cjs')
        evidence.probe = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], { windowsHide: true }).toString())
        assert(evidence.probe.streams.some(value => value.codec_type === 'video')); assert(evidence.probe.streams.some(value => value.codec_type === 'audio'))
        execFileSync(ffmpegPath, ['-v', 'error', '-y', '-ss', '2', '-i', output, '-frames:v', '1', path.join(root, 'export-2s.png')], { windowsHide: true })
        await callTool(client, 'undo_video_edit', operationEnvelope([await read(documentRef)], { documentRef }))
        const undone = await readDocument(editing.id)
        assert.equal(undone.content.sequences.length, 0, '一次撤销必须移除整批成片序列'); assert.equal(undone.content.media.length, 0)
        evidence.undo = true; evidence.completed = true; store()
        await capture('recording-movie-undone')
      } catch (error) {
        evidence.failure = { message: String(error), alerts: await page.getByRole('alert').allTextContents().catch(() => []) }
        await page.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {})
        throw error
      } finally {
        store(); await client?.close().catch(() => {}); await disableMcp(page).catch(() => {})
        await page.evaluate(async () => { const state = await window.henjiNative.screenRecording.snapshot(); if (state) await window.henjiNative.screenRecording.capture({ operation: 'close', sessionId: state.sessionId }) }).catch(() => {})
      }
    },
  }
}
module.exports = { createRecordingMovieScene }
