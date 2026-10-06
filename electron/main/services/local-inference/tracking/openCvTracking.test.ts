import { expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { decodeSmartRegionLayout } from '../../../../../src/core/videoEdit/smartRegions'
import { decodeVideoEditTrackGeometry, videoEditTrackProject, type VideoEditTrackGeometryRecord, type VideoEditTrackHeader, type VideoEditTrackQuad } from '../../../../../src/core/videoEdit/tracking'
import { loadTrackingOpenCv, OpenCvTracker } from './openCvTracking'
import { runTracking, type TrackingDependencies } from './trackJob'
import type { TrackingJob } from './trackingProtocol'

const quad:VideoEditTrackQuad=[[.2,.2],[.8,.2],[.8,.8],[.2,.8]]
const transform=(frame:number):number[]=>[1+frame*.0004,frame*.0001,frame*.002,frame*.0002,1-frame*.0001,frame*.001,frame*.0005,frame*.0002,1]
async function synthetic(width:number,height:number,count:number) {
  const {cv}=await loadTrackingOpenCv(); const rgb=new Uint8Array(width*height*3)
  let seed=4421
  // Deterministic textured plane with 6-pixel detail; black surroundings.
  const texture=new Uint8Array(Math.ceil(width/6)*Math.ceil(height/6))
  for(let i=0;i<texture.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;texture[i]=30+(seed%200)}
  for(let y=Math.floor(height*.15);y<height*.85;y++)for(let x=Math.floor(width*.15);x<width*.85;x++)rgb.fill(texture[Math.floor(y/6)*Math.ceil(width/6)+Math.floor(x/6)],(y*width+x)*3,(y*width+x)*3+3)
  const source=cv.matFromArray(height,width,cv.CV_8UC3,rgb); const frames:Uint8Array[]=[]
  try {for(let f=0;f<count;f++) {
    const h=transform(f); const m=cv.matFromArray(3,3,cv.CV_64F,[h[0],h[1]*width/height,h[2]*width,h[3]*height/width,h[4],h[5]*height,h[6]/width,h[7]/height,h[8]])
    const output=new cv.Mat()
    try{cv.warpPerspective(source,output,m,new cv.Size(width,height));frames.push(new Uint8Array(output.data))}finally{m.delete();output.delete()}
  }}finally{source.delete()}
  return {cv,frames}
}

it('真实 OpenCV WASM：合成透视视频逐帧点/四角误差、丢失与每帧耗时',async()=> {
  const timings:unknown[]=[]
  for(const [width,height] of [[640,360],[1280,720]]) {
    const {cv,frames}=await synthetic(width,height,31)
    for(const method of ['point','planar'] as const) {
      const tracker=new OpenCvTracker(cv,method,width,height)
      const initial: Array<[number,number,0|1]>=[[.35,.35,1],[.65,.35,1],[.65,.65,1],[.35,.65,1]]
      tracker.init(frames[0],{frame:0,...(method==='point'?{points:initial}:{quad})})
      const elapsed:number[]=[]; const errors:number[]=[]
      try {for(let f=1;f<frames.length;f++) {
        const begin=performance.now();const state=tracker.update(frames[f]);elapsed.push(performance.now()-begin)
        expect(state.confidence).toBeGreaterThan(.4)
        const predicted=method==='point'?state.points!:state.quad!;const original=method==='point'?initial:quad
        predicted.forEach((point,i)=>{const truth=videoEditTrackProject(transform(f),original[i][0],original[i][1]);errors.push(Math.hypot((truth[0]-point[0])*width,(truth[1]-point[1])*height))})
      }
      expect(Math.max(...errors)).toBeLessThan(2)
      const lost=tracker.update(new Uint8Array(width*height*3));expect(lost.confidence).toBe(0)
      timings.push({method,width,height,frames:30,meanMs:elapsed.reduce((s,v)=>s+v,0)/elapsed.length,p95Ms:[...elapsed].sort((a,b)=>a-b)[28],meanErrorPx:errors.reduce((s,v)=>s+v,0)/errors.length,maxErrorPx:Math.max(...errors)})
      }finally{tracker.dispose()}
    }
  }
  await mkdir('.tmp/tracking',{recursive:true});await writeFile('.tmp/tracking/opencv-benchmark.json',JSON.stringify(timings,null,2))
},30000)

it.each(['point','planar'] as const)('任务容器与 %s 正反向、单步续跟、纠错一致，不打开推理模型',async method=> {
  const {frames}=await synthetic(320,180,12);const files=new Map<string,Uint8Array>()
  const job:TrackingJob={id:'test',method,models:[],ffmpegPath:'unused',source:'synthetic',containerStartUs:0,fps:30,display:{width:320,height:180},prompts:[{frame:3,...(method==='point'?{points:[[.4,.4,1] as [number,number,0|1]],window:{feature:.04,search:.2}}:{quad})},{frame:8,...(method==='point'?{points:[[.43,.41,1] as [number,number,0|1]],window:{feature:.12,search:.2}}:{quad:quad.map(p=>videoEditTrackProject(transform(8),p[0],p[1])) as VideoEditTrackQuad})}],range:{first:0,last:11},direction:'both',outputPath:'full',providers:['cpu']}
  const deps:TrackingDependencies={openModel:async()=>{throw new Error('不应打开模型')},frames:async function*({first,count}){for(let f=first;f<first+count;f++)if(frames[f])yield frames[f]},readFile:async path=>files.get(path),writeFile:async(path,data)=>{files.set(path,data)},deflate:b=>deflateRawSync(b),inflate:b=>inflateRawSync(b),signal:new AbortController().signal,log:()=>{},progress:()=>{}}
  await runTracking(job,deps)
  await runTracking({...job,outputPath:'partial',limit:1},deps)
  await runTracking({...job,outputPath:'resumed',existingPath:'partial'},deps)
  const read=(path:string):VideoEditTrackGeometryRecord[]=>{const bytes=files.get(path)!;const l=decodeSmartRegionLayout<VideoEditTrackHeader>(bytes);expect(l.header.firstFrame).toBe(0);expect(l.header.frameCount).toBe(12);return l.frames.map(f=>decodeVideoEditTrackGeometry(inflateRawSync(bytes.subarray(l.dataOffset+f.offset,l.dataOffset+f.offset+f.length))))}
  expect(read('resumed')).toEqual(read('full'))
  if(method==='point'){const layout=decodeSmartRegionLayout<VideoEditTrackHeader>(files.get('resumed')!);expect(layout.header.boxes[0]![2]).toBeCloseTo(.04*180/320);expect(layout.header.boxes[8]![2]).toBeCloseTo(.12*180/320)}
  const correction=read('full')[8];expect(correction.confidence).toBe(1)
},30000)
