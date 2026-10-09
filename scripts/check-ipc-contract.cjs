/* IPC 对账不执行宿主代码；使用仓内 TypeScript 解析常量、导入与映射。 */
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function sources(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const file = path.join(dir, item.name)
    return item.isDirectory() ? sources(file) : /\.tsx?$/.test(file) && !/\.(test|d)\.ts$/.test(file) ? [file] : []
  })
}

function scanContract(root) {
  const main = sources(path.join(root, 'electron/main'))
  const preload = sources(path.join(root, 'electron/preload'))
  const program = ts.createProgram([...main, ...preload], { target: ts.ScriptTarget.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext })
  const checker = program.getTypeChecker()
  const tables = Object.fromEntries(['handlers', 'invokes', 'receivers', 'messages', 'events', 'subscriptions'].map(key => [key, new Set()]))
  const unresolved = []
  function values(node, seen = new Set()) {
    if (!node || seen.has(node)) return []
    seen = new Set(seen).add(node)
    if (ts.isStringLiteralLike(node)) return [node.text]
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return values(node.expression, seen)
    if (ts.isConditionalExpression(node)) return [...values(node.whenTrue, seen), ...values(node.whenFalse, seen)]
    if (ts.isBinaryExpression(node)) return [...values(node.left, seen), ...values(node.right, seen)]
    if (ts.isObjectLiteralExpression(node)) return node.properties.flatMap(property => values(property.initializer, seen))
    if (ts.isElementAccessExpression(node)) {
      const keys = values(node.argumentExpression, seen)
      const objectType = checker.getTypeAtLocation(node.expression)
      const selected = keys.flatMap(key => {
        const symbol = objectType.getProperty(key)
        return (symbol?.declarations || []).flatMap(declaration => values(declaration.initializer, seen))
      })
      if (selected.length) return selected
      return values(node.expression, seen)
    }
    let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) ? node.name : node)
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
    const fromDeclarations = (symbol?.declarations || []).flatMap(declaration => values(declaration.initializer, seen))
    if (fromDeclarations.length) return fromDeclarations
    const type = checker.getTypeAtLocation(node)
    return (type.isUnion() ? type.types : [type]).flatMap(part => part.isStringLiteral() ? [part.value] : [])
  }
  function parameter(node) {
    if (!node || !ts.isIdentifier(node)) return false
    return checker.getSymbolAtLocation(node)?.declarations?.some(ts.isParameter) || false
  }
  for (const file of [...main, ...preload]) {
    const source = program.getSourceFile(file)
    const isMain = main.includes(file)
    function visit(node) {
      if (ts.isCallExpression(node) && node.arguments.length) {
        const expression = node.expression.getText(source)
        const method = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : expression
        let table
        if (isMain && expression === 'registerIpcHandler') table = 'handlers'
        else if (isMain && expression === 'ipcMain.handle') table = 'handlers'
        else if (isMain && expression === 'ipcMain.on') table = 'receivers'
        else if (!isMain && ['nativeInvoke', 'invoke', 'ipcRenderer.invoke'].includes(expression)) table = 'invokes'
        else if (!isMain && ['ipcRenderer.send', 'ipcRenderer.postMessage', 'postMessage'].includes(expression)) table = 'messages'
        else if (!isMain && ['ipcRenderer.on', 'subscribe', 'subscribeChannel', 'listen'].includes(expression)) table = 'subscriptions'
        else if (isMain && ['send', 'postMessage'].includes(method)) table = 'events'
        if (table) {
          const channels = values(node.arguments[0]).filter(value => value.includes(':'))
          for (const channel of channels) tables[table].add(channel)
          // 通用转发器的形参由调用点对账；真正的端点不能静默跳过动态值。
          const forwarding = parameter(node.arguments[0]) && (
            expression === 'ipcMain.handle' && file === path.join(root, 'electron/main/ipc/registry.ts')
            || !isMain && ['ipcRenderer.invoke', 'ipcRenderer.postMessage', 'ipcRenderer.on'].includes(expression)
          )
          if (!channels.length && table !== 'events' && !forwarding) {
            const position = source.getLineAndCharacterOfPosition(node.getStart(source))
            unresolved.push(`${path.relative(root, file).replaceAll('\\', '/')}:${position.line + 1}: ${expression}(${node.arguments[0].getText(source)})`)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  const errors = [...unresolved.map(value => `无法解析 IPC 通道: ${value}`)]
  for (const [left, right, title] of [['handlers', 'invokes', '请求'], ['receivers', 'messages', '消息/端口']]) {
    for (const channel of tables[left]) if (!tables[right].has(channel)) errors.push(`${title}未消费: ${channel}`)
    for (const channel of tables[right]) if (!tables[left].has(channel)) errors.push(`${title}未注册: ${channel}`)
  }
  // 事件允许原生组件自身观察，但 preload 声明的订阅必须有宿主发送端。
  for (const channel of tables.subscriptions) if (!tables.events.has(channel)) errors.push(`事件未发送: ${channel}`)
  for (const channel of tables.events) if (!tables.subscriptions.has(channel)) errors.push(`事件未订阅: ${channel}`)
  return { tables: Object.fromEntries(Object.entries(tables).map(([key, value]) => [key, [...value].sort()])), errors }
}

if (require.main === module) {
  const result = scanContract(path.resolve(__dirname, '..'))
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2))
  else {
    console.log(`IPC: ${result.tables.handlers.length} 请求 / ${result.tables.receivers.length} 消息端口 / ${result.tables.subscriptions.length} 订阅事件`)
    for (const error of result.errors) console.error(error)
  }
  process.exitCode = result.errors.length ? 1 : 0
}
module.exports = { scanContract }
