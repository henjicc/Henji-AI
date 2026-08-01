import { IMAGE_EDIT_OPERATION_IDS } from '@/core/imageEdit'

import { imageEditOperationSchema, type ImageEditControlOperation } from '../application/imageEditControlCatalog'

export interface ImageEditorToolControlDefinition {
  id: 'geometry' | 'diffusion'
  label: string
  operationId: string
  operationSchema: typeof imageEditOperationSchema
  kinds: readonly ImageEditControlOperation['kind'][]
}

export const IMAGE_EDITOR_TOOL_CONTROL_DEFINITIONS: readonly ImageEditorToolControlDefinition[] = [
  {
    id: 'geometry',
    label: '几何',
    operationId: IMAGE_EDIT_OPERATION_IDS.orientation,
    operationSchema: imageEditOperationSchema,
    kinds: ['rotate_cw', 'rotate_ccw', 'flip_h', 'flip_v', 'crop', 'mark'],
  },
  {
    id: 'diffusion',
    label: '发光',
    operationId: IMAGE_EDIT_OPERATION_IDS.diffusion,
    operationSchema: imageEditOperationSchema,
    kinds: [],
  },
]

export function listImageEditorToolControls(): readonly ImageEditorToolControlDefinition[] {
  return IMAGE_EDITOR_TOOL_CONTROL_DEFINITIONS
}
