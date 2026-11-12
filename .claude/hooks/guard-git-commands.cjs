#!/usr/bin/env node
/**
 * Claude Code 执行前钩子：拦下会丢掉未提交改动或改写远端历史的 git 命令。
 *
 * 工作区里的未提交改动可能来自别的会话，这些命令一执行就找不回来。需要撤掉自己的改动时，
 * 用 Edit 改回去或按文件 `git show HEAD:<文件>` 对照；用户明确同意丢弃时，
 * 在命令里带上 HENJI_ALLOW_DISCARD=1 放行。
 */
// 按命令连接符切段：&&、||、;、|、后台 &、子 shell 括号、换行。
const SEGMENT_SEPARATOR = /&&|\|\||[;|&()\n]/
// 这些全局参数后面跟一个取值。
const GLOBAL_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])

function tokenize(segment) {
  return (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(token => token.replace(/^["']|["']$/g, ''))
}

/** 返回 git 子命令及其参数；这一段不是 git 时为 null。 */
function gitCommand(tokens) {
  const at = tokens.findIndex(token => /(^|[\\/])git(\.exe)?$/.test(token))
  if (at < 0) return null
  let index = at + 1
  while (index < tokens.length && tokens[index].startsWith('-')) index += GLOBAL_WITH_VALUE.has(tokens[index]) ? 2 : 1
  return { sub: tokens[index], args: tokens.slice(index + 1) }
}

/** 违规原因；安全时为 null。 */
function violation({ sub, args }) {
  const has = (...flags) => args.some(arg => flags.includes(arg) || flags.some(flag => flag.startsWith('--') && arg.startsWith(`${flag}=`)))
  switch (sub) {
    case 'checkout':
      if (args.includes('--') || args.includes('.') || has('-f', '--force', '-p', '--patch')) return 'git checkout 用文件或强制方式覆盖工作区改动'
      return null
    case 'restore':
      // 只动暂存区（--staged 且不带 --worktree）不碰工作区文件
      if (has('--staged', '-S') && !has('--worktree', '-W')) return null
      return 'git restore 覆盖工作区改动'
    case 'reset':
      return has('--hard', '--merge', '--keep') ? 'git reset --hard 丢弃工作区改动' : null
    case 'clean':
      return has('-n', '--dry-run') ? null : 'git clean 删除未跟踪文件'
    case 'stash':
      return ['list', 'show'].includes(args[0]) ? null : 'git stash 会搬走或弹回别的任务的改动'
    case 'switch':
      return has('-f', '--force', '--discard-changes') ? 'git switch 强制丢弃工作区改动' : null
    case 'push':
      return has('-f', '--force', '--force-with-lease', '--force-if-includes') || args.some(arg => /^\+/.test(arg)) ? 'git push 强推改写远端历史' : null
    default:
      return null
  }
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { input += chunk })
process.stdin.on('end', () => {
  let command = ''
  try { command = String(JSON.parse(input)?.tool_input?.command ?? '') } catch { process.exit(0) }
  if (/HENJI_ALLOW_DISCARD\s*=\s*['"]?1/.test(command)) process.exit(0)
  for (const segment of command.split(SEGMENT_SEPARATOR)) {
    const git = gitCommand(tokenize(segment))
    const reason = git && violation(git)
    if (!reason) continue
    process.stderr.write([
      `git 命令被拦下：${reason}，未提交的改动（可能是别的会话的）会找不回来。`,
      `命令：${segment.trim()}`,
      '要撤掉自己的改动，用 Edit 按文件改回，或对照 git show HEAD:<文件>；临时文件直接删除那个文件。',
      '用户明确同意丢弃时，在命令里加 HENJI_ALLOW_DISCARD=1 放行。',
    ].join('\n'))
    process.exit(2)
  }
  process.exit(0)
})
