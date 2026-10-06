import type * as OpenCv from '@techstark/opencv-js'
import { createRequire } from 'node:module'
import { resolve as resolvePath } from 'node:path'
import { isVideoEditTrackQuad, videoEditTrackProject, type VideoEditTrackGeometryRecord, type VideoEditTrackQuad } from '../../../../../src/core/videoEdit/tracking'
import type { TrackingJobPrompt } from './trackingProtocol'

type Cv = typeof OpenCv
let ready: Promise<{ cv: Cv }> | undefined
/** Loaded only inside the existing utility process; wrap cv to avoid assimilating Emscripten's thenable. */
export function loadTrackingOpenCv(): Promise<{ cv: Cv }> {
  return ready ??= new Promise<{ cv: Cv }>((resolve, reject) => {
    // Native require bypasses Emscripten's non-Promise `then`, which ESM loaders may assimilate forever.
    const cv = createRequire(typeof __filename === 'string' ? __filename : resolvePath(process.cwd(), 'package.json'))('@techstark/opencv-js') as Cv
    if (typeof cv.Mat === 'function') { resolve({ cv }); return }
    cv.onRuntimeInitialized = () => resolve({ cv })
    const runtime = cv as Cv & { onAbort?: (reason: unknown) => void }
    runtime.onAbort = reason => reject(new Error(`跟踪分析初始化失败：${String(reason)}`))
  })
}
const IDENTITY = [1,0,0,0,1,0,0,0,1]
function multiply(a: number[], b: number[]): number[] {
  return Array.from({ length: 9 }, (_, i) => { const r=Math.floor(i/3); const c=i%3; return a[r*3]*b[c]+a[r*3+1]*b[c+3]+a[r*3+2]*b[c+6] })
}

/** Mature OpenCV pyramidal LK + forward/backward rejection; planar = masked Shi-Tomasi features + RANSAC. */
export class OpenCvTracker {
  private previous?: OpenCv.Mat
  private state!: VideoEditTrackGeometryRecord
  private prompt!: TrackingJobPrompt
  constructor(private readonly cv: Cv, private readonly method: 'point' | 'planar', readonly width: number, readonly height: number) {}
  private gray(rgb: Uint8Array): OpenCv.Mat {
    const source = this.cv.matFromArray(this.height, this.width, this.cv.CV_8UC3, rgb)
    const gray = new this.cv.Mat()
    try { this.cv.cvtColor(source, gray, this.cv.COLOR_RGB2GRAY); return gray } catch (error) { gray.delete(); throw error } finally { source.delete() }
  }
  init(rgb: Uint8Array, prompt: TrackingJobPrompt, resume?: VideoEditTrackGeometryRecord): VideoEditTrackGeometryRecord {
    this.previous?.delete(); this.previous = this.gray(rgb); this.prompt = prompt
    this.state = resume ?? (this.method === 'point'
      ? { points: prompt.points!.map(p => [p[0],p[1],1]), confidence: 1 }
      : { quad: structuredClone(prompt.quad!), homography: [...IDENTITY], confidence: 1 })
    return this.state
  }
  update(rgb: Uint8Array): VideoEditTrackGeometryRecord {
    const cv = this.cv; const current = this.gray(rgb)
    const allocated: OpenCv.Mat[] = []
    const mat = (): OpenCv.Mat => { const m=new cv.Mat(); allocated.push(m); return m }
    try {
      const points = mat()
      if (this.method === 'point') {
        const values=this.state.points!.flatMap(p => [p[0]*this.width,p[1]*this.height])
        const input=cv.matFromArray(values.length/2,1,cv.CV_32FC2,values); allocated.push(input); input.copyTo(points)
      } else {
        const mask=cv.Mat.zeros(this.height,this.width,cv.CV_8UC1); allocated.push(mask)
        const polygon=cv.matFromArray(4,1,cv.CV_32SC2,this.state.quad!.flatMap(p => [Math.round(p[0]*this.width),Math.round(p[1]*this.height)])); allocated.push(polygon)
        cv.fillConvexPoly(mask,polygon,new cv.Scalar(255))
        cv.goodFeaturesToTrack(this.previous!,points,160,0.01,6,mask)
      }
      if (points.rows < (this.method === 'planar' ? 8 : 1)) return this.lost()
      const next=mat(); const status=mat(); const error=mat(); const back=mat(); const backStatus=mat(); const backError=mat()
      const feature=this.prompt.window?.feature ?? 0.04; const search=this.prompt.window?.search ?? 0.2
      const window=Math.max(5,Math.round(feature*this.height) | 1)
      const levels=Math.max(1,Math.min(4,Math.ceil(Math.log2(Math.max(1,search*this.height/window)))))
      const criteria=new cv.TermCriteria(cv.TermCriteria_COUNT | cv.TermCriteria_EPS,30,0.01)
      cv.calcOpticalFlowPyrLK(this.previous!,current,points,next,status,error,new cv.Size(window,window),levels,criteria)
      cv.calcOpticalFlowPyrLK(current,this.previous!,next,back,backStatus,backError,new cv.Size(window,window),levels,criteria)
      const source:number[]=[]; const destination:number[]=[]; const tracked:Array<[number,number,number]>=[]
      for (let i=0;i<points.rows;i++) {
        const x=points.data32F[i*2]; const y=points.data32F[i*2+1]; const nx=next.data32F[i*2]; const ny=next.data32F[i*2+1]
        const fb=Math.hypot(back.data32F[i*2]-x,back.data32F[i*2+1]-y)
        const valid=status.data[i] && backStatus.data[i] && Number.isFinite(fb) && fb<1.5 && error.data32F[i]<35 && Math.hypot(nx-x,ny-y)<=search*this.height/2 && nx>=0 && ny>=0 && nx<this.width && ny<this.height
        const confidence=valid ? Math.max(0,1-fb/1.5)*Math.max(0,1-error.data32F[i]/35) : 0
        tracked.push([valid?nx/this.width:x/this.width,valid?ny/this.height:y/this.height,confidence])
        if (valid) { source.push(x,y); destination.push(nx,ny) }
      }
      if (this.method === 'point') return this.state={ points: tracked, confidence: Math.min(...tracked.map(p => p[2])) }
      if (source.length<16) return this.lost()
      const from=cv.matFromArray(source.length/2,1,cv.CV_32FC2,source); const to=cv.matFromArray(source.length/2,1,cv.CV_32FC2,destination); allocated.push(from,to)
      const inliers=mat(); const h=cv.findHomography(from,to,cv.RANSAC,2,inliers,1000,0.995); allocated.push(h)
      if (h.empty()) return this.lost()
      const confidence=Array.from(inliers.data).reduce((sum,v)=>sum+Number(v!==0),0)/points.rows
      if (confidence<0.5) return this.lost()
      // Pixel homography → normalized picture coordinates before persistence.
      const p=Array.from(h.data64F); const n=[p[0],p[1]*this.height/this.width,p[2]/this.width,p[3]*this.width/this.height,p[4],p[5]/this.height,p[6]*this.width,p[7]*this.height,p[8]]
      const quad=this.state.quad!.map(([x,y])=>videoEditTrackProject(n,x,y)) as VideoEditTrackQuad
      if (!isVideoEditTrackQuad(quad)) return this.lost()
      return this.state={ quad, homography: multiply(n,this.state.homography!), confidence }
    } finally {
      for (const m of allocated) m.delete()
      this.previous?.delete(); this.previous=current
    }
  }
  private lost(): VideoEditTrackGeometryRecord { return this.state={...this.state,confidence:0,...(this.state.points?{points:this.state.points.map(p=>[p[0],p[1],0] as [number,number,number])}:{})} }
  dispose(): void { this.previous?.delete(); this.previous=undefined }
}
