import { graphemeEnds, type ParagraphLine } from './paragraph'

export interface GraphemeGeometry {
  readonly index: number; readonly start: number; readonly end: number
  readonly owner: number; readonly x: number; readonly width: number
  readonly positionKind: 'individual' | 'shared-cluster'
}
export interface GraphemePose { x?: number; y?: number; scale?: number; rotate?: number; opacity?: number }
export type GraphemeSelection = number | readonly number[] | ((grapheme: GraphemeGeometry, index: number) => GraphemePose | null)

/** 一簇多字素只有一个绘制 owner；非 owner 不创造半个 glyph 或虚假的平均分割位置。 */
export function lineGraphemeGeometry(text: string, line: ParagraphLine): readonly GraphemeGeometry[] {
  const ends = graphemeEnds(text), starts = [0, ...ends.slice(0, -1)]
  const clusters = [...new Set(line.glyphs.map(glyph => glyph.cluster))].sort((a, b) => a - b)
  const positions = new Map<number, { x: number; width: number }>()
  let x = line.visualStart ?? 0
  for (const glyph of line.glyphs) {
    const position = positions.get(glyph.cluster)
    if (position) position.width += glyph.advance
    else positions.set(glyph.cluster, { x, width: glyph.advance })
    x += glyph.advance
  }
  return Object.freeze(starts.flatMap((start, index) => {
    if (start < line.start || start >= line.contentEnd) return []
    const cluster = [...clusters].reverse().find(value => value <= start)
    if (cluster === undefined) return []
    const owner = starts.length - 1 - [...starts].reverse().findIndex(value => value <= cluster)
    const position = positions.get(cluster)!
    return [Object.freeze({ index, start, end: ends[index], owner, ...position, positionKind: owner === index ? 'individual' as const : 'shared-cluster' as const })]
  }))
}

export function selectedClusterPoses(geometry: readonly GraphemeGeometry[], selection: GraphemeSelection): ReadonlyMap<number, Readonly<GraphemePose>> {
  const result = new Map<number, Readonly<GraphemePose>>()
  for (const grapheme of geometry) {
    const pose = typeof selection === 'function' ? selection(grapheme, grapheme.index)
      : (typeof selection === 'number' ? grapheme.index < selection : selection.includes(grapheme.index)) ? {} : null
    if (grapheme.owner === grapheme.index && pose) result.set(grapheme.owner, Object.freeze({ ...pose }))
  }
  return result
}
