// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { AssetRecord, CreateAssetInput } from '@/platform/contracts/assetLibrary'
import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import { MCP_CAPABILITY_IDS, MCP_READ_PERMISSIONS, MCP_WRITE_PERMISSIONS } from '@/core/application-control/localHostContracts'
import { createApplicationCapabilitySession } from '@/features/application-control/applicationCapabilityService'
import { createImageEditPreview, resetImageEditApplicationStateForTests } from '@/features/imageEdit/application/imageEditApplicationService'
import { getStoredImageEditPreview } from '@/features/imageEdit/application/imageEditSessionRegistry'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from './harnessNativeStorage'

const io = vi.hoisted(() => ({ assets: new Map<string, AssetRecord>(), render: vi.fn(), persist: vi.fn() }))
vi.mock('@/commands/image', async importOriginal => ({ ...await importOriginal<typeof import('@/commands/image')>(),
  readImageInfo: async () => ({ width: 800, height: 600 }), persistImageSource: io.persist }))
vi.mock('@/features/imageEdit/execution/browserImageEditExecution', () => ({ exportImageEditDocument: io.render }))
vi.mock('@/commands/assetLibrary', async importOriginal => ({ ...await importOriginal<typeof import('@/commands/assetLibrary')>(),
  createAsset: async (input: CreateAssetInput) => {
    const asset: AssetRecord = { id: crypto.randomUUID(), ...input, displayName: input.displayName ?? '', displayUrl: input.filePath,
      mimeType: null, sizeBytes: null, width: null, height: null, durationSeconds: null, thumbnailPath: null, thumbnailUrl: null,
      inspectionStatus: 'pending', inspectionError: null, fileModifiedAt: null, lastUsedAt: null, createdAt: 1, updatedAt: 1, tags: [], libraryIds: [] }
    io.assets.set(asset.id, structuredClone(asset))
    return asset
  },
  inspectAsset: async (id: string) => {
    const asset = io.assets.get(id)
    if (!asset) throw new Error('NOT_FOUND')
    return structuredClone(asset)
  },
}))
afterEach(() => { resetImageEditApplicationStateForTests(); uninstallHarnessNativeStorage(); io.assets.clear(); vi.clearAllMocks() })
it('MCP 授权目录通过正式服务创建、读取并保存编辑预览，原预览不被覆盖', async () => {
  installHarnessNativeStorage()
  io.render.mockResolvedValue('data:image/png;base64,fixture')
  io.persist.mockResolvedValue('C:/fixture/edited.png')
  const source = await createImageEditPreview({ sourceRef: 'asset:original', source: 'C:/fixture/original.png', operations: [{ kind: 'flip_h' }] })
  const sourceRef = { kind: 'image_edit.preview', id: String(source.previewRef) }
  const original = structuredClone(getStoredImageEditPreview(sourceRef.id))
  const session = createApplicationCapabilitySession(createApplicationCallerGrant({ callerId: 'mcp-edit', allowWrites: true,
    allowDestructive: false, capabilityIds: [...MCP_CAPABILITY_IDS], permissions: [...MCP_READ_PERMISSIONS, ...MCP_WRITE_PERMISSIONS] }))
  const execute = (id: string, version: number, input: Record<string, unknown>) => session.execute({ id, version, input }, { requestId: crypto.randomUUID(), signal: new AbortController().signal })
  const created = await execute('create_image_edit_preview', 2, { sourceRef, operations: [{ kind: 'rotate_cw', degrees: 90 }] })
  expect(created.ok, JSON.stringify(created)).toBe(true)
  if (!created.ok) throw new Error('预览创建失败')
  expect(created.data.hasEffect).toBe(true)
  const previewRef = String(created.data.previewRef)
  const read = await execute('read_application_entity', 1, { ref: { kind: 'image_edit.preview', id: previewRef }, propertyIds: ['image_edit.preview.width'] })
  expect(read.ok, JSON.stringify(read)).toBe(true)
  expect(JSON.stringify(read)).toContain('800')
  const saved = await execute('commit_image_edit', 1, { previewRef, displayName: '旋转后的图片' })
  expect(saved.ok, JSON.stringify(saved)).toBe(true)
  if (!saved.ok) throw new Error('保存失败')
  const assetId = String(saved.data.assetId)
  expect(io.assets.get(assetId)).toMatchObject({ displayName: '旋转后的图片', filePath: 'C:/fixture/edited.png' })
  expect(saved.data.resultRefs).toEqual([{ kind: 'asset', id: assetId }])
  const assetRead = await execute('read_application_entity', 1, { ref: { kind: 'asset', id: assetId }, propertyIds: ['asset.display_name'] })
  expect(assetRead.ok, JSON.stringify(assetRead)).toBe(true)
  expect(JSON.stringify(assetRead)).toContain('旋转后的图片')
  expect(io.render).toHaveBeenCalledOnce()
  expect(getStoredImageEditPreview(previewRef)).toBeNull()
  expect(getStoredImageEditPreview(sourceRef.id)).toEqual(original)
})
