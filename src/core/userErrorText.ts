/**
 * 失败原因交给正式界面前的统一整理。软件自己写给用户的原因都是中文；浏览器、显卡驱动、编解码库、
 * 子进程、Node 文件系统直接给出的原始错误是英文，只能进日志和可展开的详情。
 */
const USER_LANGUAGE = /[\u3400-\u9fff]/
/** 引号里的内容与路径常带中文（用户资料目录就是中文），判断是不是写给用户的话时不算。 */
const QUOTED_OR_PATH = /'[^']*'|"[^"]*"|`[^`]*`|(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s'"`，。；]*/g
const FILE_SYSTEM_CODE = /\b(ENOENT|EPERM|EACCES|EBUSY|ENOSPC|EISDIR|ENOTDIR|EMFILE)\b:/

/** 这段文字是否是写给用户看的：去掉引号内容与路径后仍含中文。 */
export function isUserLanguageText(message: string): boolean {
  return USER_LANGUAGE.test(message.replace(QUOTED_OR_PATH, ''))
}

/** 主进程原样转来的 Node 文件系统错误（带错误码和内部路径）换成用户语言；不是这类错误时 undefined。 */
export function fileSystemErrorText(message: string): string | undefined {
  const code = FILE_SYSTEM_CODE.exec(message)?.[1]
  if (!code) return undefined
  if (code === 'ENOENT' || code === 'ENOTDIR') return '找不到需要的文件，它可能已被移动或删除。'
  if (code === 'ENOSPC') return '磁盘空间不足，请清理后重试。'
  return '文件暂时无法读写，请检查它是否只读或被其他程序占用。'
}

/**
 * 界面上显示的失败原因：文件系统错误换成用户语言；去掉 `Error: ` 与给助手分支用的错误码前缀
 * （如 `NOT_FOUND：`、`CONFLICT:`；其余须带下划线，不误伤 `GPU：`）；去掉中文说明后面拼接的英文原始输出
 * （如子进程 stderr）；不是写给用户的话时用 fallback。
 */
export function userErrorText(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const fileSystem = fileSystemErrorText(raw)
  if (fileSystem) return fileSystem
  const message = raw.trim().replace(/^(?:Error:\s*)?(?:[A-Z][A-Z0-9]*_[A-Z0-9_]+|CONFLICT|ABORTED)[：:]\s*/, '').replace(/^Error:\s*/, '')
  if (!isUserLanguageText(message)) return fallback
  // 只去掉像原始输出的尾巴：三个词以上、带标点行号或 error/failed 这类词的英文句子，且不是路径；字体名、文件名照留。
  const tail = /^([\s\S]*[\u3400-\u9fff][^：:]*)[：:]\s*([^\u3400-\u9fff]+)$/.exec(message)
  const output = tail && tail[2].trim().split(/\s+/).length >= 3 && !/^(?:[A-Za-z]:[\\/]|[\\/]|\w+:\/\/)/.test(tail[2].trim()) && /[.:;()[\]=]|\b(?:at|failed|error|code)\b/i.test(tail[2])
  return output ? `${tail[1].replace(/[。.，,\s]+$/, '')}。` : message
}
