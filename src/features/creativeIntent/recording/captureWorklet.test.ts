import fs from 'node:fs'
import vm from 'node:vm'
import { expect, it } from 'vitest'

it('E03 真实worklet代码采集合成PCM，延迟投递不改变sample位置，采集gap拆块与尾包封存',()=>{
  const messages:Array<{firstFrame?:number;samples?:Float32Array;stopped?:boolean}>=[]
  let Processor!:new()=>{process(inputs:Float32Array[][]):boolean;port:{onmessage:(e:{data:string})=>void}}
  const port={onmessage:(_event:{data:string})=>{},postMessage:(data:typeof messages[number])=>messages.push(data)}
  const context=vm.createContext({AudioWorkletProcessor:class{port=port},registerProcessor:(_name:string,ctor:typeof Processor)=>{Processor=ctor},currentFrame:12000,Float32Array})
  vm.runInContext(fs.readFileSync(new URL('./captureWorklet.js',import.meta.url),'utf8'),context)
  const capture=new Processor()
  for(let block=0;block<34;block++){context.currentFrame=12000+block*128;capture.process([[new Float32Array(128).fill(.2)]])}
  context.currentFrame=20000;capture.process([[new Float32Array(128).fill(.4)]])
  capture.port.onmessage({data:'stop'})
  const audio=messages.filter(m=>m.samples); expect(audio.map(m=>[m.firstFrame,m.samples!.length])).toEqual([[12000,4096],[16096,256],[20000,128]])
  expect(messages.at(-1)).toEqual({stopped:true}); expect(capture.process([])).toBe(false)
})
