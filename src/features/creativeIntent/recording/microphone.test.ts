// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { captureMicrophone } from './microphone'

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})
function device(){
  const track=new EventTarget();Object.assign(track,{stop:vi.fn(),getSettings:()=>({latency:.02})})
  const stream={getTracks:()=>[track],getAudioTracks:()=>[track]}
  const stop=()=>{expect((track as EventTarget&{stop:ReturnType<typeof vi.fn>}).stop).toHaveBeenCalled()}
  return{track,stream,stop}
}
it('E09 权限等待中取消，迟到流立刻释放；权限拒绝不创建采集器',async()=>{
  const d=device();let resolve!:(stream:typeof d.stream)=>void
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn(()=>new Promise(r=>{resolve=r}))}})
  const controller=new AbortController();const capture=captureMicrophone(0,()=>{},()=>{},controller.signal);controller.abort();resolve(d.stream)
  await expect(capture).rejects.toThrow();d.stop()
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn(async()=>{throw new Error('denied')})}})
  await expect(captureMicrophone(0,()=>{},()=>{},new AbortController().signal)).rejects.toThrow('denied')
})
it('E03/E09 样本时钟不取投递时间；设备断开通知；停止清空尾包并关闭context',async()=>{
  const d=device();const blocks:Array<{monoStartUs:number;firstFrame:number}>=[];const interrupt=vi.fn();const close=vi.fn(async()=>{})
  let node!: {port:{onmessage?:(event:{data:{firstFrame?:number;samples?:Float32Array;stopped?:boolean}})=>void;postMessage:(value:string)=>void};disconnect:()=>void}
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn(async()=>d.stream)}})
  class Context {
    sampleRate=48000;baseLatency=.01;outputLatency=.2;currentTime=1;state='running';onstatechange?:()=>void;audioWorklet={addModule:vi.fn(async()=>{})};destination={}
    resume=async()=>{};close=close;getOutputTimestamp=()=>({contextTime:1,performanceTime:1000})
    createMediaStreamSource=()=>({connect:()=>{},disconnect:()=>{}})
  }
  vi.stubGlobal('AudioContext',Context)
  vi.stubGlobal('AudioWorkletNode',class {
    port={onmessage:undefined as typeof node.port.onmessage,postMessage:(_value:string)=>{this.port.onmessage?.({data:{firstFrame:48640,samples:new Float32Array(64)}});this.port.onmessage?.({data:{stopped:true}})}}
    constructor(){node={port:this.port,disconnect:()=>{}}}connect(){}disconnect(){}
  })
  const capture=await captureMicrophone(0,block=>blocks.push(block),interrupt,new AbortController().signal)
  node.port.onmessage!({data:{firstFrame:48000,samples:new Float32Array(128)}});node.port.onmessage!({data:{firstFrame:48128,samples:new Float32Array(128)}})
  expect(blocks.map(b=>b.monoStartUs)).toEqual([780_000,782_667]);d.track.dispatchEvent(new Event('ended'));expect(interrupt).toHaveBeenCalledWith(expect.stringContaining('断开'))
  await capture.stop();d.stop();expect(close).toHaveBeenCalledTimes(1);expect(blocks.at(-1)?.firstFrame).toBe(48640)
})

it('30 分钟 60ppm 设备漂移周期重对齐，校准跳变量进入不确定度且时间不倒退', async () => {
  const d = device()
  let audioSeconds = 1
  const timestamp = vi.fn(() => ({ contextTime: audioSeconds, performanceTime: 1000 + (audioSeconds - 1) * 1000 / 1.00006 }))
  let port!: { onmessage?: (event: { data: { firstFrame?: number; samples?: Float32Array; stopped?: boolean } }) => void }
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => d.stream) } })
  vi.stubGlobal('AudioContext', class {
    sampleRate = 48000; baseLatency = .01; outputLatency = .01; state = 'running'; destination = {}
    get currentTime() { return audioSeconds }
    audioWorklet = { addModule: async () => {} }; resume = async () => {}; close = async () => {}
    getOutputTimestamp = timestamp
    createMediaStreamSource = () => ({ connect: () => {}, disconnect: () => {} })
  })
  vi.stubGlobal('AudioWorkletNode', class {
    port = { onmessage: undefined as typeof port.onmessage, postMessage: () => { this.port.onmessage?.({ data: { stopped: true } }) } }
    constructor() { port = this.port }
    connect() {} disconnect() {}
  })
  const blocks: Array<{ monoStartUs: number; uncertaintyUs: number }> = []
  const capture = await captureMicrophone(0, block => blocks.push(block), () => {}, new AbortController().signal)
  for (let index = 0; index <= 360; index++) {
    audioSeconds = 1 + index * 5
    port.onmessage!({ data: { firstFrame: Math.round(audioSeconds * 48000), samples: new Float32Array(48000 * 5) } })
    const expected = (1000 + index * 5000 / 1.00006) * 1000 - 30000
    expect(Math.abs(blocks[index].monoStartUs - expected)).toBeLessThan(1000)
    if (index) {
      expect(blocks[index].monoStartUs).toBeGreaterThan(blocks[index - 1].monoStartUs)
      expect(Math.abs(blocks[index].monoStartUs - blocks[index - 1].monoStartUs - 5_000_000)).toBeLessThanOrEqual(blocks[index].uncertaintyUs)
    }
  }
  expect(timestamp.mock.calls.length).toBeGreaterThanOrEqual(361)
  await capture.stop()
})
