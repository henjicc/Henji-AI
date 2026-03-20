const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', 'src-tauri', 'src')
const RS_EXT = '.rs'
const FORBIDDEN = /\b(?:println|eprintln)!\s*\(/g

function walk(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const next = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(next, files)
      continue
    }

    if (entry.isFile() && entry.name.endsWith(RS_EXT)) {
      files.push(next)
    }
  }
  return files
}

const violations = []
for (const filePath of walk(ROOT)) {
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/)
  lines.forEach((line, index) => {
    if (FORBIDDEN.test(line)) {
      violations.push(`${path.relative(path.resolve(__dirname, '..'), filePath)}:${index + 1}: ${line.trim()}`)
    }
    FORBIDDEN.lastIndex = 0
  })
}

if (violations.length > 0) {
  console.error('[check-rust-logging] 禁止使用 println!/eprintln!，请改用 tracing 宏。')
  console.error(violations.join('\n'))
  process.exit(1)
}

console.log('[check-rust-logging] 通过：未检测到 println!/eprintln!。')
