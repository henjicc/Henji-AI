import { TextFontChannel, type FontPort, type TextFontLease } from '@/core/imaging/vectorContent/shaping/fontChannel'
import type { TextFontSession } from '@/core/imaging/vectorContent/shaping/fontPolicy'
import { authorLibraryUrl } from '@/core/videoEdit/codeMaterial/authorLibraries'

export type TextFontChannelAttach = { kind: 'textFonts.attach'; port: MessagePort }
// 变量地址的 import() 会被 Vite 4 改写成依赖 /@vite/client 的形式（@vite-ignore 也一样），这个模块跑在渲染 Worker 里，
// 而客户端收到热更新时要访问 Worker 没有的 document。固定函数体让原生加载不经过 import-analysis。
const importFontPolicy = new Function('url', 'return import(url)') as (url: string) => Promise<{ TextFontSession: typeof TextFontSession }>
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
async function acquireTextFontLease(signal?: AbortSignal, version?: string): Promise<TextFontLease> {
  if (!channel) return Promise.reject(new Error('文字字体通道尚未连接'))
  const policy = version ? await importFontPolicy(authorLibraryUrl('henji-layout', version, 'font-session.mjs')) : undefined
  return channel.open(signal, policy?.TextFontSession)
}
export function closeTextFontChannel(): void { renewTextFontLease(); channel?.close(); channel = undefined }
