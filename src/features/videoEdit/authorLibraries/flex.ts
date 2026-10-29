import { loadYoga, Align, Direction, Edge, Errata, FlexDirection, Gutter, Justify, MeasureMode, Wrap, type Node, type Yoga } from 'henji-author-yoga-layout-3.2.1/load'
import { layoutText, type RichTextContent, type TextLayout, type TextOptions, type TextStyleInput } from './text'
import { observeTextLayouts } from '../../../core/videoEdit/textDrawObservation'
import { validateFlexTree } from './validation'

type Length = number | `${number}%`
type Edges = number | { top?: number; right?: number; bottom?: number; left?: number }
export interface FlexStyle {
  width?: Length | 'auto'; height?: Length | 'auto'
  minWidth?: Length; maxWidth?: Length; minHeight?: Length; maxHeight?: Length
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse'
  flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse'
  flexGrow?: number; flexShrink?: number; flexBasis?: Length | 'auto'
  gap?: number; rowGap?: number; columnGap?: number
  padding?: Edges; margin?: Edges
  /** baseline 按首行字母基线对齐；嵌套容器沿用 Yoga 的首个参考子节点。 */
  alignItems?: 'start' | 'flex-start' | 'center' | 'end' | 'flex-end' | 'stretch' | 'baseline'
  alignSelf?: 'auto' | 'start' | 'flex-start' | 'center' | 'end' | 'flex-end' | 'stretch' | 'baseline'
  justifyContent?: 'start' | 'flex-start' | 'center' | 'end' | 'flex-end' | 'space-between' | 'space-around' | 'space-evenly'
}
export interface FlexNode {
  id: string
  style?: FlexStyle
  children?: readonly FlexNode[]
  text?: { content: string | RichTextContent; style?: TextStyleInput; options?: TextOptions }
}
export interface Box {
  /** 相对整棵树的作品像素坐标；text 的绘制坐标相对 contentBox。 */
  x: number; y: number; width: number; height: number
  contentBox: { x: number; y: number; width: number; height: number }
  text?: TextLayout
}

let yoga: Yoga | undefined
/** 发行入口在导入完成前等待此 Promise；文字入口不依赖此模块。 */
export const ready: Promise<void> = loadYoga().then(value => { yoga = value })
const align = { auto: Align.Auto, start: Align.FlexStart, 'flex-start': Align.FlexStart, center: Align.Center, end: Align.FlexEnd, 'flex-end': Align.FlexEnd, stretch: Align.Stretch, baseline: Align.Baseline }
const justify = { start: Justify.FlexStart, 'flex-start': Justify.FlexStart, center: Justify.Center, end: Justify.FlexEnd, 'flex-end': Justify.FlexEnd, 'space-between': Justify.SpaceBetween, 'space-around': Justify.SpaceAround, 'space-evenly': Justify.SpaceEvenly }
const directions = { row: FlexDirection.Row, column: FlexDirection.Column, 'row-reverse': FlexDirection.RowReverse, 'column-reverse': FlexDirection.ColumnReverse }
const wraps = { nowrap: Wrap.NoWrap, wrap: Wrap.Wrap, 'wrap-reverse': Wrap.WrapReverse }

function setEdges(value: Edges | undefined, set: (edge: Edge, size: number) => void): void {
  if (typeof value === 'number') set(Edge.All, value)
  else if (value) for (const [name, edge] of [['top', Edge.Top], ['right', Edge.Right], ['bottom', Edge.Bottom], ['left', Edge.Left]] as const) {
    if (value[name] !== undefined) set(edge, value[name])
  }
}
function applyStyle(node: Node, style: FlexStyle): void {
  node.setWidth(style.width); node.setHeight(style.height)
  node.setMinWidth(style.minWidth); node.setMaxWidth(style.maxWidth)
  node.setMinHeight(style.minHeight); node.setMaxHeight(style.maxHeight)
  node.setFlexDirection(directions[style.flexDirection ?? 'row'])
  node.setFlexWrap(wraps[style.flexWrap ?? 'nowrap'])
  node.setFlexGrow(style.flexGrow ?? 0); node.setFlexShrink(style.flexShrink ?? 1); node.setFlexBasis(style.flexBasis ?? 'auto')
  node.setAlignItems(align[style.alignItems ?? 'stretch']); node.setAlignSelf(align[style.alignSelf ?? 'auto'])
  node.setJustifyContent(justify[style.justifyContent ?? 'start'])
  node.setGap(Gutter.All, style.gap ?? 0)
  if (style.rowGap !== undefined) node.setGap(Gutter.Row, style.rowGap)
  if (style.columnGap !== undefined) node.setGap(Gutter.Column, style.columnGap)
  setEdges(style.padding, (edge, size) => node.setPadding(edge, size))
  setEdges(style.margin, (edge, size) => node.setMargin(edge, size))
}
function measuredAxis(natural: number, available: number, mode: MeasureMode): number {
  return mode === MeasureMode.Exactly ? available : mode === MeasureMode.AtMost ? Math.min(available, natural) : natural
}

// 嵌套节点的 padding/gap/margin 会累计 float32 误差；不足 1/1024 像素的差异沿用测量尺寸。
// 未经测量的 Exactly 路径仍按参与运算的量补偿一 ULP；框坐标始终保留 Yoga 原值。
function textLimit(value: number, measured: number | undefined, ...operands: number[]): number {
  // flex 的零内容框是实际限制，不能触发文字入口中“零宽表示不限宽”的作者约定。
  if (value === 0) return Number.EPSILON
  const restored = measured !== undefined && measured > 0 && Math.abs(value - measured) <= 1 / 1024 ? measured : value
  return restored + [restored, ...operands].reduce((sum, operand) => sum + (operand === 0 ? 0 : 2 ** (Math.floor(Math.log2(Math.abs(operand))) - 23)), 0)
}

/** 根未给宽高时按内容收缩，以 size 为上限和百分比参照；铺满画幅显式设 width/height: '100%'。 */
export function layoutBoxes(tree: FlexNode, size: { width: number; height: number; direction?: 'ltr' | 'rtl' }): Readonly<Record<string, Box>> {
  if (!yoga) throw new Error('排版库尚未初始化，请等待 henji-layout/flex 的模块导入完成。')
  validateFlexTree(tree, size)
  const config = yoga.Config.create()
  config.setUseWebDefaults(true); config.setPointScaleFactor(0); config.setErrata(Errata.None)
  const nodes: Array<{ source: FlexNode; node: Node; measured?: TextLayout; baseline?: Node }> = []
  const ids = new Set<string>()
  const hasBaseline = (source: FlexNode): boolean => source.style?.alignItems === 'baseline' || source.style?.alignSelf === 'baseline' || !!source.children?.some(hasBaseline)
  const baselineLayout = hasBaseline(tree)
  const planForBox = ({ source, node, measured }: (typeof nodes)[number]): TextLayout | undefined => {
    if (!source.text) return undefined
    const width = node.getComputedWidth(), height = node.getComputedHeight()
    const left = node.getComputedPadding(Edge.Left), right = node.getComputedPadding(Edge.Right)
    const top = node.getComputedPadding(Edge.Top), bottom = node.getComputedPadding(Edge.Bottom)
    const contentWidth = Math.max(0, width - left - right), contentHeight = Math.max(0, height - top - bottom)
    const wrapWidth = textLimit(contentWidth, measured?.contentSize.width, width, left, right)
    const maxHeight = Math.min(source.text.options?.maxHeight ?? Infinity, textLimit(contentHeight, measured?.visibleContentSize.height, height, top, bottom))
    return layoutText(source.text.content, source.text.style, { ...source.text.options, maxWidth: wrapWidth, wrapWidth, maxHeight, box: { width: contentWidth || Number.EPSILON, height: contentHeight || Number.EPSILON } })
  }
  const create = (source: FlexNode, parent?: Node): Node => {
    if (ids.has(source.id)) throw new Error(`布局框 id 重复：${source.id}。请为每个框指定不同的 id。`)
    if (source.text && source.children?.length) throw new Error(`文字框 ${source.id} 不能同时有子框。`)
    ids.add(source.id)
    const node = yoga!.Node.create(config)
    if (parent) parent.insertChild(node, parent.getChildCount())
    const entry: (typeof nodes)[number] = { source, node }
    nodes.push(entry)
    applyStyle(node, source.style ?? {})
    if (source.text) {
      const text = source.text
      let measuredNode = node
      if (baselineLayout) {
        // JS 绑定未暴露 baseline 回调；零宽参考节点把共享排版基线交给 Yoga，自身不参与作者框树。
        const reference = yoga!.Node.create(config), content = yoga!.Node.create(config)
        reference.setWidth(0); reference.setHeight(0); reference.setFlexShrink(0); reference.setIsReferenceBaseline(true)
        content.setFlexGrow(1); content.setFlexShrink(1); content.setAlignSelf(Align.FlexStart)
        node.setFlexDirection(FlexDirection.Row); node.setFlexWrap(Wrap.NoWrap); node.setAlignItems(Align.FlexStart); node.setJustifyContent(Justify.FlexStart)
        node.setGap(Gutter.All, 0); node.setGap(Gutter.Row, 0); node.setGap(Gutter.Column, 0)
        node.insertChild(reference, 0); node.insertChild(content, 1)
        entry.baseline = reference; measuredNode = content
      }
      measuredNode.setMeasureFunc((width, widthMode, height, heightMode) => {
        // Yoga 传入的宽高已扣除 padding；Undefined 必须保持自然尺寸，不把 NaN 当约束。
        const padding = source.style?.padding
        const left = typeof padding === 'number' ? padding : padding?.left ?? 0
        const right = typeof padding === 'number' ? padding : padding?.right ?? 0
        const maxWidth = widthMode === MeasureMode.Undefined ? undefined : textLimit(width, entry.measured?.contentSize.width, width + left + right, left, right)
        // 探测计划不能算成作者待绘制的布局；最终布局在结果生成时照常登记。
        const plan = observeTextLayouts(() => {}, () => layoutText(text.content, text.style, { ...text.options, maxWidth, wrapWidth: maxWidth, box: undefined, anchor: undefined }))
        entry.measured = plan
        return { width: measuredAxis(plan.visibleContentSize.width, width, widthMode), height: measuredAxis(plan.visibleContentSize.height, height, heightMode) }
      })
    }
    for (const child of source.children ?? []) create(child, node)
    return node
  }
  try {
    const root = create(tree)
    // Yoga 的可用画幅会给未声明轴施加 stretch；fit-content 根以自适应轴和显式上限参与同一次布局。
    const rootLimit = (limit: Length | undefined, available: number): number => Math.min(available, typeof limit === 'string' ? available * Number.parseFloat(limit) / 100 : limit ?? available)
    if (tree.style?.width === undefined || tree.style.width === 'auto') { root.setWidth('auto'); root.setMaxWidth(rootLimit(tree.style?.maxWidth, size.width)) }
    if (tree.style?.height === undefined || tree.style.height === 'auto') { root.setHeight('auto'); root.setMaxHeight(rootLimit(tree.style?.maxHeight, size.height)) }
    root.calculateLayout(size.width, size.height, size.direction === 'rtl' ? Direction.RTL : Direction.LTR)
    if (baselineLayout) {
      for (const entry of nodes) if (entry.baseline) {
        const plan = observeTextLayouts(() => {}, () => planForBox(entry))!
        const baseline = plan.lines[0]?.alphabeticBaseline ?? plan.visibleContentSize.height
        entry.baseline.setHeight(Math.max(0, baseline)); entry.baseline.setMargin(Edge.Top, Math.min(0, baseline))
        // 基线可因行距或 baselineShift 落在行框外；抵消参考节点的外部高度，防止它改变文字自身的排版盒。
        entry.baseline.setMargin(Edge.Bottom, -baseline)
      }
      // 第一轮确定换行与字号，第二轮由 Yoga 按文字基线计算偏移和容器高度。
      root.calculateLayout(size.width, size.height, size.direction === 'rtl' ? Direction.RTL : Direction.LTR)
    }
    const result: Record<string, Box> = Object.create(null)
    for (const { source, node, measured } of nodes) {
      let x = node.getComputedLeft(), y = node.getComputedTop()
      for (let parent = node.getParent(); parent; parent = parent.getParent()) { x += parent.getComputedLeft(); y += parent.getComputedTop() }
      const width = node.getComputedWidth(), height = node.getComputedHeight()
      const left = node.getComputedPadding(Edge.Left), top = node.getComputedPadding(Edge.Top)
      const right = node.getComputedPadding(Edge.Right), bottom = node.getComputedPadding(Edge.Bottom)
      const contentBox = { x: x + left, y: y + top, width: Math.max(0, width - left - right), height: Math.max(0, height - top - bottom) }
      // 自然宽度回读时沿用测量的精确宽度；Exactly 可以跳过测量，所以两条路径都需要容差。
      // 最终框仍决定定位与截断，不能直接返回探测阶段没有最终 box/anchor 的计划。
      const text = planForBox({ source, node, measured })
      result[source.id] = { x, y, width, height, contentBox, ...(text ? { text } : {}) }
    }
    return result
  } finally {
    nodes[0]?.node.freeRecursive()
    config.free()
  }
}
