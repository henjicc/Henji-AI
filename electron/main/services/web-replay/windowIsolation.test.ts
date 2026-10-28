import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

function inspectWindows(code: string): Array<Record<string, string>> {
  const source = ts.createSourceFile('window.ts', code, ts.ScriptTarget.Latest, true)
  const bindings = new Map<string, ts.Expression>()
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) bindings.set(node.name.text, node.initializer)
    ts.forEachChild(node, collect)
  }
  collect(source)
  const objectFields = (expression: ts.Expression | undefined, seen = new Set<string>()): Map<string, ts.Expression> => {
    if (!expression) throw new Error('窗口配置缺少显式对象')
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) return objectFields(expression.expression, seen)
    if (ts.isIdentifier(expression)) {
      if (seen.has(expression.text)) throw new Error('窗口配置存在循环引用')
      if (!bindings.has(expression.text)) return new Map([['*', expression]])
      return objectFields(bindings.get(expression.text), new Set([...seen, expression.text]))
    }
    if (!ts.isObjectLiteralExpression(expression)) return new Map([['*', expression]])
    const result = new Map<string, ts.Expression>()
    for (const field of expression.properties) {
      if (ts.isSpreadAssignment(field)) {
        const spread = objectFields(field.expression, seen)
        // 未知展开可能覆盖所有前置字段；后面的显式配置仍可重新确定安全值。
        if (spread.has('*')) result.clear()
        for (const [key, value] of spread) result.set(key, value)
      } else if (ts.isPropertyAssignment(field) || ts.isShorthandPropertyAssignment(field)) {
        if (ts.isComputedPropertyName(field.name)) throw new Error('窗口配置含动态字段名')
        result.set(field.name.text, ts.isPropertyAssignment(field) ? field.initializer : field.name)
      }
    }
    return result
  }
  const preferences: Array<Record<string, string>> = []
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node)) {
      const constructor = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : node.expression.getText(source)
      if (['BrowserWindow', 'BrowserView', 'WebContentsView'].includes(constructor)) {
        const options = objectFields(node.arguments?.[0])
        const fields = objectFields(options.get('webPreferences'))
        preferences.push(Object.fromEntries([...fields].map(([key, value]) => [key, value.getText(source)])))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return preferences
}

const isolation = { contextIsolation: 'true', sandbox: 'true', nodeIntegration: 'false' }

it('所有窗口的最终 webPreferences 都保持 Electron 三项隔离底线', () => {
  let checked = 0
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) { walk(file); continue }
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue
      for (const preferences of inspectWindows(fs.readFileSync(file, 'utf8'))) {
        expect(preferences, file).toMatchObject(isolation)
        checked++
      }
    }
  }
  walk(path.resolve('electron/main'))
  expect(checked).toBeGreaterThan(0)
})

it('识别命名空间构造和展开覆盖的最终值', () => {
  const code = `const safe = { contextIsolation: true, sandbox: true, nodeIntegration: false };
    const options = { webPreferences: safe };
    new electron.BrowserWindow({ ...options });
    new electron.WebContentsView({ ...options, webPreferences: { ...safe, sandbox: false } });
    new BrowserWindow({ webPreferences: { sandbox: false, ...safe } });`
  const [safe, unsafe, restored] = inspectWindows(code)
  expect(safe).toMatchObject(isolation)
  expect(unsafe).not.toMatchObject(isolation)
  expect(unsafe.sandbox).toBe('false')
  expect(restored).toMatchObject(isolation)
})

it('拒绝无法解析的展开和缺少配置的命名空间窗口', () => {
  expect(() => inspectWindows('new electron.BrowserWindow({})')).toThrow()
  expect(() => inspectWindows('new BrowserWindow({ ...dynamicOptions })')).toThrow()
  expect(inspectWindows('new BrowserWindow({ webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, ...dynamicPreferences } })')[0]).not.toMatchObject(isolation)
})
