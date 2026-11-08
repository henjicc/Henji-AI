import { afterEach, describe, expect, it } from 'vitest'
import { useGenerationDraftStore } from '@/features/generation/store/generationDraftStore'
import { readGenerationMediaSnapshot } from '@/features/generation/store/generationMediaSnapshot'
import { mediaChangeSince } from './mediaHistory'

const audios = (): string[] => useGenerationDraftStore.getState().draft.uploadedAudios

describe('mediaChangeSince', () => {
  afterEach(() => useGenerationDraftStore.getState().reset())

  it('撤销、重做在两端之间换回快照', () => {
    const before = readGenerationMediaSnapshot()
    useGenerationDraftStore.getState().patchField('uploadedAudios', ['a'])
    const change = mediaChangeSince(before)!
    change.undo()
    expect(audios()).toEqual([])
    change.redo()
    expect(audios()).toEqual(['a'])
  })

  it('中间有没登记的改动时跳过，不把它冲掉', () => {
    const before = readGenerationMediaSnapshot()
    useGenerationDraftStore.getState().patchField('uploadedAudios', ['a'])
    const change = mediaChangeSince(before)!
    useGenerationDraftStore.getState().patchField('uploadedVideoTrimStart', 2)
    change.undo()
    expect(audios()).toEqual(['a'])
    expect(useGenerationDraftStore.getState().draft.uploadedVideoTrimStart).toBe(2)
  })

  it('没有变化时不产生撤销步骤', () => {
    expect(mediaChangeSince(readGenerationMediaSnapshot())).toBeNull()
  })
})
