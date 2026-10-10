import { createLogger } from '@/core/logging'
import { ToolRegistry } from './registry'
import type { ToolDefinition } from './types'
import { tools as transformTools } from '../toolEntries/transform'
import { tools as paintTools } from '../toolEntries/paint'
import { tools as legacyTools } from '../toolEntries/legacy'
import { toolManifestRegistration } from './toolManifest'

const entries = import.meta.glob<{ tools: readonly ToolDefinition[] }>(['../toolEntries/*.{ts,tsx}', '!../toolEntries/legacy.tsx', '!../toolEntries/paint.tsx', '!../toolEntries/transform.tsx'], { eager: true })
const logger = createLogger('imageEditor.tools')

function collect(): { registry: ToolRegistry; failed: boolean } {
  try {
    if (toolManifestRegistration.failed) throw new Error('Tool manifest registration failed')
    const registry = new ToolRegistry([...legacyTools, ...paintTools, ...transformTools, ...Object.values(entries).flatMap(entry => entry.tools)])
    const manifests = toolManifestRegistration.registry.list()
    if (registry.list().length !== manifests.length || manifests.some(manifest => !registry.get(manifest.id))) {
      throw new Error('Tool implementations must match their registered manifests')
    }
    return { registry, failed: false }
  } catch (error) {
    logger.error('图片编辑工具登记失败', error, { event: 'image_editor.tools.registration.failed' })
    return { registry: new ToolRegistry([]), failed: true }
  }
}

export const builtInToolRegistration = collect()
export const imageEditorToolRegistry = builtInToolRegistration.registry
