import { isUiInspectionActive } from '@/platform/runtime'
import { evaluateCodeMaterial } from '@/core/videoEdit/codeMaterial/evaluate'
import { createVideoEditDocument, videoEditComposition } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import type { CodeMaterialProgram } from '@/core/videoEdit/codeMaterial/contract'
import { VideoEditGpuCompositor } from './videoEditGpuCompositor'
import { VideoEditCodeCompiler } from './videoEditCodeCompiler'
export { runVideoEditCompositeProbe } from './videoEditCompositeProbe'

const source = (body: string, kind = 'generator', mode = 'dynamic', parameters = '{}'): string => `export default {apiVersion:1,name:"4K作者实验",kind:"${kind}",mode:"${mode}",width:3840,height:2160,durationSeconds:10,seed:42,parameters:${parameters},render(ctx){${body}}}`
function percentile(values: number[], percent: number): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percent))] }

/** Fixed bounded fixtures for the formal Electron scene. No user-defined script
 * or general debug invocation is exposed; normal application sessions reject it. */
export async function runVideoEditCodeProbe(host: HTMLElement): Promise<Record<string, unknown>> {
  if (!isUiInspectionActive()) throw new Error('代码素材实验仅由正式桌面验收运行。')
  const canvas = document.createElement('canvas'); canvas.width = 3840; canvas.height = 2160
  canvas.setAttribute('aria-label', '代码素材全分辨率实验'); canvas.style.width = '100%'; canvas.style.maxHeight = '65vh'; canvas.style.objectFit = 'contain'
  host.replaceChildren(canvas)
  const output = canvas.transferControlToOffscreen()
  const compositor = new VideoEditGpuCompositor(output)
  const compiler = new VideoEditCodeCompiler()
  const documentModel = createVideoEditDocument('有限实验')
  documentModel.sequences[0].width = 3840; documentModel.sequences[0].height = 2160; documentModel.sequences[0].frameRate = { numerator: 60, denominator: 1 }
  documentModel.items.push({ id: 'code-experiment-item', name: '实验画面', kind: 'text' })
  const clip = makeVideoEditItemClip(documentModel, 'code-experiment-item', documentModel.sequences[0].id, { frame: 0 })
  const composition = videoEditComposition(documentModel, documentModel.sequences[0].id)
  const context = { time: 0, localTime: 0, sequenceTime: 0, width: 3840, height: 2160, frame: 0, fps: 60 }
  let runtime: Awaited<ReturnType<VideoEditGpuCompositor['code']>> | undefined
  let snapshot: ImageBitmap | undefined
  try {
  const cold = performance.now()
  const staticSource = source('return [rect({x:80,y:100,width:800,height:600,fill:[1,0,0,.5],radius:40}),ellipse({x:980,y:100,width:600,height:600,fill:[0,1,0,.75]}),line({x1:80,y1:900,x2:3000,y2:1200,width:12,color:[1,1,1,1]})];', 'generator', 'static')
  const programs = {
    static: await compiler.compile(staticSource),
    title: await compiler.compile(source('return [rect({x:80+ctx.time*200,y:100,width:800,height:600,fill:ctx.params.ink,radius:40}),text({x:1920,y:1200,text:ctx.params.title,fontSize:180,color:[1,1,1,1],align:"center"})];', 'generator', 'dynamic', '{title:{type:"text",title:"标题",default:"原生代码 · 4K",maxLength:80},ink:{type:"color",title:"图形颜色",default:[1,.3,.1,.7]}}')),
    filter: await compiler.compile(source('const pixel=sample(ctx.u,ctx.v);return rgba(pixel.r*ctx.params.amount,pixel.g,pixel.b,pixel.a);', 'filter', 'dynamic', '{amount:{type:"number",title:"红色强度",default:.5,min:0,max:1,step:.01,animatable:true}}')),
  }
  const coldCompileMs = performance.now() - cold
  const cacheBegan = performance.now(); await compiler.compile(staticSource); const compileCacheMs = performance.now() - cacheBegan
  const readbacks: number[][] = []
  const inspect = (): number[] => {
    const sample = new OffscreenCanvas(1, 1); const context = sample.getContext('2d', { willReadFrequently: true })!
    context.drawImage(snapshot!, 300, 300, 1, 1, 0, 0, 1, 1)
    const value = [...context.getImageData(0, 0, 1, 1).data]; readbacks.push(value); return value
  }
  const render = async (program: CodeMaterialProgram, frame: number, filtered = false, values: Record<string, unknown> = {}, inspectFrame = false): Promise<number> => {
    const began = performance.now(); const time = { ...context, time: frame / 60, localTime: frame / 60, sequenceTime: frame / 60, frame }
    let picture = await runtime!.generator('generator', program, time, values)
    if (filtered) picture = await runtime!.filter('filter', 'filter-version', programs.filter, time, { amount: .25 }, picture)
    const result = await compositor.draw(composition, [clip], [picture], () => true)
    if (inspectFrame) { snapshot?.close(); snapshot = output.transferToImageBitmap() }
    await result.completion; canvas.dataset.presentedFrame = String(frame)
    return performance.now() - began
  }
    runtime = await compositor.code()
    const first = await render(programs.static, 0, false, {}, true)
    const transparentOnBlack = inspect()
    if (Math.abs(transparentOnBlack[0] - 128) > 2 || transparentOnBlack[1] !== 0) throw new Error(`透明度合成错误：${transparentOnBlack}`)
    await render(programs.static, 0, true, {}, true); const filtered = inspect()
    if (Math.abs(filtered[0] - 32) > 2 || filtered[1] !== 0) throw new Error(`滤镜或预乘透明度错误：${filtered}`)
    const titleFirstMs = await render(programs.title, 0)
    const before = runtime.diagnostics(); const hot: number[] = []; const cpu: number[] = []
    for (let frame = 0; frame < 180; frame++) {
      const started = performance.now(); evaluateCodeMaterial(programs.title, { ...context, time: frame / 60, localTime: frame / 60, sequenceTime: frame / 60, frame }); cpu.push(performance.now() - started)
      hot.push(await render(programs.title, frame, true))
    }
    const after = runtime.diagnostics()
    if (before.pipelineCompiles !== after.pipelineCompiles || before.externalCopies !== after.externalCopies || before.textureAllocations !== after.textureAllocations) throw new Error('热帧重建了管线、字形或纹理。')
    const parameterResponseMs = await render(programs.title, 0, true, { ink: [0, .8, 1, .7] }, true); const changed = inspect()
    if (changed[0] > 1 || changed[1] < 130 || changed[2] < 175) throw new Error(`参数未改变真实像素：${changed}`)
    const results: number[][] = []
    for (const frame of [120, 0, 60, 120]) { await render(programs.title, frame, false, {}, true); results.push(inspect()) }
    if (JSON.stringify(results[0]) !== JSON.stringify(results[3])) throw new Error('随机顺序指定帧不确定。')
    let recovered = false
    try { await compiler.compile(source('while(true){} return [];')) } catch { recovered = true }
    if (!recovered) throw new Error('无限循环没有被拒绝。')
    await render(programs.title, 0, true, {}, true)
    canvas.dataset.codeExperiment = 'ready'
    const evidence = { coldCompileMs, compileCacheMs, firstGpuFrameMs: first, titleFirstMs, hotFrames: hot.length, completedGpuFrameMs: { mean: hot.reduce((sum, value) => sum + value, 0) / hot.length, p95: percentile(hot, .95), max: Math.max(...hot) }, hotCpuEvaluationMs: { mean: cpu.reduce((sum, value) => sum + value, 0) / cpu.length, p95: percentile(cpu, .95) }, parameterResponseMs, transparentOnBlack, filtered, changed, randomFramePixels: results, readbackCount: readbacks.length, resolution: [canvas.width, canvas.height], before, after: runtime.diagnostics(), recovered }
    // Preserve one full-resolution inspection image before device release; this
    // copy happens after all hot-frame timing and is not part of the renderer.
    const inspectionCanvas = document.createElement('canvas'); inspectionCanvas.width = 3840; inspectionCanvas.height = 2160
    inspectionCanvas.style.cssText = canvas.style.cssText; inspectionCanvas.setAttribute('aria-label', '代码素材全分辨率实验结果')
    inspectionCanvas.getContext('2d')!.drawImage(snapshot!, 0, 0); snapshot!.close(); snapshot = undefined; host.replaceChildren(inspectionCanvas)
    await compositor.dispose()
    compiler.dispose()
    return { ...evidence, inspectionSnapshotCopies: 1, compiler: compiler.diagnostics(), disposed: runtime.diagnostics(), completed: true }
  } finally { compiler.dispose(); snapshot?.close(); await compositor.dispose() }
}
