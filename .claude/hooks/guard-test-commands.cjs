#!/usr/bin/env node
/**
 * Claude Code 执行前钩子：拦下没有列出具体测试文件的全量或整目录测试。
 *
 * docs/rules/testing.md 规定日常只跑直接断言改动的测试文件，全量只给 L3 / CI；
 * 整目录跑 vitest 会开满线程把开发者正在用的电脑吃满。确属 L3 且用户明确同意时，
 * 在命令里带上 HENJI_ALLOW_FULL_TEST=1 放行。
 */
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/
// 这些参数后面跟着一个取值，不能把取值当成测试路径。
const FLAGS_WITH_VALUE = new Set([
  '--mode', '--maxWorkers', '--minWorkers', '-t', '--testNamePattern', '--reporter', '--pool',
  '--project', '--config', '-c', '--root', '-r', '--dir', '--shard', '--environment', '--outputFile',
  '--testTimeout', '--retry', '--sequence.seed',
])
// 只有这些脚本是 vitest 的批量入口；test:reality、test:suites 等是别的工具，不管。
const VITEST_SCRIPTS = new Set(['test', 'test:unit', 'test:gpu', 'test:image-export', 'test:ffmpeg-cli'])
const INFO_FLAGS = new Set(['--version', '-v', '--help', '-h'])
// 按命令连接符切段：&&、||、;、|、后台 &、子 shell 括号、换行。
const SEGMENT_SEPARATOR = /&&|\|\||[;|&()\n]/

function tokenize(segment) {
  return (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(token => token.replace(/^["']|["']$/g, ''))
}

function positionalArgs(tokens) {
  const result = []
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token === '--' || token === 'run') continue
    // 重定向（2>、> out.log、<in）不是测试参数；单独的 > 连同后面的文件名一起跳过。
    if (/^\d*[<>]{1,2}$/.test(token)) { index++; continue }
    if (/^\d*[<>]/.test(token)) continue
    if (token.startsWith('-')) {
      if (!token.includes('=') && FLAGS_WITH_VALUE.has(token)) index++
      continue
    }
    result.push(token)
  }
  return result
}

/** 返回这一段命令要跑的测试参数；不是 vitest 批量入口时返回 null。 */
function testTargets(tokens) {
  const vitestAt = tokens.findIndex(token => /(^|[\\/])vitest(\.mjs|\.cmd)?$/.test(token))
  if (vitestAt >= 0) return positionalArgs(tokens.slice(vitestAt + 1))
  const npmAt = tokens.findIndex(token => /(^|[\\/])npm(\.cmd)?$/.test(token))
  if (npmAt < 0) return null
  const rest = tokens.slice(npmAt + 1)
  const script = rest[0] === 'test' || rest[0] === 't' ? 'test' : rest[0] === 'run' ? rest[1] : null
  if (!script || !VITEST_SCRIPTS.has(script)) return null
  return positionalArgs(rest.slice(rest[0] === 'run' ? 2 : 1))
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { input += chunk })
process.stdin.on('end', () => {
  let command = ''
  try { command = String(JSON.parse(input)?.tool_input?.command ?? '') } catch { process.exit(0) }
  if (/HENJI_ALLOW_FULL_TEST\s*=\s*['"]?1/.test(command)) process.exit(0)
  for (const segment of command.split(SEGMENT_SEPARATOR)) {
    const tokens = tokenize(segment)
    const targets = testTargets(tokens)
    if (targets === null || tokens.some(token => INFO_FLAGS.has(token))) continue
    const offending = targets.length === 0 ? ['（没有列出任何测试文件，等于全量）'] : targets.filter(target => !TEST_FILE.test(target))
    if (offending.length === 0) continue
    process.stderr.write([
      '测试命令被拦下：只能运行列出的具体测试文件（*.test.ts / *.spec.ts），不能整目录或全量运行。',
      `不符合的参数：${offending.join('、')}`,
      '按 docs/rules/testing.md：只跑直接断言本次改动的测试文件，例如 npx vitest run src/core/foo.test.ts；',
      '找不到对应测试时用 npm run verify:changed -- --level L1 <改动文件...>。',
      '确属 L3 全量且用户已明确同意时，在命令里加 HENJI_ALLOW_FULL_TEST=1 放行。',
    ].join('\n'))
    process.exit(2)
  }
  process.exit(0)
})
