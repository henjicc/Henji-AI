import fsp from 'node:fs/promises'
import path from 'node:path'

import type { ProjectFileRejectionReason, ProjectFileResolution, ResolveProjectFilesResult } from '../../../../src/core/documents/types'
import { samePath, type PathStyle } from '../../../../src/core/storage/pathSyntax'
import { errorCode } from './errors'
import { normalizeMediaImportPath } from '../../../../src/core/media/localMediaImportSafety'

/** 相对路径以项目为基准；绝对路径与目录链接直接按所指位置解析。 */

const EXAMPLE = '例如 素材/截图/产品主页.png'
// eslint-disable-next-line no-control-regex -- 控制字符正是要拒绝的输入
const CONTROL = /[\u0000-\u001f\u007f]/

function rejected(input: string, reason: ProjectFileRejectionReason, detail: string): ProjectFileResolution {
  return { input, status: 'rejected', reason, message: `“${input}”${detail}` }
}

async function resolveOne(realRoot: string, input: string, style: PathStyle): Promise<ProjectFileResolution> {
  if (!input.trim()) return rejected(input, 'invalid_path', `是空路径，请给出文件或文件夹路径，${EXAMPLE}。`)
  if (CONTROL.test(input)) return rejected(input, 'invalid_path', '含控制字符，不是有效路径。')
  let target: string
  try { target = normalizeMediaImportPath(path.resolve(realRoot, input.replace(/[\\/]/g, path.sep)), style === 'win32') }
  catch (error) { return rejected(input, 'invalid_path', `不是有效文件路径（${error instanceof Error ? error.message : String(error)}）。`) }
  let real: string
  try {
    real = await fsp.realpath(target)
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') return rejected(input, 'not_found', '不存在；请核对路径的拼写与大小写。')
    return rejected(input, 'unreadable', `无法读取（${code ?? '未知错误'}）。`)
  }
  if (samePath(style, realRoot, real)) return rejected(input, 'invalid_path', `实际指向项目文件夹本身；请给出其中的文件或文件夹，${EXAMPLE}。`)
  let stat
  try { stat = await fsp.stat(real) } catch (error) { return rejected(input, 'unreadable', `无法读取（${errorCode(error) ?? '未知错误'}）。`) }
  if (!stat.isFile() && !stat.isDirectory()) return rejected(input, 'unreadable', '不是普通文件或文件夹。')
  return { input, status: 'resolved', relativePath: path.relative(realRoot, target).split(path.sep).join('/'), path: real, kind: stat.isDirectory() ? 'directory' : 'file' }
}

/** 项目文件夹本身取不到真实路径时整体报错（项目被移走或无权访问），不逐条猜测。 */
export async function resolveProjectRelativePaths(root: string, paths: readonly string[], style: PathStyle): Promise<ResolveProjectFilesResult> {
  const realRoot = await fsp.realpath(root)
  const entries: ProjectFileResolution[] = []
  for (const input of paths) entries.push(await resolveOne(realRoot, input, style))
  return { root: realRoot, entries }
}
