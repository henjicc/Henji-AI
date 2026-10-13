import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

const root = path.resolve(__dirname, '../..')
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)])
}
const sources = files(root).filter(file => file.endsWith('.tsx') && !file.includes('.test.'))

it('按钮悬停说明统一通过 tooltip，避免原生气泡回归', () => {
  const violations: string[] = []
  for (const file of sources) {
    const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node: ts.Node): void => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && /^Ui(?:.*Button|WindowControl|FieldTrigger)$/.test(node.tagName.getText(ast))) {
        if (node.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(ast) === 'title')) violations.push(path.relative(root, file))
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  expect(violations).toEqual([])
})

it('业务加载反馈复用共享 spinner 和 skeleton', () => {
  const violations = sources.filter(file => !file.startsWith(path.join(root, 'components', 'ui') + path.sep) && /animate-(?:spin|pulse)/.test(readFileSync(file, 'utf8')))
  expect(violations.map(file => path.relative(root, file))).toEqual([])
})
