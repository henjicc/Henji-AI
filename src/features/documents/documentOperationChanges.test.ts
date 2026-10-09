import { expect, it, vi } from 'vitest'

const markOpened = vi.hoisted(() => vi.fn())
vi.mock('@/commands/documents', async importOriginal => ({
  ...await importOriginal<typeof import('@/commands/documents')>(),
  markDocumentOpened: markOpened,
}))

import { DocumentOperations, getDocumentOperations } from './documentOperations'
import { defaultDocumentOperationChanges, markSessionDocumentOpened } from './documentOperationChanges'

it('首次取得通用操作服务之前的会话打开仍推进同一修订，失败不通知', async () => {
  const listener = vi.fn()
  const release = defaultDocumentOperationChanges.subscribe(listener)
  const before = defaultDocumentOperationChanges.revision()
  try {
    markOpened.mockResolvedValue(undefined)
    await markSessionDocumentOpened('document-1')
    expect(getDocumentOperations().revision()).toBe(before + 1)
    expect(listener).toHaveBeenCalledTimes(1)
    markOpened.mockRejectedValue(new Error('write failed'))
    await expect(markSessionDocumentOpened('document-2')).rejects.toThrow('write failed')
    expect(getDocumentOperations().revision()).toBe(before + 1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(new DocumentOperations().revision()).toBe(0)
  } finally { release() }
})
