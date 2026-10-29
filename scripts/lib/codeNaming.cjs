const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')

const BASELINE_FILE = 'scripts/dead-code-baseline.json'
const ALLOWLIST_FILE = 'scripts/check-dead-code.allowlist.json'
const NUMBERED_COMMENT = /(?:重要记录\s*\d+|实施方案\s*\d+(?:\.\d+)*|\bt\d{3,}\b)/i
const QUANTITY = /^(?:毫秒|秒|分钟|小时|帧|像素|厘米|毫米|米|倍|寸|px|次|个|路|条|张|组(?!合)|份|件|段|种|级|行|列|页|位|台|只(?!对|有|在|能|读|允许|需|要|会|是|剩|保留)|套|轮(?!询)|步|批|块|层|天|周|月|年|点|%)/i

function hasNumberedComment(text) {
  for (const match of text.matchAll(/(?:(?:任务|阶段)\s*[（(]?\s*\d+(?:\.\d+)*|记录\s*\d{3,})(?![\d.])/g)) {
    if (!QUANTITY.test(text.slice(match.index + match[0].length).replace(/^[）)]?\s*/, ''))) return true
  }
  if (NUMBERED_COMMENT.test(text)) return true
  // 裸阶段号需要说明文字作上下文，避免把版本、尺寸和计量数值当成任务记录。
  const prose = text.replace(/[（(]?\s*\d+(?:\.\d+)*\s*(?:毫秒|秒|帧|像素|厘米|毫米|米|倍|寸|px)[）)]?/gi, '#')
    .replace(/\d+(?:\.\d+)*(?![\d.])\s*[\p{Script=Han}%]+/gu, value => QUANTITY.test(value.replace(/^\d+(?:\.\d+)*\s*/, '')) ? '#' : value)
    .replace(/(?:版本(?:号)?|\bversion)\s*[（(]?\s*v?\d+(?:\.\d+)*[）)]?/gi, '#')
    .replace(/(?:尺寸|分辨率|时长|宽度|高度|比例|倍率|小于|大于|低于|高于|不超过|至少|至多|帧率|采样率|阈值|音量|透明度|系数|指数|增益|伽马)\s*([（(]?)\s*\d+(?:\.\d+)*/g,
      (value, opening, offset, source) => opening && !/^\s*[）)]/.test(source.slice(offset + value.length)) ? value : '#')
    .replace(/\b[A-Za-z][\w.-]*\s+\d+\.\d+(?:\.\d+)*/g, '#')
    .replace(/\b[A-Za-z][\w.-]*[（(]\s*\d+\.\d+(?:\.\d+)*/g,
      (value, offset, source) => /^\s*(?:起|之前|之后|已经|[）)])/.test(source.slice(offset + value.length)) ? '#' : value)
    .replace(/\bv\d+(?:\.\d+)+\b|\b\d+\.\d+\.\d+\b/gi, '#')
    .replace(/[（(]\s*\d+\.\d+\s*(?:以下|以上|默认|环绕|伽马|上限|下限|阈值)[^）)\n]*[）)]/g, '#')
    .replace(/\d+\.\d+\s*(?:已经)?(?:是|为)?(?:上限|下限|默认|阈值|极限)/g, '#')
  return /(?<![\w.])\d+\.\d+\s*第\s*\d+\s*项/u.test(prose)
    || /[（(]\s*\d+\.\d+\s*[\p{Script=Han}]+[^）)\n]*[）)]/u.test(prose)
    || /[\p{Script=Han}][（(]\s*\d+\.\d+\s*[）)]/u.test(prose)
    || /(?<![\w.])\d+\.\d+\s*(?:起|之前|之后|已经|阶段)/u.test(prose)
}

function nameTokens(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').split(/[^a-zA-Z0-9]+/).filter(Boolean)
}

function hasIterationName(name, peers = []) {
  const tokens = nameTokens(name.replace(/\.[cm]?[jt]sx?$/, '')).map(token => token.toLowerCase())
  if (tokens.some(token => /^(?:v\d+|legacy|old)$/.test(token)) || tokens.at(-1) === 'new') return true
  const counterpart = tokens.map(token => token === 'new' ? 'old' : token).join(':')
  return tokens.includes('new') && peers.some(peer => nameTokens(peer).map(token => token.toLowerCase()).join(':') === counterpart)
}

function fingerprintComment(text) {
  // 缩进与行尾不承担注释含义，移动代码不应消耗新的存量额度。
  const normalized = text.replace(/\r\n/g, '\n').split('\n').map(line => line.trim()).join('\n')
  return createHash('sha256').update(normalized).digest('hex')
}

function inspectSource(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const names = new Set(), comments = new Map(), imports = [], registrations = [], literalRanges = []
  function binding(name) {
    if (ts.isIdentifier(name)) names.add(name.text)
    else for (const element of name.elements) if (element.name) binding(element.name)
  }
  function comment(range) {
    if (comments.has(range.pos)) return
    const value = text.slice(range.pos, range.end)
    comments.set(range.pos, { text: value, fingerprint: fingerprintComment(value), line: source.getLineAndCharacterOfPosition(range.pos).line + 1 })
  }
  function visit(node) {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return
    if (ts.isStringLiteralLike(node) || [ts.SyntaxKind.RegularExpressionLiteral, ts.SyntaxKind.TemplateHead,
      ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail, ts.SyntaxKind.JsxText].includes(node.kind)) literalRanges.push([node.getStart(source), node.end])
    if (node.kind !== ts.SyntaxKind.SyntaxList && node.kind !== ts.SyntaxKind.JsxText) {
      for (const range of ts.getLeadingCommentRanges(text, node.pos) ?? []) comment(range)
      for (const range of ts.getTrailingCommentRanges(text, node.end) ?? []) comment(range)
    }
    if (node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      if (node.name && ts.isIdentifier(node.name)) names.add(node.name.text)
      if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) binding(declaration.name)
    }
    if (ts.isExportDeclaration(node) && node.exportClause) {
      if (ts.isNamedExports(node.exportClause)) for (const element of node.exportClause.elements) names.add(element.name.text)
      else if (node.exportClause.name) names.add(node.exportClause.name.text)
    }
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text)
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = node.left.getText(source)
      if (/^(?:module\.)?exports\.[\w$]+$/.test(left)) names.add(left.slice(left.lastIndexOf('.') + 1))
      if (left === 'module.exports' && ts.isObjectLiteralExpression(node.right)) for (const property of node.right.properties) {
        if (property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) names.add(property.name.text)
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      const call = node.initializer
      if (ts.isIdentifier(call.expression) && call.expression.text === 'defineModel' && call.arguments[0] && ts.isObjectLiteralExpression(call.arguments[0])) {
        const meta = call.arguments[0].properties.find(property => property.name?.getText(source) === 'meta')
        const id = meta && ts.isPropertyAssignment(meta) && ts.isObjectLiteralExpression(meta.initializer)
          ? meta.initializer.properties.find(property => property.name?.getText(source) === 'id') : null
        if (id && ts.isPropertyAssignment(id) && ts.isStringLiteral(id.initializer)) registrations.push({ name: node.name.text, id: id.initializer.text })
      }
      if (ts.isIdentifier(call.expression) && call.expression.text === 'definePreset' && call.arguments[0] && ts.isStringLiteral(call.arguments[0])) registrations.push({ name: node.name.text, id: call.arguments[0].text })
    }
    // 闭括号 token 的前导 trivia 包含空块和 JSX 表达式里的注释。
    for (const child of node.getChildren(source)) visit(child)
  }
  visit(source)
  const realComments = [...comments].filter(([position]) => !literalRanges.some(([start, end]) => position >= start && position < end)).map(([, value]) => value)
  return { file, names: [...names], comments: realComments, imports, registrations }
}

function sourceFiles(root) {
  return [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true }).split('\0'))]
    .filter(file => /^(?:src|electron|packages|scripts|tests)\//.test(file) && /\.[cm]?[jt]sx?$/.test(file)
      && !/(?:^|\/)(?:node_modules|dist|out|vendor|generated)\//.test(file) && fs.existsSync(path.join(root, file))).sort()
}

function productExceptions(facts, readText) {
  const keys = new Set(), models = new Map()
  const allow = (file, name) => keys.add(`${file}:${name}`)
  const matchesProduct = (name, id) => {
    const tokens = nameTokens(name)
    return !tokens.some(token => /^(?:legacy|old|new)$/i.test(token))
      && tokens.filter(token => /^v\d+$/i.test(token)).every(token => id.replace(/[^a-z0-9]/gi, '').toLowerCase().includes(token.toLowerCase()))
  }
  for (const fact of facts) {
    if (!/^packages\/ai-sdk\/src\/(?:catalog\/.*\.model\.ts|capabilities\/speech-recognition\/.*\/presets\.ts)$/.test(fact.file)) continue
    for (const registration of fact.registrations) {
      if (matchesProduct(registration.name, registration.id)) allow(fact.file, registration.name)
      if (fact.file.endsWith('.model.ts')) {
        if (matchesProduct(path.posix.basename(fact.file), registration.id)) allow(fact.file, path.posix.basename(fact.file))
        models.set(fact.file, { name: fact.file.slice('packages/ai-sdk/src/catalog/'.length).replace(/\.model\.ts$/, ''), id: registration.id })
      }
    }
  }
  for (const fact of facts) {
    for (const specifier of fact.imports.filter(value => value.startsWith('.'))) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(fact.file), `${specifier}.ts`))
      const model = models.get(target)
      if (!model) continue
      const base = path.posix.basename(fact.file)
      if (matchesProduct(base, model.id) && (fact.file === `packages/ai-sdk/src/packs/models/${model.name}.ts`
        || base === `${model.name.replaceAll('/', '-')}.test.ts` || base === `${path.posix.basename(model.name)}.test.ts`)) allow(fact.file, base)
    }
  }
  // 产品常量与正式 LLM 目录的产品版本前缀相符才放行，不维护第二份模型名称清单。
  const catalogFile = 'packages/ai-sdk/src/llm/modelCatalogEntries.ts'
  const catalog = facts.find(fact => fact.file === catalogFile)
  if (catalog) {
    const ids = []
    const source = ts.createSourceFile(catalogFile, readText(catalogFile), ts.ScriptTarget.Latest, true)
    const strings = node => { if (ts.isStringLiteral(node)) ids.push(node.text.replace(/[^a-z0-9]/gi, '').toLowerCase()); ts.forEachChild(node, strings) }
    strings(source)
    for (const fact of facts.filter(item => /^(?:packages\/ai-sdk\/src|src\/core)\/llm\/defaults\.ts$/.test(item.file))) {
      for (const name of fact.names) {
        const tokens = nameTokens(name), version = tokens.findIndex(token => /^v\d+$/i.test(token))
        if (version > 0 && tokens.filter(token => /^v\d+$/i.test(token)).length === 1
          && !tokens.some(token => /^(?:legacy|old|new)$/i.test(token))
          && ids.some(id => id.startsWith(tokens.slice(0, version + 1).join('').toLowerCase()))) allow(fact.file, name)
      }
    }
  }
  return keys
}

function scanNamingFacts(facts, allowlist, read) {
  if (allowlist.version !== 1 || !Array.isArray(allowlist.entries)) throw new Error('命名白名单格式错误')
  const allowed = new Set()
  for (const entry of allowlist.entries) {
    if (!['format', 'interface', 'migration', 'codec', 'model-file'].includes(entry.category)
      || typeof entry.file !== 'string' || !entry.file || typeof entry.name !== 'string' || !entry.name
      || typeof entry.reason !== 'string' || !entry.reason.trim() || /[*?]/.test(entry.file)) throw new Error('命名白名单须登记类别、精确路径、名称与原因')
    const key = `${entry.file}:${entry.name}`
    if (allowed.has(key)) throw new Error(`重复命名白名单：${key}`)
    allowed.add(key)
  }
  const products = productExceptions(facts, read)
  const result = { directories: [], files: [], exports: [], comments: [] }
  const matchedEntries = new Set()
  const directories = new Set(facts.flatMap(fact => {
    const parts = fact.file.split('/').slice(0, -1)
    return parts.map((_, index) => parts.slice(0, index + 1).join('/'))
  }))
  const siblingGroups = candidates => {
    const groups = new Map()
    for (const file of candidates) {
      const directory = path.posix.dirname(file)
      if (!groups.has(directory)) groups.set(directory, [])
      groups.get(directory).push(path.posix.basename(file).replace(/\.[cm]?[jt]sx?$/, ''))
    }
    return groups
  }
  const directoryPeers = siblingGroups(directories), filePeers = siblingGroups(facts.map(fact => fact.file))
  const isAllowed = (file, name) => {
    const key = `${file}:${name}`
    if (allowed.has(key)) matchedEntries.add(key)
    const matched = allowed.has(key) || products.has(key)
    if (matched) exempt++
    return matched
  }
  let exempt = 0
  for (const directory of [...directories].sort()) {
    if (hasIterationName(path.posix.basename(directory), directoryPeers.get(path.posix.dirname(directory))) && !isAllowed(directory, path.posix.basename(directory))) result.directories.push(directory)
  }
  for (const fact of facts) {
    const base = path.posix.basename(fact.file)
    if (hasIterationName(base, filePeers.get(path.posix.dirname(fact.file))) && !isAllowed(fact.file, base)) result.files.push(fact.file)
    for (const name of fact.names.sort()) if (hasIterationName(name, fact.names) && !isAllowed(fact.file, name)) result.exports.push({ file: fact.file, name })
    const counts = new Map()
    for (const comment of fact.comments.filter(item => hasNumberedComment(item.text))) {
      const existing = counts.get(comment.fingerprint)
      if (existing) existing.count++
      else counts.set(comment.fingerprint, { file: fact.file, fingerprint: comment.fingerprint, count: 1 })
    }
    result.comments.push(...[...counts.values()].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)))
  }
  for (const key of allowed) if (!matchedEntries.has(key)) throw new Error(`过期命名白名单，文件或名称不存在或已不命中，须删除：${key}`)
  return { naming: result, exempt, sourceCount: facts.length }
}

function scanNaming(root, allowlist) {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8')
  return scanNamingFacts(sourceFiles(root).map(file => inspectSource(file, read(file))), allowlist, read)
}

function namingEntries(naming) {
  if (!naming || !Array.isArray(naming.files) || !Array.isArray(naming.exports) || !Array.isArray(naming.comments)) throw new Error('命名基线缺失或格式错误')
  const entries = new Map()
  const add = (key, count) => {
    if (!Number.isSafeInteger(count) || count < 1 || entries.has(key)) throw new Error(`命名基线条目无效或重复：${key}`)
    entries.set(key, count)
  }
  for (const directory of naming.directories ?? []) { if (typeof directory !== 'string') throw new Error('命名基线目录无效'); add(`directory:${directory}`, 1) }
  for (const file of naming.files) { if (typeof file !== 'string') throw new Error('命名基线路径无效'); add(`file:${file}`, 1) }
  for (const item of naming.exports) { if (typeof item.file !== 'string' || typeof item.name !== 'string') throw new Error('命名基线导出无效'); add(`export:${item.file}:${item.name}`, 1) }
  for (const item of naming.comments) { if (typeof item.file !== 'string' || !/^[a-f0-9]{64}$/.test(item.fingerprint)) throw new Error('命名基线注释指纹无效'); add(`comment:${item.file}:${item.fingerprint}`, item.count) }
  return entries
}

function compareNaming(current, baseline, protectedNaming, prune = false) {
  const actual = namingEntries(current), registered = namingEntries(baseline), errors = []
  for (const [key, count] of actual) if (count > (registered.get(key) ?? 0)) errors.push(`新增命名残留：${key}`)
  if (!prune) for (const [key, count] of registered) if (count > (actual.get(key) ?? 0)) errors.push(`过期命名基线，须删除或减数量：${key}`)
  const protectedEntries = protectedNaming && namingEntries(protectedNaming)
  if (protectedEntries) for (const [key, count] of registered) if (count > (protectedEntries.get(key) ?? 0)) errors.push(`命名基线只许减少：${key}`)
  return errors
}

function readProtectedJson(root, file, ref) {
  const exists = execFileSync('git', ['ls-tree', '--name-only', ref, '--', file], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
  return exists ? JSON.parse(execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true })) : undefined
}

function readProtectedNaming(root, ref = process.env.HENJI_CODE_NAMING_BASE_REF || 'HEAD') {
  // 首次引入门禁的提交没有 naming 节，之后始终以不可变的比较提交冻结存量。
  return readProtectedJson(root, BASELINE_FILE, ref)?.naming
}

function protectAllowlist(allowlist, protectedNaming) {
  if (!protectedNaming) return []
  namingEntries(protectedNaming)
  const names = [...protectedNaming.exports.map(entry => entry.name), ...protectedNaming.files.map(file => path.posix.basename(file)),
    ...(protectedNaming.directories ?? []).map(file => path.posix.basename(file))]
  // 路径移动和版本改名不能把同一存量实现变成永久例外。
  const stem = name => nameTokens(path.posix.basename(name).replace(/\.[cm]?[jt]sx?$/, ''))
    .filter(token => !/^(?:v\d+|\d+)$/i.test(token)).join('').toLowerCase()
  const exact = new Set(names), stems = new Set(names.map(stem))
  return allowlist.entries.filter(({ name }) => exact.has(name) || (stem(name) && stems.has(stem(name))))
    .map(({ file, name }) => `存量基线不得转入白名单：${file}:${name}`)
}

function allowlistAdditions(allowlist, previous) {
  const key = ({ category, file, name, reason }) => JSON.stringify({ category, file, name, reason })
  const known = new Set((previous?.entries ?? []).map(key))
  return allowlist.entries.filter(entry => !known.has(key(entry)))
}

function formatAllowlistAdditions(entries) {
  return entries.map(entry => `新增命名白名单：${JSON.stringify(entry)}`)
}

function checkNaming(root, { write = false, initialize } = {}) {
  const filename = path.join(root, BASELINE_FILE)
  const baseline = JSON.parse(fs.readFileSync(filename, 'utf8'))
  const protectedNaming = readProtectedNaming(root)
  if (initialize && (baseline.naming || protectedNaming || !initialize.trim())) throw new Error('命名基线只允许首次初始化，必须提供理由，已有基线不得覆盖')
  const allowlist = JSON.parse(fs.readFileSync(path.join(root, ALLOWLIST_FILE), 'utf8'))
  const added = allowlistAdditions(allowlist, readProtectedJson(root, ALLOWLIST_FILE, process.env.HENJI_CODE_NAMING_BASE_REF || 'HEAD'))
  const result = scanNaming(root, allowlist)
  const errors = [...protectAllowlist({ entries: added }, protectedNaming), ...(initialize ? [] : compareNaming(result.naming, baseline.naming, protectedNaming, write))]
  if ((write || initialize) && !errors.length) {
    baseline.naming = { ...result.naming, initialization: baseline.naming?.initialization ?? {
      reason: initialize, command: 'node scripts/check-dead-code.cjs --initialize-naming <理由>',
    } }
    fs.writeFileSync(filename, `${JSON.stringify(baseline, null, 2)}\n`)
  }
  return { ...result, errors, messages: formatAllowlistAdditions(added) }
}

module.exports = { hasIterationName, hasNumberedComment, fingerprintComment, inspectSource, productExceptions, scanNamingFacts, scanNaming, namingEntries, compareNaming, checkNaming, readProtectedNaming, protectAllowlist, allowlistAdditions, formatAllowlistAdditions }
