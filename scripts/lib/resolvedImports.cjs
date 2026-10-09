const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const slash = (value) => value.replaceAll('\\', '/')

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(file)
    return /\.(?:ts|tsx|mts|cts)$/.test(file) && !/\.(?:test|spec)\.[^.]+$/.test(file)
      ? [file] : []
  }).sort()
}

function createImportResolver(root, configPath = path.join(root, 'tsconfig.json')) {
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const { options, errors } = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath))
  if (errors.some((error) => error.code !== 18003)) {
    throw new Error(errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'))
  }
  const cache = ts.createModuleResolutionCache(root, (file) => file, options)
  const directories = new Map()
  function checkCasing(filename) {
    const relative = path.relative(root, filename)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return
    let directory = root
    for (const segment of relative.split(path.sep)) {
      if (!directories.has(directory)) directories.set(directory, fs.readdirSync(directory))
      if (!directories.get(directory).includes(segment)) {
        throw new Error(`依赖路径大小写不一致：${slash(relative)}；Windows 和 Linux 必须使用文件的实际大小写。`)
      }
      directory = path.join(directory, segment)
    }
  }
  return (specifier, file) => {
    const resolved = ts.resolveModuleName(specifier.split('?')[0], file, options, ts.sys, cache).resolvedModule
    if (resolved) {
      checkCasing(resolved.resolvedFileName)
      return slash(path.relative(root, resolved.resolvedFileName))
    }
    // 非 TS 资源不参与代码拓扑；缺失的本地代码导入必须失败，不能漏边而绿灯。
    if ((specifier.startsWith('.') || specifier.startsWith('@/'))
      && !/\.(?:wgsl|css|scss|svg|png|jpe?g|webp|gif|mp4|mp3|wasm|json)(?:\?|$)/i.test(specifier)) {
      throw new Error(`无法解析本地依赖 ${slash(path.relative(root, file))} → ${specifier}；检查文件、大小写及 tsconfig 路径。`)
    }
    return null
  }
}

function readResolvedImports(file, root, resolve = createImportResolver(root)) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const edges = []
  function add(node, literal, kind) {
    if (!literal || !ts.isStringLiteralLike(literal)) return
    const target = resolve(literal.text, file)
    if (target === null) return
    edges.push({
      from: slash(path.relative(root, file)), to: target, kind,
      specifier: literal.text, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    })
  }
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause
      const bindings = clause?.namedBindings
      const typeOnly = clause?.isTypeOnly || (clause && !clause.name && bindings
        && ts.isNamedImports(bindings) && bindings.elements.length > 0
        && bindings.elements.every((element) => element.isTypeOnly))
      add(node, node.moduleSpecifier, typeOnly ? 'type' : 'static')
    } else if (ts.isExportDeclaration(node)) {
      const typeOnly = node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause)
        && node.exportClause.elements.length > 0 && node.exportClause.elements.every((element) => element.isTypeOnly))
      add(node, node.moduleSpecifier, typeOnly ? 'type' : 'static')
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node, node.moduleReference.expression, node.isTypeOnly ? 'type' : 'static')
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add(node, node.arguments[0], 'dynamic')
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node, node.argument.literal, 'type')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return edges
}

function assistantImportViolation(edge) {
  if (/^src\/features\/application-control\/capabilities\/(?:registry|applicationControlRegistry)\.ts$/.test(edge.from)
    && (/^src\/stores\//.test(edge.to) || /^src\/features\/(?!application-control\/)/.test(edge.to))) {
    return '公共注册器直接依赖业务实现，须从领域模块装配'
  }
  if (edge.from.startsWith('src/core/application-control/')
    && /^(?:src\/components\/|src\/stores\/|src\/features\/assistant\/|electron\/)/.test(edge.to)) {
    return 'Application API 核心跨层导入'
  }
  return null
}

module.exports = { slash, sourceFiles, createImportResolver, readResolvedImports, assistantImportViolation }
