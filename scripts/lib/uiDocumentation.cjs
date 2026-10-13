const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function sourceFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(root, entry.name)
    return entry.isDirectory() ? sourceFiles(file) : /\.tsx?$/.test(file) && !/\.(?:test|spec)\./.test(file) ? [file] : []
  })
}
function resolveModule(file, specifier) {
  const base = path.resolve(path.dirname(file), specifier)
  return [base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')].find(candidate => fs.existsSync(candidate))
}
function exportedComponents(file, seen = new Set()) {
  if (seen.has(file)) return new Set()
  seen.add(file)
  const names = new Set()
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const add = name => { if (/^[A-Z][a-z]/.test(name || '')) names.add(name) }
  for (const statement of ast.statements) {
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const specifier of statement.exportClause.elements) if (!specifier.isTypeOnly) add(specifier.name.text)
      } else if (!statement.exportClause && statement.moduleSpecifier) {
        const target = resolveModule(file, statement.moduleSpecifier.text)
        if (!target) throw new Error(`无法解析 UI 导出：${file} -> ${statement.moduleSpecifier.text}`)
        exportedComponents(target, seen).forEach(add)
      }
    }
    if (!statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) add(statement.name?.text)
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) add(declaration.name.text)
  }
  return names
}
function catalogProblems(names, skill) {
  const table = skill.split('## 必须复用')[1]?.split('## Agent 改 UI')[0] || ''
  const registered = new Set(table.split('\n').filter(line => line.startsWith('|')).flatMap(line => line.match(/\b[A-Z][a-z]\w*\b/g) || []))
  return [...names].filter(name => !registered.has(name)).map(name => `复用表未登记 ${name}`)
}
function declaredSymbols(root) {
  const symbols = new Set()
  for (const file of sourceFiles(root)) {
    const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    function visit(node) {
      // 声明才算存在，避免过期 import/注释/文案自己证明自己。
      if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) && node.name && ts.isIdentifier(node.name)) symbols.add(node.name.text)
      if (ts.isExportSpecifier(node)) symbols.add(node.name.text)
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  return symbols
}
function symbolProblems(text, symbols) {
  const problems = []
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.includes('<!-- symbol-ignore -->')) return
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      for (const symbol of match[1].match(/\b(?:Ui[A-Z]\w*|UI_[A-Z0-9_]+_CLASS|use[A-Z]\w*)\b/g) || []) {
        if (!symbols.has(symbol)) problems.push(`第 ${index + 1} 行不存在符号 ${symbol}`)
      }
    }
  })
  return problems
}
module.exports = { sourceFiles, exportedComponents, catalogProblems, declaredSymbols, symbolProblems }
