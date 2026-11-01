import type { TextFontAccess } from './fontSession'

const key = Symbol.for('henji-layout.text.font-session')
type FontGlobal = typeof globalThis & { [key]?: TextFontAccess }

export function currentTextFontSession(): TextFontAccess {
  const fonts = (globalThis as FontGlobal)[key]
  if (!fonts) throw new Error('文字排版需要宿主先准备本模块声明的字体')
  return fonts
}
export function resolvedTextFontSession(fonts: TextFontAccess | undefined): TextFontAccess | undefined {
  const current = (globalThis as FontGlobal)[key]
  return fonts?.owner && current?.owner === fonts.owner ? current : fonts
}

/** 仅在同步作者调用期间绑定；异步资源加载不能占用跨模块共享的调用上下文。 */
export function withTextFontSession<T>(fonts: TextFontAccess | undefined, call: () => T): T {
  if (!fonts) return call()
  const host = globalThis as FontGlobal, previous = host[key]
  host[key] = fonts
  try { return call() } finally { host[key] = previous }
}

/** 只供宿主已经串行化的异步作者入口使用；字体与 wasm 必须在进入前就绪。 */
export async function importWithTextFontSession<T>(fonts: TextFontAccess | undefined, load: () => Promise<T>): Promise<T> {
  if (!fonts) return load()
  const host = globalThis as FontGlobal, previous = host[key]
  host[key] = fonts
  try { return await load() } finally { host[key] = previous }
}
