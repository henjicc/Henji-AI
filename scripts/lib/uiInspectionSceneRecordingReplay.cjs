const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')
const net = require('node:net')
const { fixture } = require('./uiInspectionSceneVideoEditMotionDraft.cjs')
const { seedVideoEditProject, openVideoEditProjectCard } = require('./uiInspectionVideoEditDocuments.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')

function createRecordingReplayScene() {
  return { id: 'recording-replay', name: '操作脚本-真实录制与第二步重录替换撤销', surface: '屏幕录制', writesUserData: true,
    launchArgs: ['--autoplay-policy=no-user-gesture-required'],
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/recording-replay'); fs.mkdirSync(root, { recursive: true })
      const readDocument = id => page.evaluate(id => window.henjiNative.documents.readDocument({ id }), id)
      const button = name => page.getByRole('button', { name, exact: true })
      const evidence = { paidGenerationBlocked: true, capture: 'Real application window; no microphone/camera' }
      const unblock = await blockPaidGeneration(app)
      let client
      try {
        const source = path.join(root, 'source.png')
        await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="white"/><circle cx="640" cy="360" r="230" fill="black"/></svg>')).png().toFile(source)
        const project = fixture(source); project.name = '脚本重录源工程'
        await button('剪辑').first().click()
        const seeded = await seedVideoEditProject(page, project)
        await openVideoEditProjectCard(page, seeded.projectId)
        await page.getByLabel('剪辑画面', { exact: true }).waitFor()
        const sourceId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(v => !v.webContents.getURL().includes('view=')).getMediaSourceId())
        const portProbe = net.createServer()
        await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve))
        const port = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve))
        await page.evaluate(port => window.henjiNative.mcp.configure({ enabled: false, port }), port)
        client = await connectMcpClient((await authorizeMcpConnection(page, { name: '操作脚本免费验收', allowWrites: true, allowDestructive: true })).config)
        const read = (ref, propertyIds = []) => callTool(client, 'read_application_entity', { ref, propertyIds })
        const invoke = async (name, input) => {
          const execution = await callTool(client, name, operationEnvelope([], input))
          assert.equal(execution.executionState, 'completed', JSON.stringify(execution))
          return execution.result.data
        }
        const started = await invoke('start_screen_recording', { name: '三步真实操作', sourceRef: { kind: 'screen_recording.source', id: sourceId }, width: 1280, height: 720, fps: 30, tracks: { systemAudio: false } })
        const sessionRef = started.resultRef
        const startDeadline = Date.now() + 30000
        while ((await page.evaluate(() => window.henjiNative.screenRecording.snapshot()))?.phase !== 'recording') {
          assert(Date.now() < startDeadline, '采集倒计时未在限定时间内完成')
          await page.waitForTimeout(100)
        }
        evidence.captureBackend = (await page.evaluate(sessionId => window.henjiNative.screenRecording.capture({ operation: 'read', sessionId }), sessionRef.id)).backend
        const clipRef = { kind: 'video_edit.clip', id: `${seeded.documentId}:motion-clip` }
        for (const x of [-.2, .2, 0]) {
          await page.waitForTimeout(300)
          const baseline = await read(clipRef, ['video_edit.clip.x'])
          const changed = await callTool(client, 'change_application_entities', operationEnvelope([baseline], { summary: '演示水平移动', changes: [{ kind: 'set_properties', entityType: clipRef.kind, target: clipRef, properties: { 'video_edit.clip.x': x } }] }))
          assert.equal(changed.executionState, 'completed', JSON.stringify(changed))
          evidence.changes ??= []; evidence.changes.push({ x, changed, snapshot: await page.evaluate(() => window.henjiNative.screenRecording.snapshot()) })
          await page.waitForTimeout(2300)
        }
        await invoke('stop_screen_recording', { sessionRef })
        const originalSource = await readDocument(seeded.documentId)
        const originalCapture = await readDocument(sessionRef.id)
        evidence.originalCapture = originalCapture; evidence.originalSource = originalSource
        fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
        assert.equal(originalCapture.content.scriptCapture.calls.length, 3, '三次正式操作必须全部捕获')
        assert.equal(originalCapture.content.scriptCapture.baselines.length, 1)
        await invoke('understand_screen_recording', { sessionRef, transcribe: false, detectVisuals: false })
        await invoke('generate_screen_recording_script', { sessionRef })
        const scripted = await readDocument(sessionRef.id)
        evidence.steps = scripted.content.understanding.operationScript.steps
        assert.equal(evidence.steps.length, 3, JSON.stringify(evidence.steps))
        assert(evidence.steps.every(v => !v.blockedReason), JSON.stringify(evidence.steps))
        fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
        const showScript = async () => {
          await invoke('open_document', { documentId: sessionRef.id })
          await page.getByText('操作脚本', { exact: true }).waitFor()
          await page.getByText('操作脚本', { exact: true }).scrollIntoViewIfNeeded()
          await page.getByRole('button', { name: /^重录步骤 / }).click()
          await page.getByRole('option', { name: `2. ${evidence.steps[1].title}`, exact: true }).click()
          await page.locator('[data-dropdown-portal="true"]').waitFor({ state: 'detached' })
          await page.getByText('完成后停留（秒）', { exact: true }).scrollIntoViewIfNeeded()
        }
        await showScript()
        await page.screenshot({ path: path.join(root, 'script.png') }); await capture('recording-replay-script')
        const target = fixture(source); target.id = 'reality-recording-replacement'; target.name = '局部重录成片'; target.media = []; target.items = []; target.sequences = []
        const destination = await seedVideoEditProject(page, target)
        const documentRef = { kind: 'video_edit.document', id: destination.documentId }
        await invoke('generate_screen_recording_movie', { sessionRef, documentRef, recipe: { formats: ['landscape'], trimPauses: false, trimFillers: false, waitSpeed: 1, attention: 'off', cursor: false, captions: false, steps: false, camera: 'off', frame: false, normalizeAudio: false } })
        const before = await readDocument(destination.documentId)
        const result = await invoke('rerecord_screen_recording_steps', { sessionRef, documentRef, stepId: evidence.steps[1].id, sourceRef: { kind: 'screen_recording.source', id: sourceId } })
        assert.equal(result.verified, true, JSON.stringify(result))
        const after = await readDocument(destination.documentId)
        assert.deepEqual((await readDocument(seeded.documentId)).content, originalSource.content, '重放修改了真实源工程')
        const beforeScreen = before.content.sequences.find(v => v.name.endsWith('屏幕画面'))
        const afterScreen = after.content.sequences.find(v => v.id === beforeScreen.id)
        assert(afterScreen.clips.length > beforeScreen.clips.length, '第二步边界没有拆开')
        const oldItems = new Set(before.content.items.map(v => v.id))
        const replaced = afterScreen.clips.filter(v => !oldItems.has(v.itemId))
        assert(replaced.length > 0)
        for (const sequence of before.content.sequences.filter(v => v.id !== beforeScreen.id)) assert.deepEqual(after.content.sequences.find(v => v.id === sequence.id), sequence, '非目标序列被修改')
        assert(afterScreen.clips[0].itemId === beforeScreen.clips[0].itemId && afterScreen.clips.at(-1).itemId === beforeScreen.clips.at(-1).itemId, '前后步骤未保留原片')
        await invoke('open_document', { documentId: destination.documentId })
        await invoke('focus_application_entity', { ref: { kind: 'video_edit.sequence', id: `${destination.documentId}:${afterScreen.id}` } })
        const playback = 'video_edit.document.program_playback'
        await callTool(client, 'change_application_entities', operationEnvelope([await read(documentRef, [playback])], { summary: '查看替换画面', changes: [{ kind: 'set_properties', entityType: documentRef.kind, target: documentRef, properties: { [playback]: { frame: replaced[0].start + Math.floor(replaced[0].duration * .8), playing: false, playbackDirection: 1 } } }] }))
        await page.waitForTimeout(1500)
        await page.screenshot({ path: path.join(root, 'replaced.png') }); await capture('recording-replay-replaced')
        await callTool(client, 'undo_video_edit', operationEnvelope([await read(documentRef)], { documentRef }))
        const undone = await readDocument(destination.documentId)
        assert.deepEqual(undone.content.sequences, before.content.sequences, '撤销未恢复原时间线')
        assert.deepEqual(undone.content.media, before.content.media)
        evidence.replaced = result.replaced; evidence.originalUnchanged = true; evidence.undoRestored = true
        evidence.before = before; evidence.after = after
        assert(!(await page.evaluate(() => window.henjiNative.documents.listProjects())).some(v => v.name.startsWith('重放临时-')), '临时项目未清理')
        fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
        await showScript()
      } finally { await client?.close(); await disableMcp(page); await unblock() }
    },
  }
}
module.exports = { createRecordingReplayScene }
