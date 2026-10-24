/**
 * 桌面桥错误名（重要记录 020）：contextBridge 跨世界复制错误时只保留 message 与 stack，name 一律变回 "Error"
 * （Electron 42 实测：主进程抛出的 DocumentNotFoundError 到渲染层只剩 Error）。渲染层按 name 判断的分支
 * （文档不存在、重名、版本冲突、取消）因此在真实应用里全部落空。
 *
 * 预加载层把错误名编进 message 前缀（不可见分隔符包住），平台层在每次调用失败时还原 name 与原文。
 * 主进程与预加载、渲染层共用本文件，不引用别名或 DOM。
 */
const MARK = '\u2063'

/** 预加载层：给带具体名字的错误把名字编进 message；普通 Error 原样返回 */
export function encodeNativeErrorMessage(name: string, message: string): string {
  return name && name !== 'Error' ? `${MARK}${name}${MARK}${message}` : message
}

/** 平台层：还原 name 与原文（就地修改并返回同一个错误）；不是编码过的错误原样返回 */
export function restoreNativeErrorName<T>(error: T): T {
  if (!(error instanceof Error) || !error.message.startsWith(MARK)) return error
  const end = error.message.indexOf(MARK, MARK.length)
  if (end <= MARK.length) return error
  const name = error.message.slice(MARK.length, end)
  const encoded = error.message
  const message = encoded.slice(end + MARK.length)
  error.name = name
  error.message = message
  if (typeof error.stack === 'string') error.stack = error.stack.split(encoded).join(message).replace(/^Error:/, `${name}:`)
  return error
}
