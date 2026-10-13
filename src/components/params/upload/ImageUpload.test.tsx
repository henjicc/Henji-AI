// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ImageUploadParamDef } from '@/core/types'
const mocks = vi.hoisted(() => ({ uploader: vi.fn(), notify: vi.fn(), base64: vi.fn() }))
vi.mock('@/components/ui/FileUploader', () => ({ default: (props: { onUpload: (files: File[]) => Promise<void> }) => { mocks.uploader(props); return null } }))
vi.mock('@/contexts/NotificationContext', () => ({ useNotification: () => ({ showNotification: mocks.notify }) }))
vi.mock('@/utils/fileConverter', () => ({ fileToBase64: mocks.base64 }))
import { ImageUpload } from './ImageUpload'
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    width = 10
    height = 20
    set src(url: string) { queueMicrotask(() => { if (url.includes('broken')) this.onerror?.(); else this.onload?.() }) }
  })
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn((file: File) => `blob:${file.name}`)
    static revokeObjectURL = vi.fn()
  })
  mocks.base64.mockResolvedValue('data:image/png;base64,good')
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('解码失败也释放 Blob URL，提示错误并继续上传后续图片', async () => {
  const onChange = vi.fn()
  const param: ImageUploadParamDef = { id: 'image', name: 'Image', type: 'image-upload', order: 1, default: [], format: 'base64', maxCount: 2, base64Prefix: true }
  render(<ImageUpload param={param} value={[]} onChange={onChange} showLabel={false} />)
  const { onUpload } = mocks.uploader.mock.calls[0][0] as { onUpload: (files: File[]) => Promise<void> }
  await expect(onUpload([new File(['bad'], 'broken.png', { type: 'image/png' }), new File(['good'], 'good.png', { type: 'image/png' })])).resolves.toBeUndefined()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:broken.png')
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:good.png')
  expect(mocks.notify).toHaveBeenCalledWith(expect.any(String), 'error')
  expect(onChange).toHaveBeenCalledWith(['data:image/png;base64,good'])
})
