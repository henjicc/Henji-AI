import { describe, expect, it } from 'vitest'

import {
  createTextHistoryState,
  recordTextEdit,
  redoTextEdit,
  type TextHistorySnapshot,
  undoTextEdit,
} from './textHistory'

function snapshot(value: string, cursor = value.length): TextHistorySnapshot {
  return {
    value,
    selectionStart: cursor,
    selectionEnd: cursor,
    scrollTop: 0,
    scrollLeft: 0,
  }
}

describe('局部文本历史', () => {
  it('不同输入实例维护彼此独立的撤销栈', () => {
    const first = recordTextEdit(
      createTextHistoryState(snapshot('节点一')),
      snapshot('节点一内容'),
      'replace',
      100
    )
    const second = recordTextEdit(
      createTextHistoryState(snapshot('节点二')),
      snapshot('节点二内容'),
      'replace',
      100
    )

    const undoneSecond = undoTextEdit(second)

    expect(first.current.value).toBe('节点一内容')
    expect(undoneSecond.current.value).toBe('节点二')
    expect(first.undo).toHaveLength(1)
  })

  it('连续输入合并成一个自然撤销步骤', () => {
    const initial = createTextHistoryState(snapshot(''))
    const afterFirstCharacter = recordTextEdit(initial, snapshot('a'), 'insert', 100)
    const afterSecondCharacter = recordTextEdit(afterFirstCharacter, snapshot('ab'), 'insert', 200)

    expect(afterSecondCharacter.undo).toHaveLength(1)
    expect(undoTextEdit(afterSecondCharacter).current.value).toBe('')
  })

  it('撤销后可以重做并恢复光标位置', () => {
    const edited = recordTextEdit(
      createTextHistoryState(snapshot('before')),
      snapshot('after', 2),
      'replace',
      100
    )

    const redone = redoTextEdit(undoTextEdit(edited))

    expect(redone.current.value).toBe('after')
    expect(redone.current.selectionStart).toBe(2)
    expect(redone.current.selectionEnd).toBe(2)
  })
})
