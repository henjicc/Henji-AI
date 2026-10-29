// @vitest-environment jsdom
import { Blob as NativeBlob } from 'node:buffer'
import { resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject, closeAllVideoEdits } from './videoEditDocumentTestKit'
import { updateVideoEditCreativeIntents, editVideoProject } from './videoEditService'
import { captureVideoEditProgramFrame, registerVideoEditProgramCapture } from './videoEditProgramCapture'

beforeEach(() => {
  installHarnessNativeStorage()
  const platform = getPlatform()
  vi.spyOn(platform.system.fs, 'exists').mockResolvedValue(false)
  vi.spyOn(platform.system.fs, 'writeFile').mockResolvedValue(undefined)
  vi.spyOn(platform.system.dialog, 'save').mockResolvedValue(resolve('fixture', 'frame.png'))
  vi.spyOn(platform.system.paths, 'dirname').mockResolvedValue(resolve('fixture'))
  vi.spyOn(platform.assetLibrary, 'inspectFileContent').mockResolvedValue({ contentIdentity: 'a'.repeat(64), sizeBytes: 4, fileModifiedAt: 1 })
})
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
it('取帧期间及已发布缓存的元数据写入不使帧失效，内容编辑仍拒绝', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id
  const capture = vi.fn(async (request: { assertCurrent(): void }) => {
    updateVideoEditCreativeIntents(id, { drafts: [], sessions: [], resources: [] })
    request.assertCurrent()
    return new NativeBlob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }) as unknown as Blob
  })
  const off = registerVideoEditProgramCapture(owner, owner.activeSequenceId, capture)
  try {
    const output = await captureVideoEditProgramFrame(id)
    updateVideoEditCreativeIntents(id, { drafts: [], sessions: [], resources: [] })
    expect(await captureVideoEditProgramFrame(id)).toBe(output)
    expect(capture).toHaveBeenCalledOnce()
    capture.mockImplementationOnce(async request => {
      editVideoProject(id, doc => ({ ...doc, sequences: doc.sequences.map(seq => ({ ...seq, name: '新内容' })) }))
      request.assertCurrent()
      throw new Error('不可达')
    })
    await expect(captureVideoEditProgramFrame(id, 0, resolve('fixture', 'changed.png'))).rejects.toThrow('原节目帧已改变')
  } finally { off() }
})
