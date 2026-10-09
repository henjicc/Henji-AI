import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { listApplicationSurfaces } from '@/features/navigation/application/surfaceCatalog'
import { mergeToolboxRecentFiles } from '@/features/toolbox/toolboxRecentFiles'
import { TOOLBOX_APPLICATION_CAPABILITIES } from '@/core/application-control/domains/toolbox/toolboxApplicationCapabilities'

function source(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(path.resolve(file), 'utf8'), ts.ScriptTarget.Latest, true)
}

function findNode<T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T): T {
  let found: T | undefined
  function visit(node: ts.Node): void {
    if (predicate(node)) found = node
    else ts.forEachChild(node, visit)
  }
  visit(root)
  if (!found) throw new Error('未找到登记源 AST，必须更新真实来源读取方式')
  return found
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort()
}

describe('工具箱工具同源登记集合', () => {
  it('类型、实际渲染分支、Surface、最近文件和能力输入/输出 schema 两两相等', () => {
    const type = findNode(source('src/core/types/workspace.ts'),
      (node): node is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(node) && node.name.text === 'ToolboxToolId')
    if (!ts.isUnionTypeNode(type.type)) throw new Error('ToolboxToolId 应读取其真实类型来源')
    const typeIds = type.type.types.map((node) => {
      if (!ts.isLiteralTypeNode(node) || !ts.isStringLiteral(node.literal)) throw new Error('工具 ID 不是字符串类型')
      return node.literal.text
    })
    const renderer = findNode(source('src/workspaces/ToolboxWorkspace.tsx'),
      (node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'renderTool')
    const branches = findNode(renderer, ts.isSwitchStatement)
    const renderIds = branches.caseBlock.clauses.flatMap((clause) => {
      if (!ts.isCaseClause(clause) || !ts.isStringLiteral(clause.expression)) return []
      expect(clause.statements.some((statement) => ts.isReturnStatement(statement) && statement.expression)).toBe(true)
      return [clause.expression.text]
    })
    const select = TOOLBOX_APPLICATION_CAPABILITIES.find((entry) => entry.id === 'select_toolbox_tool')
    if (!select) throw new Error('缺少 select_toolbox_tool 登记')
    // 用现有类型来源探测封闭 schema；再读运行时 enum 的所有 options，发现多登记的工具。
    const enumIds = (schema: typeof select.inputSchema, field: string): string[] => {
      const object = schema as unknown as { shape: Record<string, { unwrap: () => { options: string[] } }> }
      return object.shape[field].unwrap().options
    }
    for (const toolId of typeIds) expect(select.inputSchema.safeParse({ toolId }).success).toBe(true)
    const document = [{ id: 'registration-probe', name: '登记探测', updatedAt: 1 }]
    const sets = {
      type: sorted(typeIds),
      render: sorted(renderIds),
      surfaces: sorted(listApplicationSurfaces().flatMap((surface) => surface.toolId ? [surface.toolId] : [])),
      recent: sorted(mergeToolboxRecentFiles(document, document, Number.POSITIVE_INFINITY, document).map((entry) => entry.toolId)),
      inputSchema: sorted(enumIds(select.inputSchema, 'toolId')),
      outputSchema: sorted(enumIds(select.outputSchema, 'toolId')),
    }
    const entries = Object.entries(sets)
    expect(typeIds.length).toBeGreaterThan(0)
    for (let index = 0; index < entries.length; index += 1) {
      for (const [name, values] of entries.slice(index + 1)) {
        expect(entries[index][1], `${entries[index][0]} 与 ${name} 登记漂移`).toEqual(values)
      }
    }
  })
})
