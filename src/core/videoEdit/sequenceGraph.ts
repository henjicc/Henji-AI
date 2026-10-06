/** Both persisted documents and render snapshots obey this same bounded DAG. */
export const VIDEO_EDIT_MAX_SEQUENCE_DEPTH = 8
interface SequenceGraph {
  items: readonly { id: string; kind: string; sequenceId?: string }[]
  sequences: readonly { id: string; name: string; clips: readonly { kind: string; itemId: string }[] }[]
}

/** Only reachable sequences participate in export preparation; shared children are visited once. */
export function videoEditReachableSequences<T extends { clips: readonly { kind: string; itemId: string }[] }>(document: { items: SequenceGraph['items']; sequences?: readonly T[] }, root: T): T[] {
  const result: T[] = []; const seen = new Set<T>()
  const visit = (sequence: T, depth: number): void => {
    if (depth > VIDEO_EDIT_MAX_SEQUENCE_DEPTH) throw new Error('序列嵌套超过八层。')
    if (seen.has(sequence)) return
    seen.add(sequence); result.push(sequence)
    for (const clip of sequence.clips) if (clip.kind === 'sequence') {
      const id = document.items.find(item => item.id === clip.itemId)?.sequenceId
      const child = document.sequences?.find(sequence => 'id' in sequence && sequence.id === id)
      if (!child) throw new Error('嵌套引用的序列不存在。')
      visit(child, depth + 1)
    }
  }
  visit(root, 1); return result
}
export function assertVideoEditSequenceGraph(document: SequenceGraph): void {
  const items = new Map(document.items.map(item => [item.id, item]))
  const sequences = new Map(document.sequences.map(sequence => [sequence.id, sequence]))
  const depths = new Map<string, number>()
  const visit = (id: string, path: string[]): number => {
    const sequence = sequences.get(id)
    if (!sequence) throw new Error('嵌套引用的序列不存在。')
    const route = [...path, id]
    const names = (): string => route.map(key => sequences.get(key)?.name ?? key).join(' → ')
    if (path.includes(id)) throw new Error(`序列循环嵌套：${names()}`)
    if (route.length > VIDEO_EDIT_MAX_SEQUENCE_DEPTH) throw new Error(`序列嵌套不能超过 ${VIDEO_EDIT_MAX_SEQUENCE_DEPTH} 层：${names()}`)
    const cached = depths.get(id)
    if (cached !== undefined) {
      if (path.length + cached > VIDEO_EDIT_MAX_SEQUENCE_DEPTH) throw new Error(`序列嵌套不能超过 ${VIDEO_EDIT_MAX_SEQUENCE_DEPTH} 层：${names()}`)
      return cached
    }
    let depth = 1
    for (const clip of sequence.clips) if (clip.kind === 'sequence') {
      const item = items.get(clip.itemId)
      if (!item?.sequenceId || item.kind !== 'sequence') throw new Error('序列片段缺少有效的序列素材引用。')
      depth = Math.max(depth, 1 + visit(item.sequenceId, route))
    }
    depths.set(id, depth)
    return depth
  }
  for (const sequence of document.sequences) visit(sequence.id, [])
}
