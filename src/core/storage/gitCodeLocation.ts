import { z } from 'zod'

/** git:<commit SHA-1>:<percent-encoded repository location>:<percent-encoded POSIX path>. */
export interface GitCodeLocation { oid: string; repository: string; filepath: string }
const pattern = /^git:([a-f0-9]{40}):([^:]+):([^:]+)$/
export function parseGitCodeLocation(value: string): GitCodeLocation | null {
  if (!value.startsWith('git:')) return null
  const match = pattern.exec(value)
  if (!match) throw new Error('代码版本引用无效，请从工程备份恢复。')
  let repository: string; let filepath: string
  try { repository = decodeURIComponent(match[2]); filepath = decodeURIComponent(match[3]) }
  catch { throw new Error('代码版本引用编码无效，请从工程备份恢复。') }
  if (!repository || repository.startsWith('git:') || /[\0\r\n]/.test(repository) || !filepath.split('/').every(part => part && part !== '.' && part !== '..' && !/[\\:\0]/.test(part) && part.toLowerCase() !== '.git')) throw new Error('代码版本引用路径越界。')
  return { oid: match[1], repository, filepath }
}
export function gitCodeLocation(value: GitCodeLocation): string {
  const result = `git:${value.oid}:${encodeURIComponent(value.repository)}:${encodeURIComponent(value.filepath)}`
  parseGitCodeLocation(result)
  return result
}
export const gitCodeLocationSchema = z.string().regex(pattern).refine(value => {
  try { return parseGitCodeLocation(value) !== null } catch { return false }
}, '无效的 Git 源码引用')
/** Legacy file, memory and asset locations retain their existing interpretation. */
export const codeLocationSchema = z.union([gitCodeLocationSchema, z.string().min(1).regex(/^(?!git:)/)])
