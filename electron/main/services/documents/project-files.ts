import fsp from 'node:fs/promises'
import path from 'node:path'

import type { ProjectFileRejectionReason, ProjectFileResolution, ResolveProjectFilesResult } from '../../../../src/core/documents/types'
import { isPathInside, isSafeRelativeSegment, samePath, type PathStyle } from '../../../../src/core/storage/pathSyntax'
import { errorCode } from './errors'

/*
 * 项目内相对路径 → 真实路径（助手导入项目素材）。能力输入只接受项目文件夹里的相对路径：
 * 先按字面拒绝绝对路径、盘符、网络路径与 `..`，再对拼出的位置取 realpath，
 * 真实位置不在项目文件夹（同样取 realpath）以内的——符号链接、联接点指出去的——一律拒绝。
 * 每条路径单独给出结论；消息里点名原样输入与原因，不带项目文件夹的绝对路径。
 */

const EXAMPLE = '例如 素材/截图/产品主页.png'
const ABSOLUTE = /^(?:[\\/]|[a-z]:)/i
// eslint-disable-next-line no-control-regex -- 控制字符正是要拒绝的输入
const CONTROL = /[\u0000-\u001f\u007f]/

function rejected(input: string, reason: ProjectFileRejectionReason, detail: string): ProjectFileResolution {
  return { input, status: 'rejected', reason, message: `“${input}”${detail}` }
}

async function resolveOne(realRoot: string, input: string, style: PathStyle): Promise<ProjectFileResolution> {
  if (!input.trim()) return rejected(input, 'invalid_path', `是空路径，请给出项目文件夹里的文件或文件夹，${EXAMPLE}。`)
  if (CONTROL.test(input)) return rejected(input, 'invalid_path', '含控制字符，不是有效的相对路径。')
  if (ABSOLUTE.test(input) || path.win32.isAbsolute(input) || path.posix.isAbsolute(input)) {
    return rejected(input, 'absolute_path', `是绝对路径、盘符或网络路径；只能用项目文件夹里的相对路径，${EXAMPLE}。`)
  }
  const segments = input.split(/[\\/]+/).filter(segment => segment !== '' && segment !== '.')
  if (segments.includes('..')) return rejected(input, 'parent_segment', '含“..”，会走出项目文件夹；请直接写项目里的相对路径。')
  if (!segments.length) return rejected(input, 'invalid_path', `指向项目文件夹本身；请给出其中的文件或文件夹，${EXAMPLE}。`)
  const unsafe = segments.find(segment => !isSafeRelativeSegment(style, segment))
  if (unsafe !== undefined) return rejected(input, 'invalid_path', `里的“${unsafe}”含不能用于路径的字符。`)
  let real: string
  try {
    real = await fsp.realpath(path.join(realRoot, ...segments))
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') return rejected(input, 'not_found', '在项目文件夹里不存在；请核对相对路径的拼写与大小写。')
    return rejected(input, 'unreadable', `无法读取（${code ?? '未知错误'}）。`)
  }
  if (samePath(style, realRoot, real)) return rejected(input, 'invalid_path', `实际指向项目文件夹本身；请给出其中的文件或文件夹，${EXAMPLE}。`)
  if (!isPathInside(style, realRoot, real)) return rejected(input, 'outside_project', '的真实位置不在项目文件夹内（符号链接或联接点指向项目外），已拒绝；请把素材复制进项目文件夹后再导入。')
  let stat
  try { stat = await fsp.stat(real) } catch (error) { return rejected(input, 'unreadable', `无法读取（${errorCode(error) ?? '未知错误'}）。`) }
  if (!stat.isFile() && !stat.isDirectory()) return rejected(input, 'unreadable', '不是普通文件或文件夹。')
  return { input, status: 'resolved', relativePath: segments.join('/'), path: real, kind: stat.isDirectory() ? 'directory' : 'file' }
}

/** 项目文件夹本身取不到真实路径时整体报错（项目被移走或无权访问），不逐条猜测。 */
export async function resolveProjectRelativePaths(root: string, paths: readonly string[], style: PathStyle): Promise<ResolveProjectFilesResult> {
  const realRoot = await fsp.realpath(root)
  const entries: ProjectFileResolution[] = []
  for (const input of paths) entries.push(await resolveOne(realRoot, input, style))
  return { root: realRoot, entries }
}
