#!/usr/bin/env node

const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const repoRoot = path.resolve(__dirname, '..')
const catalogRoot = path.join(repoRoot, 'packages', 'ai-sdk', 'src', 'catalog')
const baselinePath = path.join(repoRoot, 'scripts', 'model-id-baseline.json')

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text
  return undefined
}

function objectProperty(object, name) {
  return object.properties.find((property) =>
    ts.isPropertyAssignment(property) && propertyName(property.name) === name
  )
}

function literalString(node, context) {
  if (ts.isStringLiteral(node)) return node.text
  throw new Error(`${context} must be a string literal`)
}

function stringArray(node, context) {
  if (!node) return []
  if (!ts.isArrayLiteralExpression(node)) throw new Error(`${context} must be an array literal`)
  return node.elements.map((element) => literalString(element, context))
}

function unwrapExpression(node) {
  let current = node
  while (
    ts.isAsExpression(current)
    || ts.isParenthesizedExpression(current)
    || (typeof ts.isSatisfiesExpression === 'function' && ts.isSatisfiesExpression(current))
  ) {
    current = current.expression
  }
  return current
}

function parseModel(fileName, source) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let model
  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'defineModel'
      && node.arguments.length === 1
      && ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      model = node.arguments[0]
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  if (!model) throw new Error(`defineModel object not found: ${fileName}`)

  const metaProperty = objectProperty(model, 'meta')
  const paramsProperty = objectProperty(model, 'params')
  if (!metaProperty || !ts.isObjectLiteralExpression(metaProperty.initializer)) throw new Error(`meta missing: ${fileName}`)
  if (!paramsProperty || !ts.isArrayLiteralExpression(paramsProperty.initializer)) throw new Error(`params missing: ${fileName}`)

  const meta = metaProperty.initializer
  const idProperty = objectProperty(meta, 'id')
  const canonicalProperty = objectProperty(meta, 'canonicalModelId')
  const aliasesProperty = objectProperty(meta, 'aliases')
  if (!idProperty || !canonicalProperty) throw new Error(`model id fields missing: ${fileName}`)

  const params = paramsProperty.initializer.elements.map((element) => {
    const param = unwrapExpression(element)
    if (!ts.isObjectLiteralExpression(param)) throw new Error(`non-object param: ${fileName}`)
    const id = objectProperty(param, 'id')
    if (!id) throw new Error(`param id missing: ${fileName}`)
    return literalString(id.initializer, `${fileName} param id`)
  })

  return {
    id: literalString(idProperty.initializer, `${fileName} meta.id`),
    canonicalModelId: literalString(canonicalProperty.initializer, `${fileName} canonicalModelId`),
    aliases: stringArray(aliasesProperty?.initializer, `${fileName} aliases`),
    params,
  }
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(absolute)
    return entry.name.endsWith('.model.ts') ? [absolute] : []
  })
}

function currentCatalog() {
  return walk(catalogRoot).sort().map((absolute) =>
    parseModel(path.relative(repoRoot, absolute), fs.readFileSync(absolute, 'utf8'))
  ).sort((left, right) => left.id.localeCompare(right.id, 'en'))
}

function headBaseline() {
  const names = childProcess.execFileSync(
    'git',
    ['ls-tree', '-r', '--name-only', 'HEAD', 'src/models'],
    { cwd: repoRoot, encoding: 'utf8' },
  ).trim().split('\n').filter((name) => name.endsWith('.model.ts')).sort()
  return names.map((name) => parseModel(
    name,
    childProcess.execFileSync('git', ['show', `HEAD:${name}`], { cwd: repoRoot, encoding: 'utf8' }),
  )).sort((left, right) => left.id.localeCompare(right.id, 'en'))
}

if (process.argv.includes('--write-baseline-from-head')) {
  const baseline = headBaseline()
  if (baseline.length !== 99) throw new Error(`expected 99 HEAD models, got ${baseline.length}`)
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
  console.log(`[model-id-parity] wrote ${baseline.length} baseline models -> ${baselinePath}`)
  process.exit(0)
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
const current = currentCatalog()
if (JSON.stringify(current) !== JSON.stringify(baseline)) {
  const baselineById = new Map(baseline.map((model) => [model.id, model]))
  const currentById = new Map(current.map((model) => [model.id, model]))
  const ids = [...new Set([...baselineById.keys(), ...currentById.keys()])].sort()
  const differences = ids.filter((id) =>
    JSON.stringify(baselineById.get(id)) !== JSON.stringify(currentById.get(id))
  )
  console.error(`[model-id-parity] mismatch in ${differences.length} models:`)
  differences.forEach((id) => console.error(`- ${id}`))
  process.exit(1)
}

console.log(`[model-id-parity] passed: ${current.length} models, meta.id/canonicalModelId/aliases/params[].id unchanged`)
