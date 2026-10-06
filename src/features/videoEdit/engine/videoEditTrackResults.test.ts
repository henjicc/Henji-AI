import { afterEach, expect, it, vi } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { createVideoEditSequence, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { encodeSmartRegionSegment } from '@/core/videoEdit/smartRegions'
import { createVideoEditTrackHeader, encodeVideoEditTrackRecord, encodeVideoEditTrackGeometry, videoEditTrackerKey, type VideoEditTrackHeader, type VideoEditTrackQuad } from '@/core/videoEdit/tracking'
import { applyVideoEditClipFollow, setVideoEditTrackResults, videoEditClipSourceTimeUs, videoEditTrackerBox, videoEditTrackerMask, videoEditTrackerGeometry, videoEditClipTrackingQuad } from './videoEditTrackResults'
import { videoEditEffectMask } from './videoEditEffectMasks'

afterEach(() => { vi.unstubAllGlobals(); setVideoEditTrackResults({}) })

it('平面 Range 记录插值驱动角点贴合；丢失帧不外推，定义不被渲染改写',async()=> {
  const quad:VideoEditTrackQuad=[[.1,.2],[.8,.1],[.9,.8],[.2,.9]]
  const tracker={id:'plane',name:'屏幕',method:'planar' as const,prompts:[{timeUs:0,quad}]}
  const source:VideoEditClip={id:'source',itemId:'video',kind:'video',name:'原片',text:'',track:1,start:0,duration:30,sourceInUs:0,sourceRemainder:{numerator:0,denominator:1},x:0,y:0,scale:1,rotation:0,opacity:1,brightness:1,volume:0,trackers:[tracker]}
  const pinned:VideoEditClip={...source,id:'replacement',track:2,trackers:undefined,follow:{clipId:source.id,trackerId:tracker.id,offsetX:0,offsetY:0,mode:'corner_pin'}}
  const document:VideoEditComposition={...createVideoEditSequence(),width:100,height:100,fps:30,revision:0,media:[{id:'media',name:'视频',path:'video',kind:'video',durationSeconds:3,width:100,height:100}],items:[{id:'video',mediaId:'media',name:'视频',kind:'video'}],clips:[source,pinned]}
  const next=quad.map(p=>[p[0]+.05,p[1]]) as VideoEditTrackQuad
  serve({plane:encodeSmartRegionSegment(header({method:'planar',frameCount:3,boxes:[header().boxes[0],header().boxes[1],null]}),[quad,next,next].map((q,i)=>deflateRawSync(encodeVideoEditTrackGeometry({quad:q,homography:[1,0,0,0,1,0,0,0,1],confidence:i===2?0:1}))))})
  const key=videoEditTrackerKey('media',tracker);setVideoEditTrackResults({[key]:{url:'plane',version:'1'}})
  expect((await videoEditTrackerGeometry(key,50_000))!.quad![0][0]).toBeCloseTo(.125)
  const [followed]=await applyVideoEditClipFollow(document,[pinned],0)
  videoEditClipTrackingQuad(followed)!.forEach((p,i)=>p.forEach((v,k)=>expect(v).toBeCloseTo(quad[i][k],12)));expect(videoEditClipTrackingQuad(pinned)).toBeUndefined()
  expect(await videoEditTrackerGeometry(key,200_000)).toBeUndefined()
  expect(videoEditClipTrackingQuad((await applyVideoEditClipFollow(document,[pinned],6))[0])).toBeUndefined()
})
const header = (patch: Partial<VideoEditTrackHeader> = {}) => createVideoEditTrackHeader({ method: 'box', model: 'vittrack', fps: 10, firstFrame: 0, frameCount: 2, sourceWidth: 64, sourceHeight: 64, promptFrames: [0], boxes: [[0.1, 0.2, 0.2, 0.2, 1], [0.5, 0.6, 0.4, 0.4, 1]], summary: { tracked: 2, lost: 0 }, ...patch })
function serve(files: Record<string, Uint8Array>) {
  const fetcher = vi.fn(async (url: string, options?: { headers?: { Range: string } }) => {
    const bytes = files[url]; if (!bytes) return new Response(null, { status: 404 })
    const [, start, end] = /bytes=(\d+)-(\d+)/.exec(options?.headers?.Range ?? '') ?? []
    return new Response(bytes.slice(Number(start), Number(end) + 1).buffer, { status: 206 })
  })
  vi.stubGlobal('fetch', fetcher); return fetcher
}
it('按素材时间插值，缓存按地址与版本失效，读取失败可重试', async () => {
  const files = { 'track.htrk': encodeSmartRegionSegment(header()) }; const fetcher = serve(files)
  setVideoEditTrackResults({ key: { url: 'track.htrk', version: '1' } })
  const interpolated = (await videoEditTrackerBox('key', 50_000))!
  ;[0.3, 0.4, 0.3, 0.3, 1].forEach((value, index) => expect(interpolated[index]).toBeCloseTo(value, 10))
  await videoEditTrackerBox('key', 100_000); expect(fetcher).toHaveBeenCalledTimes(1)
  files['track.htrk'] = encodeSmartRegionSegment(header({ boxes: [[0, 0, 0.1, 0.1, 1], [0, 0, 0.1, 0.1, 1]] }))
  setVideoEditTrackResults({ key: { url: 'track.htrk', version: '2' } })
  expect(await videoEditTrackerBox('key', 50_000)).toEqual([0, 0, 0.1, 0.1, 1]); expect(fetcher).toHaveBeenCalledTimes(2)
  setVideoEditTrackResults({ key: { url: 'missing', version: '1' } })
  await expect(videoEditTrackerBox('key', 0)).rejects.toThrow('404')
  Object.assign(files, { missing: encodeSmartRegionSegment(header()) })
  expect(await videoEditTrackerBox('key', 0)).toEqual(header().boxes[0])
  expect(await videoEditTrackerBox('unbound', 0)).toBeUndefined()
})
it('形状跟踪真实 Range + deflate 读取；框与形状结果经同一路径分派到作用区域', async () => {
  const logits = new Int8Array(16).fill(-8); logits[5] = 8; logits[6] = 8; logits[9] = 8; logits[10] = 8
  const record = encodeVideoEditTrackRecord({ score: 1, pointer: new Float32Array(256), logits })
  const shape = header({ method: 'shape', frameCount: 1, boxes: [header().boxes[0]], logits: { width: 4, height: 4, scale: 4 } })
  serve({ shape: encodeSmartRegionSegment(shape, [deflateRawSync(record)]), box: encodeSmartRegionSegment(header()) })
  setVideoEditTrackResults({ shape: { url: 'shape', version: '1' }, box: { url: 'box', version: '1' } })
  const mask = await videoEditEffectMask({ regionId: 'tracker', trackerId: 's', feather: 0, expand: 0 }, { timeUs: 0, picture: { width: 64, height: 64 }, trackerKeys: { s: 'shape' } })
  expect(mask!.data[Math.floor(mask!.height / 2) * mask!.width + Math.floor(mask!.width / 2)]).toBe(255)
  expect(mask!.data[0]).toBe(0)
  const box = await videoEditTrackerMask('box', { feather: 0, expand: 0, invert: false }, 0)
  expect(box!.data[Math.floor(box!.height * 0.3) * box!.width + Math.floor(box!.width * 0.2)]).toBe(255)
  expect(await videoEditEffectMask({ regionId: 'tracker', trackerId: 'missing' }, { timeUs: 0, picture: { width: 64, height: 64 } })).toBeUndefined()
})
it('手绘遮罩跟随参考框移动与缩放，缺少绑定结果时跳过效果', async () => {
  serve({ box: encodeSmartRegionSegment(header({ frameCount: 1, boxes: [[0.5, 0.5, 0.4, 0.4, 1]] })) })
  setVideoEditTrackResults({ box: { url: 'box', version: '1' } })
  const setting = { regionId: 'shapes' as const, shapes: [{ id: 's1', kind: 'rect' as const, box: [0.1, 0.1, 0.2, 0.2] as [number, number, number, number], feather: 0, follow: { trackerId: 't1', reference: [0.1, 0.1, 0.2, 0.2] as [number, number, number, number] } }] }
  const context = { timeUs: 0, picture: { width: 64, height: 64 }, trackerKeys: { t1: 'box' } }
  const mask = (await videoEditEffectMask(setting, context))!
  expect(mask.data[Math.floor(mask.height * 0.7) * mask.width + Math.floor(mask.width * 0.7)]).toBe(255)
  expect(mask.data[Math.floor(mask.height * 0.2) * mask.width + Math.floor(mask.width * 0.2)]).toBe(0)
  setVideoEditTrackResults({}); expect(await videoEditEffectMask(setting, context)).toBeUndefined()
})
it('Worker 片段跟随按来源片段几何换算并保持自身缩放基值；静态图片、源时钟与落空引用', async () => {
  const tracker = { id: 't1', name: '物体', method: 'box' as const, prompts: [{ timeUs: 0, box: [0, 0, 1, 1] as [number, number, number, number] }] }
  const source: VideoEditClip = { id: 'source', itemId: 'video', kind: 'video', name: '视频', text: '', track: 1, start: 0, duration: 30, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0.1, y: 0, scale: 0.5, rotation: 0, opacity: 1, brightness: 1, volume: 0, trackers: [tracker] }
  const title: VideoEditClip = { ...source, id: 'title', itemId: 'text', kind: 'text', scale: 2, x: 0.3, trackers: undefined, follow: { clipId: 'source', trackerId: 't1', offsetX: 0.1, offsetY: 0.2 } }
  const sequence = createVideoEditSequence()
  const document: VideoEditComposition = { ...sequence, width: 100, height: 100, fps: 30, revision: 0, media: [{ id: 'media', name: '视频', path: 'video', kind: 'video', durationSeconds: 3, width: 100, height: 100 }], items: [{ id: 'video', mediaId: 'media', name: '视频', kind: 'video' }, { id: 'text', name: '标题', kind: 'text' }], clips: [source, title] }
  serve({ track: encodeSmartRegionSegment(header({ frameCount: 1, boxes: [[0.5, 0.5, 0.2, 0.2, 1]] })) })
  setVideoEditTrackResults({ [videoEditTrackerKey('media', tracker)]: { url: 'track', version: '1' } })
  const [followed] = await applyVideoEditClipFollow(document, [title], 0)
  expect(followed.x).toBeCloseTo(0.25); expect(followed.y).toBeCloseTo(0.25); expect(followed.scale).toBe(2)
  expect(title.x).toBe(0.3)
  expect(videoEditClipSourceTimeUs(document, { ...source, sourceInUs: 1_000_000, start: 10 }, 25)).toBe(1_500_000)
  document.media[0].kind = 'image'; expect(videoEditClipSourceTimeUs(document, source, 25)).toBe(0)
  source.follow = { clipId: title.id, trackerId: 't1', offsetX: 0, offsetY: 0 }
  expect((await applyVideoEditClipFollow(document, [title], 0))[0]).toBe(title)
  setVideoEditTrackResults({}); expect((await applyVideoEditClipFollow(document, [title], 0))[0]).toBe(title)
})
