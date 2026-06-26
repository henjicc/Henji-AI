import { clipboard, nativeImage } from 'electron'
import fs from 'node:fs/promises'
import sharp from 'sharp'
import { resolveSourceBytes } from './image/source'

export interface ClipboardFileEntryDto {
  path: string
  data: string
  mimeType: string
}

export async function readClipboardFiles(): Promise<ClipboardFileEntryDto[]> {
  return []
}

export function readClipboardText(): string {
  return clipboard.readText()
}

export async function writeImageFromPath(filePath: string): Promise<void> {
  const pngBytes = await sharp(await fs.readFile(filePath)).png().toBuffer()
  const image = nativeImage.createFromBuffer(pngBytes)
  if (image.isEmpty()) {
    throw new Error('Failed to decode image for clipboard')
  }
  clipboard.writeImage(image)
}

export async function writeImageFromSource(source: string): Promise<void> {
  const { bytes } = await resolveSourceBytes(source)
  const pngBytes = await sharp(bytes).png().toBuffer()
  const image = nativeImage.createFromBuffer(pngBytes)
  if (image.isEmpty()) {
    throw new Error('Failed to decode image source for clipboard')
  }
  clipboard.writeImage(image)
}
