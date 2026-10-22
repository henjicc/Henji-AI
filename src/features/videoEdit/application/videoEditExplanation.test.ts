import { installPaidApprovalTestBridge } from '@/tests/paidApprovalTestKit'
// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { normalizeTimestampedTranscript } from '@/core/audioEdit/timestampedTranscript'
import { videoEditComposition } from '@/core/videoEdit/document'
import { confirmedExplanationBinding, pickedExplanationBinding } from '@/core/creativeIntent/deixis'
import type { CapturedAudioBlock } from '@/features/creativeIntent/recording/microphone'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { modelDefaultsManager } from '@/features/settings/modelDefaultsManager'
import { createVideoEditTestProject, failVideoEditSaves, savedVideoEdit } from './videoEditDocumentTestKit'
import { appendVideoEditClip, closeVideoEditProject, getActiveVideoEditSequence, listVideoEditInstances, editVideoProject, setVideoEditView, undoVideoEdit, beginVideoEditGesture, finishVideoEditGesture } from './videoEditService'
import { getApplicationReflectionRegistry } from '@/features/application-control/capabilities/applicationControlRegistry'
import { storeMotionResource, storeMotionResourceBytes, readMotionResource, readMotionResourceBytes } from './videoEditMotionResources'
import { startVideoExplanation, pauseVideoExplanation, resumeVideoExplanation, stopVideoExplanation, videoExplanationState, recordVideoExplanationPresentation, recordVideoExplanationPointer, preflightVideoExplanation, transcribeVideoExplanation, readVideoExplanationPage, correctVideoExplanationText, videoExplanationJsonl, eraseVideoExplanation, reopenVideoExplanation, retryVideoExplanationSave, retainVideoExplanationAudio, readVideoExplanationReview, correctVideoExplanationBinding, pickVideoExplanationBinding } from './videoEditExplanation'
import { startSuperKeyframes, finishSuperKeyframes, pauseSuperKeyframes, resumeSuperKeyframes, configureSuperKeyframeMicrophone } from './videoEditSuperKeyframes'
import { videoMotionState, recordVideoMotionPresentation, videoMotionComposition, demonstrateVideoMotion } from './videoEditMotionDraft'
import { useAssistantUiStore } from '@/features/assistant/store/assistantUiStore'
import { captureMicrophone } from '@/features/creativeIntent/recording/microphone'

const capture = vi.hoisted(()=>({block:undefined as ((block:CapturedAudioBlock)=>void)|undefined,interrupt:undefined as ((message:string)=>void)|undefined,stop:vi.fn(async()=>{}),deny:false}))
vi.mock('./videoEditExplanationVisual',()=>({captureExplanationPixels:vi.fn(async()=>({bytes:new Uint8Array([137,80,78,71,13,10,26,10]),size:[200,100]}))}))
vi.mock('@/features/creativeIntent/recording/microphone',()=>({captureMicrophone:vi.fn(async(_origin:number,onBlock:(block:CapturedAudioBlock)=>void,onInterrupt:(message:string)=>void)=>{if(capture.deny)throw new Error('PermissionDenied');capture.block=onBlock;capture.interrupt=onInterrupt;return{stop:capture.stop}})}))
const files=new Map<string,Uint8Array>(); const chunks=new Map<string,Float32Array>(); let clock=100
beforeEach(()=>{
  installHarnessNativeStorage(); installPaidApprovalTestBridge();files.clear();chunks.clear();capture.stop.mockClear();capture.deny=false;clock=100;vi.stubGlobal('crypto',webcrypto)
  vi.spyOn(performance,'now').mockImplementation(()=>clock)
  vi.spyOn(getPlatform().system.paths,'tempDir').mockResolvedValue('D:/temp');vi.spyOn(getPlatform().system.paths,'join').mockImplementation(async(...parts)=>parts.join('/'))
  vi.spyOn(getPlatform().system.fs,'writeFile').mockImplementation(async(path,bytes)=>{files.set(path,bytes)})
  vi.spyOn(getPlatform().system.fs,'readFile').mockImplementation(async path=>{if(!files.has(path))throw new Error('missing');return files.get(path)!})
  vi.spyOn(getPlatform().system.fs,'remove').mockImplementation(async path=>{files.delete(path)})
  vi.spyOn(getPlatform().documents,'importFile').mockImplementation(async request=>{const path=`D:/materials/${crypto.randomUUID()}.json`;files.set(path,files.get(request.sourcePath)!);return{path,copied:true}})
  const api=getPlatform().audioEdit.recording
  vi.spyOn(api,'microphone').mockResolvedValue();vi.spyOn(api,'write').mockImplementation(async input=>{chunks.set(input.chunkId,input.samples)})
  vi.spyOn(api,'erase').mockImplementation(async()=>{chunks.clear()});vi.spyOn(api,'release').mockImplementation(async()=>{chunks.clear()});vi.spyOn(api,'cancel').mockResolvedValue();vi.spyOn(api,'restore').mockResolvedValue()
  vi.spyOn(api,'archive').mockImplementation(async()=>{const path='D:/temp/retained.zip';const bytes=new Uint8Array([1,2,3]);files.set(path,bytes);return{path,digest:`sha256:${'3'.repeat(64)}`,bytes:3}})
  vi.spyOn(modelDefaultsManager,'resolveTranscriptionModelId').mockReturnValue('groq.speech-recognition.whisper-large-v3')
  vi.spyOn(api,'preflight').mockResolvedValue()
  vi.spyOn(api,'transcribe').mockImplementation(async input=>({modelId:input.modelId,providerId:'groq',requestId:input.requestId,transcript:normalizeTimestampedTranscript({text:'向左移动',segments:[{text:'向左移动',startMs:0,endMs:100}]},100,'word')}))
})
afterEach(async()=>{failVideoEditSaves(false);for(const owner of listVideoEditInstances())await closeVideoEditProject(owner.document.id);vi.restoreAllMocks();vi.unstubAllGlobals();uninstallHarnessNativeStorage()})
async function setup(){const owner=await createVideoEditTestProject();appendVideoEditClip(owner.document.id);return owner}
it('共用 visual 资源保存入口保留结构化 JSON 与二进制 PNG 的编码、扩展名和校验读回',async()=>{
  const owner=await setup();const id=owner.document.id;const value={note:'历史说明'}
  const structured=await storeMotionResource(id,value,'visual')
  expect(vi.mocked(getPlatform().documents.importFile).mock.lastCall![0].sourcePath).toMatch(/\.json$/)
  expect(await readMotionResource(structured)).toEqual(value)
  const bytes=new Uint8Array([137,80,78,71,13,10,26,10]);const binary=await storeMotionResourceBytes(id,bytes,'visual')
  expect(vi.mocked(getPlatform().documents.importFile).mock.lastCall![0].sourcePath).toMatch(/\.png$/)
  expect(await readMotionResourceBytes(binary)).toEqual(bytes)
  files.set(binary.path,new Uint8Array(bytes.length));await expect(readMotionResourceBytes(binary)).rejects.toThrow('已被修改')
})
function present(owner:Awaited<ReturnType<typeof setup>>,frame:number){setVideoEditView(owner.document.id,{frame});recordVideoExplanationPresentation(owner,{frame,sequenceId:owner.activeSequenceId,revision:owner.document.revision,at:clock})}
function audio(){capture.block!({firstFrame:4800,samples:new Float32Array(4800).fill(.2),sampleRate:48000,monoStartUs:100_000,uncertaintyUs:10_000})}
it('超级关键帧默认麦克风、暂停续段、转写后引用交接，同组继续录制不丢已转写段落', async () => {
  localStorage.removeItem('henji-recording-setup')
  const owner = await setup(), id = owner.document.id
  setVideoEditView(id, { selection: getActiveVideoEditSequence(owner).clips[0].id })
  await startSuperKeyframes(id)
  expect(getPlatform().audioEdit.recording.microphone).toHaveBeenCalledWith(true, expect.any(String))
  const draftId = videoMotionState(owner)!.draft.id
  clock = 200; present(owner, 0); audio()
  recordVideoMotionPresentation(owner, { sequenceId: owner.activeSequenceId, frame: 0, revision: videoMotionComposition(owner)!.revision, at: clock })
  demonstrateVideoMotion(id, { ...videoMotionState(owner)!.pose, position: [.7, .5] })
  recordVideoMotionPresentation(owner, { sequenceId: owner.activeSequenceId, frame: 0, revision: videoMotionComposition(owner)!.revision, at: clock })
  clock = 300; await pauseSuperKeyframes(id)
  expect(videoExplanationState(owner)!.collector.session.state).toBe('paused')
  clock = 400; await resumeSuperKeyframes(id)
  clock = 500; present(owner, 10)
  clock = 600; await finishSuperKeyframes(id)
  expect(videoMotionState(owner)!.draft.takes).toHaveLength(2)
  expect(videoExplanationState(owner)!.collector.session.pages.some(page => page.kind === 'transcript')).toBe(true)
  expect(useAssistantUiStore.getState().pendingGoalOptions).toMatchObject({ autoSend: false, attachments: [{ attachment: { modality: 'super_keyframes', summary: { takeCount: 2, hasNarration: true } } }] })
  const transcriptPages = videoExplanationState(owner)!.collector.session.pages.filter(page => page.kind === 'transcript')
  clock = 700; await startSuperKeyframes(id)
  expect(videoMotionState(owner)!.draft.id).toBe(draftId)
  expect(videoExplanationState(owner)!.collector.session.pages.filter(page => page.kind === 'transcript')).toEqual(transcriptPages)
  await configureSuperKeyframeMicrophone(id, true, 'chosen-microphone')
  expect(vi.mocked(captureMicrophone).mock.lastCall?.[4]).toMatchObject({ deviceId: 'chosen-microphone' })
  await configureSuperKeyframeMicrophone(id, false, 'chosen-microphone')
  expect(videoExplanationState(owner)!.microphone).toBeUndefined()
  clock = 800; await finishSuperKeyframes(id)
  expect(videoMotionState(owner)!.draft.takes).toHaveLength(3)
})
it('起点重叠不阻止终点独立确认，轮廓还原指向时的位置而非后来移动的位置', async()=>{
  const owner=await setup(),id=owner.document.id
  editVideoProject(id,doc=>{doc.sequences[0].clips.push({...doc.sequences[0].clips[0],id:'overlap',scale:.3});return doc})
  await startVideoExplanation(id,crypto.randomUUID());clock=200;present(owner,0);audio()
  const monitor=document.createElement('div');document.body.append(monitor)
  vi.spyOn(monitor,'getBoundingClientRect').mockReturnValue(new DOMRect(0,0,200,100))
  const point=(x:number)=>{const event=new MouseEvent('pointerdown',{clientX:x,clientY:50,bubbles:true});Object.defineProperty(event,'timeStamp',{value:clock});monitor.dispatchEvent(event);recordVideoExplanationPointer(owner,event as unknown as PointerEvent,monitor)}
  clock=230;point(100);clock=250;editVideoProject(id,doc=>{doc.sequences[0].clips[0].x=.2;return doc});clock=260;present(owner,0);clock=290;point(180)
  videoExplanationState(owner)!.picture=undefined // Resume invalidates presentation until the next acknowledged draw.
  clock=400;await stopVideoExplanation(id)
  vi.mocked(getPlatform().audioEdit.recording.transcribe).mockImplementationOnce(async input=>({modelId:input.modelId,providerId:'groq',requestId:input.requestId,transcript:{unit:'ms',text:'从这里到那边',granularity:'word',words:[],segments:[{text:'从这里到那边',startMs:30,endMs:100,granularity:'segment',timing:'coarse',words:[{text:'从这里',startMs:30,endMs:40,granularity:'word',timing:'precise'},{text:'到那边',startMs:90,endMs:100,granularity:'word',timing:'precise'}]}]}}))
  await transcribeVideoExplanation(id,crypto.randomUUID())
  const entry=(await readVideoExplanationPage(id,0))[0];if(entry.kind!=='transcript')throw new Error('missing')
  const review=await readVideoExplanationReview(id,entry),source=review.resolution.mentions.find(m=>m.slot==='source')!,destination=review.resolution.mentions.find(m=>m.slot==='destination')!
  expect(source.selected).toBeUndefined();expect(destination.candidates.length).toBeGreaterThan(0);expect(review.plan.issues).toContain('差异目标尚未确认')
  await correctVideoExplanationBinding(id,entry,pickedExplanationBinding(destination,[],[.9,.5]))
  const independentlyConfirmed=await readVideoExplanationReview(id,entry)
  expect(independentlyConfirmed.resolution.mentions.find(m=>m.slot==='destination')!.confirmedByUser).toBe(true)
  expect(independentlyConfirmed.resolution.mentions.find(m=>m.slot==='source')!.selected).toBeUndefined()
  const candidate=source.candidates.find(candidate=>candidate.point[0]===.5)!
  await correctVideoExplanationBinding(id,entry,confirmedExplanationBinding(source,candidate,candidate.targetRefs.find(ref=>!ref.id.endsWith(':overlap'))))
  const evidence=await readVideoExplanationReview(id,entry,source.id)
  const corners=evidence.objects!.find(object=>object.ref.id.endsWith(`:${getActiveVideoEditSequence(owner).clips[0].id}`))!.corners!
  expect(corners.reduce((sum,point)=>sum+point[0],0)/4).toBeCloseTo(.5)
  monitor.remove()
})
it('真实词级结果后出现句级块不会降级已有词时刻，每条仍保留自身粒度', async () => {
  const owner=await setup(); const id=owner.document.id
  await startVideoExplanation(id,crypto.randomUUID());clock=200;present(owner,0);audio()
  clock=300;await pauseVideoExplanation(id);clock=400;await resumeVideoExplanation(id);clock=500;present(owner,0)
  capture.block!({firstFrame:4800,samples:new Float32Array(4800).fill(.2),sampleRate:48000,monoStartUs:400_000,uncertaintyUs:10_000})
  clock=600;await stopVideoExplanation(id)
  vi.mocked(getPlatform().audioEdit.recording.transcribe).mockImplementationOnce(async input=>({modelId:input.modelId,providerId:'groq',requestId:input.requestId,transcript:normalizeTimestampedTranscript({text:'这里',segments:[{text:'这里',startMs:0,endMs:100,words:[{text:'这里',startMs:0,endMs:50}]}]},100,'word')}))
  await transcribeVideoExplanation(id,crypto.randomUUID())
  expect(getPlatform().audioEdit.recording.transcribe).toHaveBeenCalledTimes(2)
  expect(videoExplanationState(owner)!.collector.session.asr?.granularity).toBe('word')
  expect(await readVideoExplanationPage(id,0)).toMatchObject([{granularity:'word',monoSpanUs:[100_000,150_000]}])
  expect(await readVideoExplanationPage(id,1)).toMatchObject([{granularity:'segment'}])
})
it('E01/E05 自主控制与正式undo链不重复应用；结束转写/校正/JSONL/删除历史闭环',async()=>{
  const bridge = installPaidApprovalTestBridge()
  const owner=await setup();const id=owner.document.id;const undoCount=owner.past.length
  await startVideoExplanation(id,crypto.randomUUID());expect(owner.playing).toBe(false);clock=200;present(owner,0);audio()
  clock=300;editVideoProject(id,document=>{document.sequences[0].clips[0].x=.2;return document});clock=400;undoVideoEdit(id);clock=500;undoVideoEdit(id,true)
  clock=600;expect(()=>editVideoProject(id,document=>{document.sequences[0].width=-1;return document})).toThrow()
  clock=700;await stopVideoExplanation(id);expect(capture.stop).toHaveBeenCalledTimes(1);expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(.2);expect(owner.past.length).toBe(undoCount+1)
  expect(getPlatform().audioEdit.recording.transcribe).not.toHaveBeenCalled();await transcribeVideoExplanation(id,crypto.randomUUID())
  expect([...bridge.records.values()]).toMatchObject([{ origin: { actor: 'user' }, state: 'completed', paidReservations: [{ category: 'recognition' }] }])
  const original=(await readVideoExplanationPage(id,0))[0];expect(original.kind).toBe('transcript');if(original.kind!=='transcript')throw new Error('missing')
  expect(original.granularity).toBe('segment');await correctVideoExplanationText(id,original,'往左移')
  expect(await readVideoExplanationPage(id,0)).toMatchObject([{text:'往左移',source:'user'}])
  await expect(correctVideoExplanationText(id,original,'迟到的旧词稿')).rejects.toThrow('已经校正')
  const latest = (await readVideoExplanationPage(id,0))[0]; if(latest.kind!=='transcript')throw new Error('missing')
  await correctVideoExplanationText(id,{...latest,monoSpanUs:[9_000_000,9_200_000],timelineSpans:[]},'往左移')
  const verified=(await readVideoExplanationPage(id,0))[0]; if(verified.kind!=='transcript')throw new Error('missing')
  expect(verified.monoSpanUs).toEqual(original.monoSpanUs);expect(verified.timelineSpans).toEqual(original.timelineSpans)
  const lines=[];for await(const line of videoExplanationJsonl(id))lines.push(JSON.parse(line) as Record<string,unknown>)
  const commands=lines.filter(l=>l.type==='command');expect(commands.map(l=>l.phase)).toEqual(['committed','undo','redo','failed']);expect(commands[1].related).toBe(commands[0].operation)
  expect(lines.filter(l=>l.type==='speech')).toMatchObject([{text:'往左移'}]);expect(lines.filter(l=>l.type==='speech')).toHaveLength(1)
  const sessionId=videoExplanationState(owner)!.collector.session.id
  const pendingPreview=videoExplanationJsonl(id);await pendingPreview.next()
  await eraseVideoExplanation(id);expect(savedVideoEdit(owner).creativeIntents!.sessions).toHaveLength(0);undoVideoEdit(id)
  await expect(pendingPreview.next()).rejects.toThrow('删除')
  expect(owner.document.creativeIntents?.sessions.some(s=>s.id===sessionId)).toBe(false);expect(files.size).toBe(0)
})
it('E09 设备拒绝/断开与恢复重新订阅，sealed页可恢复；保存失败不丢尾音',async()=>{
  const owner=await setup();const id=owner.document.id;capture.deny=true;await expect(startVideoExplanation(id,crypto.randomUUID())).rejects.toThrow('PermissionDenied')
  expect(videoExplanationState(owner)!.collector.session.state).toBe('recoverable');capture.deny=false;clock=200;await resumeVideoExplanation(id);clock=300;present(owner,0);audio()
  clock=400;await pauseVideoExplanation(id);const sessionId=videoExplanationState(owner)!.collector.session.id
  await reopenVideoExplanation(id,sessionId);clock=500;await resumeVideoExplanation(id);clock=600;present(owner,0);editVideoProject(id,document=>{document.sequences[0].clips[0].x=.3;return document})
  clock=700;await stopVideoExplanation(id);expect(videoExplanationState(owner)!.collector.session.clockSegments.some(c=>c.mode==='gap')).toBe(true)
  const lines=[];for await(const line of videoExplanationJsonl(id))lines.push(JSON.parse(line) as Record<string,unknown>);expect(lines.some(l=>l.type==='command')).toBe(true)
  expect(capture.stop).toHaveBeenCalledTimes(2)
})
it('E09 音频落盘失败暂停并可重试；私密原稿不会改变正在操作的手势撤销语义',async()=>{
  const owner=await setup();const id=owner.document.id;await startVideoExplanation(id,crypto.randomUUID());clock=200;present(owner,0);audio()
  vi.mocked(getPlatform().audioEdit.recording.write).mockRejectedValueOnce(new Error('disk'))
  const before=owner.past.length;const gesture=beginVideoEditGesture(id);clock=300;const pausing=pauseVideoExplanation(id);finishVideoEditGesture(gesture);await pausing
  expect(owner.past).toHaveLength(before);expect(chunks.size).toBe(1);await retryVideoExplanationSave(id);await stopVideoExplanation(id)
  await retainVideoExplanationAudio(id);expect(videoExplanationState(owner)!.collector.session.retentionStatus).toBe('retained');expect(savedVideoEdit(owner).creativeIntents!.sessions[0].audio).toBeTruthy()
})
it('会话元数据正式实体可读，私密词稿/指向/音频路径不进入助手副本',async()=>{
  const owner=await setup();await startVideoExplanation(owner.document.id,crypto.randomUUID());clock=300;await stopVideoExplanation(owner.document.id)
  expect(getApplicationReflectionRegistry()).toBeTruthy()
  // Provider uses only live heads; erasure makes the stable reference unavailable.
  const {createVideoEditExplanationRegistration}=await import('./videoEditExplanationReflection');const registration=createVideoEditExplanationRegistration();expect(registration.entity.writeExclusion?.reason).toContain('本机');const provider=registration.provider!
  const refs=await provider.listEntities({limit:10});const value=await provider.readEntity(refs.refs[0],{})
  expect(Object.keys(value.properties)).toEqual(['video_edit.explanation_session.state','video_edit.explanation_session.audio_retention','video_edit.explanation_session.audio_upload_allowed'])
  await eraseVideoExplanation(owner.document.id);await expect(provider.readEntity(refs.refs[0],{})).rejects.toThrow('已经删除')
})
it('迟到呈现回执保留提交时画面；关闭先封尾音，不提前取消采集',async()=>{
  const owner=await setup();const id=owner.document.id;await startVideoExplanation(id,crypto.randomUUID());clock=200
  const submitted=videoEditComposition(owner.document,owner.activeSequenceId)
  editVideoProject(id,document=>{document.sequences[0].clips[0].x=.4;return document})
  recordVideoExplanationPresentation(owner,{frame:0,sequenceId:submitted.id,revision:submitted.revision,composition:submitted,at:clock})
  expect(videoExplanationState(owner)!.picture?.composition).toBe(submitted)
  const signal=videoExplanationState(owner)!.controller.signal
  capture.stop.mockImplementationOnce(async()=>{expect(signal.aborted).toBe(false);audio()})
  clock=400;await closeVideoEditProject(id);expect(getPlatform().audioEdit.recording.write).toHaveBeenCalledTimes(1);expect(signal.aborted).toBe(true)
})
it('彻底擦除失败仍保留待清路径，重试会完成而不会复活历史',async()=>{
  const owner=await setup();const id=owner.document.id;await startVideoExplanation(id,crypto.randomUUID());clock=300;await stopVideoExplanation(id)
  const sessionId=videoExplanationState(owner)!.collector.session.id;expect(files.size).toBeGreaterThan(0)
  vi.mocked(getPlatform().system.fs.remove).mockRejectedValueOnce(new Error('temporarily locked'))
  await expect(eraseVideoExplanation(id)).rejects.toThrow('temporarily locked');expect(owner.document.creativeIntents!.sessions).toHaveLength(0)
  await eraseVideoExplanation(id);expect(files.size).toBe(0);undoVideoEdit(id);expect(owner.document.creativeIntents?.sessions.some(s=>s.id===sessionId)).toBe(false)
})
it('指向使用实际呈现几何和正式workspace引用；菜单外点不指画面，敏感区不采',async()=>{
  const owner=await setup();const id=owner.document.id;await startVideoExplanation(id,crypto.randomUUID());clock=200;present(owner,0)
  const parent=document.createElement('div');const monitor=document.createElement('div');const sensitive=document.createElement('div');sensitive.dataset.observationSensitive='';parent.append(monitor,sensitive);document.body.append(parent)
  vi.spyOn(monitor,'getBoundingClientRect').mockReturnValue({left:100,top:50,width:200,height:100,right:300,bottom:150,x:100,y:50,toJSON:()=>({})})
  const pointer=(target:HTMLElement,x:number,y:number)=>{const event=new MouseEvent('pointermove',{clientX:x,clientY:y,bubbles:true});Object.defineProperty(event,'timeStamp',{value:clock});target.dispatchEvent(event);recordVideoExplanationPointer(owner,event as unknown as PointerEvent,monitor)}
  pointer(monitor,200,100);clock=250;pointer(parent,50,50);clock=300;pointer(sensitive,200,100);clock=500;await stopVideoExplanation(id)
  const lines=[];for await(const line of videoExplanationJsonl(id))lines.push(JSON.parse(line) as Record<string,unknown>)
  const pointers=lines.filter(line=>line.type==='pointer');expect(pointers).toHaveLength(2);expect(pointers[0].q).toEqual([.5,.5]);expect(pointers[1]).toMatchObject({q:null,hover:[],pointed:[]})
  const refs=Object.assign({},...lines.filter(line=>line.kind==='dictionary').map(line=>line.refs)) as Record<string,{id:string}>
  expect(refs[String(pointers[0].surface)].id).toBe('workspace.video_edit');parent.remove()
})
it('慢摘要背压暂停采集并完整封存操作，解除后不丢尾部',async()=>{
  const owner=await setup();const id=owner.document.id;await startVideoExplanation(id,crypto.randomUUID());clock=200;present(owner,0)
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});const digest=crypto.subtle.digest.bind(crypto.subtle)
  vi.spyOn(crypto.subtle,'digest').mockImplementationOnce(async(algorithm,data)=>{await gate;return digest(algorithm,data)})
  for(let i=1;i<=8;i++)editVideoProject(id,document=>{document.sequences[0].clips[0].x=i/100;return document})
  expect(videoExplanationState(owner)!.busy).toBe(true);await new Promise(resolve=>setTimeout(resolve,0));expect(capture.stop).toHaveBeenCalledTimes(1)
  release();clock=500;await stopVideoExplanation(id)
  const lines=[];for await(const line of videoExplanationJsonl(id))lines.push(JSON.parse(line) as Record<string,unknown>)
  expect(lines.filter(line=>line.type==='command')).toHaveLength(8);expect(videoExplanationState(owner)!.collector.session.clockSegments.some(clock=>clock.mode==='gap')).toBe(true)
})
it('开始下一次和切换已封讲解先清临时原音，保留旧词稿并阻止并发开始',async()=>{
  const owner=await setup();const id=owner.document.id;await startVideoExplanation(id,crypto.randomUUID());clock=200;present(owner,0);audio();clock=300;await stopVideoExplanation(id)
  await transcribeVideoExplanation(id,crypto.randomUUID());const first=videoExplanationState(owner)!.collector.session.id
  let release!:()=>void;vi.mocked(getPlatform().audioEdit.recording.release).mockImplementationOnce(()=>new Promise<void>(resolve=>{release=()=>{chunks.clear();resolve()}}))
  const starting=startVideoExplanation(id,crypto.randomUUID());await expect(startVideoExplanation(id,crypto.randomUUID())).rejects.toThrow('完成当前');release();await starting
  expect(chunks.size).toBe(0);expect(owner.document.creativeIntents!.sessions.find(s=>s.id===first)).toMatchObject({retentionStatus:'deleted',state:'reviewing'})
  const second=videoExplanationState(owner)!.collector.session.id;clock=400;audio();clock=500;await stopVideoExplanation(id)
  await reopenVideoExplanation(id,first);expect(chunks.size).toBe(0);expect(owner.document.creativeIntents!.sessions.find(s=>s.id===second)?.retentionStatus).toBe('deleted')
  expect(await readVideoExplanationPage(id,0)).toMatchObject([{text:'向左移动'}])
  videoExplanationState(owner)!.collector.session.state='recoverable';await startVideoExplanation(id,crypto.randomUUID());expect(videoExplanationState(owner)!.collector.session.id).not.toBe(first)
})
it('粗时间人工校正不伪造历史画面，当前节目点选要求实际呈现帧并可取消', async () => {
  const owner = await setup(), id = owner.document.id
  await startVideoExplanation(id, crypto.randomUUID()); clock = 200; present(owner, 0); audio(); clock = 300; await stopVideoExplanation(id)
  vi.mocked(getPlatform().audioEdit.recording.transcribe).mockImplementationOnce(async input => ({ modelId: input.modelId, providerId: 'groq', requestId: input.requestId, transcript: normalizeTimestampedTranscript({ text: '这个', segments: [{ text: '这个', startMs: 0, endMs: 100 }] }, 100, 'word') }))
  await transcribeVideoExplanation(id, crypto.randomUUID())
  const entry = (await readVideoExplanationPage(id, 0))[0]; if (entry.kind !== 'transcript') throw new Error('missing')
  const mention = (await readVideoExplanationReview(id, entry)).resolution.mentions[0]
  const target = { kind: 'video_edit.clip', id: `${id}:${getActiveVideoEditSequence(owner).clips[0].id}`, label: '主图' }
  await correctVideoExplanationBinding(id, entry, pickedExplanationBinding(mention, [target], [.5, .5]))
  const corrected = await readVideoExplanationReview(id, entry)
  expect(corrected.resolution.mentions[0].confirmedByUser).toBe(true); expect(corrected.image).toBeUndefined()
  const monitor = document.createElement('div'); monitor.dataset.videoEditProgramDisplay = ''; document.body.append(monitor)
  const controller = new AbortController(), waiting = pickVideoExplanationBinding(owner, entry, mention, controller.signal)
  const refused = expect(waiting).rejects.toThrow('画面正在更新')
  monitor.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 })); await refused
  const cancel = new AbortController(), cancelled = pickVideoExplanationBinding(owner, entry, mention, cancel.signal)
  cancel.abort(); await cancelled; monitor.remove()
})

it('讲解确认前预检所有待识别块，不调用识别、不改变会话', async () => {
  const owner=await setup();const id=owner.document.id
  await startVideoExplanation(id,crypto.randomUUID());clock=200;present(owner,0);audio();clock=400;await stopVideoExplanation(id)
  vi.mocked(getPlatform().audioEdit.recording.preflight).mockRejectedValueOnce(new Error('本地媒体不可读'))
  await expect(preflightVideoExplanation(id)).rejects.toThrow('本地媒体不可读')
  expect(getPlatform().audioEdit.recording.transcribe).not.toHaveBeenCalled();expect(videoExplanationState(owner)!.collector.session.state).toBe('reviewing')
  await preflightVideoExplanation(id);expect(getPlatform().audioEdit.recording.preflight).toHaveBeenLastCalledWith(expect.objectContaining({action:'preflight',sessionId:videoExplanationState(owner)!.collector.session.id}))
})
