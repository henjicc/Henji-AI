const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { observeWorkers, workerSnapshot, waitReleased } = require('./uiInspectionSceneVideoEditLayout.cjs')
const { dialogs, presented, png, pixelDifference, mediaProbe, trackBanks } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const { createPlaybackFixture, seedCameraStageDocument } = require('./uiInspectionCameraStagePlayback.cjs')
const { createAudioEditDocument, removeAudioEditDocument } = require('./audioEditDocumentFixture.cjs')
const { leaveVideoEditProject, openVideoEditProjectCard, readVideoEditFile, seedVideoEditProject } = require('./uiInspectionVideoEditDocuments.cjs')
const button = (page, name) => page.getByRole('button', { name, exact: true })
const normalized = value => value.replaceAll('/', '\\').toLowerCase()
const ORIGINAL = 'D:/视频制作/0A0片头片尾和素材/2021片头V2 4K 60FPS.mp4'
const FIXTURE_ID = 'video-edit-creative-results'
const STAGE_NODE_ID = '__video_edit_creative_stage'

function project(root) {
  const video = (index, name) => ({ id: `v${index}`, name, index, kind: 'video', locked: false, enabled: true, muted: false, solo: false })
  return { format: 'henji-video-project', version: 2, id: FIXTURE_ID, name: '创作结果回填验收', revision: 0,
    media: [{ id: 'original', name: '原4K60片头', path: ORIGINAL, kind: 'video', durationSeconds: 7, width: 3840, height: 2160, hasAudio: false, frameRate: { numerator: 60, denominator: 1 }, frameRateMode: 'sampled-constant' }],
    bins: [], items: [{ id: 'original-item', name: '原4K60片头', kind: 'video', mediaId: 'original' }],
    sequences: [{ id: 'main', name: '序列 1', width: 3840, height: 2160, frameRate: { numerator: 60, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
      tracks: [{ id: 'a1', name: '音频 1', index: 0, kind: 'audio', locked: false, enabled: true, muted: false, solo: false }, video(1, '视频 1'), video(2, '视频 2'), video(3, '视频 3'), video(4, '视频 4')],
      clips: [{ id: 'base', itemId: 'original-item', name: '原4K60片头', kind: 'video', track: 1, start: 0, duration: 420, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: '' }], annotations: [] }],
    _root: root }
}
// 3.1：剪辑是项目里的文档文件，按旧工程形状读出（项目内相对写法换回绝对路径）
const readProject = readVideoEditFile
async function savedClip(page, file, predicate, message) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const current = fs.existsSync(file) ? readProject(file) : null
    const clip = current?.sequences[0].clips.find(predicate)
    if (clip) return { document: current, clip }
    await page.waitForTimeout(100)
  }
  throw new Error(message)
}

/** Generation, canvas, image edit, voice-over and 3D results enter one fixed edit slot through real hosts. */
function createVideoEditCreativeResultsScene(context) {
  return { id: 'video-edit-creative-results', surface: '剪辑', name: '剪辑-生成/画布/图片编辑/口播/三维结果固定回填与4K60导出', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-creative-results'); fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(root, { recursive: true })
      const { ffmpegPath, ffprobePath } = require('./mediaBinaries.cjs')
      const ffmpeg = args => execFileSync(ffmpegPath, ['-v', 'error', '-y', ...args], { windowsHide: true, timeout: 120000 })
      const generatedA = path.join(root, 'generated-a.png'); const generatedB = path.join(root, 'generated-b.png'); const voice = path.join(root, 'voice-source.wav')
      ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=1', '-frames:v', '1', generatedA])
      ffmpeg(['-f', 'lavfi', '-i', 'smptehdbars=size=3840x2160:rate=1', '-frames:v', '1', generatedB])
      ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=5:sample_rate=48000', '-ac', '2', '-c:a', 'pcm_s16le', voice])
      const fixture = project(root); delete fixture._root
      // 3.1：经正式文档接口建项目与主剪辑（文档 ID 由仓库生成）
      let file; let PROJECT_ID; let projectRef; let editProject
      const original = { size: fs.statSync(ORIGINAL).size, mtimeMs: fs.statSync(ORIGINAL).mtimeMs }
      const evidence = { completed: false, phases: [], captures: [], timings: {} }
      const sceneStart = new Date().toISOString()
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const shot = async name => { evidence.captures.push({ name, result: await capture(name) }); store() }
      const phase = name => { evidence.currentPhase = name; store() }
      let client; let observed = false; let audioProjectId
      const playhead = async frame => {
        const read = await callTool(client, 'read_application_entity', { ref: projectRef, propertyIds: ['video_edit.document.program_playback'] })
        await callTool(client, 'change_application_entities', operationEnvelope([read], { summary: '定位回填播放头', changes: [{ kind: 'set_properties', entityType: 'video_edit.document', target: projectRef, properties: { 'video_edit.document.program_playback': { frame, playing: false, playbackDirection: 1 } } }] }))
      }
      const openEdit = async () => { await button(page, '剪辑').first().click(); await button(page, '关闭项目').or(button(page, '新建项目')).first().waitFor({ state: 'visible', timeout: 30000 }) }
      try {
        editProject = await seedVideoEditProject(page, fixture); file = editProject.file; PROJECT_ID = editProject.documentId
        projectRef = { kind: 'video_edit.document', id: PROJECT_ID }; evidence.project = { projectPath: editProject.projectPath, file }
        evidence.display = await app.evaluate(({ BrowserWindow, screen }, { point, hostContentsId }) => {
          const host = (BrowserWindow.getAllWindows().find(window => window.webContents.id === hostContentsId) ?? BrowserWindow.getAllWindows()[0])
          const bounds = host.getBounds(); const current = screen.getDisplayMatching(bounds); const coordinates = point?.split(',').map(Number)
          const selected = coordinates ? screen.getAllDisplays().find(display => coordinates[0] >= display.bounds.x && coordinates[0] < display.bounds.x + display.bounds.width && coordinates[1] >= display.bounds.y && coordinates[1] < display.bounds.y + display.bounds.height) : undefined
          return { windowBounds: bounds, id: current.id, primary: current.id === screen.getPrimaryDisplay().id, preferredId: selected?.id }
        }, { point: process.env.HENJI_DEV_DISPLAY_POINT, hostContentsId: await (await app.browserWindow(page)).evaluate((window) => window.webContents.id) })
        if (process.env.HENJI_DEV_DISPLAY_POINT) { assert.equal(evidence.display.id, evidence.display.preferredId); assert.equal(evidence.display.primary, false) }
        // Controlled producer records: completed local files, no paid request.
        await page.evaluate(async rows => {
          // 经正式生成记录接口造数据（存储底座 2.3 起渲染层不执行 SQL）；同 ID 先删再写等同原来的覆盖。
          for (const row of rows) {
            await window.henjiNative.generationHistory.delete(row.id)
            await window.henjiNative.generationHistory.insert({ id: row.id, providerId: 'fixture', modelId: 'fixture-image', type: 'image', prompt: row.prompt,
              params: {}, resultPaths: [row.file], taskId: null, status: 'success', errorMessage: null, cost: null, duration: null })
          }
        }, [{ id: 'creative-generation-a', prompt: '受控生成结果A', file: generatedA }, { id: 'creative-generation-b', prompt: '受控生成结果B', file: generatedB }])
        // History is read when the generation workspace mounts; reload so the seeded rows are the formal list.
        await page.reload({ waitUntil: 'domcontentloaded' }); await button(page, '剪辑').waitFor({ state: 'visible', timeout: 30000 })


        // 3D render first. The canvas document is written through the formal document API (test fixtures) before any
        // canvas instance exists; its persisted completion node is consumed after the edit project is open.
        phase('camera-stage-render')
        // 3.2：镜头参考是作品目录里的文档文件，经正式文档接口造数据
        const stageDocumentId = await seedCameraStageDocument(page, { name: '剪辑回填三维', scene: createPlaybackFixture() })
        const stageCanvasId = await page.evaluate(async ({ stageProjectId, nodeId }) => {
          const now = Date.now()
          const node = { id: nodeId, type: 'cameraStageNode', position: { x: 220, y: 160 }, width: 480, height: 320, measured: { width: 480, height: 320 }, style: { width: 480, height: 320 },
            data: { displayName: '剪辑回填镜头', projectId: stageProjectId, imageUrl: null, previewImageUrl: null, videoUrl: null, aspectRatio: '16:9', durationSec: null, selectedTimeSec: 0.25, mediaInputs: {}, environmentImageUrl: null, imageExporting: false, imageRenderRequestId: null, imageRenderError: null, videoProgress: null, videoExporting: false, videoRenderPhase: null, videoRenderRequestId: null, videoRenderError: null, renderTask: null, outputKind: 'image' } }
          const created = await window.henjiNative.testFixtures.createCanvas({ name: `剪辑回填三维画布 ${now}`, nodes: [node], viewport: { x: 180, y: 100, zoom: 0.8 } })
          return created.id
        }, { stageProjectId: stageDocumentId, nodeId: STAGE_NODE_ID })
        await page.reload({ waitUntil: 'domcontentloaded' }); await button(page, '剪辑').waitFor({ state: 'visible', timeout: 30000 })
        await context.setupCanvas(page)
        if (await page.locator('.react-flow').count()) { await page.getByRole('button', { name: /返回画布列表|Back to Canvases/ }).click(); await context.settlePage(page) }
        await page.locator(`[data-project-id="${stageCanvasId}"]:visible`).click()
        const stageNode = page.locator(`.react-flow__node[data-id="${STAGE_NODE_ID}"]`); await stageNode.waitFor({ state: 'visible', timeout: 15000 }); await stageNode.click()
        const renderAt = performance.now(); await page.getByRole('button', { name: /输出图片|Output Image/i }).click()
        // Poll the persisted canvas record; an async predicate in waitForFunction would resolve immediately.
        let stageResultId = null
        for (let attempt = 0; attempt < 600 && !stageResultId; attempt++) {
          stageResultId = await page.evaluate(async canvasProjectId => {
            const stored = await window.henjiNative.testFixtures.readCanvas(canvasProjectId)
            const nodes = (stored?.nodes ?? [])
            return nodes.find(candidate => candidate.data?.cameraStageRenderReceipt && candidate.data?.generationOutputCommitId)?.id ?? null
          }, stageCanvasId)
          if (!stageResultId) await page.waitForTimeout(100)
        }
        assert.ok(stageResultId, '三维渲染没有在60秒内持久化正式结果节点')
        const stage = { canvasId: stageCanvasId, resultNodeId: stageResultId }
        evidence.timings.cameraStageRenderMs = performance.now() - renderAt
        phase('open-project')
        await openEdit(); if (await button(page, '关闭项目').isVisible()) await button(page, '关闭项目').click()
        await observeWorkers(page); observed = true
        await openVideoEditProjectCard(page, editProject.projectId); await presented(page, 0)
        const identity = await authorizeMcpConnection(page, { name: '创作结果回填验收', allowWrites: true }); client = await connectMcpClient(identity.config, 'Henji creative results Reality')
        evidence.trackBanks = await trackBanks(page)

        phase('generation-page-add')
        await playhead(120); await presented(page, 120)
        await button(page, '生成').click()
        const resultImage = page.locator('[data-generation-result="creative-generation-a"]').first()
        await resultImage.waitFor({ state: 'visible', timeout: 30000 })
        await resultImage.click({ button: 'right' })
        const addItem = page.getByText('剪辑：加入播放头', { exact: true })
        await addItem.waitFor({ state: 'visible', timeout: 10000 }); let at = performance.now(); await addItem.click()
        // 4.1：片段来源统一为“文档 + 部位”与“生成记录 + 第几个结果”两种
        const generated = await savedClip(page, file, clip => clip.creativeSource?.type === 'generation', '生成页结果没有回填并保存到原剪辑工程')
        evidence.timings.generationAddMs = performance.now() - at
        assert.equal(generated.clip.start, 120); assert.ok(generated.clip.track >= 2, '加入播放头不得覆盖原片段所在轨道')
        const generatedMedia = generated.document.media.find(media => media.id === generated.document.items.find(item => item.id === generated.clip.itemId).mediaId)
        // 3.1：其他工具的结果复制进项目“生成结果”再引用（重要记录 006），原文件保留
        assert.equal(normalized(path.dirname(generatedMedia.path)), normalized(path.join(editProject.projectPath, '生成结果')), `回填必须引用项目“生成结果”里的副本：${generatedMedia.path}`)
        assert.ok(['generated-a.png', 'generated-b.png'].includes(path.basename(generatedMedia.path)), '副本须沿用生成结果的文件名')
        assert.ok(fs.existsSync(generatedA) && fs.existsSync(generatedMedia.path), '原文件与项目副本都应存在')
        evidence.generation = { clip: generated.clip, media: generatedMedia }; evidence.phases.push('生成页右键加入播放头，固定原工程/序列并保存')

        phase('mcp-replace-generation')
        const read = await callTool(client, 'read_application_entity', { ref: projectRef })
        at = performance.now()
        const replaced = await callTool(client, 'place_video_edit_creative_result', operationEnvelope([read], { documentRef: projectRef, sequenceRef: { kind: 'video_edit.sequence', id: `${PROJECT_ID}:main` }, placement: { mode: 'replace', clipRef: { kind: 'video_edit.clip', id: `${PROJECT_ID}:${generated.clip.id}` } }, result: { type: 'generation', resultRef: { kind: 'generation.result', id: generated.clip.creativeSource.recordId === 'creative-generation-a' ? 'creative-generation-b' : 'creative-generation-a' }, outputIndex: 0 } }))
        evidence.timings.mcpReplaceMs = performance.now() - at
        assert.equal(replaced.executionState, 'completed', JSON.stringify(replaced)); assert.equal(replaced.verificationState, 'verified', JSON.stringify(replaced))
        const afterReplace = readProject(file).sequences[0].clips.find(clip => clip.id === generated.clip.id)
        assert.equal(afterReplace.start, generated.clip.start); assert.equal(afterReplace.duration, generated.clip.duration); assert.notEqual(afterReplace.creativeSource.recordId, generated.clip.creativeSource.recordId)
        evidence.replace = { result: replaced, clip: afterReplace }; evidence.phases.push('Modern MCP 替换同一片段：原时间位置保留，来源更新')

        phase('program-frame-image-edit')
        await openEdit(); await playhead(300); await presented(page, 300)
        const before = await png(page, path.join(root, 'program-300-before.png'))
        const framePath = path.join(root, `frame-300-${Date.now()}.png`)
        await dialogs(app, [], framePath); at = performance.now(); await button(page, '更多节目操作').click(); await button(page, '编辑当前帧').click()
        const sendMenu = page.getByRole('button', { name: /加入剪辑/ })
        await page.locator('[data-image-editor-v3-host-state]').waitFor({ state: 'detached', timeout: 60000 })
        await sendMenu.waitFor({ state: 'visible', timeout: 60000 })
        evidence.timings.frameToEditorMs = performance.now() - at
        await shot('creative-image-editor-opened')
        await sendMenu.click(); const backfill = page.getByRole('menuitem', { name: /回填到原剪辑位置/ })
        await backfill.waitFor({ state: 'visible' }); evidence.imageReturnLabel = await backfill.innerText(); at = performance.now(); await backfill.click()
        // 编辑当前帧 = 一份图片文档：片段来源引用图片文档本身（保持链接，写回后自动重新渲染）
        const edited = await savedClip(page, file, clip => clip.creativeSource?.type === 'document' && /\.henjiimg$/i.test(clip.creativeSource.docRef.path), '图片编辑结果没有回填原帧位置')
        evidence.timings.imageBackfillMs = performance.now() - at
        assert.equal(edited.clip.start, 300); assert.ok(edited.clip.track > 1, '编辑帧必须位于原画面上方')
        const editedMedia = edited.document.media.find(media => media.id === edited.document.items.find(item => item.id === edited.clip.itemId).mediaId)
        assert.equal(editedMedia.width, 3840); assert.equal(editedMedia.height, 2160)
        await openEdit(); await playhead(301); await presented(page, 301); await playhead(300); await presented(page, 300)
        const afterImage = await png(page, path.join(root, 'program-300-after.png'))
        evidence.imageRoundTrip = { clip: edited.clip, media: editedMedia, difference: await pixelDifference(before.file, afterImage.file) }
        assert.ok(evidence.imageRoundTrip.difference.equal || evidence.imageRoundTrip.difference.psnr >= 40, JSON.stringify(evidence.imageRoundTrip.difference))
        evidence.phases.push('节目帧→V3图片编辑→独立栅格→原帧上方，节目画面一致'); await shot('creative-image-backfilled-4k')
        // Stage timings come from the formal structured log query, not ad-hoc instrumentation.
        evidence.stageLogs = await page.evaluate(async after => {
          const read = async keyword => (await window.henjiNative.logging.queryLogEvents({ date: after.slice(0, 10), afterTimestamp: after, keyword, limit: 50 })).events
          return [...await read('video_edit.creative_source.prepare.completed'), ...await read('video_edit.result.commit.completed')].map(event => ({ event: event.event, at: event.timestamp, context: event.context }))
        }, sceneStart)

        phase('voice-over')
        // 3.3：口播是 .henji-audio 文档，经正式接口造数据（audioEditDocumentFixture.cjs）
        const created = await createAudioEditDocument(page, { sourcePath: voice, name: '回填口播', granularity: 'word', transcriptRows: [
          ['cut', '删去', 0, 1, false], ['keep', '保留字幕', 1.5, 2.5, true],
        ] })
        audioProjectId = created.id
        await playhead(60)
        await context.setupToolbox(page); await context.clickNamedButton(page, /^(口播剪辑)/)
        await page.getByRole('button', { name: /回填口播/ }).first().click()
        // 4.1：剪后声音直接写进剪辑所在项目的“生成结果”（不再弹保存对话框）
        await page.getByRole('button', { name: /加入剪辑/ }).click(); const voiceAdd = page.getByRole('menuitem', { name: /加入播放头/ })
        await voiceAdd.waitFor({ state: 'visible' }); evidence.voiceLabel = await voiceAdd.innerText(); at = performance.now(); await voiceAdd.click()
        const voiced = await savedClip(page, file, clip => clip.creativeSource?.type === 'document' && clip.creativeSource.docRef.docId === audioProjectId, '口播结果没有回填序列')
        evidence.timings.voiceMs = performance.now() - at
        const wavPath = voiced.document.media.find(media => media.id === voiced.document.items.find(item => item.id === voiced.clip.itemId).mediaId).path
        assert.equal(normalized(path.dirname(wavPath)), normalized(path.join(editProject.projectPath, '生成结果')), `剪后声音应写进项目“生成结果”：${wavPath}`)
        const voiceProbe = mediaProbe(ffprobePath, wavPath); const voiceStream = voiceProbe.streams.find(stream => stream.codec_type === 'audio')
        assert.equal(Number(voiceStream.sample_rate), 48000); assert.ok(Math.abs(Number(voiceProbe.format.duration) - 4) < 0.02, `剪后时长应为4秒：${voiceProbe.format.duration}`)
        assert.ok(fs.existsSync(wavPath.replace(/\.wav$/, '.srt')))
        assert.equal(voiced.clip.start, 60); assert.equal(voiced.clip.duration, 240)
        const caption = voiced.document.sequences[0].captions.find(value => value.clipId === voiced.clip.id)
        assert.ok(caption, '口播字幕应与音频同事务进入序列'); assert.equal(caption.start, 90); assert.equal(caption.text, '保留字幕')
        evidence.voice = { clip: voiced.clip, caption, probe: voiceProbe.format }; evidence.phases.push('口播剪后WAV/SRT：采样帧→序列帧，字幕按剪后时钟落位')

        phase('camera-stage')
        await playhead(360)
        const { canvasId, resultNodeId } = stage
        await context.setupCanvas(page)
        if (!await page.locator(`.react-flow__node[data-id="${resultNodeId}"]`).count()) {
          if (await page.locator('.react-flow').count()) { await page.getByRole('button', { name: /返回画布列表|Back to Canvases/ }).click(); await context.settlePage(page) }
          await page.locator(`[data-project-id="${canvasId}"]:visible`).click()
        }
        const resultNode = page.locator(`.react-flow__node[data-id="${resultNodeId}"]`); await resultNode.waitFor({ state: 'visible', timeout: 15000 }); await resultNode.click()
        at = performance.now(); await page.getByRole('button', { name: '加入剪辑', exact: true }).click()
        const staged = await savedClip(page, file, clip => clip.creativeSource?.type === 'document' && clip.creativeSource.part === resultNodeId, '三维正式渲染没有回填序列')
        evidence.timings.cameraStageMs = performance.now() - at
        assert.equal(staged.clip.start, 360)
        const stagedMedia = staged.document.media.find(media => media.id === staged.document.items.find(item => item.id === staged.clip.itemId).mediaId)
        evidence.cameraStage = { clip: staged.clip, media: stagedMedia, note: '三维源为既有1080p输出，目标序列与导出保持4K60' }
        await shot('creative-camera-stage-sent')
        // Same canvas completion through the public canvas-node source, replacing the 3D clip in place.
        const nodeRead = await callTool(client, 'read_application_entity', { ref: projectRef })
        const canvasReplace = await callTool(client, 'place_video_edit_creative_result', operationEnvelope([nodeRead], { documentRef: projectRef, sequenceRef: { kind: 'video_edit.sequence', id: `${PROJECT_ID}:main` }, placement: { mode: 'replace', clipRef: { kind: 'video_edit.clip', id: `${PROJECT_ID}:${staged.clip.id}` } }, result: { type: 'document', documentRef: { kind: 'documents.document', id: canvasId }, nodeRef: { kind: 'canvas.node', id: `${canvasId}:${resultNodeId}` } } }))
        assert.equal(canvasReplace.verificationState, 'verified', JSON.stringify(canvasReplace))
        assert.deepEqual(readProject(file).sequences[0].clips.find(clip => clip.id === staged.clip.id).creativeSource.part, resultNodeId)
        evidence.phases.push('三维正式完成结果经画布节点工具条进入播放头；同一完成节点经MCP画布来源替换')

        phase('reopen-export')
        await openEdit(); const persisted = readProject(file)
        await leaveVideoEditProject(page, null); await waitReleased(page)
        await openVideoEditProjectCard(page, editProject.projectId); await presented(page, 0)
        const reopened = readProject(file); assert.deepEqual(reopened.sequences[0].clips, persisted.sequences[0].clips)
        await playhead(300); await presented(page, 300)
        const reopenedFrame = await png(page, path.join(root, 'program-300-reopened.png'))
        evidence.reopenDifference = await pixelDifference(afterImage.file, reopenedFrame.file); assert.ok(evidence.reopenDifference.equal)
        const exportPath = path.join(root, `creative-${Date.now()}.mp4`); await dialogs(app, [], exportPath); at = performance.now(); await button(page, '导出视频').click()
        let task
        for (let attempt = 0; attempt < 6000; attempt++) { task = await callTool(client, 'query_video_edit_export', { documentRef: projectRef }); if (['completed', 'failed', 'cancelled'].includes(task.data.task?.state)) break; await page.waitForTimeout(50) }
        assert.equal(task.data.task?.state, 'completed', JSON.stringify(task))
        const metadata = mediaProbe(ffprobePath, exportPath); const exportedVideo = metadata.streams.find(stream => stream.codec_type === 'video'); const exportedAudio = metadata.streams.find(stream => stream.codec_type === 'audio')
        assert.equal(exportedVideo.width, 3840); assert.equal(exportedVideo.height, 2160); assert.equal(exportedVideo.avg_frame_rate, '60/1'); const timelineEnd = Math.max(...reopened.sequences[0].clips.map(clip => clip.start + clip.duration)); assert.equal(Number(exportedVideo.nb_frames), timelineEnd)
        assert.equal(Number(exportedAudio.sample_rate), 48000); assert.equal(exportedAudio.channels, 2)
        const decoded = path.join(root, 'export-300.png'); execFileSync(ffmpegPath, ['-v', 'error', '-y', '-i', exportPath, '-vf', 'select=eq(n\\,300)', '-frames:v', '1', decoded], { windowsHide: true, timeout: 60000 })
        evidence.export = { path: exportPath, elapsedMs: performance.now() - at, metadata, frame300: await pixelDifference(decoded, reopenedFrame.file) }
        assert.ok(evidence.export.frame300.psnr === null || evidence.export.frame300.psnr >= 30, JSON.stringify(evidence.export.frame300))
        evidence.phases.push('保存重开片段与画面一致；4K60整条时间线/48k双声道成片含全部回填结果'); await shot('creative-results-reopened-4k60')

        await button(page, '关闭项目').click(); await waitReleased(page)
        const now = fs.statSync(ORIGINAL); assert.equal(now.size, original.size); assert.equal(now.mtimeMs, original.mtimeMs)
        evidence.resources = await workerSnapshot(page); assert.equal(evidence.resources.live, 0)
        evidence.originalUnchanged = true; evidence.completed = true; store()
      } catch (error) { evidence.failed = { phase: evidence.currentPhase, message: String(error.message ?? error), stack: error.stack }; store(); await shot('creative-results-failed').catch(() => {}); throw error }
      finally {
        await client?.close().catch(() => {}); await disableMcp(page).catch(() => {})
        await removeAudioEditDocument(page, audioProjectId)
        if (await button(page, '关闭项目').isVisible().catch(() => false)) await button(page, '关闭项目').click().catch(() => {})
        if (observed) { await waitReleased(page).catch(error => { evidence.completed = false; evidence.releaseFailure = String(error) }); evidence.resources = await workerSnapshot(page).catch(() => evidence.resources) }
        await page.evaluate(() => { window.__videoLayoutObservers?.forEach(observer => observer.disconnect()); if (window.__videoLayoutNativeWorker) window.Worker = window.__videoLayoutNativeWorker }).catch(() => {}); store()
      }
    },
  }
}
module.exports = { createVideoEditCreativeResultsScene }
