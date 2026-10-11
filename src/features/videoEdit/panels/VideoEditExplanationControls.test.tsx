// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactNode } from 'react'
import { RecordingCollector } from '@/features/creativeIntent/recording/RecordingCollector'
import { recordingFixtureSession } from '@/core/creativeIntent/fixtures/recordingFixtures'
import { transcriptEventSchema } from '@/core/creativeIntent/schema'
import type { VideoEditInstance } from '../application/videoEditService'
import type { VideoExplanationState } from '../application/videoEditExplanation'
import { VideoEditExplanationControls, VideoEditExplanationReview } from './VideoEditExplanationControls'

const control=vi.hoisted(()=>({state:undefined as VideoExplanationState|undefined,version:0,listeners:new Set<()=>void>(),read:vi.fn(),stream:vi.fn()}))
vi.mock('../application/videoEditExplanation',()=>({videoExplanationState:()=>control.state,videoExplanationRevision:()=>control.version,subscribeVideoExplanation:(listener:()=>void)=>{control.listeners.add(listener);return()=>control.listeners.delete(listener)},readVideoExplanationPage:control.read,videoExplanationJsonl:control.stream,readVideoExplanationReview:vi.fn(),correctVideoExplanationBinding:vi.fn(),startVideoExplanation:vi.fn(),stopVideoExplanation:vi.fn(),pauseVideoExplanation:vi.fn(),resumeVideoExplanation:vi.fn(),transcribeVideoExplanation:vi.fn(),eraseVideoExplanation:vi.fn(),reopenVideoExplanation:vi.fn(),cancelVideoExplanationTranscription:vi.fn(),correctVideoExplanationText:vi.fn(),clearTemporaryVideoExplanationAudio:vi.fn(),retainVideoExplanationAudio:vi.fn(),readVideoExplanationAudio:vi.fn(),retryVideoExplanationSave:vi.fn()}))
vi.mock('@/features/settings',()=>({modelDefaultsManager:{resolveTranscriptionModelId:()=>{throw new Error('not configured')},listTranscriptionModels:()=>[]}}))
vi.mock('react-virtuoso',()=>({Virtuoso:({data,itemContent}:{data:unknown[];itemContent:(index:number,value:unknown)=>ReactNode})=><div>{data.map((value,index)=><div key={index}>{itemContent(index,value)}</div>)}</div>}))
let root:Root|undefined;let element:HTMLElement|undefined
afterEach(async()=>{await act(async()=>root?.unmount());element?.remove();root=undefined;control.state=undefined;control.listeners.clear();vi.clearAllMocks()})
function state(id:string):VideoExplanationState{
  const collector=new RecordingCollector({...recordingFixtureSession(),id,state:'reviewing'},async()=>{},()=>{})
  return{collector,originMs:0,elapsedUs:1000,busy:false,erased:false,controller:new AbortController(),uncertaintyUs:[]}
}
it('E09 删除/换会话清除词稿缓存，迟到JSONL批次不能在新讲解中复活',async()=>{
  const owner={document:{id:'fixture-document'}} as unknown as VideoEditInstance;const onError=vi.fn()
  const entry=transcriptEventSchema.parse({kind:'transcript',eventId:'event',seq:1,monoUs:0,timeline:null,unavailableReason:'missing-presentation',clockSegmentRef:'clock',utteranceId:'utterance',text:'PRIVATE transcript old',audioSegmentRef:'audio',startSample:0,endSample:48,monoSpanUs:[0,1000],timelineSpans:[],granularity:'segment',alignmentQuality:'unavailable',source:'asr'})
  control.state=state('old-session');control.read.mockResolvedValue([entry]);control.version=0
  let resolve!:(value:IteratorResult<string>)=>void;control.stream.mockReturnValue({next:()=>new Promise<IteratorResult<string>>(done=>{resolve=done})})
  element=document.createElement('div');document.body.append(element);root=createRoot(element)
  await act(async()=>root!.render(<VideoEditExplanationReview owner={owner} onError={onError}/>))
  expect(element.querySelector('textarea')?.value).toBe('PRIVATE transcript old')
  await act(async()=>{Array.from(element!.querySelectorAll('button')).find(button=>button.textContent==='预览结构化输入')!.click()})
  await act(async()=>{control.state=undefined;control.version++;control.listeners.forEach(listener=>listener())})
  expect(element.textContent).toBe('')
  control.read.mockResolvedValue([])
  await act(async()=>{control.state=state('new-session');control.version++;control.listeners.forEach(listener=>listener())})
  await act(async()=>{resolve({done:false,value:'PRIVATE JSONL old'});await Promise.resolve()})
  expect(element.querySelector('textarea')).toBeNull();expect(element.textContent).not.toContain('PRIVATE');expect(onError).not.toHaveBeenCalled()
})
it('原音失效的可恢复会话可以开始新讲解，不提供无效继续入口',async()=>{
  const owner={document:{id:'fixture-document'}} as unknown as VideoEditInstance
  control.state=state('expired-session');control.state.collector.session.state='recoverable';control.state.collector.session.retentionStatus='deleted';control.version=0
  element=document.createElement('div');document.body.append(element);root=createRoot(element)
  await act(async()=>root!.render(<VideoEditExplanationControls owner={owner} onError={vi.fn()}/>))
  await act(async()=>element!.querySelector('button')!.click())
  const buttons=Array.from(document.querySelectorAll('button'))
  expect(buttons.find(button=>button.textContent==='开始录制讲解')?.disabled).toBe(false)
  expect(buttons.some(button=>button.textContent==='继续录制')).toBe(false)
})
