const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '../resources/video-edit-author/vendor')
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
for (const [name, version] of [['pretext', '1.0.0'], ['harfbuzzjs', '1.6.4']]) {
  const directory = path.join(root, name, version)
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'source.json'), 'utf8'))
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-text-vendor-check-'))
  try {
    for (const [file, record] of Object.entries(manifest.files)) {
      const bytes = fs.readFileSync(path.join(directory, file))
      if (hash(bytes) !== record.sha256) throw new Error(`依赖字节摘要不符：${name}/${file}`)
      fs.mkdirSync(path.dirname(path.join(copy, file)), { recursive: true })
      fs.writeFileSync(path.join(copy, file), bytes)
    }
    for (const [file, expected] of Object.entries(manifest.localArtifacts)) {
      if (hash(fs.readFileSync(path.join(directory, file))) !== expected) throw new Error(`补丁/许可摘要不符：${name}/${file}`)
    }
    execFileSync('git', ['-c', 'core.autocrlf=false', 'apply', '--reverse', '--whitespace=nowarn', path.join(directory, 'henji.patch')], { cwd: copy, stdio: 'pipe' })
    for (const [file, record] of Object.entries(manifest.files)) {
      if (hash(fs.readFileSync(path.join(copy, file))) !== record.upstreamSha256) throw new Error(`补丁不能还原上游字节：${name}/${file}`)
    }
  } finally {
    // 只清理本命令在系统临时目录创建的独立目录，不涉及依赖联接点。
    if (path.dirname(copy) !== path.resolve(os.tmpdir()) || !path.basename(copy).startsWith('henji-text-vendor-check-')) throw new Error('临时目录不在预期范围')
    fs.rmSync(copy, { recursive: true, force: true })
  }
}
const pretext = path.join(root, 'pretext/1.0.0')
const visited = new Set()
function inspect(file) {
  if (visited.has(file)) return
  visited.add(file)
  const source = fs.readFileSync(path.join(pretext, file), 'utf8')
  if (/\b(?:document|OffscreenCanvas)\b|\.measureText\s*\(/.test(source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ''))) throw new Error(`生产规则可达 Canvas/DOM：${file}`)
  for (const match of source.matchAll(/\bfrom\s+['"](.+?)['"]/g)) inspect(path.posix.join(path.posix.dirname(file), match[1]))
}
for (const entry of ['analysis.js', 'line-break.js', 'han-kerning.js']) inspect(entry)
console.log(`固定依赖字节、许可、补丁反向还原、Pretext 无 Canvas 可达图通过（${visited.size} 模块）`)
