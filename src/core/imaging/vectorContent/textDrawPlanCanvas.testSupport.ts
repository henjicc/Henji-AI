import type { TextPlanMetrics } from './textDrawPlan'
import { inflateSync } from 'node:zlib'

interface CanvasState {
  font: string
  fontKerning: string
  direction: string
  textBaseline: string
  textAlign: string
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  lineJoin: string
  globalAlpha: number
  globalCompositeOperation: string
  filter: string
  matrix: number[]
}
interface Operation { op: string; args: unknown[]; state: Partial<CanvasState> }
const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** 非可加度量刻意覆盖字偶距和整段塑形；等宽替身会漏掉重复量字导致的定位偏差。 */
export function fixtureTextMetrics(text: string, font: string, kerning = 'normal', direction = 'inherit', baseline = 'middle'): TextPlanMetrics {
  const size = Number(/([\d.]+)px/u.exec(font)?.[1] ?? 16)
  const characters = [...segments.segment(text)].map(item => item.segment)
  let width = characters.reduce((sum, character) => sum + (/\s/u.test(character) ? .3 : /[\u0020-\u007e]/u.test(character) ? .6 : 1) * size, 0)
  if (kerning !== 'none') width -= (text.match(/AV|To/gu)?.length ?? 0) * size * .12
  width -= (text.match(/ffi|لا/gu)?.length ?? 0) * size * .15
  const ink = /\S/u.test(text)
  const firstLetter = /\p{L}/u.exec(text)?.[0] ?? ''
  const rtl = direction === 'rtl' || direction === 'inherit' && /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(firstLetter)
  const extreme = text.includes('悬')
  const shift = baseline === 'alphabetic' ? size * .3 : 0
  return { width, actualBoundingBoxLeft: ink ? size * (extreme ? 2.3 : rtl ? .08 : .05) : 0, actualBoundingBoxRight: ink ? width + size * (extreme ? 1.7 : rtl ? .05 : .08) : 0, actualBoundingBoxAscent: ink ? size * (extreme ? 2.2 : .55) + shift : 0, actualBoundingBoxDescent: ink ? size * (extreme ? 1.8 : .22) - shift : 0, fontBoundingBoxAscent: size * .5 + shift, fontBoundingBoxDescent: size * .5 - shift }
}

export function createTextCanvasRecorder(): {
  Canvas: new (width: number, height: number) => { width: number; height: number; getContext: () => OffscreenCanvasRenderingContext2D; transferToImageBitmap: () => ImageBitmap }
  Bitmap: typeof ImageBitmap
  snapshot: () => unknown
} {
  const surfaces: RecordingCanvas[] = []
  class RecordingBitmap {
    readonly width: number
    readonly height: number
    constructor(readonly surface: RecordingCanvas) { this.width = surface.width; this.height = surface.height }
    close(): void {}
  }
  class RecordingCanvas {
    operations: Operation[] = []
    context: OffscreenCanvasRenderingContext2D
    constructor(public width: number, public height: number) {
      surfaces.push(this)
      let state: CanvasState = { font: '10px sans-serif', fontKerning: 'auto', direction: 'inherit', textBaseline: 'alphabetic', textAlign: 'start', fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: 'miter', globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none', matrix: [1, 0, 0, 1, 0, 0] }
      const stack: CanvasState[] = []
      const record = (op: string, args: unknown[]): void => {
        const common = { globalAlpha: state.globalAlpha, globalCompositeOperation: state.globalCompositeOperation, filter: state.filter, matrix: [...state.matrix] }
        const text = op.endsWith('Text') ? { font: state.font, fontKerning: state.fontKerning, direction: state.direction, textBaseline: state.textBaseline, textAlign: state.textAlign } : {}
        const fill = op === 'fillText' || op === 'fillRect' || op === 'fill' ? { fillStyle: state.fillStyle } : {}
        const stroke = op === 'strokeText' ? { strokeStyle: state.strokeStyle, lineWidth: state.lineWidth, lineJoin: state.lineJoin } : {}
        this.operations.push({ op, args, state: { ...common, ...text, ...fill, ...stroke } })
      }
      const transform = (a: number, b: number, c: number, d: number, e: number, f: number): void => {
        const [aa, bb, cc, dd, ee, ff] = state.matrix
        state.matrix = [aa * a + cc * b, bb * a + dd * b, aa * c + cc * d, bb * c + dd * d, aa * e + cc * f + ee, bb * e + dd * f + ff]
      }
      const methods: Record<string, unknown> = {
        save: () => { stack.push({ ...state, matrix: [...state.matrix] }) },
        restore: () => { const previous = stack.pop(); if (!previous) throw new Error('Canvas 状态栈不平衡。'); state = previous },
        scale: (x: number, y: number) => transform(x, 0, 0, y, 0, 0),
        rotate: (angle: number) => transform(Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0),
        setTransform: (...matrix: number[]) => { state.matrix = matrix },
        translate: (x: number, y: number) => transform(1, 0, 0, 1, x, y), transform,
        getTransform: () => { const [a, b, c, d, e, f] = state.matrix; return { a, b, c, d, e, f } },
        getContextAttributes: () => ({ colorSpace: 'srgb' }),
        measureText: (text: string) => fixtureTextMetrics(text, state.font, state.fontKerning, state.direction, state.textBaseline),
        // 指令替身只承接宿主 ROI 读回协议；实际像素仍由真实字体验收。
        getImageData: (_x: number, _y: number, width: number, height: number) => new ImageData(width, height),
      }
      for (const op of ['fillText', 'strokeText', 'fillRect', 'drawImage', 'clearRect', 'beginPath', 'roundRect', 'fill']) methods[op] = (...args: unknown[]) => record(op, args)
      this.context = new Proxy(methods, {
        get: (target, key: string) => key in state ? state[key as keyof CanvasState] : target[key],
        set: (_target, key: string, value: unknown) => { Object.assign(state, { [key]: value }); return true },
      }) as unknown as OffscreenCanvasRenderingContext2D
    }
    getContext(): OffscreenCanvasRenderingContext2D { return this.context }
    transferToImageBitmap(): ImageBitmap { return new RecordingBitmap(this) as unknown as ImageBitmap }
  }
  return {
    Canvas: RecordingCanvas,
    Bitmap: RecordingBitmap as unknown as typeof ImageBitmap,
    snapshot: () => {
      const painted = surfaces.filter(surface => surface.operations.length)
      return painted.map(surface => ({ width: surface.width, height: surface.height, operations: surface.operations.map(operation => ({ ...operation, args: operation.args.map(arg => arg instanceof RecordingCanvas || arg instanceof RecordingBitmap ? { surface: painted.indexOf(arg instanceof RecordingBitmap ? arg.surface : arg), width: arg.width, height: arg.height } : arg) })) }))
    },
  }
}

// 固定样本来自 paintText、rasterizeText、富文本逐 run 入口及 layoutCodeText；不能随被测实现自动更新。
// code-font-baseline 是字体度量修正公式的独立预期，例外地不属于旧入口输出快照。
// 重复的 Canvas 状态以无损压缩保存，解码后比较完整指令，避免大快照遮蔽测试逻辑。
export const textDrawGolden: Record<string, unknown> = JSON.parse(inflateSync(Buffer.from('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', 'base64')).toString('utf8'))
