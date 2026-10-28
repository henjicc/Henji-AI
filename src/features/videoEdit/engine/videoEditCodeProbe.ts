import { isUiInspectionActive } from '@/platform/runtime'
import { VIDEO_EDIT_AUTHOR_CONTENT_COLORS } from '@/core/theme/colorTokens'
import { addressCodeMaterialFiles, normalizeCodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { VideoEditRenderSession } from './videoEditRenderSession'
import { VideoEditCodeCompiler } from './videoEditCodeCompiler'
import { AUTHOR_GAIN_SOURCE } from './videoEditAuthorProbeSources'
import { videoEditRenderFailures } from './videoEditRenderFailures'
import type { CodeParameterValues } from '@/core/videoEdit/codeMaterial/contract'
export { runVideoEditCompositeProbe } from './videoEditCompositeProbe'
export { runVideoEditCodeInputProbe } from './videoEditCodeInputProbe'

const staticSource = `export default {name:"透明形状",mode:"static",draw(ctx){ctx.fillStyle=${JSON.stringify(VIDEO_EDIT_AUTHOR_CONTENT_COLORS.probeRectangle)};ctx.beginPath();ctx.roundRect(80,100,800,600,40);ctx.fill();ctx.fillStyle=${JSON.stringify(VIDEO_EDIT_AUTHOR_CONTENT_COLORS.probeEllipse)};ctx.beginPath();ctx.ellipse(1280,400,300,300,0,0,Math.PI*2);ctx.fill();}}`
const titleSource = `export default {name:"原生代码",params:[{key:"title",type:"text",title:"标题",default:"原生代码 · 4K"},{key:"ink",type:"color",title:"颜色",default:[1,.3,.1,.7]},{key:"fail",type:"boolean",title:"错误测试",default:false}],draw(ctx,t,p){if(p.fail)throw new Error("作者测试异常");const c=p.ink;ctx.fillStyle="rgba("+c.slice(0,3).map(v=>v*255).join(",")+","+c[3]+")";ctx.beginPath();ctx.roundRect(80+t*200,100,800,600,40);ctx.fill();ctx.fillStyle="white";ctx.font="180px sans-serif";ctx.textAlign="center";ctx.fillText(p.title,1920,1200);}}`
function percentile(values: number[], percent: number): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percent))] }

/** Same production Worker/session as preview and export; only fixture content is artificial. */
export async function runVideoEditCodeProbe(host: HTMLElement): Promise<Record<string, unknown>> {
  if (!isUiInspectionActive()) throw new Error('代码素材实验仅由正式桌面验收运行。')
  const canvas = document.createElement('canvas'); canvas.width = 3840; canvas.height = 2160
  canvas.setAttribute('aria-label', '代码素材全分辨率实验'); canvas.style.cssText = 'width:100%;max-height:65vh;object-fit:contain'
  host.replaceChildren(canvas)
  const model = createVideoEditDocument('标准作者接口检查'), sequence = createVideoEditSequence('检查')
  model.sequences = [sequence]
  sequence.width = 3840; sequence.height = 2160; sequence.frameRate = { numerator: 60, denominator: 1 }
  const compiler = new VideoEditCodeCompiler()
  let session: VideoEditRenderSession | undefined
  let snapshot: ImageBitmap | undefined
  const sceneNotices = new Set<string>()
  try {
    const cold = performance.now()
    for (const text of [staticSource, titleSource, AUTHOR_GAIN_SOURCE]) await compiler.bundle(normalizeCodeMaterialFiles(text))
    const coldCompileMs = performance.now() - cold
    const cached = performance.now(); await compiler.bundle(normalizeCodeMaterialFiles(staticSource)); const compileCacheMs = performance.now() - cached
    model.codeMaterials = []
    for (const [id, text] of [['static', staticSource], ['title', titleSource], ['gain', AUTHOR_GAIN_SOURCE]]) {
      const { codeSources: _sources, ...manifest } = await addressCodeMaterialFiles(text)
      model.codeMaterials.push({ id, name: id, defaultVersionId: id, versions: [{ id, apiVersion: 4, languageVersion: 4, ...manifest }] })
    }
    model.items.push({ id: 'fixture', name: '检查画面', kind: 'text' })
    const base = makeVideoEditItemClip(model, 'fixture', sequence.id, { frame: 0 })
    const set = async (id: string, filtered: boolean, parameters: CodeParameterValues = {}): Promise<void> => {
      sequence.clips = [{ ...base, kind: 'code', duration: 600, text: '', code: { definitionId: id, versionId: id, parameters }, effects: filtered ? [{ id: 'gain', name: '增益', enabled: true, amount: 1, code: { definitionId: 'gain', versionId: 'gain', parameters: { gain: .25 } } }] : [] }]
      model.revision++
      const composition = videoEditComposition(model, sequence.id)
      if (session) await session.updateDocument(composition)
      else session = new VideoEditRenderSession(composition)
    }
    const readbacks: number[][] = []
    const inspect = (): number[] => {
      const sample = new OffscreenCanvas(1, 1), context = sample.getContext('2d', { willReadFrequently: true })!
      context.drawImage(snapshot!, 300, 300, 1, 1, 0, 0, 1, 1)
      const value = [...context.getImageData(0, 0, 1, 1).data]; readbacks.push(value); return value
    }
    const render = async (frame: number, inspectFrame = false): Promise<{ elapsed: number; cpu: number }> => {
      const began = performance.now(), result = await session!.present(frame)
      const failures = videoEditRenderFailures(result, sceneNotices)
      if (!result.presented || !result.bitmap || failures.length) { result.bitmap?.close(); throw new Error(failures.join('\n') || '正式渲染没有返回画面') }
      if (inspectFrame) { snapshot?.close(); snapshot = result.bitmap; canvas.getContext('2d')!.drawImage(snapshot, 0, 0) }
      else result.bitmap.close()
      return { elapsed: performance.now() - began, cpu: (result.codePerformance ?? []).reduce((sum, value) => sum + value.cpuMs, 0) }
    }
    await set('static', false); const first = await render(0, true); const transparentOnBlack = inspect()
    if (Math.abs(transparentOnBlack[0] - 128) > 2 || transparentOnBlack[1] !== 0) throw new Error(`透明度合成错误：${transparentOnBlack}`)
    await set('static', true); await render(0, true); const filtered = inspect()
    if (Math.abs(filtered[0] - 32) > 2 || filtered[1] !== 0) throw new Error(`滤镜预乘透明度错误：${filtered}`)
    await set('title', true); const titleFirst = await render(0)
    const hot: number[] = [], cpu: number[] = []
    for (let frame = 1; frame <= 180; frame++) { const sample = await render(frame); hot.push(sample.elapsed); cpu.push(sample.cpu) }
    await set('title', true, { ink: [0, .8, 1, .7] }); const parameter = await render(0, true), changed = inspect()
    if (changed[0] > 1 || changed[1] < 130 || changed[2] < 175) throw new Error(`参数未改变真实像素：${changed}`)
    await set('title', false); const results: number[][] = []
    for (const frame of [120, 0, 60, 120]) { await render(frame, true); results.push(inspect()) }
    if (JSON.stringify(results[0]) !== JSON.stringify(results[3])) throw new Error('随机顺序指定帧不确定。')
    await set('title', false, { fail: true }); let recovered = false
    try { await render(0) } catch (error) { if (!(error instanceof Error) || !error.message.includes('作者测试异常')) throw error; recovered = true }
    if (!recovered) throw new Error('作者异常没有传回正式会话。')
    await set('title', false); await render(0, true)
    canvas.dataset.codeExperiment = 'ready'
    return { completed: true, coldCompileMs, compileCacheMs, firstGpuFrameMs: first.elapsed, titleFirstMs: titleFirst.elapsed, hotFrames: hot.length, completedGpuFrameMs: { mean: hot.reduce((sum, value) => sum + value, 0) / hot.length, p95: percentile(hot, .95), max: Math.max(...hot) }, hotCpuEvaluationMs: { mean: cpu.reduce((sum, value) => sum + value, 0) / cpu.length, p95: percentile(cpu, .95) }, parameterResponseMs: parameter.elapsed, transparentOnBlack, filtered, changed, randomFramePixels: results, readbackCount: readbacks.length, resolution: [3840, 2160], recovered, ...(sceneNotices.size ? { sceneNotices: [...sceneNotices] } : {}) }
  } finally { compiler.dispose(); snapshot?.close(); await session?.dispose() }
}
