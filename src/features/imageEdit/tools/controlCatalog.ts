import { imageEditOperationSchema, type ImageEditControlOperation } from '../application/imageEditControlCatalog'

export interface ImageEditorToolControlDefinition {
  id: 'geometry' | 'blur' | 'diffusion' | 'vgpuGlow'
  label: string
  operationId: string
  operationSchema: typeof imageEditOperationSchema
  kinds: readonly ImageEditControlOperation['kind'][]
}

export const IMAGE_EDITOR_TOOL_CONTROL_DEFINITIONS: readonly ImageEditorToolControlDefinition[] = [
  {
    id: 'geometry',
    label: '几何',
    operationId: 'document.update-output-geometry',
    operationSchema: imageEditOperationSchema,
    kinds: ['rotate_cw', 'rotate_ccw', 'flip_h', 'flip_v', 'crop', 'mark'],
  },
  {
    id: 'blur',
    label: '模糊',
    operationId: 'gaussian_blur',
    operationSchema: imageEditOperationSchema,
    kinds: ['blur'],
  },
  {
    id: 'diffusion',
    label: '发光',
    operationId: 'image.diffusion',
    operationSchema: imageEditOperationSchema,
    kinds: ['diffusion'],
  },
  {
    id: 'vgpuGlow',
    label: '辉光 Pro',
    operationId: 'image.vgpu-glow',
    operationSchema: imageEditOperationSchema,
    kinds: ['vgpu_glow'],
  },
]

export function listImageEditorToolControls(): readonly ImageEditorToolControlDefinition[] {
  return IMAGE_EDITOR_TOOL_CONTROL_DEFINITIONS
}
