import { expect, it, vi } from 'vitest'
import { createImageEditDocumentV3, createImageEditTextLayerV3, createImageEditGroupLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { vectorDocumentFontNames, prepareVectorDocumentFonts } from './fonts'
import { validateFontName, prepareFontPayloads } from '@/platform/fonts'

vi.mock('@/platform/fonts', () => ({ prepareFontPayloads: vi.fn(async () => []), validateFontName: vi.fn((name: string) => { if (name === 'missing-font') throw new Error('字体不存在，请导入原字体') }) }))
it('字体目录由现有 PAL/fontkit 解析，按正式内容片段收集，包内只持有名称引用', async () => {
  const document = createImageEditDocumentV3({ width:100, height:100 }), text = createImageEditTextLayerV3('title','标题'), group = createImageEditGroupLayerV3('group','组')
  group.children = [text, { ...text, id:'title2' }]; document.layers = [group]
  expect(vectorDocumentFontNames(document)).toEqual(['sans-serif'])
  await expect(prepareVectorDocumentFonts(document)).resolves.toEqual([])
  expect(prepareFontPayloads).toHaveBeenCalledWith(['sans-serif'])
  expect(validateFontName).toHaveBeenCalledWith('sans-serif')
  expect(JSON.stringify(document)).not.toMatch(/fontBytes|\.ttf|\.otf/)
})
it('缺失字体保留正式名称并拒绝无提示替换或导出', async () => {
  const document = createImageEditDocumentV3({ width:100, height:100 }), text = createImageEditTextLayerV3('title','标题')
  text.content.paragraphs[0].runs[0].style.fontFamily = 'missing-font'; document.layers = [text]
  await expect(prepareVectorDocumentFonts(document)).rejects.toThrow('字体不存在')
  expect(text.content.paragraphs[0].runs[0].style.fontFamily).toBe('missing-font')
})
