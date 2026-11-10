import type { TextOutline } from '@/core/imaging/vectorContent/shaping/harfbuzz'

export const TEXT_OUTLINE_DRAW = Symbol.for('henji-layout.text.outline.draw')
export const TEXT_APPEARANCE_DRAW = Symbol.for('henji-layout.text.appearance.draw')
/** 录制时标出一次 drawText 画了哪些动作、用的哪份版面：运动模糊靠它区分“重新排版”和“字在动”。返回结束标记的函数。 */
export const TEXT_RUN_DRAW = Symbol.for('henji-layout.text.run.draw')
export type TextRunContext = { [TEXT_RUN_DRAW]?: (layout: number | string, motionBlur: boolean | undefined) => () => void }
export interface TextAppearance {
  identity: string
  /** 局部坐标中的完整栅格范围，包含描边、阴影及栅格取整留边。 */
  bounds: { x: number; y: number; width: number; height: number }
  draw(context: OffscreenCanvasRenderingContext2D): void
}
type TextAppearanceContext = { [TEXT_APPEARANCE_DRAW]?: (appearance: TextAppearance) => void }
/** 指纹只录内容身份；真实栅格尺寸在重放阶段决定。 */
export function drawTextAppearance(context: OffscreenCanvasRenderingContext2D, appearance: TextAppearance): void {
  const record = (context as TextAppearanceContext)[TEXT_APPEARANCE_DRAW]
  if (record) record(appearance)
  else appearance.draw(context)
}
type TextOutlineContext = { [TEXT_OUTLINE_DRAW]?: (outline: TextOutline, stroke: boolean) => void }
export function drawTextOutline(context: OffscreenCanvasRenderingContext2D, outline: TextOutline, stroke = false): void {
  const record = (context as TextOutlineContext)[TEXT_OUTLINE_DRAW]
  if (record) record(outline, stroke)
  else if (stroke) context.stroke(textOutlinePath(outline))
  else context.fill(textOutlinePath(outline))
}

/** 冻结作者模块与宿主分属 bundle；身份表只认由内部字体路径工厂创建的对象。 */
const outlineTable = Symbol.for('henji-layout.text.outline.v1')
interface OutlineFactory { create(svg: string, identity: string): Path2D; read(value: object): string | undefined }
type Host = typeof globalThis & { [outlineTable]?: OutlineFactory }
const factory = (): OutlineFactory => {
  const host = globalThis as Host
  if (!host[outlineTable]) {
    const identities = new WeakMap<object, string>()
    host[outlineTable] = Object.freeze({
      create(svg: string, identity: string): Path2D { const path = new Path2D(svg); identities.set(path, identity); return path },
      read(value: object): string | undefined { return identities.get(value) },
    })
  }
  return host[outlineTable]
}

/** 返回值仅供内部绘制，不交给作者；创建后不能修改 Path2D 的内容。 */
export function createTextOutline(svg: string, identity: string): Path2D {
  return factory().create(svg, identity)
}
export function textOutlineIdentity(value: object): string | undefined { return factory().read(value) }

const paths = new Map<string, { path: Path2D; bytes: number }>()
let pathBytes = 0
export function textOutlinePath(outline: TextOutline): Path2D {
  let entry = paths.get(outline.identity)
  if (entry) paths.delete(outline.identity)
  else { entry = { path: createTextOutline(outline.svg, outline.identity), bytes: outline.svg.length * 4 + outline.identity.length * 2 }; pathBytes += entry.bytes }
  paths.set(outline.identity, entry)
  while (pathBytes > 4 * 1024 * 1024 && paths.size > 1) {
    const [key, oldest] = paths.entries().next().value!
    paths.delete(key); pathBytes -= oldest.bytes
  }
  return entry.path
}
