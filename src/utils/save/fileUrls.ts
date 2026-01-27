import { readFile } from '@tauri-apps/plugin-fs'
import { inferMimeFromPath as inferMimeFromPathShared } from '@/utils/mime'

export async function fileToBlobSrc(fullPath: string, mimeHint?: string): Promise<string> {
  const bytes = await readFile(fullPath)
  const blob = new Blob([bytes], { type: mimeHint || inferMimeFromPathShared(fullPath) })
  return URL.createObjectURL(blob)
}

export async function fileToDataUrl(fullPath: string, mimeHint?: string): Promise<string> {
  const bytes = await readFile(fullPath)
  const blob = new Blob([bytes], { type: mimeHint || inferMimeFromPathShared(fullPath) })
  const reader = new FileReader()
  const p = new Promise<string>((resolve, reject) => {
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = (e) => reject(e)
  })
  reader.readAsDataURL(blob)
  return p
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  const bin = Array.from(bytes).map(b => String.fromCharCode(b)).join('')
  const base64 = btoa(bin)
  return `data:${mime};base64,${base64}`
}

