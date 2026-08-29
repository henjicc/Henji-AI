import { describe, expect, it, vi } from 'vitest'

import type { ParamDef } from '@/core/types'

import {
  isMediaFileAccepted,
  resolveGenerationMediaInputConstraints,
  validateGenerationImageInputs,
} from './generationMediaInputConstraints'

const schema: ParamDef[] = [{
  id: 'image', type: 'image-upload', order: 1, required: true,
  name: { zh: '图片', en: 'Image' }, default: [], valueType: 'array', maxCount: 1,
  accept: ['image/jpeg', 'image/png'], maxSize: 5 * 1024 * 1024,
}]

describe('generation media input constraints', () => {
  it('从被标准媒体行承载的上传参数继承格式与体积限制', () => {
    expect(resolveGenerationMediaInputConstraints(schema, ['image']).image).toEqual({
      accept: ['image/jpeg', 'image/png'],
      maxSizeBytes: 5 * 1024 * 1024,
    })
    expect(resolveGenerationMediaInputConstraints(schema, []).image).toBeUndefined()
  })

  it('文件选择与资产拖入可按 MIME 或扩展名判断', () => {
    const constraint = resolveGenerationMediaInputConstraints(schema, ['image']).image
    expect(isMediaFileAccepted(constraint, { fileName: 'photo.jpg', mimeType: '' })).toBe(true)
    expect(isMediaFileAccepted(constraint, { fileName: 'photo.webp', mimeType: 'image/webp' })).toBe(false)
    expect(isMediaFileAccepted(constraint, { fileName: 'photo.png', sizeBytes: 6 * 1024 * 1024 })).toBe(false)
  })

  it('运行前检查连线输入，拒绝绕过文件选择器的 WebP', async () => {
    const constraint = resolveGenerationMediaInputConstraints(schema, ['image']).image
    const readImageInfo = vi.fn().mockResolvedValue({
      extension: 'webp', fileName: 'upstream.webp', fileSizeBytes: 1_024,
    })

    await expect(validateGenerationImageInputs(
      ['upstream.webp'], constraint, readImageInfo,
    )).rejects.toMatchObject({
      code: 'unsupported-format',
    })
    expect(readImageInfo).toHaveBeenCalledWith('upstream.webp')
  })
})
