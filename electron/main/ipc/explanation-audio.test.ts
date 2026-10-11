import { beforeEach, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent, WebContents, PermissionCheckHandlerHandlerDetails, Session } from 'electron'
import type { RecordingAudioRequest } from '../../../src/core/audioEdit/recordingAudio'
import { registerExplanationAudioHandlers } from './explanation-audio'
type RequestDetails = Parameters<NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]>>[3]

const hooks=vi.hoisted(()=>({check:undefined as ((...args:unknown[])=>boolean)|undefined,request:undefined as ((...args:unknown[])=>void)|undefined,handler:undefined as ((input:RecordingAudioRequest,event:IpcMainInvokeEvent)=>unknown)|undefined,cancel:vi.fn(),erase:vi.fn(),release:vi.fn()}))
vi.mock('electron',()=>({app:{on:vi.fn()},session:{defaultSession:{setPermissionCheckHandler:(fn:typeof hooks.check)=>{hooks.check=fn},setPermissionRequestHandler:(fn:typeof hooks.request)=>{hooks.request=fn}}}}))
vi.mock('./registry',()=>({registerIpcHandler:(_channel:string,_parse:unknown,handler:typeof hooks.handler)=>{hooks.handler=handler}}))
vi.mock('./application-control',()=>({assertTrustedApplicationSender:vi.fn()}))
vi.mock('../security/main-renderer-url',()=>({isTrustedMainRendererUrl:(url:string)=>url==='app://henji'}))
vi.mock('../services/logging',()=>({createMainLogger:()=>({warn:vi.fn()})}))
vi.mock('../services/audio-edit/explanation-audio',()=>({explanationAudioService:{cleanupExpired:vi.fn(async()=>{}),cancel:hooks.cancel,release:hooks.release,erase:hooks.erase}}))
beforeEach(()=>{vi.clearAllMocks();registerExplanationAudioHandlers()})
it('知情arming仅允许可信主frame麦克风；摄像头/混合请求/非应用frame都拒绝',async()=>{
  const handlers=new Map<string,()=>void>();const contents={id:1,getURL:()=> 'app://henji',on:(key:string,fn:()=>void)=>handlers.set(key,fn),once:(key:string,fn:()=>void)=>handlers.set(key,fn),removeListener:(key:string)=>handlers.delete(key)} as unknown as WebContents
  const event={sender:contents} as IpcMainInvokeEvent
  const details={mediaType:'audio'} as PermissionCheckHandlerHandlerDetails
  expect(hooks.check!(contents,'media','',details)).toBe(false)
  await hooks.handler!({action:'microphone',enabled:true,userReceipt:crypto.randomUUID()},event)
  expect(hooks.check!(contents,'media','',details)).toBe(true);expect(hooks.check!(contents,'media','',{mediaType:'video'})).toBe(false)
  for (const permission of ['geolocation','notifications','serial','unknown']) {
    expect(hooks.check!(contents,permission,'',details)).toBe(false)
    let granted=true;hooks.request!(contents,permission,(answer:boolean)=>{granted=answer},{isMainFrame:true,mediaTypes:['audio']});expect(granted).toBe(false)
  }
  for (const permission of ['clipboard-read','clipboard-sanitized-write']) {
    expect(hooks.check!(contents,permission,'',details)).toBe(true)
    let granted=false;hooks.request!(contents,permission,(answer:boolean)=>{granted=answer},{isMainFrame:true});expect(granted).toBe(true)
    hooks.request!(contents,permission,(answer:boolean)=>{granted=answer},{isMainFrame:false});expect(granted).toBe(false)
  }
  const decide=(request:Partial<RequestDetails>)=>{let answer:boolean|undefined;hooks.request!(contents,'media',(value:boolean)=>{answer=value},request);return answer}
  expect(decide({isMainFrame:true,mediaTypes:['audio']})).toBe(true);expect(decide({isMainFrame:true,mediaTypes:['audio','video']})).toBe(false);expect(decide({isMainFrame:false,mediaTypes:['audio']})).toBe(false)
  handlers.get('destroyed')!();expect(hooks.check!(contents,'media','',details)).toBe(false)
  expect(hooks.check!({getURL:()=> 'https://other.invalid'},'media','',details)).toBe(false)
})
