const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope, readAllMedia } = require('./uiInspectionMcpClient.cjs')
const { seedVideoEditProject, openVideoEditProjectCard, readVideoEditFile, showVideoEditProjects, leaveVideoEditProject } = require('./uiInspectionVideoEditDocuments.cjs')
const { presented } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')

const WORDS = [['打开', 200, 600], ['后台', 600, 1000], ['打开', 1400, 1800], ['后台', 1800, 2200], ['然后', 2500, 2800], ['点击', 2800, 3200], ['设置', 3200, 3600]]
const normalize = value => value.replace(/[，。！、\s]/g, '')

function createVideoEditContentEditScene() {
  return { id: 'video-edit-content-edit', surface: '剪辑', name: '剪辑-局部检索删重说字幕与关联画面同撤销', writesUserData: true,
    setup: async (page, app, { capture }) => {
      assert.ok(await app.evaluate(() => Boolean(process.env.HENJI_ISOLATED_APP_DATA)), '内容剪辑验收只允许隔离资料目录')
      const unblock = await blockPaidGeneration(app)
      const root = path.resolve('node_modules/.cache/video-edit-content-edit'); fs.mkdirSync(root, { recursive: true })
      const evidence = { completed: false, fixture: 'Controlled word transcript with real generated AVC/AAC files; no ASR or model judgement. Audio is gated sine, not human speech.', calls: [] }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      let client
      try {
        const { ffmpegPath } = require('./mediaBinaries.cjs')
        const source = path.join(root, 'source.mp4'), demo = path.join(root, 'demo.mp4')
        const encode = args => execFileSync(ffmpegPath, ['-v', 'error', '-y', ...args], { windowsHide: true, timeout: 30000 })
        const colors = ['-vf', 'scale=in_range=limited:out_range=limited:in_color_matrix=bt601:out_color_matrix=bt709', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1']
        encode(['-f', 'lavfi', '-i', "color=c=green:s=640x360:r=60:d=5,drawbox=color=yellow:t=fill:enable='gte(t,1.4)'", '-f', 'lavfi', '-i', 'aevalsrc=0.2*sin(2*PI*440*t)*(between(t\\,0.2\\,1)+between(t\\,1.4\\,2.2)+between(t\\,2.5\\,3.6)):s=48000:d=5', ...colors, '-c:a', 'aac', '-shortest', source])
        encode(['-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=60:d=5', ...colors, '-an', demo])
        const { createVideoEditDocument, createVideoEditSequence, videoEditComposition, makeVideoEditItemClip, buildVideoEditTextTranscription, bindVideoEditCaptionSpeech } = loadTypeScript('scripts/lib/uiInspectionVideoEditContentFixture.ts')
        const model = createVideoEditDocument('内容剪辑联动验收'); model.id = 'reality-content-edit'
        const sequence = createVideoEditSequence('口播'); sequence.id = 'main'; sequence.width = 640; sequence.height = 360; sequence.frameRate = { numerator: 60, denominator: 1 }
        sequence.tracks = [0, 1, 2, 3].map(index => ({ id: `track-${index}`, name: index ? `视频${index}` : '声音', kind: index ? 'video' : 'audio', index, enabled: true, locked: false, muted: false, solo: false }))
        model.sequences.push(sequence)
        model.media = [{ id: 'voice', name: '受控口播信号', path: source, kind: 'video', width: 640, height: 360, durationSeconds: 5, hasAudio: true, frameRate: sequence.frameRate }, { id: 'demo', name: '演示画面', path: demo, kind: 'video', width: 640, height: 360, durationSeconds: 5, hasAudio: false, frameRate: sequence.frameRate }]
        model.items = [{ id: 'voice-item', name: '口播', kind: 'video', mediaId: 'voice' }, { id: 'demo-item', name: '演示画面', kind: 'video', mediaId: 'demo' }, { id: 'label-item', name: '强调标签', kind: 'text' }]
        const base = makeVideoEditItemClip(model, 'voice-item', 'main', { frame: 0, duration: 300, track: 1 })
        sequence.clips = [{ ...base, id: 'video', sourceComponent: 'video', linkId: 'voice-link' }, { ...base, id: 'audio', kind: 'audio', track: 0, sourceComponent: 'audio', linkId: 'voice-link' }]
        await showVideoEditProjects(page)
        const seeded = await seedVideoEditProject(page, model)
        // Seed only the prior recognition state. All editing below uses the real
        // public tools; import and identity binding use the formal document API.
        const imported = await page.evaluate(async ({ id, projectId, files }) => {
          const documents = window.henjiNative.documents, read = await documents.readDocument({ id })
          for (const media of read.content.media) {
            const resource = await documents.importFile({ sourcePath: files[media.id], container: { kind: 'project', projectId }, folder: 'materials' })
            media.path = resource.path; media.assetContent = await window.henjiNative.assetLibrary.inspectFileContent(resource.path, 'video')
          }
          return { content: read.content, revision: read.meta.revision }
        }, { id: seeded.documentId, projectId: seeded.projectId, files: { voice: source, demo } })
        const authored = { ...model, ...imported.content }, current = authored.sequences[0]
        current.textTranscription = buildVideoEditTextTranscription(videoEditComposition(authored, 'main'), [current.clips.find(clip => clip.id === 'audio')], {
          id: 'controlled-transcript', name: '受控词时间', source: { mediaType: 'audio', sourcePath: source, audioPath: source, durationFrames: 5000, sampleRate: 1000, channels: 1 }, revision: 1, createdAt: 1, updatedAt: 1, vstEnabled: false, referenceScript: '', suggestions: [],
          transcript: WORDS.map(([text, startFrame, endFrame], index) => ({ id: `word-${index}`, text, startFrame, endFrame, granularity: 'word', included: true, locked: false })),
        }, 0)
        current.captions = [bindVideoEditCaptionSpeech({ id: 'spoken-caption', start: 12, duration: 204, text: '打开后台，打开后台，然后点击设置。', translation: 'Open the dashboard twice, then click settings.' }, WORDS.map(([text, start, end]) => ({ clipId: 'audio', text, startUs: start * 1000, endUs: end * 1000, precision: 'word' }))), { id: 'independent-caption', start: 250, duration: 30, text: '独立创作字幕' }]
        const { id: _id, name: _name, revision: _revision, format: _format, version: _version, ...content } = authored
        await page.evaluate(async ({ id, revision, content }) => window.henjiNative.documents.saveDocument({ target: { id }, expectedRevision: revision, content }), { id: seeded.documentId, revision: imported.revision, content })
        await openVideoEditProjectCard(page, seeded.projectId)
        const identity = await authorizeMcpConnection(page, { name: '内容剪辑联动验收', allowWrites: true, allowDestructive: true })
        client = await connectMcpClient(identity.config, 'Henji content editing Reality')
        const invoke = async (name, input) => {
          const start = performance.now(), result = await callTool(client, name, input)
          evidence.calls.push({ name, elapsedMs: performance.now() - start, inputBytes: Buffer.byteLength(JSON.stringify(input)), outputBytes: Buffer.byteLength(JSON.stringify(result)) }); store()
          return result
        }
        const documentRef = { kind: 'video_edit.document', id: seeded.documentId }, sequenceRef = { kind: 'video_edit.sequence', id: `${seeded.documentId}:main` }
        const read = ref => invoke('read_application_entity', { ref, propertyIds: [`${ref.kind}.name`] })
        const query = () => invoke('query_video_edit_transcript', { documentRef, sequenceRef, text: '打开， 后台！', matchSource: 'asr', contextWords: 1, limit: 2 })
        const found = (await query()).data
        assert.equal(found.total, 2); assert.equal(found.matches.length, 2)
        assert.deepEqual(found.matches.map(match => [match.from, match.to]), [[12, 60], [84, 132]])
        assert.ok(found.matches.every(match => match.editable && match.selector && match.sourceRange))
        evidence.query = found
        const pauses = (await invoke('get_video_edit_clip_pauses', { clipRef: found.matches[1].clipRef, range: { from: 84, to: 132 } })).data
        assert.equal(pauses.source, 'words_and_energy'); assert.ok(pauses.pauses.some(pause => pause.kind === 'silence')); assert.ok(pauses.cutCandidates.length)
        evidence.pauses = pauses
        const placed = await invoke('change_application_entities', operationEnvelope([await read(sequenceRef)], { summary: '在保留的开口前插入演示画面并关联强调标签', changes: [{ kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: [
          { properties: { 'video_edit.clip.item_id': 'demo-item', 'video_edit.clip.kind': 'video', 'video_edit.clip.name': '开口前演示', 'video_edit.clip.track': 2, 'video_edit.clip.content_anchor': { matchId: found.matches[1].matchId, startOffsetSeconds: -.1 } } },
          { properties: { 'video_edit.clip.item_id': 'label-item', 'video_edit.clip.kind': 'text', 'video_edit.clip.name': '后台标签', 'video_edit.clip.text': '后台', 'video_edit.clip.track': 3, 'video_edit.clip.y': -.25, 'video_edit.clip.content_anchor': { matchId: found.matches[1].matchId } } },
        ] }] }))
        assert.equal(placed.verificationState, 'verified')
        const before = readVideoEditFile(seeded.file).sequences[0]
        const demoClip = before.clips.find(clip => clip.name === '开口前演示'), labelClip = before.clips.find(clip => clip.name === '后台标签')
        assert.deepEqual([demoClip.start, demoClip.duration, labelClip.start, labelClip.duration], [78, 54, 84, 48])
        // Creating the overlays changes the work; obtain a fresh executable match.
        const fresh = (await query()).data
        const deleted = await invoke('ripple_delete_video_edit_text', operationEnvelope([await read(documentRef), await read(sequenceRef)], { documentRef, sequenceRef, selector: fresh.matches[0].selector }))
        assert.equal(deleted.verificationState, 'verified'); assert.deepEqual(deleted.result.data.ranges, [{ from: 12, to: 60 }])
        const after = readVideoEditFile(seeded.file).sequences[0]
        assert.equal(after.clips.filter(clip => clip.sourceComponent === 'video').reduce((sum, clip) => sum + clip.duration, 0), 252)
        assert.equal(after.clips.filter(clip => clip.sourceComponent === 'audio').reduce((sum, clip) => sum + clip.duration, 0), 252)
        assert.deepEqual([after.clips.find(clip => clip.id === demoClip.id).start, after.clips.find(clip => clip.id === labelClip.id).start], [30, 36])
        const captions = after.captions.filter(caption => caption.speech)
        assert.equal(normalize(captions.map(caption => caption.text).join('')), '打开后台然后点击设置')
        assert.equal(captions.reduce((sum, caption) => sum + caption.speech.words.length, 0), 5)
        assert.ok(captions.every(caption => caption.reviewReasons?.includes('translation')))
        assert.equal(after.captions.find(caption => caption.id === 'independent-caption').text, '独立创作字幕')
        evidence.deleted = { ranges: deleted.result.data.ranges, before, after }; store()
        const waitSaved = async expected => {
          for (let attempt = 0; attempt < 100; attempt++) {
            if (JSON.stringify(readVideoEditFile(seeded.file).sequences[0]) === JSON.stringify(expected)) return
            await page.waitForTimeout(50)
          }
          assert.deepEqual(readVideoEditFile(seeded.file).sequences[0], expected)
        }
        await page.getByRole('button', { name: '撤销', exact: true }).click(); await waitSaved(before)
        await page.getByRole('button', { name: '重做', exact: true }).click(); await waitSaved(after)
        evidence.undoRedo = { wholeSequenceRestoredWithOneUndo: true, redoRestored: true }; store()
        await leaveVideoEditProject(page, null); await openVideoEditProjectCard(page, seeded.projectId)
        assert.deepEqual(readVideoEditFile(seeded.file).sequences[0], after)
        const reopened = (await query()).data; assert.equal(reopened.total, 1); assert.deepEqual([reopened.matches[0].from, reopened.matches[0].to], [36, 84])
        const state = async () => (await invoke('read_application_entity', { ref: documentRef, propertyIds: ['video_edit.document.frame', 'video_edit.document.selection'] })).data.properties
        const viewBefore = await state()
        const review = (await invoke('query_video_edit_review', { documentRef, sequenceRef, from: 0, to: 100, maxFrames: 8 })).data
        assert.ok(review.checkpoints.frames.length && review.checkpoints.frames.length <= 8)
        const observed = (await invoke('observe_video_edit_frame', { documentRef, documentVersion: review.documentVersion, target: { kind: 'frames', sequenceRef, frames: review.checkpoints.frames }, maxWidth: 640 })).data
        assert.ok(observed.verification.verified)
        const media = await readAllMedia(client, observed.resultRef); fs.writeFileSync(path.join(root, 'review.png'), media.bytes)
        assert.deepEqual(await state(), viewBefore, '观察不能移动播放头或选区')
        const seek = await invoke('change_application_entities', operationEnvelope([await read(documentRef)], { summary: '显示删重说后的字幕与关联画面', changes: [{ kind: 'set_properties', entityType: documentRef.kind, target: documentRef, properties: { 'video_edit.document.program_playback': { frame: 48, playing: false, playbackDirection: 1 } } }] }))
        assert.equal(seek.verificationState, 'verified'); await presented(page, 48)
        await capture('content-linked-after-delete')
        evidence.reopened = reopened; evidence.review = review; evidence.viewUnchangedByObservation = true
        evidence.completed = true; store()
      } catch (error) { evidence.failure = String(error.stack ?? error); store(); throw error }
      finally {
        await client?.close().catch(() => {}); await disableMcp(page).catch(() => {}); await unblock()
        const close = page.getByRole('button', { name: '关闭项目', exact: true })
        if (await close.isVisible().catch(() => false)) await close.click()
      }
    },
  }
}
module.exports = { createVideoEditContentEditScene }
