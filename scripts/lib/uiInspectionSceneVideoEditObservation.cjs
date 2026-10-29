const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')
const { execFileSync } = require('node:child_process')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope, readAllMedia } = require('./uiInspectionMcpClient.cjs')
const { openVideoEditProjectCard, readVideoEditFile, seedVideoEditProject, showVideoEditProjects } = require('./uiInspectionVideoEditDocuments.cjs')
const { presented, png, pixelDifference, mediaProbe } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const { observeWorkers, workerSnapshot } = require('./uiInspectionSceneVideoEditLayout.cjs')
const authorSources = require('./uiInspectionAuthorSources.cjs')

const SOURCE = authorSources.OBSERVATION_SOURCES.flash
const SOUND_SOURCE = authorSources.OBSERVATION_SOURCES.sound
const INPUT_SOURCE = authorSources.OBSERVATION_SOURCES.input
const SHARED_INPUT_SOURCE = authorSources.OBSERVATION_SOURCES.shared
const MOTION_SOURCE = authorSources.OBSERVATION_SOURCES.motion
const LENS_SOURCE = authorSources.OBSERVATION_SOURCES.lens
async function pixel(bytes, x, y) {
  return [...await sharp(bytes).extract({ left: x, top: y, width: 1, height: 1 }).removeAlpha().raw().toBuffer()]
}
function near(actual, expected) { assert.ok(actual.every((value, index) => Math.abs(value - expected[index]) <= 4), `像素不符：${actual}，期望${expected}`) }

function createVideoEditObservationScene() {
  return { id: 'video-edit-observation-review', surface: '剪辑', name: '剪辑-定向连续帧局部放大与参考比较', writesUserData: true,
    setup: async (page, app, { capture }) => {
      assert.ok(await app.evaluate(() => Boolean(process.env.HENJI_ISOLATED_APP_DATA)), '输入性能测量只允许隔离资料目录')
      const root = path.resolve('node_modules/.cache/video-edit-observation-review'); fs.mkdirSync(root, { recursive: true })
      const referencePath = path.join(root, 'reference.png')
      const videoReferencePath = path.join(root, 'reference.mp4')
      const soundPath = path.join(root, 'sound.wav')
      const pcm = Buffer.alloc(44 + 96000 * 2)
      pcm.write('RIFF', 0); pcm.writeUInt32LE(pcm.length - 8, 4); pcm.write('WAVEfmt ', 8); pcm.writeUInt32LE(16, 16)
      pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(48000, 24); pcm.writeUInt32LE(96000, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(pcm.length - 44, 40)
      for (let i = 0; i < 96000; i++) pcm.writeInt16LE(Math.round((i < 48000 ? .1 : .4) * 32767), 44 + i * 2)
      fs.writeFileSync(soundPath, pcm)
      await sharp({ create: { width: 640, height: 360, channels: 3, background: { r: 0, g: 0, b: 255 } } }).png().toFile(referencePath)
      const { ffmpegPath } = require('./mediaBinaries.cjs')
      // lavfi color starts in BT.601 YUV; encode/tag the same BT.709 matrix + sRGB transfer as our frame exporter.
      execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', "color=c=green:s=360x640:r=60:d=2,drawbox=color=yellow:t=fill:enable='gte(t,1)'", '-vf', 'scale=in_range=limited:out_range=limited:in_color_matrix=bt601:out_color_matrix=bt709', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', videoReferencePath], { windowsHide: true, timeout: 30000 })
      const track = index => ({ id: `v${index}`, name: `视频 ${index}`, index, kind: 'video', locked: false, enabled: true, muted: false, solo: false })
      const fixture = { id: 'video-edit-observation-review', name: '定向观察验收', media: [{ id: 'reference', name: '蓝色参考', path: referencePath, kind: 'image', width: 640, height: 360, durationSeconds: 0 }, { id: 'video-reference', name: '竖版变色参考', path: videoReferencePath, kind: 'video', width: 360, height: 640, durationSeconds: 2, hasAudio: false, frameRate: { numerator: 60, denominator: 1 } }],
        items: [{ id: 'reference-item', name: '蓝色参考', kind: 'image', mediaId: 'reference' }, { id: 'video-reference-item', name: '竖版变色参考', kind: 'video', mediaId: 'video-reference' }], bins: [],
        sequences: [{ id: 'main', name: '主序列', width: 640, height: 360, frameRate: { numerator: 60, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
          tracks: [track(1), track(2)], clips: [{ id: 'base', itemId: 'reference-item', name: '蓝色底图', kind: 'image', track: 1, start: 0, duration: 120, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '' }], captions: [{ id: 'review-caption', text: '检查', start: 30, duration: 1 }], annotations: [] }] }
      fixture.media.push({ id: 'sound', name: '声音电平夹具', path: soundPath, kind: 'audio', width: 0, height: 0, durationSeconds: 2, hasAudio: true })
      fixture.items.push({ id: 'sound-item', name: '声音电平夹具', kind: 'audio', mediaId: 'sound' })
      fixture.sequences[0].tracks.push({ ...track(0), kind: 'audio', name: '声音' }, track(3), track(4), track(5), track(6))
      let client
      const evidence = { completed: false, observations: [] }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      try {
        await observeWorkers(page)
        await showVideoEditProjects(page)
        const seeded = await seedVideoEditProject(page, fixture)
        await page.evaluate(async ({ source, sound, projectId, id }) => {
          const documents = window.henjiNative.documents
          const resource = await documents.importFile({ sourcePath: source, container: { kind: 'project', projectId }, folder: 'materials' })
          const read = await documents.readDocument({ id })
          const media = read.content.media.find(value => value.id === 'video-reference')
          media.path = resource.path
          media.assetContent = await window.henjiNative.assetLibrary.inspectFileContent(resource.path, 'video')
          const soundResource = await documents.importFile({ sourcePath: sound, container: { kind: 'project', projectId }, folder: 'materials' })
          const soundMedia = read.content.media.find(value => value.id === 'sound')
          soundMedia.path = soundResource.path
          soundMedia.assetContent = await window.henjiNative.assetLibrary.inspectFileContent(soundResource.path, 'audio')
          read.content.sequences[0].clips[0].itemId = 'video-reference-item'; read.content.sequences[0].clips[0].kind = 'video'
          await documents.saveDocument({ target: { id }, expectedRevision: read.meta.revision, content: read.content })
        }, { source: videoReferencePath, sound: soundPath, projectId: seeded.projectId, id: seeded.documentId })
        await openVideoEditProjectCard(page, seeded.projectId)
        const identity = await authorizeMcpConnection(page, { name: '定向观察验收' })
        client = await connectMcpClient(identity.config, 'Henji observation Reality')
        const documentRef = { kind: 'video_edit.document', id: seeded.documentId }
        const sequenceRef = { kind: 'video_edit.sequence', id: `${seeded.documentId}:main` }
        const baseline = await callTool(client, 'read_application_entity', { ref: documentRef })
        const created = await callTool(client, 'change_application_entities', operationEnvelope([baseline], { summary: '创建单帧闪动验收素材', changes: [{ kind: 'create_items', entityType: 'video_edit.code_material', parent: documentRef, items: [{ properties: { 'video_edit.code_material.source': SOURCE } }] }] }))
        assert.equal(created.verificationState, 'verified', JSON.stringify(created))
        const item = readVideoEditFile(seeded.file).items.find(item => item.kind === 'code'); assert.ok(item)
        const seqRead = await callTool(client, 'read_application_entity', { ref: sequenceRef })
        const inserted = await callTool(client, 'change_application_entities', operationEnvelope([seqRead], { summary: '插入单帧闪动', changes: [{ kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: [{ properties: {
          'video_edit.clip.item_id': item.id, 'video_edit.clip.name': '单帧闪动', 'video_edit.clip.kind': 'code', 'video_edit.clip.track': 2, 'video_edit.clip.start': 0, 'video_edit.clip.duration': 120,
        } }] }] }))
        assert.equal(inserted.verificationState, 'verified', JSON.stringify(inserted))
        const before = readVideoEditFile(seeded.file)
        const stateBefore = (await callTool(client, 'read_application_entity', { ref: documentRef, propertyIds: ['video_edit.document.frame', 'video_edit.document.selection'] })).data.properties
        const observe = async (name, target, options = {}) => {
          const result = await callTool(client, 'observe_video_edit_frame', { documentRef, target: { sequenceRef, ...target }, maxWidth: 640, ...options })
          const data = result.data ?? result.result?.data
          assert.ok(data?.verification?.verified, JSON.stringify(result))
          const media = await readAllMedia(client, data.resultRef)
          fs.writeFileSync(path.join(root, `${name}.png`), media.bytes)
          evidence.observations.push({ name, ...data }); store()
          return { data, bytes: media.bytes }
        }
        const exportFrame = async (name, frame, reference, roi) => {
          const baseline = await callTool(client, 'read_application_entity', { ref: documentRef })
          const exported = await callTool(client, 'export_video_edit', operationEnvelope([baseline], { documentRef, range: { startFrame: frame, endFrame: frame + 1 }, settings: { format: 'mp4', width: 640, height: 360, fps: 60, videoBitrateMbps: 20, audioBitrateKbps: 192, fit: 'fit', loudness: null, encoderPreference: 'software', audioEnabled: false, addToLibrary: false } }))
          const exportData = exported.data ?? exported.result?.data
          const jobId = exportData?.queue?.[0]?.id; assert.ok(jobId, JSON.stringify(exported))
          let job
          for (let attempt = 0; attempt < 120; attempt++) {
            const progress = await callTool(client, 'query_video_edit_export', { documentRef, taskId: jobId, detail: 'full' })
            job = progress.data.queue.find(value => value.id === jobId)
            if (job && ['completed', 'failed', 'cancelled'].includes(job.state)) break
            await page.waitForTimeout(500)
          }
          assert.equal(job?.state, 'completed', JSON.stringify(job)); assert.ok(job.outputReady && job.path && fs.existsSync(job.path), JSON.stringify(job))
          const { ffprobePath } = require('./mediaBinaries.cjs')
          const video = mediaProbe(ffprobePath, job.path).streams.find(value => value.codec_type === 'video')
          assert.equal(video.width, 640); assert.equal(video.height, 360); assert.equal(video.avg_frame_rate, '60/1'); assert.equal(Number(video.nb_frames), 1)
          const decoded = path.join(root, `${name}-export.png`)
          execFileSync(ffmpegPath, ['-v', 'error', '-y', '-i', job.path, '-frames:v', '1', decoded], { windowsHide: true, timeout: 30000 })
          const exportDifference = await pixelDifference(decoded, reference, roi)
          assert.ok(exportDifference.psnr === null || exportDifference.psnr >= 30, `实际成片效果区域须与预览匹配：${JSON.stringify(exportDifference)}`)
          return { path: job.path, frameCount: Number(video.nb_frames), exportDifference }
        }
        const list = await observe('frames', { kind: 'frames', frames: [31, 29, 30, 29] })
        assert.deepEqual(list.data.contactSheet.frames, [29, 30, 31])
        near(await pixel(list.bytes, 160, 90), [0, 0, 255]); near(await pixel(list.bytes, 480, 90), [255, 0, 0]); near(await pixel(list.bytes, 160, 270), [0, 0, 255])
        const cut = await observe('near-cut', { kind: 'near_cut', cutFrame: 30, before: 1, after: 1 })
        assert.deepEqual(cut.data.contactSheet.frames, [29, 30, 31]); near(await pixel(cut.bytes, 480, 90), [255, 0, 0])
        const crop = await observe('crop', { kind: 'program', frame: 30 }, { cropRegion: { x: .25, y: .25, width: .5, height: .5 }, maxWidth: 320 })
        assert.deepEqual([crop.data.width, crop.data.height], [320, 180]); near(await pixel(crop.bytes, 160, 90), [255, 0, 0])
        const compare = await observe('compare', { kind: 'program', frame: 30 }, { reference: { itemRef: { kind: 'video_edit.item', id: `${seeded.documentId}:reference-item` } } })
        near(await pixel(compare.bytes, 160, 90), [255, 0, 0]); near(await pixel(compare.bytes, 480, 90), [0, 0, 255])
        assert.deepEqual(compare.data.comparison.referenceTimesUs, [0])
        const plan = (await callTool(client, 'query_video_edit_review', { documentRef, sequenceRef, from: 0, to: 120 })).data
        assert.ok(plan.checkpoints.frames.includes(30), JSON.stringify(plan)); evidence.plan = plan
        const automatic = await observe('automatic', { kind: 'frames', frames: plan.checkpoints.frames }, { documentVersion: plan.documentVersion })
        assert.deepEqual(automatic.data.contactSheet.frames, plan.checkpoints.frames)
        const videoCompare = await observe('compare-video', { kind: 'frames', frames: [0, 30] }, { documentVersion: plan.documentVersion, reference: { itemRef: { kind: 'video_edit.item', id: `${seeded.documentId}:video-reference-item` }, offsetUs: 500000 } })
        assert.deepEqual(videoCompare.data.comparison.referenceTimesUs, [500000, 1000000])
        near(await pixel(videoCompare.bytes, 80, 45), [0, 0, 255]); near(await pixel(videoCompare.bytes, 240, 45), [0, 128, 0])
        near(await pixel(videoCompare.bytes, 400, 45), [255, 0, 0]); near(await pixel(videoCompare.bytes, 560, 45), [255, 255, 0])
        assert.notDeepEqual(await pixel(videoCompare.bytes, 170, 45), await pixel(videoCompare.bytes, 240, 45), '竖版参考应保留画幅并留边')
        for (const observation of evidence.observations) assert.equal(observation.documentVersion, list.data.documentVersion)
        assert.deepEqual(readVideoEditFile(seeded.file), before)
        assert.deepEqual((await callTool(client, 'read_application_entity', { ref: documentRef, propertyIds: ['video_edit.document.frame', 'video_edit.document.selection'] })).data.properties, stateBefore)
        const motionPlan = (await callTool(client, 'query_video_edit_review', { documentRef, sequenceRef, from: 0, to: 120, motion: { videoPixels: true, minimumHoldSeconds: .25 }, limit: 50 })).data
        assert.ok(motionPlan.records.some(record => record.kind === 'code_change' && record.motionEvidence?.basis === 'code_structure' && record.timeline.fromFrame === 30), JSON.stringify(motionPlan))
        assert.ok(motionPlan.records.some(record => record.kind === 'pixel_cut' && record.motionEvidence?.basis === 'video_pixels' && record.timeline.fromFrame >= 55 && record.timeline.fromFrame <= 65), JSON.stringify(motionPlan))
        assert.ok(motionPlan.records.some(record => record.kind === 'pixel_still'), JSON.stringify(motionPlan))
        assert.ok(motionPlan.records.filter(record => record.motionEvidence?.basis === 'video_pixels').every(record => record.subjectRef.id.endsWith(':base') && record.source), JSON.stringify(motionPlan))
        evidence.motionPlan = motionPlan; store()
        const motionObserved = await observe('motion-review', { kind: 'frames', frames: motionPlan.checkpoints.frames }, { documentVersion: motionPlan.documentVersion })
        assert.deepEqual(motionObserved.data.contactSheet.frames, motionPlan.checkpoints.frames)
        assert.deepEqual(readVideoEditFile(seeded.file), before)
        assert.deepEqual((await callTool(client, 'read_application_entity', { ref: documentRef, propertyIds: ['video_edit.document.frame', 'video_edit.document.selection'] })).data.properties, stateBefore)
        const soundBaseline = await callTool(client, 'read_application_entity', { ref: documentRef })
        const soundCreated = await callTool(client, 'change_application_entities', operationEnvelope([soundBaseline], { summary: '创建声音驱动画面验收素材', changes: [{ kind: 'create_items', entityType: 'video_edit.code_material', parent: documentRef, items: [{ properties: { 'video_edit.code_material.source': SOUND_SOURCE } }] }] }))
        assert.equal(soundCreated.verificationState, 'verified', JSON.stringify(soundCreated))
        const soundItem = readVideoEditFile(seeded.file).items.find(value => value.kind === 'code' && value.id !== item.id); assert.ok(soundItem)
        const soundSeq = await callTool(client, 'read_application_entity', { ref: sequenceRef })
        const soundPlaced = await callTool(client, 'change_application_entities', operationEnvelope([soundSeq], { summary: '放置声音与驱动画面', changes: [{ kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: [
          { properties: { 'video_edit.clip.item_id': 'sound-item', 'video_edit.clip.name': '声音电平', 'video_edit.clip.kind': 'audio', 'video_edit.clip.track': 0, 'video_edit.clip.start': 0, 'video_edit.clip.duration': 120 } },
          { properties: { 'video_edit.clip.item_id': soundItem.id, 'video_edit.clip.name': '声音驱动', 'video_edit.clip.kind': 'code', 'video_edit.clip.track': 3, 'video_edit.clip.start': 0, 'video_edit.clip.duration': 120 } },
        ] }] }))
        assert.equal(soundPlaced.verificationState, 'verified', JSON.stringify(soundPlaced))
        const soundBefore = readVideoEditFile(seeded.file)
        const soundClip = soundBefore.sequences[0].clips.find(value => value.itemId === soundItem.id)
        const soundPlan = (await callTool(client, 'query_video_edit_review', { documentRef, sequenceRef, from: 0, to: 120, motion: { minimumHoldSeconds: .25 }, limit: 50 })).data
        assert.ok(soundPlan.records.some(record => record.kind === 'motion' && record.motionEvidence?.basis === 'code_structure' && record.subjectRef.id.endsWith(`:${soundClip.id}`) && record.timeline.fromFrame >= 58 && record.timeline.fromFrame <= 61), JSON.stringify(soundPlan))
        assert.ok(!soundPlan.records.some(record => record.kind === 'code_unavailable'), JSON.stringify(soundPlan))
        evidence.soundPlan = soundPlan; store()
        const soundObserved = await observe('sound-review', { kind: 'frames', frames: [59, 61] }, { documentVersion: soundPlan.documentVersion })
        near(await pixel(soundObserved.bytes, 40, 50), [0, 255, 0]); near(await pixel(soundObserved.bytes, 435, 50), [0, 255, 0])
        near(await pixel(soundObserved.bytes, 115, 50), [0, 0, 255]); near(await pixel(soundObserved.bytes, 360, 50), [0, 0, 255])
        assert.deepEqual(readVideoEditFile(seeded.file), soundBefore)
        assert.deepEqual((await callTool(client, 'read_application_entity', { ref: documentRef, propertyIds: ['video_edit.document.frame', 'video_edit.document.selection'] })).data.properties, stateBefore)
        const inputBaseline = await callTool(client, 'read_application_entity', { ref: documentRef })
        const inputCreated = await callTool(client, 'change_application_entities', operationEnvelope([inputBaseline], { summary: '创建画面输入验收素材', changes: [{ kind: 'create_items', entityType: 'video_edit.code_material', parent: documentRef, items: [{ properties: { 'video_edit.code_material.source': INPUT_SOURCE } }] }] }))
        assert.equal(inputCreated.verificationState, 'verified', JSON.stringify(inputCreated))
        const inputItem = readVideoEditFile(seeded.file).items.find(value => value.kind === 'code' && ![item.id, soundItem.id].includes(value.id)); assert.ok(inputItem)
        const inputSeq = await callTool(client, 'read_application_entity', { ref: sequenceRef })
        const inputPlaced = await callTool(client, 'change_application_entities', operationEnvelope([inputSeq], { summary: '放置视频输入画面', changes: [{ kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: [{ properties: {
          'video_edit.clip.item_id': inputItem.id, 'video_edit.clip.name': '画面输入', 'video_edit.clip.kind': 'code', 'video_edit.clip.track': 4, 'video_edit.clip.start': 0, 'video_edit.clip.duration': 120,
          'video_edit.clip.code_parameters': { picture: { kind: 'video', mediaId: 'video-reference' } },
        } }] }] }))
        assert.equal(inputPlaced.verificationState, 'verified', JSON.stringify(inputPlaced))
        const inputClip = readVideoEditFile(seeded.file).sequences[0].clips.find(value => value.itemId === inputItem.id)
        const inputRef = { kind: 'video_edit.clip', id: `${seeded.documentId}:${inputClip.id}` }
        for (const mode of ['video', 'fixed', 'sequence']) {
          if (mode !== 'video') {
            const baseline = await callTool(client, 'read_application_entity', { ref: inputRef })
            const changed = await callTool(client, 'change_application_entities', operationEnvelope([baseline], { summary: '切换画面输入验收', changes: [{ kind: 'set_properties', entityType: inputRef.kind, target: inputRef, properties: { 'video_edit.clip.code_parameters': { picture: mode === 'fixed' ? { kind: 'video', mediaId: 'video-reference', time: .5 } : { kind: 'sequence', mediaId: 'below' } } } }] }))
            assert.equal(changed.verificationState, 'verified', JSON.stringify(changed))
          }
          const unchanged = readVideoEditFile(seeded.file)
          const plan = (await callTool(client, 'query_video_edit_review', { documentRef, sequenceRef, from: 0, to: 120, motion: { videoPixels: true, minimumHoldSeconds: .25 }, limit: 50 })).data
          const candidates = plan.records.filter(record => record.motionEvidence?.basis === 'code_input_pixels' && record.subjectRef.id === inputRef.id)
          assert.ok(candidates.length && candidates.every(record => record.motionEvidence.input.mediaRef.id === `${seeded.documentId}:video-reference`), JSON.stringify(plan))
          if (mode === 'fixed') assert.ok(!candidates.some(record => ['motion', 'pixel_cut', 'pixel_change'].includes(record.kind)), JSON.stringify(candidates))
          else assert.ok(candidates.some(record => record.kind === 'pixel_cut'), JSON.stringify(candidates))
          const observed = await observe(`input-${mode}`, { kind: 'frames', frames: [0, 60] }, { documentVersion: plan.documentVersion })
          near(await pixel(observed.bytes, 160, 90), mode === 'sequence' ? [0, 0, 255] : [0, 128, 0])
          near(await pixel(observed.bytes, 480, 90), mode === 'sequence' ? [0, 0, 255] : mode === 'fixed' ? [0, 128, 0] : [255, 255, 0])
          evidence[`input_${mode}`] = plan; store()
          assert.deepEqual(readVideoEditFile(seeded.file), unchanged)
          assert.deepEqual((await callTool(client, 'read_application_entity', { ref: documentRef, propertyIds: ['video_edit.document.frame', 'video_edit.document.selection'] })).data.properties, stateBefore)
        }
        await observe('input-export-frame', { kind: 'program', frame: 60 })
        evidence.inputExport = await exportFrame('input', 60, path.join(root, 'input-export-frame.png'), { left: 0, top: 0, width: 640, height: 360 }); store()
        const motionBaseline = await callTool(client, 'read_application_entity', { ref: documentRef })
        const motionCreated = await callTool(client, 'change_application_entities', operationEnvelope([motionBaseline], { summary: '创建API2运动曝光验收素材', changes: [{ kind: 'create_items', entityType: 'video_edit.code_material', parent: documentRef, items: [{ properties: { 'video_edit.code_material.source': MOTION_SOURCE } }] }] }))
        assert.equal(motionCreated.verificationState, 'verified', JSON.stringify(motionCreated))
        const motionItem = readVideoEditFile(seeded.file).items.find(value => value.name === '快门曝光验收' && value.kind === 'code'); assert.ok(motionItem)
        const motionSeq = await callTool(client, 'read_application_entity', { ref: sequenceRef })
        const motionPlaced = await callTool(client, 'change_application_entities', operationEnvelope([motionSeq], { summary: '放置运动曝光画面', changes: [{ kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: [{ properties: {
          'video_edit.clip.item_id': motionItem.id, 'video_edit.clip.name': '运动曝光', 'video_edit.clip.kind': 'code', 'video_edit.clip.track': 5, 'video_edit.clip.start': 0, 'video_edit.clip.duration': 120,
        } }] }] }))
        assert.equal(motionPlaced.verificationState, 'verified', JSON.stringify(motionPlaced))
        const motionBefore = readVideoEditFile(seeded.file)
        const blurred = await observe('motion-enabled', { kind: 'program', frame: 60 })
        const left = await pixel(blurred.bytes, 154, 180), center = await pixel(blurred.bytes, 162, 180)
        assert.ok(left[0] > 0 && left[0] < center[0], `曝光应有渐变拖影：${left}/${center}`)
        near(await pixel(blurred.bytes, 178, 180), [0, 0, 0])
        await observe('motion-seek', { kind: 'program', frame: 61 })
        const replay = await observe('motion-replay', { kind: 'program', frame: 60 })
        assert.deepEqual(await sharp(replay.bytes).ensureAlpha().raw().toBuffer(), await sharp(blurred.bytes).ensureAlpha().raw().toBuffer())
        assert.deepEqual(readVideoEditFile(seeded.file), motionBefore)
        const playbackBaseline = await callTool(client, 'read_application_entity', { ref: documentRef })
        const seeked = await callTool(client, 'change_application_entities', operationEnvelope([playbackBaseline], { summary: '核对运动曝光真实节目预览', changes: [{ kind: 'set_properties', entityType: documentRef.kind, target: documentRef, properties: { 'video_edit.document.program_playback': { frame: 60, playing: false, playbackDirection: 1 } } }] }))
        assert.equal(seeked.verificationState, 'verified', JSON.stringify(seeked)); await presented(page, 60)
        const preview = await png(page, path.join(root, 'motion-preview.png'), { width: 640, height: 360 })
        const previewDifference = await pixelDifference(preview.file, path.join(root, 'motion-enabled.png'))
        assert.ok(previewDifference.equal, `节目预览与观察像素须一致：${JSON.stringify(previewDifference)}`)
        evidence.motionPreviewCapture = await capture('motion-exposure-preview'); store()
        evidence.motionExport = { ...await exportFrame('motion', 60, preview.file, { left: 140, top: 160, width: 48, height: 40 }), previewDifference }; store()
        const restoreBaseline = await callTool(client, 'read_application_entity', { ref: documentRef })
        const restored = await callTool(client, 'change_application_entities', operationEnvelope([restoreBaseline], { summary: '恢复验收前播放头', changes: [{ kind: 'set_properties', entityType: documentRef.kind, target: documentRef, properties: { 'video_edit.document.program_playback': { frame: stateBefore['video_edit.document.frame'], playing: false, playbackDirection: 1 } } }] }))
        assert.equal(restored.verificationState, 'verified', JSON.stringify(restored)); await presented(page, stateBefore['video_edit.document.frame'])
        const motionClip = motionBefore.sequences[0].clips.find(value => value.itemId === motionItem.id)
        const motionRef = { kind: 'video_edit.clip', id: `${seeded.documentId}:${motionClip.id}` }
        const motionRead = await callTool(client, 'read_application_entity', { ref: motionRef })
        const disabled = await callTool(client, 'change_application_entities', operationEnvelope([motionRead], { summary: '关闭运动曝光比较原画面', changes: [{ kind: 'set_properties', entityType: motionRef.kind, target: motionRef, properties: { 'video_edit.clip.code_parameters': { blurEnabled: false } } }] }))
        assert.equal(disabled.verificationState, 'verified', JSON.stringify(disabled))
        const disabledBefore = readVideoEditFile(seeded.file)
        const sharpFrame = await observe('motion-disabled', { kind: 'program', frame: 60 })
        near(await pixel(sharpFrame.bytes, 154, 180), [0, 0, 0])
        const sharpCenter = await pixel(sharpFrame.bytes, 162, 180)
        assert.ok(sharpCenter[0] > center[0], `关闭后应保留清晰中心：${sharpCenter}/${center}`)
        assert.deepEqual(readVideoEditFile(seeded.file), disabledBefore)
        assert.deepEqual((await callTool(client, 'read_application_entity', { ref: documentRef, propertyIds: ['video_edit.document.frame', 'video_edit.document.selection'] })).data.properties, stateBefore)
        evidence.motionExposure = { apiVersion: 2, left, center, disabledCenter: sharpCenter, replayExact: true }; store()
        const lensBaseline = await callTool(client, 'read_application_entity', { ref: documentRef })
        const lensCreated = await callTool(client, 'change_application_entities', operationEnvelope([lensBaseline], { summary: '创建分层焦点验收素材', changes: [{ kind: 'create_items', entityType: 'video_edit.code_material', parent: documentRef, items: [{ properties: { 'video_edit.code_material.source': LENS_SOURCE } }] }] }))
        assert.equal(lensCreated.verificationState, 'verified', JSON.stringify(lensCreated))
        const lensItem = readVideoEditFile(seeded.file).items.find(value => value.name === '层级焦点验收'); assert.ok(lensItem)
        const lensSequence = await callTool(client, 'read_application_entity', { ref: sequenceRef })
        const lensPlaced = await callTool(client, 'change_application_entities', operationEnvelope([lensSequence], { summary: '用参数曲线交换前后景焦点', changes: [{ kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: [{ properties: {
          'video_edit.clip.item_id': lensItem.id, 'video_edit.clip.name': '层级焦点', 'video_edit.clip.kind': 'code', 'video_edit.clip.track': 6, 'video_edit.clip.start': 0, 'video_edit.clip.duration': 120,
          'video_edit.clip.code_curves': { focus: [{ id: 'near', sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, value: 0, interpolation: 'linear' }, { id: 'far', sourceInUs: 1000000, sourceRemainder: { numerator: 0, denominator: 1 }, value: 1, interpolation: 'linear' }] },
        } }] }] }))
        assert.equal(lensPlaced.verificationState, 'verified', JSON.stringify(lensPlaced))
        const lensBefore = readVideoEditFile(seeded.file)
        const nearFocus = await observe('lens-focus-near', { kind: 'program', frame: 0 })
        const farFocus = await observe('lens-focus-far', { kind: 'program', frame: 60 })
        near(await pixel(nearFocus.bytes, 162, 180), [255, 0, 0]); near(await pixel(farFocus.bytes, 402, 180), [0, 0, 255])
        assert.ok((await pixel(farFocus.bytes, 162, 180))[0] < 200)
        assert.ok((await pixel(nearFocus.bytes, 402, 180))[2] < 200)
        near(await pixel(nearFocus.bytes, 150, 180), [0, 0, 0]); near(await pixel(farFocus.bytes, 390, 180), [0, 0, 0])
        assert.ok((await pixel(farFocus.bytes, 150, 180))[0] > 10); assert.ok((await pixel(nearFocus.bytes, 390, 180))[2] > 10)
        const replayLens = await observe('lens-replay', { kind: 'program', frame: 0 })
        assert.deepEqual(await sharp(replayLens.bytes).raw().toBuffer(), await sharp(nearFocus.bytes).raw().toBuffer())
        assert.deepEqual(readVideoEditFile(seeded.file), lensBefore)
        evidence.lensExport = await exportFrame('lens', 60, path.join(root, 'lens-focus-far.png'), { left: 128, top: 128, width: 320, height: 104 }); store()
        assert.deepEqual((await callTool(client, 'read_application_entity', { ref: documentRef, propertyIds: ['video_edit.document.frame', 'video_edit.document.selection'] })).data.properties, stateBefore)
        evidence.capture = await capture('observation-review-host'); store()
        const assets = fs.readdirSync(path.resolve('out/renderer/assets')).filter(name => /^videoEditCodeProbe-[\w-]+\.js$/.test(name))
        assert.equal(assets.length, 1)
        evidence.inputPerformance = await page.evaluate(async ({ asset, video, source }) => {
          const imported = await import(new URL(`./assets/${asset}`, window.location.href).href)
          const probe = imported.runVideoEditCodeInputProbe ? imported : Object.values(imported).find(value => value && typeof value === 'object' && typeof value.runVideoEditCodeInputProbe === 'function')
          const host = document.createElement('div'); host.dataset.codeInputProbe = ''; host.style.cssText = 'position:fixed;inset:80px 24px 40px;z-index:100'; document.body.appendChild(host)
          try { return await probe.runVideoEditCodeInputProbe(host, video, source) } catch (error) { host.remove(); throw error }
        }, { asset: assets[0], video: videoReferencePath, source: SHARED_INPUT_SOURCE }); store()
        assert.equal(evidence.inputPerformance.completed, true)
        await capture('shared-video-inputs')
        await page.locator('[data-code-input-probe]').evaluateAll(elements => elements.forEach(element => element.remove()))
        assert.equal(evidence.inputPerformance.disposed.codeInputSessions, 0)
        // Use the actual program monitor, its Worker and its two-frame pipeline.
        // Completion acknowledges the GPU queue; it does not measure physical scanout.
        const changed = async (refs, changes) => {
          const baselines = await Promise.all(refs.map(ref => callTool(client, 'read_application_entity', { ref })))
          const result = await callTool(client, 'change_application_entities', operationEnvelope(baselines, { summary: '测量四路视频输入正式回放', changes }))
          assert.equal(result.verificationState, 'verified', JSON.stringify(result))
        }
        const oldItems = new Set(readVideoEditFile(seeded.file).items.map(item => item.id))
        await changed([documentRef], [{ kind: 'create_items', entityType: 'video_edit.code_material', parent: documentRef, items: [{ properties: { 'video_edit.code_material.source': SHARED_INPUT_SOURCE } }] }])
        const sharedItem = readVideoEditFile(seeded.file).items.find(item => !oldItems.has(item.id) && item.kind === 'code'); assert.ok(sharedItem)
        const removed = readVideoEditFile(seeded.file).sequences[0].clips.filter(clip => clip.id !== 'base').map(clip => ({ kind: 'video_edit.clip', id: `${seeded.documentId}:${clip.id}` }))
        await changed([sequenceRef, ...removed], [
          { kind: 'remove_items', entityType: 'video_edit.clip', parent: sequenceRef, targets: removed },
          { kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: [{ properties: {
            'video_edit.clip.item_id': sharedItem.id, 'video_edit.clip.name': '四路输入回放', 'video_edit.clip.kind': 'code', 'video_edit.clip.track': 2, 'video_edit.clip.start': 0, 'video_edit.clip.duration': 120,
            'video_edit.clip.code_parameters': { a: { kind: 'video', mediaId: 'video-reference' }, b: { kind: 'video', mediaId: 'video-reference' }, c: { kind: 'sequence', mediaId: 'below' }, d: { kind: 'sequence', mediaId: 'below' } },
          } }] },
        ])
        const playback = (frame, playing) => changed([documentRef], [{ kind: 'set_properties', entityType: documentRef.kind, target: documentRef, properties: { 'video_edit.document.program_playback': { frame, playing, playbackDirection: 1 } } }])
        const canvas = page.locator('canvas[aria-label="剪辑画面"]')
        const stats = values => { const sorted = values.sort((a, b) => a - b); return { count: sorted.length, p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))], max: sorted.at(-1) } }
        const playbackEvidence = { resolutions: [[640, 360], [3840, 2160]], sourceResolution: [360, 640], fps: 60, expectedFrames: 120, measurement: 'Formal program monitor; GPU completion acknowledgements, not physical display scanout. Frame 0 is already paused and presented before play. 4K means output/compositing size; the source video remains 360x640.', runs: [] }
        evidence.inputPlayback = playbackEvidence; store()
        for (const [width, height] of playbackEvidence.resolutions) {
        if (width !== 640) await changed([sequenceRef], [{ kind: 'set_properties', entityType: sequenceRef.kind, target: sequenceRef, properties: { 'video_edit.sequence.width': width, 'video_edit.sequence.height': height } }])
        for (let round = 0; round < 2; round++) {
          await playback(0, false); await presented(page, 0)
          await page.waitForFunction(({ width, height }) => { const canvas = document.querySelector('canvas[aria-label="剪辑画面"]'); return canvas?.width === width && canvas.height === height && canvas.dataset.renderDivisor === '1' }, { width, height }, { timeout: 15000 })
          const marker = await page.evaluate(() => performance.now())
          await playback(0, true)
          await presented(page, 119)
          const clock = await canvas.evaluate(canvas => ({ startAt: Number(canvas.dataset.playClockStartAt), phases: JSON.parse(canvas.dataset.playStartPhases || 'null') }))
          const snapshot = await workerSnapshot(page)
          const owners = new Set(snapshot.workers.filter(worker => worker.direct && worker.sequenceId === 'main').map(worker => worker.id))
          const samples = snapshot.events.filter(event => owners.has(event.worker) && event.kind === 'render.completed' && event.at >= marker && event.frame > 0 && event.frame < 120 && event.presented)
          const unique = [...new Map(samples.map(sample => [sample.frame, sample])).values()].sort((a, b) => a.frame - b.frame)
          assert.equal(unique.length, 119, '正式回放必须完成所有后续帧，不能用跳帧提高测量帧率')
          assert.ok(Number.isFinite(clock.startAt) && clock.startAt >= marker, '必须读取本轮正式播放时钟')
          const first = unique[0], last = unique.at(-1), elapsedMs = last.at - clock.startAt
          const stages = last.preparationStages; assert.ok(stages?.codeInputRender?.count, '必须捕获正式Worker输入渲染成本')
          assert.ok(unique.every(sample => sample.codeResources?.codeInputSessions === 2), '每个正式回放帧应只保留两个共享输入会话')
          playbackEvidence.runs.push({ resolution: [width, height], round, clock, completedFrames: unique.length + 1, elapsedMs, completedFps: 119000 / elapsedMs, hotCompletedFps: 118000 / (last.at - first.at), behindMs: Math.max(0, elapsedMs - 119000 / 60), requestMs: stats(unique.map(sample => sample.elapsedMs)), latenessMs: stats(unique.map(sample => Math.max(0, sample.at - clock.startAt - sample.frame * 1000 / 60))), samples: unique })
          store()
        }
        await playback(60, false); await presented(page, 60)
        const sharedPreview = await png(page, path.join(root, `shared-input-playback-${width}.png`), { width, height })
        for (const x of [80, 240, 400, 560]) near(await pixel(fs.readFileSync(sharedPreview.file), x * width / 640, height / 2), [255, 255, 0])
        near(await pixel(fs.readFileSync(sharedPreview.file), 330 * width / 640, height / 2), [0, 0, 0])
        await capture(`shared-input-playback-${width}`)
        }
        playbackEvidence.runtime = await app.evaluate(async ({ app }) => ({ electron: process.versions.electron, chrome: process.versions.chrome, gpu: await app.getGPUInfo('basic') }))
        const programWorkers = (await workerSnapshot(page)).workers.filter(worker => worker.direct && worker.sequenceId === 'main')
        assert.ok(programWorkers.length, '必须找到实际节目Worker，零样本不能证明释放')
        await page.getByRole('button', { name: '关闭项目', exact: true }).click()
        await page.waitForFunction(ids => window.__videoLayoutEvidence.workers.filter(worker => ids.includes(worker.id)).every(worker => worker.terminated), programWorkers.map(worker => worker.id), { timeout: 10000 })
        const released = (await workerSnapshot(page)).events.filter(event => event.kind === 'dispose.completed' && programWorkers.some(worker => worker.id === event.worker))
        assert.equal(released.length, programWorkers.length, '每个节目Worker都必须返回正式释放回执')
        for (const event of released) {
          assert.ok(event.codeResources && !event.error, '关闭后必须返回资源实测，失败或缺失不能算释放')
          assert.equal(event.codeResources.codeInputSessions, 0)
          assert.equal(event.codeResources.gpu?.residentBytes ?? 0, 0)
          assert.equal(event.codeResources.gpu?.surfaces ?? 0, 0)
          assert.equal(event.codeResources.images?.textures ?? 0, 0)
        }
        playbackEvidence.disposed = released
        evidence.completed = true; store()
      } catch (error) { evidence.failure = String(error.stack ?? error); store(); throw error }
      finally {
        await client?.close().catch(() => {}); await disableMcp(page).catch(() => {})
        const close = page.getByRole('button', { name: '关闭项目', exact: true })
        if (await close.isVisible().catch(() => false)) await close.click()
      }
    },
  }
}
module.exports = { createVideoEditObservationScene }
