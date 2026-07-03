/** 曲线图（值曲线）几何换算（纯函数，无主题/UI 依赖）：值↔Y 像素映射、值域计算 */

export interface ValueRange {
  min: number
  max: number
}

export const GRAPH_PADDING = 16

/** 由一组数值算出带留白的显示值域；全相等时上下各扩 1 */
export function computeValueRange(values: number[]): ValueRange {
  if (values.length === 0) return { min: 0, max: 1 }
  let min = values[0]
  let max = values[0]
  for (const value of values) {
    if (value < min) min = value
    if (value > max) max = value
  }
  if (max - min < 1e-6) {
    return { min: min - 1, max: max + 1 }
  }
  const pad = (max - min) * 0.12
  return { min: min - pad, max: max + pad }
}

function inner(height: number): number {
  return height - GRAPH_PADDING * 2
}

export function valueToY(value: number, range: ValueRange, height: number): number {
  const span = range.max - range.min || 1
  return GRAPH_PADDING + (1 - (value - range.min) / span) * inner(height)
}

export function yToValue(y: number, range: ValueRange, height: number): number {
  const span = range.max - range.min || 1
  return range.min + (1 - (y - GRAPH_PADDING) / inner(height)) * span
}

/** 生成若干条水平网格线对应的值刻度（含首尾），用于绘制值轴参考线 */
export function valueGridTicks(range: ValueRange, count = 4): number[] {
  const ticks: number[] = []
  for (let i = 0; i <= count; i += 1) {
    ticks.push(range.min + ((range.max - range.min) * i) / count)
  }
  return ticks
}
