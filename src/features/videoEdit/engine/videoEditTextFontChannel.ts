import { TextFontChannel, type FontPort, type TextFontLease } from '@/core/imaging/vectorContent/shaping/fontChannel'
import type { TextFontSession } from '@/core/imaging/vectorContent/shaping/fontPolicy'
import { authorLibraryUrl } from '@/core/videoEdit/codeMaterial/authorLibraries'

export type TextFontChannelAttach = { kind: 'textFonts.attach'; port: MessagePort }
let channel: TextFontChannel | undefined
const shared = new Map<string, { lease: Promise<TextFontLease>; references: number }>()
export function renewTextFontLease(): void {
  for (const previous of shared.values()) if (--previous.references === 0) void previous.lease.then(lease => lease.release(), () => undefined)
  shared.clear()
}
export function attachTextFontChannel(port: MessagePort): void {
  renewTextFontLease()
  channel?.close()
  channel = new TextFontChannel(port as unknown as FontPort)
}
export async function acquireSharedTextFontLease(version?: string): Promise<TextFontLease> {
  const key = version ?? 'source'
  let entry = shared.get(key)
  if (!entry) { entry = { lease: acquireTextFontLease(undefined, version), references: 1 }; shared.set(key, entry) }
  entry.references++
  try {
    const lease = await entry.lease
    let released = false
    return { fonts: lease.fonts, revision: lease.revision, release: () => {
      if (released) return
      released = true
      if (--entry.references === 0) lease.release()
    } }
  } catch (error) {
    entry.references--
    if (shared.get(key) === entry) { shared.delete(key); entry.references-- }
    throw error
  }
}
export async function acquireTextFontLease(signal?: AbortSignal, version?: string): Promise<TextFontLease> {
  if (!channel) return Promise.reject(new Error('文字字体通道尚未连接'))
  const policy = version ? await import(/* @vite-ignore */ authorLibraryUrl('henji-layout', version, 'font-session.mjs')) as { TextFontSession: typeof TextFontSession } : undefined
  return channel.open(signal, policy?.TextFontSession)
}
export function closeTextFontChannel(): void { renewTextFontLease(); channel?.close(); channel = undefined }
