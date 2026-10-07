// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createVideoEditDocument, createVideoEditSequence } from '@/core/videoEdit/document'
import { videoEditSubtitleStyleSchema } from '@/core/videoEdit/subtitleStyle'
import { GENERIC_FONT_FACES } from '@/core/fonts/catalog'
import { VideoEditFontWarnings } from './VideoEditFontWarnings'
const boundary = vi.hoisted(() => ({ imported: vi.fn(), warn: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ fonts: { list: async () => ({ faces: [], revision: 0 }), importFiles: boundary.imported, onChanged: () => () => undefined }, settings: { get: async () => null } }) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ warn: boundary.warn, error: vi.fn() }) }))
afterEach(cleanup)
it('工程及导出共用缺字体提示，包含字体、受影响字幕和回退，导入后提示消失', async () => {
  const document = createVideoEditDocument('缺字体'); const sequence = createVideoEditSequence()
  sequence.captions = [{ id: 'one', text: '说明文字', start: 0, duration: 30, style: videoEditSubtitleStyleSchema.parse({ fontFamily: 'Missing CJK' }) }]; document.sequences = [sequence]
  boundary.imported.mockResolvedValue({ revision: 1, faces: [{ ...GENERIC_FONT_FACES[0], id: 'import', family: 'Missing CJK', fullName: 'Missing CJK', localizedFamily: '缺失中文字体', aliases: [], imported: true }] })
  const view = render(<VideoEditFontWarnings document={document} />)
  const warning = await view.findByRole('status'); expect(warning.textContent).toContain('Missing CJK'); expect(warning.textContent).toContain('说明文字'); expect(warning.textContent).toContain('系统无衬线字体')
  expect(boundary.warn).toHaveBeenCalledWith('工程字体缺失', expect.objectContaining({ event: 'video_edit.fonts.missing' }))
  fireEvent.click(view.getByRole('button', { name: '导入缺失字体' })); await waitFor(() => expect(view.queryByRole('status')).toBeNull()); expect(boundary.imported).toHaveBeenCalledTimes(1)
})
