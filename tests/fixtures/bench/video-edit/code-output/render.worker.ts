import { enableVideoEditRenderDiagnostics, beginVideoEditGpuFrame, takeVideoEditGpuFrame } from '@/features/videoEdit/engine/videoEditPreparationTiming'
import { VideoEditRenderer } from '@/features/videoEdit/engine/videoEditRenderer'
import { createVideoEditSequence, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { rememberTransientCodeSource } from '@/core/videoEdit/codeMaterial/sources'
import { sha256HexString } from '@/utils/save/hash'
import { installAuthorTrustGate } from '@/features/videoEdit/engine/videoEditAuthorTrust'
import { videoEditParameterUpdate } from '@/features/videoEdit/engine/videoEditParameterUpdate'

// 夹具全为本机作者源码；外来内容不会通过此测试宿主。
installAuthorTrustGate(async request => { if (request.context?.length) throw new Error('此验收不执行外来内容') })
const source = (variant: number, mode: string): string => `export default {
 name:'输出缓存夹具',mode:'${mode}',width:1920,height:1080,frameKey(){return 'still'},
 params:[{key:'amount',type:'number',title:'位置',default:0,min:0,max:1,step:.01}],
 draw(ctx,t,p,w,h){
   ctx.fillStyle='rgba(20,40,80,.55)';ctx.fillRect(0,0,w,h);
   for(let i=0;i<360;i++){
     ctx.fillStyle='hsla('+((i*17+${variant})%360)+',70%,55%,.65)';
     ctx.beginPath();ctx.arc((i*83+p.amount*160)%w,(i*37)%h,12+i%26,0,Math.PI*2);ctx.fill();
   }
 }
}`
async function fixture(mode: string): Promise<VideoEditComposition> {
  const versions = await Promise.all([0, 1].map(async variant => {
    const text = source(variant, mode), hash = await sha256HexString(text)
    return { id: `v${variant}`, apiVersion: 7 as const, languageVersion: 4 as const, entry: 'main.js', files: [{ path: 'main.js', hash, location: rememberTransientCodeSource(hash, text) }] }
  }))
  const sequence = { ...createVideoEditSequence('缓存验收'), width: 1920, height: 1080, tracks: [1, 2, 3].map(index => ({ id: `track${index}`, name: `视频${index}`, index, kind: 'video' as const, locked: false, enabled: true, muted: false, solo: false })) }
  const clips: VideoEditClip[] = [0, 1, 2].map(index => ({ id: `clip${index}`, itemId: `item${index}`, kind: 'code', name: `代码${index}`, track: index + 1, start: 0, duration: 300, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: index * .05, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '', code: { definitionId: 'code', versionId: 'v0', parameters: { amount: 0 } }, effects: [{ id: 'external', name: '反相', enabled: true, amount: 0, builtin: { id: 'invert', params: {} } }] }))
  return { ...sequence, clips, fps: 30, revision: 0, media: [], items: clips.map(clip => ({ id: clip.itemId, name: clip.name, kind: 'code', code: clip.code })), codeMaterials: [{ id: 'code', name: '代码', defaultVersionId: 'v0', versions }] }
}
self.onmessage = async ({ data }: MessageEvent<{ id: number; scenario: string; reuse: boolean; diagnostics: boolean; surface: OffscreenCanvas }>) => {
  let renderer: VideoEditRenderer | undefined
  try {
    enableVideoEditRenderDiagnostics(data.diagnostics)
    let document = await fixture(data.scenario === 'static-parameter' ? 'static' : 'dynamic')
    renderer = new VideoEditRenderer(document, { previewWidth: 1920, surface: data.surface, reuseCodeOutputs: data.reuse })
    const render = async (frame: number, sequential = false, observe = false) => {
      beginVideoEditGpuFrame()
      const start = performance.now(), result = await renderer!.render(frame, sequential, false, () => true, undefined, undefined, 'interactive', undefined, true, undefined, observe)
      await result.completion
      if (!result.presented || result.approximate || result.effectErrors?.length) throw new Error(JSON.stringify({ presented: result.presented, errors: result.effectErrors }))
      const elapsedMs = performance.now() - start, stages = await takeVideoEditGpuFrame()
      return { elapsedMs, stages, allocations: renderer!.codeDiagnostics().gpu?.textureAllocations, hits: result.cacheHits, cpuMs: renderer!.codePerformance().reduce((sum, value) => sum + value.cpuMs, 0), gpuMs: result.gpuMs }
    }
    const cold = await render(0)
    const samples = []
    for (let index = 0; index < 32; index++) {
      if (data.scenario !== 'still-playback') {
        const next = { ...document, revision: document.revision + 1, clips: document.clips.map((clip, at) => at ? clip : data.scenario === 'other-clip' ? { ...clip, code: { ...clip.code!, versionId: `v${index % 2}` } } : (data.scenario === 'parameter-gesture' || data.scenario === 'static-parameter') ? { ...clip, code: { ...clip.code!, parameters: { amount: index / 40 } } } : data.scenario === 'external-transform' ? { ...clip, x: index / 200 } : { ...clip, effects: clip.effects!.map(effect => ({ ...effect, amount: index / 40 })) }) }
        if (data.scenario === 'other-clip') await renderer.updateDocument(next)
        else {
          const update = videoEditParameterUpdate(document, next)
          if (!update) throw new Error('夹具应走正式参数手势更新')
          renderer.updateParameters(update)
        }
        document = next
      }
      const sample = await render(data.scenario === 'still-playback' ? index + 1 : 0, data.scenario === 'still-playback')
      if (index >= 8) samples.push(sample)
    }
    const diagnostics = renderer.codeDiagnostics()
    if (data.scenario === 'static-parameter' && new Set(samples.map(sample => sample.allocations)).size !== 1) throw new Error('静态参数热帧重复分配了纹理')
    // 像素回读放在计时区间外，两条路径拥有相同的请求帧历史。
    let capture: Promise<ImageBitmap> | undefined
    const captured = await renderer.render(data.scenario === 'still-playback' ? 32 : 0, false, false, () => true, undefined, undefined, 'interactive', pixels => { capture = pixels }, true)
    await captured.completion
    if (!capture) throw new Error('正式呈现未交回像素')
    const bitmap = await capture, raster = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = raster.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0); bitmap.close()
    const pixels = ctx.getImageData(0, 0, raster.width, raster.height)
    const pixelDigest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels.data))].map(value => value.toString(16).padStart(2, '0')).join('')
    const png = [...new Uint8Array(await (await raster.convertToBlob({ type: 'image/png' })).arrayBuffer())]
    // 观察与字体失效必须回到作者入口，不借用上一次的元素或像素。
    const observed = await render(33, false, true)
    if (observed.hits !== 0) throw new Error('观察请求复用了旧作者输出')
    await renderer.invalidateFontResources()
    const fontReset = await render(33)
    // 静态 B/C 内容相同，失效后 B 重画，C 可以共享本帧刚生成的 B。
    const sameFrameHits = data.reuse && data.scenario === 'static-parameter' ? 1 : 0
    if (fontReset.hits !== sameFrameHits) throw new Error('字体失效后的生成与同帧共享数量不符')
    self.postMessage({ id: data.id, result: { cold, samples, diagnostics, observed, fontReset, pixelDigest, png } })
  } catch (error) { self.postMessage({ id: data.id, error: error instanceof Error ? error.stack : String(error) }) }
  finally { await renderer?.dispose() }
}
