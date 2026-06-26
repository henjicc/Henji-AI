import type { PlatformRuntime } from '@/platform/contracts'
import { createTauriAiRuntime } from './aiRuntime'
import { createTauriLlmRuntime } from './llmRuntime'
import { createTauriDb } from './db'
import { createTauriKeystore } from './keystore'
import { createTauriSystem } from './system'
import { createTauriMedia } from './media'
import { createTauriImage } from './image'
import { createTauriClipboard } from './clipboard'
import { createTauriDragDrop } from './dragDrop'
import { createTauriProjectPackage } from './projectPackage'
import { createTauriWindow } from './window'
import { createTauriLogging } from './logging'
import { createTauriUpdater } from './updater'

export function createTauriPlatform(): PlatformRuntime {
  return {
    aiRuntime: createTauriAiRuntime(),
    llmRuntime: createTauriLlmRuntime(),
    db: createTauriDb(),
    keystore: createTauriKeystore(),
    system: createTauriSystem(),
    media: createTauriMedia(),
    image: createTauriImage(),
    clipboard: createTauriClipboard(),
    dragDrop: createTauriDragDrop(),
    projectPackage: createTauriProjectPackage(),
    window: createTauriWindow(),
    logging: createTauriLogging(),
    updater: createTauriUpdater(),
  }
}
