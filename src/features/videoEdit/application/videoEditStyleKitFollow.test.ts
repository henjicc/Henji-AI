// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { BUILTIN_STYLE_KITS, availableStyleKitFonts } from '@/core/videoEdit/styleKitPresets'
import { styleColorHex } from '@/core/videoEdit/styleKit'
import { createVideoEditTestProject, closeAllVideoEdits } from './videoEditDocumentTestKit'
import { applyStyleKitToSequence, styleKitHostSummary } from './videoEditStyleKits'
import { videoEditStyleKitLibrary } from './videoEditStyleKitLibrary'
import { createVideoEditCaption } from './videoEditTimedContent'
import { createVideoEditGraphicItem } from './videoEditProjectItems'
import { videoEditInPlaceStylePrompt } from './videoEditInPlaceGeneration'
import { STYLE_SUBTITLE_PRESET_ID, listVideoEditSubtitlePresets } from './videoEditSubtitlePresets'

beforeEach(() => { installHarnessNativeStorage(); videoEditStyleKitLibrary.replace([]) })
afterEach(async () => { await closeAllVideoEdits(); uninstallHarnessNativeStorage() })

it('序列绑定风格后，新字幕、新文字图形、字幕预设与就地生成提示词都跟随；未绑定保持原样', async () => {
  const owner = await createVideoEditTestProject(); const projectId = owner.document.id; const sequenceId = owner.activeSequenceId
  const plainCaption = createVideoEditCaption(projectId, sequenceId, { start: 0, duration: 30, text: '无风格' })
  expect((owner.document.sequences[0].captions!.find(cue => cue.id === plainCaption)!.style as { fontFamily: string }).fontFamily).not.toBe('Source Han Sans SC')
  expect(videoEditInPlaceStylePrompt({ projectId, sequenceId }, 'image')).toBe('')
  expect(styleKitHostSummary(projectId, sequenceId).summary).toContain('未绑定风格')

  const kit = applyStyleKitToSequence(projectId, sequenceId, availableStyleKitFonts(BUILTIN_STYLE_KITS[1], []))
  const fresh = await createVideoEditTestProject(); const freshSequence = fresh.activeSequenceId
  const followed = applyStyleKitToSequence(fresh.document.id, freshSequence, kit)
  const caption = createVideoEditCaption(fresh.document.id, freshSequence, { start: 0, duration: 30, text: '跟随风格' })
  expect(fresh.document.sequences[0].captions!.find(cue => cue.id === caption)!.style).toMatchObject({ fontFamily: followed.tokens.fonts.body.family, fill: { color: styleColorHex(followed.tokens.palette.fg) } })
  const item = createVideoEditGraphicItem(fresh.document.id, { kind: 'text' })
  expect(fresh.document.items.find(value => value.id === item)!.graphic!.objects[0].textStyle!.fontFamily).toBe(followed.tokens.fonts.body.family)
  expect(listVideoEditSubtitlePresets(followed)[0].id).toBe(STYLE_SUBTITLE_PRESET_ID)

  expect(videoEditInPlaceStylePrompt({ projectId: fresh.document.id, sequenceId: freshSequence }, 'video')).toContain(followed.profile.summary)
  expect(videoEditInPlaceStylePrompt({ projectId: fresh.document.id, sequenceId: freshSequence, applyStyle: false }, 'video')).toBe('')
  expect(videoEditInPlaceStylePrompt({ projectId: fresh.document.id, sequenceId: freshSequence }, 'audio')).toBe('')
  const summary = styleKitHostSummary(fresh.document.id, freshSequence).summary
  expect(summary).toContain(followed.profile.summary); expect(summary).toContain('必须：')
})
it('未绑定时宿主摘要列出个人风格及其场景，供助手推荐', async () => {
  const owner = await createVideoEditTestProject()
  videoEditStyleKitLibrary.save({ ...availableStyleKitFonts(BUILTIN_STYLE_KITS[1], []), name: '我的讲解' })
  expect(styleKitHostSummary(owner.document.id, owner.activeSequenceId).summary).toContain('我的讲解（科技教程、数码评测、数据讲解）')
})
