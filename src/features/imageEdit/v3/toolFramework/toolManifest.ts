import { createLogger } from '@/core/logging'
import { legacyToolManifest } from '../tools/legacy/manifest'
import { ToolRegistry } from './registry'
import type { ToolDefinition } from './types'

/** No editor components in this projection: host profiles must not load their own consumers. */
export type ToolManifest = Omit<ToolDefinition, 'Options' | 'overlays' | 'createGesture'>
const manifests = import.meta.glob<{ toolManifest: readonly ToolManifest[] }>([
  '../tools/**/manifest.ts', '!../tools/legacy/manifest.ts',
], { eager: true })

function collect(): { registry: ToolRegistry; failed: boolean } {
  try {
    return { registry: new ToolRegistry([...legacyToolManifest, ...Object.values(manifests).flatMap(entry => entry.toolManifest)]), failed: false }
  } catch (error) {
    createLogger('imageEditor.tools').error('图片编辑工具清单登记失败', error, { event: 'image_editor.tools.manifest.failed' })
    return { registry: new ToolRegistry([]), failed: true }
  }
}

export const toolManifestRegistration = collect()
