import { beforeEach, describe, expect, it } from 'vitest'
import type { GenerationTask } from '../types'
import { listSelectableResults, useResultSelectionStore } from './resultSelection'

const task = (id: string, type: 'image' | 'video', filePaths: string[], extra: Partial<GenerationTask> = {}): GenerationTask => ({
  id, type, createdAt: new Date(), prompt: '', model: 'm', status: 'success',
  result: { type, urls: filePaths.map(() => 'u'), filePaths } as GenerationTask['result'], ...extra,
})

describe('生成结果多选', () => {
  beforeEach(() => useResultSelectionStore.getState().exit())

  it('只收已保存到本机的成功结果；视频只取第一个；文件丢失或失败的记录不可选', () => {
    const keys = listSelectableResults([
      task('a', 'image', ['a0', '', 'a2']),
      task('b', 'video', ['b0', 'b1']),
      task('c', 'image', ['c0'], { resultFileMissing: true }),
      task('d', 'image', ['d0'], { status: 'error' }),
    ]).map(result => result.key)
    expect(keys).toEqual(['a#0', 'a#2', 'b#0'])
  })

  it('Shift 连选按列表顺序把起点到这一项整段设成这一项的新状态；列表收窄后选择跟着收窄', () => {
    const store = useResultSelectionStore.getState()
    store.syncOrder(['a#0', 'a#1', 'b#0', 'c#0'])
    store.toggle('a#1')
    useResultSelectionStore.getState().toggle('c#0', true)
    expect([...useResultSelectionStore.getState().selected]).toEqual(['a#1', 'b#0', 'c#0'])
    useResultSelectionStore.getState().toggle('a#0', true)
    expect([...useResultSelectionStore.getState().selected]).toEqual(['a#1', 'b#0', 'c#0', 'a#0'])
    useResultSelectionStore.getState().syncOrder(['a#0', 'c#0'])
    expect([...useResultSelectionStore.getState().selected].sort()).toEqual(['a#0', 'c#0'])
    expect(useResultSelectionStore.getState().active).toBe(true)
  })
})
