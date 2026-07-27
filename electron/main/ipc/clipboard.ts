import {
  readClipboardFiles,
  readClipboardImage,
  readClipboardText,
  writeImageFromPath,
  writeImageFromSource,
  type ClipboardFileEntryDto,
  type ClipboardImageDto,
} from '../services/clipboard'
import { parseStringField, parseVoid, registerIpcHandler } from './registry'

export function registerClipboardIpc(): void {
  registerIpcHandler<void, ClipboardFileEntryDto[]>('clipboard:readFiles', parseVoid, () => readClipboardFiles())
  registerIpcHandler<void, string>('clipboard:readText', parseVoid, () => readClipboardText())
  registerIpcHandler<void, ClipboardImageDto | null>('clipboard:readImage', parseVoid, () => readClipboardImage())
  registerIpcHandler<string, void>('clipboard:writeImageFromPath', (input) => parseStringField(input, 'filePath'), async (filePath) => {
    await writeImageFromPath(filePath)
  })
  registerIpcHandler<string, void>('clipboard:writeImageFromSource', (input) => parseStringField(input, 'source'), async (source) => {
    await writeImageFromSource(source)
  })
}
