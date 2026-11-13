import { jsonEqual } from '../../../../src/core/jsonEqual'

import type { LoadedDocumentFile } from './document-file'

/**
 * 增量保存：文档类型声明了“顶层这些数组的元素各自独立”（如画布的节点、连线）时，
 * 保存只校验、换算相对上次保存变了的元素，没变的直接沿用上次的结果。
 * 写出的文件与整份重做的结果内容相同，磁盘格式不变。
 */

/** 上一次保存留下的结果：同一份文档下次保存时拿来比对。 */
export interface SaveMemo {
  /** 上次写出（或确认与磁盘一致）的文件；磁盘上的文件大小、修改时间与它不符就作废 */
  file: LoadedDocumentFile
  /** 位置换算所依据的各个根目录；变了则换算结果不能沿用 */
  contextKey: string
  /** 上次保存收到的内容、校验后的内容、换算成存储写法的内容。调用方交出内容后不得再改动它 */
  input: Record<string, unknown>
  validated: Record<string, unknown>
  encoded: Record<string, unknown>
}

export interface IncrementalSavePlan {
  /** 只带着变了的元素的内容：拿它去校验、换算 */
  probe: Record<string, unknown>
  /** 把 probe 的处理结果与上次同一阶段的结果拼回完整内容；结构对不上时返回 null（调用方改走整份处理） */
  merge(processed: unknown, previous: Record<string, unknown>): Record<string, unknown> | null
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function idOf(value: unknown): string | undefined {
  return isPlainRecord(value) && typeof value.id === 'string' ? value.id : undefined
}

/** 上次保存的三份内容在这些数组上是否一一对应（校验与换算没有增删元素）。 */
export function memoArraysAligned(arrays: readonly string[], memo: Pick<SaveMemo, 'input' | 'validated' | 'encoded'>): boolean {
  return arrays.every((key) => {
    const input = memo.input[key], validated = memo.validated[key], encoded = memo.encoded[key]
    if (input === undefined && validated === undefined && encoded === undefined) return true
    return Array.isArray(input) && Array.isArray(validated) && Array.isArray(encoded)
      && input.length === validated.length && input.length === encoded.length
  })
}

/**
 * 对比这次与上次保存收到的内容，找出每个独立数组里变了的元素。
 * 没变的元素先按同一位置找，位置变了再按 id 找（中间插入、删除一个元素时其余的仍能沿用）。
 */
export function planIncrementalSave(arrays: readonly string[], previous: Record<string, unknown>, next: unknown): IncrementalSavePlan | null {
  if (!isPlainRecord(next)) return null
  const probe: Record<string, unknown> = { ...next }
  /** 每个数组里各元素的来源：上次结果里的下标，或 -1（变了，取这次处理的结果） */
  const sources = new Map<string, number[]>()
  for (const key of arrays) {
    const current = next[key], before = previous[key]
    if (current === undefined && before === undefined) continue
    if (!Array.isArray(current) || !Array.isArray(before)) return null
    let byId: Map<string, number> | null = null
    const from: number[] = []
    const changed: unknown[] = []
    for (let index = 0; index < current.length; index += 1) {
      const element = current[index]
      let source = index < before.length && jsonEqual(element, before[index]) ? index : -1
      if (source < 0) {
        const id = idOf(element)
        if (id !== undefined) {
          if (!byId) {
            byId = new Map()
            for (let position = 0; position < before.length; position += 1) {
              const beforeId = idOf(before[position])
              if (beforeId !== undefined) byId.set(beforeId, position)
            }
          }
          const candidate = byId.get(id)
          if (candidate !== undefined && jsonEqual(element, before[candidate])) source = candidate
        }
      }
      from.push(source)
      if (source < 0) changed.push(element)
    }
    sources.set(key, from)
    probe[key] = changed
  }
  return {
    probe,
    merge(processed, previousStage) {
      if (!isPlainRecord(processed)) return null
      const merged: Record<string, unknown> = { ...processed }
      for (const [key, from] of sources) {
        const fresh = processed[key], kept = previousStage[key]
        if (!Array.isArray(fresh) || !Array.isArray(kept)) return null
        let cursor = 0
        const elements: unknown[] = []
        for (const source of from) {
          if (source >= 0) { if (source >= kept.length) return null; elements.push(kept[source]) } else elements.push(fresh[cursor++])
        }
        if (cursor !== fresh.length) return null
        merged[key] = elements
      }
      return merged
    },
  }
}
