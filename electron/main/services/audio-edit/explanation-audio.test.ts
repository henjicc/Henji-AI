import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TimestampedAsrService } from './timestamped-asr'
import type { AudioEditStoredTask } from './task-store'
import type { RecordingAudioRequest } from '../../../../src/core/audioEdit/recordingAudio'
import { normalizeTimestampedTranscript } from '../../../../src/core/audioEdit/timestampedTranscript'
import { ExplanationAudioService } from './explanation-audio'

const ledger = vi.hoisted(() => new Map<string, AudioEditStoredTask & { document_id: string }>())
vi.mock('./timestamped-asr', () => ({ timestampedAsrService: undefined }))
vi.mock('./task-store', () => ({
  getAudioEditStoredTask: (id: string) => ledger.get(id),
  createAudioEditTask: (input: { requestId:string;projectId:string;inputDigest:string }) => { if (ledger.has(input.requestId)) throw new Error('duplicate'); ledger.set(input.requestId,{request_id:input.requestId,document_id:input.projectId,input_digest:input.inputDigest,state:'queued',provider_task_id:null,result_json:null}) },
  updateAudioEditTask: (id:string, patch:{state?:AudioEditStoredTask['state'];providerTaskId?:string;result?:unknown}) => { const entry=ledger.get(id); if (entry) Object.assign(entry,{...(patch.state?{state:patch.state}:{}),...(patch.providerTaskId?{provider_task_id:patch.providerTaskId}:{}),...(patch.result?{result_json:JSON.stringify(patch.result)}:{})}) },
  deleteAudioEditTasks: (scope:string) => { for (const [id,row] of ledger) if (row.document_id===scope) ledger.delete(id) },
  registerAudioEditTaskController: () => () => {},
}))
let root: string
const sessionId = crypto.randomUUID(); const chunkId = crypto.randomUUID()
const synthetic = () => Float32Array.from({length:4800},(_,i)=>Math.sin(i*.1)*.2)
const request = (): Extract<RecordingAudioRequest,{action:'transcribe'}> => ({action:'transcribe',sessionId,chunkId,requestId:chunkId,modelId:'fixture.speech-recognition.asr',audioUploadReceipt:crypto.randomUUID(),resume:false})
const dto = normalizeTimestampedTranscript({text:'本地夹具',segments:[{text:'本地夹具',startMs:0,endMs:100}]},100,'word')
function fixtureAsr(): Pick<TimestampedAsrService,'prepare'|'execute'|'preflight'> {
  return {preflight:vi.fn(async input=>({modelId:input.modelId!,cost:{status:'unknown' as const,amount:null,currency:null}})),prepare: input=>Object.freeze({modelId:input.modelId!,providerId:'fixture',audioPath:input.audioPath,durationMs:input.durationMs,language:'zh',cost:{status:'unknown' as const,amount:null,currency:null}}),execute:vi.fn(async()=>dto)}
}
beforeEach(async()=>{ root=await fs.mkdtemp(path.join(os.tmpdir(),'henji-recording-test-')); ledger.clear() })
afterEach(async()=>{ await fs.rm(root,{recursive:true,force:true}) })
describe('E06/E09 零网络录音与转写生命周期',()=>{
  it('确认前检查媒体与宿主可执行性，不登记收费任务、不执行识别',async()=>{
    const asr=fixtureAsr(); const service=new ExplanationAudioService(root,asr)
    const { audioUploadReceipt: _receipt, ...rest } = request(); const preflight={...rest,action:'preflight' as const}
    await expect(service.preflight(preflight)).rejects.toThrow()
    await service.write({action:'write',sessionId,chunkId,sampleRate:48000,samples:synthetic()})
    vi.mocked(asr.preflight).mockRejectedValueOnce(new Error('native_upload_unsupported'))
    await expect(service.preflight(preflight)).rejects.toThrow('native_upload_unsupported')
    expect(asr.execute).not.toHaveBeenCalled(); expect(ledger.size).toBe(0)
    await service.preflight(preflight); expect(asr.preflight).toHaveBeenLastCalledWith(expect.objectContaining({sourcePath:path.join(root,sessionId,`${chunkId}.wav`),durationMs:100}))
  })
  it('分块写入幂等；字节错误拒绝；未授权外发不执行；已完成回执不重新转写',async()=>{
    const asr=fixtureAsr(); const service=new ExplanationAudioService(root,asr)
    const write={action:'write' as const,sessionId,chunkId,sampleRate:48000,samples:synthetic()}; await service.write(write); await service.write(write)
    await expect(service.write({...write,samples:new Float32Array([1])})).rejects.toThrow('内容不同')
    await expect(service.transcribe({...request(),audioUploadReceipt:''})).rejects.toThrow('确认')
    expect(asr.execute).not.toHaveBeenCalled(); const result=await service.transcribe(request()); expect(result.transcript).toEqual(dto)
    await service.transcribe(request()); expect(asr.execute).toHaveBeenCalledTimes(1)
    const pathToAudio=path.join(root,sessionId,`${chunkId}.wav`);const tampered=Buffer.from(await service.read(sessionId,chunkId));tampered[44]^=1;await fs.writeFile(pathToAudio,tampered)
    await expect(service.transcribe(request())).rejects.toThrow('录音不符');expect(asr.execute).toHaveBeenCalledTimes(1)
  })
  it('未知提交不重发；恢复只交给共用入口原任务身份',async()=>{
    const asr=fixtureAsr(); const service=new ExplanationAudioService(root,asr); await service.write({action:'write',sessionId,chunkId,sampleRate:48000,samples:synthetic()})
    const archived=await service.archive(sessionId);const retained=path.join(root,'private-retained.zip');await fs.copyFile(archived.path,retained)
    vi.mocked(asr.execute).mockRejectedValueOnce(new Error('private transcript/url MUST NOT escape'))
    await expect(service.transcribe(request())).rejects.toThrow('讲解转写未完成')
    await service.release(sessionId);await service.restore({action:'restore',sessionId,...archived,path:retained})
    await expect(service.transcribe({...request(),resume:true})).rejects.toThrow('禁止重新发送'); expect(asr.execute).toHaveBeenCalledTimes(1)
    ledger.get(chunkId)!.provider_task_id='fixture-original-task'
    await service.transcribe({...request(),resume:true}); expect(vi.mocked(asr.execute).mock.calls[1][1].resumeTaskId).toBe('fixture-original-task')
  })
  it('并发转写拒绝；删除中迟到结果不入账、不重新写回音频',async()=>{
    const asr=fixtureAsr(); const service=new ExplanationAudioService(root,asr); await service.write({action:'write',sessionId,chunkId,sampleRate:48000,samples:synthetic()})
    let resolve!: (result:typeof dto)=>void; let started!:()=>void; const ready=new Promise<void>(r=>{started=r})
    vi.mocked(asr.execute).mockImplementationOnce(async()=>{started();return new Promise(r=>{resolve=r})})
    const first=service.transcribe(request()); const rejected=expect(first).rejects.toThrow('讲解转写未完成'); await ready
    await expect(service.transcribe(request())).rejects.toThrow('正在转写'); await service.erase(sessionId); resolve(dto); await rejected
    expect(ledger.size).toBe(0); await expect(service.read(sessionId,chunkId)).rejects.toThrow(); await expect(service.write({action:'write',sessionId,chunkId,sampleRate:48000,samples:synthetic()})).rejects.toThrow('已删除')
  })
  it('明确留存复用ZIP单资源，临时清除后可校验恢复；彻底删除后不可恢复',async()=>{
    const service=new ExplanationAudioService(root,fixtureAsr()); await service.write({action:'write',sessionId,chunkId,sampleRate:48000,samples:synthetic()})
    const original=await service.read(sessionId,chunkId); const archived=await service.archive(sessionId); const retained=path.join(root,'retained.zip'); await fs.copyFile(archived.path,retained)
    await service.release(sessionId); await service.restore({action:'restore',sessionId,...archived,path:retained}); expect(await service.read(sessionId,chunkId)).toEqual(original)
    await expect(service.restore({action:'restore',sessionId,...archived,path:retained,digest:`sha256:${'0'.repeat(64)}`})).rejects.toThrow('已修改')
    await service.erase(sessionId); await expect(service.restore({action:'restore',sessionId,...archived,path:retained})).rejects.toThrow('不能恢复')
  })
  it('写入与擦除串行，不可由排队写入复活；过期清理不改变明确留存文件',async()=>{
    const service=new ExplanationAudioService(root,fixtureAsr()); const writing=service.write({action:'write',sessionId,chunkId,sampleRate:48000,samples:synthetic()}); const rejected=expect(writing).rejects.toThrow('已删除'); await service.erase(sessionId); await rejected
    const other=crypto.randomUUID(); await service.write({action:'write',sessionId:other,chunkId,sampleRate:48000,samples:synthetic()}); await service.cleanupExpired(Date.now()+25*3600_000); await expect(service.read(other,chunkId)).rejects.toThrow()
  })
})
