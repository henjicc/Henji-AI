const { readFileSync, readdirSync } = require('node:fs')
const { join, relative } = require('node:path')

const ROOT = process.cwd()
const CODEX_DIR = join(ROOT, '.codex/skills/henji-model-adaptation')
const CLAUDE_DIR = join(ROOT, '.claude/skills/henji-model-adaptation')

function collectSharedFiles(directory) {
  const files = ['SKILL.md']
  const references = join(directory, 'references')

  for (const entry of readdirSync(references, { withFileTypes: true })) {
    if (!entry.isFile()) {
      throw new Error(`skill references 不应包含子目录: ${join(references, entry.name)}`)
    }
    files.push(join('references', entry.name))
  }

  return files.sort()
}

const codexFiles = collectSharedFiles(CODEX_DIR)
const claudeFiles = collectSharedFiles(CLAUDE_DIR)

if (JSON.stringify(codexFiles) !== JSON.stringify(claudeFiles)) {
  throw new Error(
    `Codex/Claude skill 文件清单不一致\nCodex: ${codexFiles.join(', ')}\nClaude: ${claudeFiles.join(', ')}`,
  )
}

const mismatches = codexFiles.filter((file) => {
  const codex = readFileSync(join(CODEX_DIR, file))
  const claude = readFileSync(join(CLAUDE_DIR, file))
  return !codex.equals(claude)
})

if (mismatches.length > 0) {
  throw new Error(`Codex/Claude skill 内容不一致: ${mismatches.join(', ')}`)
}

console.log(
  `henji-model-adaptation skill 已同步：${codexFiles.length} 个共享文件（${relative(ROOT, CODEX_DIR)} ↔ ${relative(ROOT, CLAUDE_DIR)}）`,
)
