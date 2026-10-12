import { decodeImageLayoutResource } from '../../../../src/core/persistence/resourceContracts'
import { z } from 'zod'
import { creativeIntentPageSchema } from '../../../../src/core/creativeIntent/pages'
import { imageLayoutCandidateSchema, imageLayoutPageSchema } from '../../../../src/core/imageEdit/v3/layoutDraft'
import type { ContentAddressedResourceStore } from './resource-store'
import type { ResourceId } from './contracts'

export const imageLayoutResourceSchema = z.union([creativeIntentPageSchema, imageLayoutPageSchema, imageLayoutCandidateSchema])
// One page/IPC work budget, never a limit on layers or draft length.
export const IMAGE_LAYOUT_RESOURCE_MAX_BYTES = 4 * 1024 * 1024
export async function readImageLayoutResource(store: ContentAddressedResourceStore, id: ResourceId): Promise<unknown> {
  const bytes = await store.readVerifiedBuffer(id, IMAGE_LAYOUT_RESOURCE_MAX_BYTES)
  return decodeImageLayoutResource(JSON.parse(bytes.toString('utf8')))
}
