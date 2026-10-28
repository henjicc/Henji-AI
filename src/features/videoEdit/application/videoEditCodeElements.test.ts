
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'


import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createVideoEditTestProject, closeAllVideoEdits } from './videoEditDocumentTestKit'


import { videoEditCodeElementFrames, videoEditProgramClipAt } from './videoEditCodeElements'




const font = vi.hoisted(() => ({ generation: 0, calls: 0 }))
vi.mock('../videoEditGlyphMetrics', async () => {
  const { layoutCodeText } = await import('@/core/videoEdit/codeMaterial/textLayout')
  return { measureCodeText: (request: Parameters<typeof layoutCodeText>[0]) => { font.calls++; return { ...layoutCodeText(request, text => text.length * request.fontSize, { alphabeticPlacement: 'em' }), fontGeneration: font.generation } } }
})
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('non-code scenes do not initialize font measurement or author indices', async () => {
  installHarnessNativeStorage(); const owner = await createVideoEditTestProject(); const before = font.calls
  expect(videoEditCodeElementFrames(owner).size).toBe(0)
  expect(videoEditProgramClipAt(owner, { x: .5, y: .5 })).toBeUndefined()
  expect(font.calls).toBe(before)
})
