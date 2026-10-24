// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { closeAllVideoEdits, createVideoEditTestProject } from './videoEditDocumentTestKit'
import { editVideoProject, focusVideoEditPanel } from './videoEditService'
import { selectedVideoEditSubtitleId, selectVideoEditSubtitle } from './videoEditSubtitleSelection'

beforeEach(installHarnessNativeStorage)
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('选中一条字幕时字幕面板到前面，播放头跳到它；取消选中不切面板（重要记录 019）', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id
  editVideoProject(id, document => { document.sequences[0].captions = [{ id: 'one', text: '第一句', start: 12, duration: 30 }]; return document })
  focusVideoEditPanel(id, 'timeline')
  const version = owner.panelFocusVersion ?? 0
  selectVideoEditSubtitle(id, owner.activeSequenceId, 'one')
  expect(owner.activePanel).toBe('content'); expect(owner.panelFocusVersion).toBe(version + 1)
  expect(owner.frame).toBe(12); expect(selectedVideoEditSubtitleId(owner, owner.activeSequenceId)).toBe('one')
  focusVideoEditPanel(id, 'timeline')
  selectVideoEditSubtitle(id, owner.activeSequenceId, null)
  expect(owner.activePanel).toBe('timeline')
})
