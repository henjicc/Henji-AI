/**
 * 组件样张页覆盖检查（任务 5.11）：`@/components/ui` 新增导出组件却没有上样张页时提醒。
 *
 * 从 `src/components/ui/index.ts` 出发，跟随 `export *` 与 `export { default as X }`，收集导出的组件
 * （首字母大写、第二个字母小写的 const / function / class，排除常量与类型），要求每个组件在
 * `src/features/devGallery/` 的样张源码里以 JSX（`<Name` 或 `<Name.Provider`）出现。
 * 确实不是可见组件的，登记到 NON_VISUAL 并写理由。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { GALLERY_CONTROL_SIZES, GALLERY_ICON_SIZES, GALLERY_SEGMENTED_SIZES, GALLERY_PARAMETER_SIZES, GALLERY_INDEX } from './galleryIndex'
import { UI_MODAL_SIZE_CLASS } from '@/components/ui/styleTokens'

const UI_DIR = path.resolve(__dirname, '../../components/ui')
const GALLERY_DIR = __dirname

/** 不在样张页以 JSX 出现的导出（必须写理由）。 */
const NON_VISUAL: Record<string, string> = {
  GlobalAlertDialog: '全局挂载在 App 根上、由 alertDialogStore 驱动；外观就是 AlertDialog，样张页以 AlertDialog 展示',
  ParamList: '领域字段描述驱动的组合容器（分组、更多折叠、条件显示），自身不画控件；可见部分是已上样张的参数原件（角度盘、色轮、曲线等）与 UiGroup',
  ParamField: '按字段类型分派到已上样张的参数原件，并接入领域手势适配器；没有独立外观',
  ParameterNumber: '参数手势适配器，自身不画新外观；数值外观唯一来自 NumberInput，尺寸阶梯展示正式 NumberInput',
  PromptSuggestionList: '提示词编辑器内部建议列表，依赖资源解析器，属于 PromptEditor 的子实现而非独立公共组件',
  MediaReferenceExtension: 'TipTap 扩展配置，不是 React 可见组件，媒体引用由 PromptEditor 渲染',
  TemplateVariableExtension: 'TipTap 扩展配置，不是 React 可见组件，模板变量由 PromptEditor 渲染',
  MediaReferenceNodeView: 'TipTap 内部节点视图，需要编辑器 NodeView 上下文，由 PromptEditor 的媒体引用宿主创建',
  TemplateVariableNodeView: 'TipTap 内部节点视图，需要编辑器 NodeView 上下文，由 PromptEditor 的模板变量宿主创建',
  PromptEditorResourceRegistry: '提示词资源解析服务类，不是 React 可见组件，媒体与变量解析由正式编辑器维护',
  UiFormRowLabelContext: '表单行内部标签关联上下文，没有独立视觉，样张使用 UiFormRow 驱动正式消费组件',
  UiPropertyMenuContext: '属性面板的面板级右键菜单上下文，没有独立视觉；菜单外观就是已上样张的 ContextMenu，属性行外观由样张里的 property 排布 UiFormRow 展示',
  UiBooleanAppearanceContext: '开关外观的区域上下文（停靠宿主提供复选框外观、弹窗重置回滑块），没有独立视觉；两种外观由样张里的 UiSwitch 展示',
  UiPrimaryActionContext: '主动作权限上下文，没有独立视觉；样张按钮的正式优先级规则由 UiToolbar 管理',
}


function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name)
    return entry.isDirectory() ? sourceFiles(file) : /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [file] : []
  })
}

function resolveModule(fromFile: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep) && path.extname(candidate)) return candidate
  }
  return null
}

const COMPONENT_NAME = /^[A-Z][a-z]/

function collectExportedComponents(file: string, seen = new Set<string>()): Set<string> {
  const names = new Set<string>()
  if (seen.has(file)) return names
  seen.add(file)
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(/^export (?:const|function|class) ([A-Za-z0-9_]+)/gm)) {
    if (COMPONENT_NAME.test(match[1])) names.add(match[1])
  }
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  for (const statement of ast.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
      const name = statement.name?.text ?? path.basename(file, '.tsx')
      if (COMPONENT_NAME.test(name)) names.add(name)
    }
    if (ts.isExportAssignment(statement)) {
      const name = ts.isIdentifier(statement.expression) ? statement.expression.text : path.basename(file, '.tsx')
      if (COMPONENT_NAME.test(name)) names.add(name)
    }
  }
  for (const match of source.matchAll(/^export \{([^}]*)\} from '([^']+)'/gm)) {
    if (/^\s*type\b/.test(match[1])) continue
    for (const part of match[1].split(',')) {
      const trimmed = part.trim()
      if (!trimmed || trimmed.startsWith('type ')) continue
      const exported = trimmed.split(/\s+as\s+/).pop() ?? ''
      if (COMPONENT_NAME.test(exported)) names.add(exported)
    }
  }
  for (const match of source.matchAll(/^export \* from '([^']+)'/gm)) {
    const target = resolveModule(file, match[1])
    if (target) collectExportedComponents(target, seen).forEach((name) => names.add(name))
  }
  return names
}

function gallerySource(): string {
  return readdirSync(GALLERY_DIR)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => readFileSync(path.join(GALLERY_DIR, name), 'utf8'))
    .join('\n')
}

describe('设计系统中心覆盖 ui/** 全部导出组件', () => {
  const exported = [...new Set(sourceFiles(UI_DIR).flatMap(file => [...collectExportedComponents(file)]))].sort()
  const source = gallerySource()

  it('深路径和 default export 同样进入门禁（防止空跑）', () => {
    expect(exported).toEqual(expect.arrayContaining(['UiButton', 'UiReadout', 'UiModal', 'Dropdown', 'PanelTrigger', 'UiToast', 'PromptEditor']))
    expect(exported.length).toBeGreaterThan(30)
    expect(exported).toEqual(expect.arrayContaining(['NumberInput', 'ProgressBar', 'Tooltip', 'TooltipContent', 'PriceEstimate', 'UiRecordList', 'UiRecordItem', 'UiViewerShell', 'FileUploader']))
  })

  it('每个导出组件都在样张页出现，或登记为非可见并写明理由', () => {
    const missing = [...exported, 'ContextMenu', 'WaveformView', 'AudioPlayer', 'TypographyPanel'].filter((name) => !NON_VISUAL[name] && !new RegExp(`<${name}[\\s.>/]`).test(source))
    expect(missing, `这些 @/components/ui 导出组件还没上组件样张页（src/features/devGallery/gallerySections.tsx 补一个样本，或在本测试 NON_VISUAL 写理由）：${missing.join('、')}`).toEqual([])
  })

  it('非可见登记没有过期', () => {
    const stale = Object.keys(NON_VISUAL).filter((name) => !exported.includes(name))
    expect(stale).toEqual([])
    for (const reason of Object.values(NON_VISUAL)) expect(reason.length).toBeGreaterThanOrEqual(8)
  })

  it('静态浮层不能只用点击后打开的样本冒充覆盖', () => {
    for (const name of ['UiModal', 'Tooltip', 'TooltipContent', 'ContextMenu']) {
      expect(source.includes(`data-gallery-static="${name}"`) || (name === 'UiModal' && source.includes('scope="container"'))).toBe(true)
    }
  })

  it('可见导出组件必须在主 skill 登记，不能只在截图附录出现', () => {
    const skillRoot = path.resolve(UI_DIR, '../../../.codex/skills/henji-ui-surface')
    const docs = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8')
    const missing = exported.filter(name => !NON_VISUAL[name] && !docs.includes(name))
    expect(missing, `未登记的共享组件：${missing.join('、')}`).toEqual([])
  })

  it('每个目录都有截图，并有滚动步骤覆盖超过首屏的内容', () => {
    const tour = JSON.parse(readFileSync(path.resolve(UI_DIR, '../../../scripts/ui-review/ui-gallery.json'), 'utf8')) as { steps: Array<{ click?: { selector?: string }; capture?: string; scroll?: unknown }> }
    for (const entry of GALLERY_INDEX) expect(tour.steps.some(step => step.click?.selector === `[data-gallery-nav="${entry.id}"]`), entry.id).toBe(true)
    expect(tour.steps.filter(step => step.capture).length).toBeGreaterThan(GALLERY_INDEX.length)
    expect(tour.steps.some(step => step.scroll)).toBe(true)
  })
})

/** TypeScript AST 读取字面量联合、别名、继承和 keyof typeof 令牌对象。 */
const ENUM_PROPS = new Set(['size', 'variant', 'tone', 'shape', 'appearance', 'surface', 'frame', 'density', 'labelWidth', 'gap', 'titleTone', 'gridCell', 'placement', 'trackTone', 'height', 'panelSize', 'contentPadding', 'contentScroll'])
const uiAsts = sourceFiles(UI_DIR).map(file => ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS))
const declarations = new Map<string, ts.TypeAliasDeclaration | ts.InterfaceDeclaration>()
const objects = new Map<string, ts.ObjectLiteralExpression>()
for (const file of uiAsts) for (const statement of file.statements) {
  if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) declarations.set(statement.name.text, statement)
  if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
    let initializer = declaration.initializer
    if (initializer && ts.isAsExpression(initializer)) initializer = initializer.expression
    if (ts.isIdentifier(declaration.name) && initializer && ts.isObjectLiteralExpression(initializer)) objects.set(declaration.name.text, initializer)
  }
}
function literals(node: ts.TypeNode, seen = new Set<string>()): string[] {
  if (ts.isLiteralTypeNode(node)) return ts.isStringLiteral(node.literal) || ts.isNumericLiteral(node.literal) ? [node.literal.text] : []
  if (ts.isUnionTypeNode(node)) return node.types.flatMap(type => literals(type, seen))
  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText()
    if (seen.has(name)) return []
    const definition = declarations.get(name)
    if (definition && ts.isTypeAliasDeclaration(definition)) return literals(definition.type, new Set([...seen, name]))
  }
  if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.KeyOfKeyword && ts.isTypeQueryNode(node.type)) {
    return objects.get(node.type.exprName.getText())?.properties.flatMap(property => property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)) ? [property.name.text] : []) ?? []
  }
  return []
}
function properties(node: ts.TypeNode | ts.InterfaceDeclaration, seen = new Set<string>()): Map<string, string[]> {
  const result = new Map<string, string[]>()
  const merge = (other: Map<string, string[]>): void => other.forEach((values, key) => result.set(key, [...new Set([...(result.get(key) ?? []), ...values])]))
  if (ts.isInterfaceDeclaration(node) || ts.isTypeLiteralNode(node)) {
    for (const member of node.members) if (ts.isPropertySignature(member) && member.type && member.name && ENUM_PROPS.has(member.name.getText())) {
      const values = literals(member.type)
      if (values.length) result.set(member.name.getText(), values)
    }
    if (ts.isInterfaceDeclaration(node)) for (const clause of node.heritageClauses ?? []) for (const type of clause.types) {
      const name = type.expression.getText(), declaration = declarations.get(name)
      if (declaration && !seen.has(name)) merge(properties(ts.isTypeAliasDeclaration(declaration) ? declaration.type : declaration, new Set([...seen, name])))
    }
  } else if (ts.isIntersectionTypeNode(node) || ts.isUnionTypeNode(node)) node.types.forEach(type => merge(properties(type, seen)))
  else if (ts.isParenthesizedTypeNode(node)) merge(properties(node.type, seen))
  else if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText(), declaration = declarations.get(name)
    if (declaration && !seen.has(name)) merge(properties(ts.isTypeAliasDeclaration(declaration) ? declaration.type : declaration, new Set([...seen, name])))
  }
  return result
}

const VARIANT_EXEMPT: Record<string, string> = {
  'UiOptionButton.variant.segment': '分段内部项只能由 UiSegmented 使用，禁止独立样本冒充分段；两个 UiSegmented 尺寸样本覆盖正式内部实现',
  'UiToast.placement.window': '视口顶部通知会覆盖其他样本；容器模式展示相同正式通知，窗口定位由 UiToast 精确测试验证',
  'Tooltip.placement.bottom': 'Tooltip 外包装只负责延迟，浮层定位唯一来自 TooltipContent；bottom/right 由位置精确测试覆盖，常驻样本展示 top/left',
  'Tooltip.placement.right': 'Tooltip 外包装只负责延迟，浮层定位唯一来自 TooltipContent；bottom/right 由位置精确测试覆盖，常驻样本展示 top/left',
  'TooltipContent.placement.bottom': '优先上下翻转与边界夹取由 tooltipPosition 精确测试验证，常驻 top/left 样本代表两种轴向',
  'TooltipContent.placement.right': '优先左右翻转与边界夹取由 tooltipPosition 精确测试验证，常驻 top/left 样本代表两种轴向',
  'UiTooltipText.placement.bottom': '标签说明只是 Tooltip 的组合包装，正式定位唯一来自 TooltipContent，常驻 top/left 样本代表两种轴向',
  'UiTooltipText.placement.right': '标签说明只是 Tooltip 的组合包装，正式定位唯一来自 TooltipContent，常驻 top/left 样本代表两种轴向',
}

describe('组件尺寸与变体枚举覆盖', () => {
  it('每个已导出组件的视觉枚举都有真实 JSX 样本或明确理由', () => {
    const samples = new Map<string, Set<string>>()
    const forwarded: Array<[string, string]> = []
    const dynamicSizes: Record<string, readonly string[]> = { GALLERY_CONTROL_SIZES, GALLERY_ICON_SIZES, GALLERY_SEGMENTED_SIZES, GALLERY_PARAMETER_SIZES, 'Object.keys(UI_MODAL_SIZE_CLASS)': Object.keys(UI_MODAL_SIZE_CLASS) }
    for (const file of sourceFiles(GALLERY_DIR).filter(file => file.endsWith('.tsx'))) {
      const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const arrays = new Map<string, ts.Expression>()
      const collectArrays = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) arrays.set(node.name.text, node.initializer)
        ts.forEachChild(node, collectArrays)
      }
      collectArrays(ast)
      const visit = (node: ts.Node): void => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) for (const attribute of node.attributes.properties) {
          if (!ts.isJsxAttribute(attribute) || !ts.isIdentifier(attribute.name) || !attribute.initializer || !ENUM_PROPS.has(attribute.name.text)) continue
          const key = `${node.tagName.getText()}.${attribute.name.text}`
          const values = samples.get(key) ?? new Set<string>()
          const initializer = attribute.initializer
          if (ts.isStringLiteral(initializer)) values.add(initializer.text)
          if (ts.isJsxExpression(initializer) && initializer.expression) {
            const expression = initializer.expression
            if (ts.isStringLiteral(expression) || ts.isNumericLiteral(expression)) values.add(expression.text)
            if (attribute.name.text === 'size' && /\bsize\b/.test(expression.getText())) {
              let parent: ts.Node | undefined = node.parent
              while (parent && !ts.isSourceFile(parent)) {
                if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression) && parent.expression.name.text === 'map') {
                  let receiver: ts.Expression = parent.expression.expression
                  while (ts.isParenthesizedExpression(receiver) || ts.isAsExpression(receiver)) receiver = receiver.expression
                  const sizes = dynamicSizes[receiver.getText()]
                  sizes?.forEach(size => values.add(size))
                }
                parent = parent.parent
              }
            }
            // 局部 as const 数组 map 的值也必须来自真实字面量，不接受任意变量占位。
            if (ts.isIdentifier(expression)) {
              let parent: ts.Node | undefined = node.parent
              while (parent && !ts.isSourceFile(parent)) {
                if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression) && parent.expression.name.text === 'map') {
                  let list: ts.Expression = parent.expression.expression
                  if (ts.isIdentifier(list) && arrays.has(list.text)) list = arrays.get(list.text)!
                  if (ts.isParenthesizedExpression(list)) list = list.expression
                  if (ts.isAsExpression(list)) list = list.expression
                  let tupleIndex = -1
                  const callback = parent.arguments[0]
                  if (callback && ts.isArrowFunction(callback) && callback.parameters[0] && ts.isArrayBindingPattern(callback.parameters[0].name)) {
                    tupleIndex = callback.parameters[0].name.elements.findIndex(element => ts.isBindingElement(element) && element.name.getText() === expression.text)
                  }
                  if (ts.isArrayLiteralExpression(list)) list.elements.forEach(value => {
                    if (ts.isArrayLiteralExpression(value) && tupleIndex >= 0) {
                      const entry = value.elements[tupleIndex]
                      if (entry && (ts.isStringLiteral(entry) || ts.isNumericLiteral(entry))) values.add(entry.text)
                    } else if (ts.isStringLiteral(value) || ts.isNumericLiteral(value)) values.add(value.text)
                  })
                }
                parent = parent.parent
              }
              parent = node.parent
              while (parent && !ts.isSourceFile(parent)) {
                if (ts.isFunctionDeclaration(parent) && parent.name) {
                  const parameter = parent.parameters[0]
                  if (parameter && ts.isObjectBindingPattern(parameter.name)) {
                    const binding = parameter.name.elements.find(element => element.name.getText() === expression.text)
                    if (binding) forwarded.push([key, `${parent.name.text}.${binding.propertyName?.getText() ?? expression.text}`])
                  }
                  break
                }
                parent = parent.parent
              }
            }
          }
          samples.set(key, values)
        }
        ts.forEachChild(node, visit)
      }
      visit(ast)
    }
    // 私有预览包装只透传 props；覆盖取自实际调用它的 JSX，不以类型声明冒充样本。
    forwarded.forEach(([destination, source]) => {
      const values = samples.get(destination) ?? new Set<string>()
      samples.get(source)?.forEach(value => values.add(value))
      samples.set(destination, values)
    })
    const missing: string[] = []
    const covered = new Set<string>()
    for (const [name, declaration] of declarations) {
      if (!name.endsWith('Props')) continue
      const component = name.slice(0, -5)
      if (NON_VISUAL[component] || !samples.has(`${component}.size`) && !gallerySource().includes(`<${component}`)) continue
      for (const [prop, values] of properties(ts.isTypeAliasDeclaration(declaration) ? declaration.type : declaration)) for (const value of values) {
        const id = `${component}.${prop}.${value}`
        covered.add(id)
        if (!samples.get(`${component}.${prop}`)?.has(value) && !VARIANT_EXEMPT[id]) missing.push(id)
      }
    }
    expect(covered.size).toBeGreaterThan(80)
    expect(missing, `缺少真实枚举样本：${missing.join('、')}`).toEqual([])
    for (const [id, reason] of Object.entries(VARIANT_EXEMPT)) { expect(covered.has(id), id).toBe(true); expect(reason.length).toBeGreaterThanOrEqual(8) }
  })
})
