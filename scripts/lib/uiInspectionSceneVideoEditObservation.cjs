const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')
const { execFileSync } = require('node:child_process')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope, readAllMedia } = require('./uiInspectionMcpClient.cjs')
const { openVideoEditProjectCard, readVideoEditFile, seedVideoEditProject, showVideoEditProjects } = require('./uiInspectionVideoEditDocuments.cjs')

const SOURCE = 'export default {apiVersion:1,languageVersion:3,name:"单帧观察验收",kind:"generator",mode:"dynamic",width:640,height:360,durationSeconds:2,seed:1,parameters:{},render(ctx){return [rect({id:"背景",x:0,y:0,width:640,height:360,fill:ctx.time>=.5&&ctx.time<.51?[1,0,0,1]:[0,0,1,1]})];}}'
const SOUND_SOURCE = 'export default {apiVersion:1,languageVersion:3,name:"声音驱动验收",kind:"generator",mode:"dynamic",width:640,height:360,durationSeconds:2,seed:1,parameters:{},render(ctx){return [rect({id:"声音标记",x:ctx.audio.level()*500,y:80,width:60,height:40,fill:[0,1,0,1]})];}}'
const INPUT_SOURCE = 'export default {apiVersion:1,languageVersion:3,name:"画面输入验收",kind:"generator",mode:"dynamic",width:640,height:360,durationSeconds:2,seed:1,parameters:{picture:{type:"image",title:"画面",default:null}},render(ctx){return [image({id:"输入",source:ctx.params.picture,x:0,y:0,width:640,height:360})];}}'
async function pixel(bytes, x, y) {
  return [...await sharp(bytes).extract({ left: x, top: y, width: 1, height: 1 }).removeAlpha().raw().toBuffer()]
}
function near(actual, expected) { assert.ok(actual.every((value, index) => Math.abs(value - expected[index]) <= 4), `像素不符：${actual}，期望${expected}`) }

function createVideoEditObservationScene() {
  return { id: 'video-edit-observation-review', surface: '剪辑', name: '剪辑-定向连续帧局部放大与参考比较', writesUserData: true,
    setup: async (page, app, { capture }) => {
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
      fixture.sequences[0].tracks.push({ ...track(0), kind: 'audio', name: '声音' }, track(3), track(4))
      let client
      const evidence = { completed: false, observations: [] }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      try {
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
        const identity = await authorizeMcpConnection(page, { name: '定向观察验收', allowWrites: true })
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
        evidence.capture = await capture('observation-review-host'); evidence.completed = true; store()
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
