const { existsSync, readFileSync, readdirSync } = require('node:fs')
const { join, relative } = require('node:path')

/*
 * Codex / Claude Code 两份项目 skill 必须逐字一致（npm run check:skill-sync，CI 代码检查门禁）。
 *
 * - 比较 `.codex/skills/<名>` 与 `.claude/skills/<名>` 两侧同名 skill 的全部共享文件：`SKILL.md` 与 `references/` 下全部文件
 *   （递归）。文件清单不同或内容不同都失败。
 * - 只存在于一侧的 skill 也失败（新增 skill 必须两份同时提交）。
 * - Codex 专属的 `agents/`（如 `agents/openai.yaml`）是 Codex 客户端的界面元数据，不参与同步。
 * - 内容按 LF 归一后比较：仓库里两份都以 LF 入库，Windows 工作区 `core.autocrlf` 检出的 CRLF 不算差异。
 */

const ROOT = process.cwd()
const CODEX_ROOT = join(ROOT, '.codex/skills')
const CLAUDE_ROOT = join(ROOT, '.claude/skills')
/** 只属于某一个客户端、不参与同步的目录 */
const CLIENT_ONLY_DIRS = new Set(['agents'])

function listSkills(root) {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function collectSharedFiles(directory, prefix = '') {
  const files = []
  for (const entry of readdirSync(join(directory, prefix), { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (!prefix && CLIENT_ONLY_DIRS.has(entry.name)) continue
      files.push(...collectSharedFiles(directory, relativePath))
    } else if (entry.isFile()) {
      files.push(relativePath)
    }
  }
  return files.sort()
}

function readNormalized(file) {
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
}

const codexSkills = listSkills(CODEX_ROOT)
const claudeSkills = listSkills(CLAUDE_ROOT)
const problems = []

for (const name of codexSkills.filter((skill) => !claudeSkills.includes(skill))) {
  problems.push(`${name}：只存在于 .codex/skills，缺少 .claude/skills/${name}`)
}
for (const name of claudeSkills.filter((skill) => !codexSkills.includes(skill))) {
  problems.push(`${name}：只存在于 .claude/skills，缺少 .codex/skills/${name}`)
}

let sharedFileCount = 0
const shared = codexSkills.filter((skill) => claudeSkills.includes(skill))
for (const name of shared) {
  const codexDir = join(CODEX_ROOT, name)
  const claudeDir = join(CLAUDE_ROOT, name)
  const codexFiles = collectSharedFiles(codexDir)
  const claudeFiles = collectSharedFiles(claudeDir)

  const onlyCodex = codexFiles.filter((file) => !claudeFiles.includes(file))
  const onlyClaude = claudeFiles.filter((file) => !codexFiles.includes(file))
  if (onlyCodex.length > 0) problems.push(`${name}：只在 Codex 一侧的文件 ${onlyCodex.join(', ')}`)
  if (onlyClaude.length > 0) problems.push(`${name}：只在 Claude 一侧的文件 ${onlyClaude.join(', ')}`)

  for (const file of codexFiles.filter((item) => claudeFiles.includes(item))) {
    sharedFileCount += 1
    if (readNormalized(join(codexDir, file)) !== readNormalized(join(claudeDir, file))) {
      problems.push(`${name}：内容不一致 ${file}`)
    }
  }
}

if (problems.length > 0) {
  console.error('\n[check-skill-sync] Codex / Claude 两份 skill 不一致（修改任一侧后必须同步另一侧）：\n')
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('')
  process.exit(1)
}

console.log(
  `[check-skill-sync] 通过：${shared.length} 个 skill、${sharedFileCount} 个共享文件一致（${relative(ROOT, CODEX_ROOT)} ↔ ${relative(ROOT, CLAUDE_ROOT)}）`,
)
