import { expect, it, vi } from 'vitest'

const configure = vi.hoisted(() => vi.fn())
vi.mock('@/features/imageEdit/v3/application/imageEditDocumentBindings', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/imageEdit/v3/application/imageEditDocumentBindings')>(),
  configureImageEditDocumentProjectionResolverV3: configure,
}))

import { initializeApplicationDomainBindings } from './applicationDomains'
import { resolveCanvasImageEditDocumentProjection } from '@/features/canvas/application/imageEditDocumentProjectionBinding'

it('导入领域目录不配置投影，显式重复装配使用同一个领域 resolver', () => {
  expect(configure).not.toHaveBeenCalled()
  initializeApplicationDomainBindings()
  initializeApplicationDomainBindings()
  expect(configure.mock.calls).toEqual([
    [resolveCanvasImageEditDocumentProjection],
    [resolveCanvasImageEditDocumentProjection],
  ])
})
