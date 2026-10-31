import ts from 'typescript'

export interface CodeTrackSuggestion { file: string; line: number; layerId: string; name: string; reason: string }
const propertyName = (node: ts.ObjectLiteralElementLike): string | undefined => node.name && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) ? node.name.text : undefined
const member = (node: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined => node.properties.find(value => propertyName(value) === name)
const literal = (node: ts.Node | undefined): string | number | undefined => node && ts.isStringLiteralLike(node) ? node.text : node && ts.isNumericLiteral(node) ? Number(node.text) : undefined
const value = (node: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined => { const property = member(node, name); return property && ts.isPropertyAssignment(property) ? property.initializer : undefined }

/** 邻层也可能通过 destination-out 等操作依赖此层；不明调用不能证明可拆。 */
function independentComposite(layer: ts.Expression): boolean {
  if (!ts.isObjectLiteralExpression(layer) || layer.properties.some(property => !['id', 'name', 'bounds', 'draw', 'pose', 'motionBlur'].includes(propertyName(property) ?? ''))) return false
  const draw = member(layer, 'draw')
  if (!draw || !ts.isMethodDeclaration(draw) || !draw.body || !draw.parameters[0] || !ts.isIdentifier(draw.parameters[0].name)) return false
  const context = draw.parameters[0].name.text
  const calls = new Set(['fillRect', 'strokeRect', 'fillText', 'strokeText', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'rect', 'roundRect', 'arc', 'ellipse', 'bezierCurveTo', 'quadraticCurveTo', 'fill', 'stroke', 'translate', 'scale', 'rotate', 'transform', 'setTransform', 'resetTransform', 'setLineDash'])
  const styles = new Set(['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'miterLimit', 'lineDashOffset', 'font', 'textAlign', 'textBaseline', 'globalAlpha'])
  let safe = true
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) || ts.isFunctionLike(node)) safe = false
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const target = node.left
      if (!ts.isPropertyAccessExpression(target) || !ts.isIdentifier(target.expression) || target.expression.text !== context || !styles.has(target.name.text) && target.name.text !== 'globalCompositeOperation') safe = false
    }
    if (ts.isCallExpression(node)) {
      const target = node.expression
      if (!ts.isPropertyAccessExpression(target) || !ts.isIdentifier(target.expression)
        || !(target.expression.text === context && calls.has(target.name.text) || target.expression.text === 'Math' && ['sin', 'cos', 'min', 'max', 'abs', 'round', 'floor', 'ceil'].includes(target.name.text))) safe = false
    }
    if (ts.isIdentifier(node) && node.text === context && !(ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node)) safe = false
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === context) {
      if (node.name.text === 'globalCompositeOperation') {
        const assignment = node.parent
        if (!ts.isBinaryExpression(assignment) || assignment.left !== node || assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken || literal(assignment.right) !== 'source-over') safe = false
      } else if (!calls.has(node.name.text) && !styles.has(node.name.text)) safe = false
    }
    ts.forEachChild(node, visit)
  }
  // 不尝试证明分支、循环或 save/restore 的平衡，避免作者状态溢出到相邻层。
  if (draw.body.statements.some(statement => !ts.isExpressionStatement(statement))) return false
  visit(draw.body)
  return safe
}

/** 只证明无外部依赖的字面量静态层；任意辅助函数、时间、父组或合成状态都留给作者判断。 */
export function reviewCodeTrackSeparation(source: ts.SourceFile, size?: { width: number; height: number }, skipped?: (reason: string) => void): CodeTrackSuggestion[] {
  const skip = (reason: string): CodeTrackSuggestion[] => { skipped?.(reason); return [] }
  const exported = source.statements.find(ts.isExportAssignment)
  if (!exported || !ts.isObjectLiteralExpression(exported.expression)) return skip('入口不是直接导出的字面量')
  const root = exported.expression, width = literal(value(root, 'width')), height = literal(value(root, 'height'))
  if (root.properties.some(property => !propertyName(property)) || new Set(root.properties.map(propertyName)).size !== root.properties.length || literal(value(root, 'kind')) === 'filter') return skip('滤镜或不明入口属性')
  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0 || member(root, 'draw') || member(root, 'createWebGPU') || member(root, 'createWebGL')) return skip('缺少固定画幅或使用整体绘制入口')
  if (size && (width !== size.width || height !== size.height)) return skip('代码画幅与所在序列尺寸或比例不一致')
  const layers = member(root, 'layers')
  if (!layers || !ts.isMethodDeclaration(layers) || !layers.body || layers.body.statements.length !== 1) return skip('图层由辅助函数、工厂或布局逻辑构建')
  const returned = layers.body.statements[0]
  if (!ts.isReturnStatement(returned) || !returned.expression || !ts.isArrayLiteralExpression(returned.expression) || returned.expression.elements.length < 2) return skip('没有可独立判断的字面量多图层')
  if (!returned.expression.elements.every(independentComposite)) return skip('图层组包含未知调用、父组或共享合成状态')
  const suggestions: CodeTrackSuggestion[] = []
  for (const layer of returned.expression.elements) {
    if (!ts.isObjectLiteralExpression(layer) || new Set(layer.properties.map(propertyName)).size !== layer.properties.length || layer.properties.some(property => !['id', 'name', 'bounds', 'draw'].includes(propertyName(property) ?? ''))) continue
    const id = literal(value(layer, 'id')), name = literal(value(layer, 'name')), draw = member(layer, 'draw')
    if (typeof id !== 'string' || !id || !draw || !ts.isMethodDeclaration(draw) || !draw.body || !draw.parameters[0] || !ts.isIdentifier(draw.parameters[0].name)) continue
    const context = draw.parameters[0].name.text
    let full = false, corner = false, safe = true, font = 0, baseline = 'alphabetic', align = 'start'
    for (const statement of draw.body.statements) {
      if (!ts.isExpressionStatement(statement)) { safe = false; break }
      const expression = statement.expression
      if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(expression.left)
        && ts.isIdentifier(expression.left.expression) && expression.left.expression.text === context) {
        const key = expression.left.name.text, assigned = literal(expression.right)
        if (!['fillStyle', 'font', 'textAlign', 'textBaseline', 'globalAlpha'].includes(key) || assigned === undefined) { safe = false; break }
        if (key === 'font') font = typeof assigned === 'string' ? Number(/(?:^|\s)([\d.]+)px\b/.exec(assigned)?.[1] ?? 0) : 0
        if (key === 'textAlign') align = String(assigned)
        if (key === 'textBaseline') baseline = String(assigned)
        continue
      }
      if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression) || !ts.isIdentifier(expression.expression.expression)
        || expression.expression.expression.text !== context || expression.arguments.some(argument => literal(argument) === undefined)) { safe = false; break }
      const args = expression.arguments.map(literal), method = expression.expression.name.text
      if (method === 'fillRect' && args.length === 4 && args[0] === 0 && args[1] === 0 && args[2] === width && args[3] === height) full = true
      else if (method === 'fillText' && args.length === 3 && typeof args[0] === 'string' && typeof args[1] === 'number' && typeof args[2] === 'number'
        && args[0].length * font * 2 <= width * .35 && font > 0 && font <= height * .04 && args[1] >= 0 && args[1] <= width && args[2] >= font && args[2] <= height
        && (args[1] < width * .2 && ['left', 'start'].includes(align) || args[1] > width * .8 && ['right', 'end'].includes(align))
        && (args[2] < height * .2 || args[2] > height * .8) && ['alphabetic', 'bottom'].includes(baseline)) corner = true
      else { safe = false; break }
    }
    // bounds、默认样式不得从邻层继承，绘制入口之外也不能藏可执行的属性。
    const bounds = value(layer, 'bounds')
    if (bounds && (!ts.isArrayLiteralExpression(bounds) || bounds.elements.length !== 4 || bounds.elements.some(element => typeof literal(element) !== 'number'))) safe = false
    if (full && bounds && ts.isArrayLiteralExpression(bounds) && bounds.elements.map(literal).some((entry, index) => entry !== [0, 0, width, height][index])) safe = false
    if (!value(layer, 'id') || member(layer, 'name') && typeof name !== 'string' || !draw.body.statements.some(statement => ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression) && ts.isPropertyAccessExpression(statement.expression.left) && statement.expression.left.name.text === 'fillStyle')) safe = false
    if (safe && (full || corner)) suggestions.push({ file: source.fileName, line: source.getLineAndCharacterOfPosition(layer.getStart(source)).line + 1, layerId: id, name: typeof name === 'string' ? name : id,
      reason: full ? '全幅常驻、字面量绘制，不读时间或其他层' : '角落常驻小字、字面量绘制，不读时间或其他层' })
  }
  return suggestions.length ? suggestions : skip('没有可证明独立的常驻层（时间、参数或布局依赖）')
}
