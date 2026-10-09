const fs = require('node:fs')
const path = require('node:path')
const madge = require('madge')
const { Graph, alg } = require('@dagrejs/graphlib')
const { createImportResolver, readResolvedImports, sourceFiles, slash } = require('./lib/resolvedImports.cjs')

const edgeKey = (edge) => `${edge.from} → ${edge.to}`
const sortEdges = (edges) => edges.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'))

// 已收口的纯子域：类型、静态值、动态值和 re-export 均不得依赖界面实现。
// core/services 等 renderer-only 编排不以整个 core 为纯层；仍受原冻结规则约束。
const PURE_CORE_DIRECTORIES = ['imageEdit', 'imaging', 'application-control', 'documents', 'toolbox']
function isPureCoreViolation({ from, to }) {
  return PURE_CORE_DIRECTORIES.some((directory) => from.startsWith(`src/core/${directory}/`))
    && /^src\/(?:features|stores|components)\//.test(to)
}

// 明确守住首屏代码加载边界；纯几何/文档/调度契约不因名字含 GPU 被误拦。
const FIRST_SCREEN_HEAVY_PACKAGES = [
  'konva', 'react-konva', 'vgpu', 'onnxruntime-web', 'onnxruntime-node', 'onnxruntime-common',
  'three', '@react-three/fiber', '@react-three/drei', 'monaco-editor', '@monaco-editor/react',
]
const FIRST_SCREEN_HEAVY_MODULE_PREFIXES = [
  'src/features/imageEdit/v3/editor/', 'src/features/imageEdit/editor/',
  'src/features/maskEditor/v3/', 'src/features/maskEditor/MaskEditorCanvas.tsx',
  'src/core/imageEdit/webgpu/', 'src/core/imageEdit/worker/webgpuRuntimeBackend.ts',
  'src/features/imageEdit/v3/execution/imageEditorRenderSessionGpuBridgeV3.ts',
  'src/features/imageEdit/v3/export/renderExportTilesV3.ts',
  'src/features/imageEdit/v3/export/gpuExportSessionV3.ts',
  'src/features/imageEdit/v3/export/gpuDefaultExportV3.ts',
]

function firstScreenReachability(edges, entry = 'src/main.tsx') {
  const outgoing = new Map()
  for (const edge of edges.filter((item) => item.kind === 'static')) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, [])
    outgoing.get(edge.from).push(edge)
  }
  const routes = new Map([[entry, [entry]]])
  const queue = [entry]
  const heavy = new Map()
  for (let index = 0; index < queue.length; index += 1) {
    const from = queue[index]
    for (const edge of outgoing.get(from) ?? []) {
      const pkg = FIRST_SCREEN_HEAVY_PACKAGES.find((name) => edge.specifier === name || edge.specifier.startsWith(`${name}/`))
      const target = pkg ?? edge.to
      const route = [...routes.get(from), target]
      if (pkg || FIRST_SCREEN_HEAVY_MODULE_PREFIXES.some((prefix) => edge.to.startsWith(prefix))) {
        if (!heavy.has(target)) heavy.set(target, { target, route })
      }
      if (edge.to.startsWith('src/') && !routes.has(edge.to)) {
        routes.set(edge.to, route)
        queue.push(edge.to)
      }
    }
  }
  return { entry, moduleCount: routes.size, heavyModules: [...heavy.values()].sort((a, b) => a.target.localeCompare(b.target, 'en')) }
}

function dynamicBackEdges(edges, codeFiles) {
  const graph = new Graph({ directed: true })
  for (const file of codeFiles) graph.setNode(file)
  for (const edge of edges) {
    if (edge.kind !== 'type' && codeFiles.has(edge.to)) graph.setEdge(edge.from, edge.to)
  }
  const component = new Map()
  alg.tarjan(graph).forEach((members, index) => members.forEach((file) => component.set(file, index)))
  return sortEdges(edges.filter((edge) => edge.kind === 'dynamic' && codeFiles.has(edge.to)
    && component.get(edge.from) === component.get(edge.to)).map(({ from, to }) => ({ from, to })))
}

function forbiddenReason(edge) {
  const { from, to, kind } = edge
  if (from.startsWith('src/components/')) {
    if (to.startsWith('electron/main/')) return '组件不得依赖主进程；通过 commands/platform 访问宿主'
    if (/^(?:src\/core\/providers\/|packages\/ai-sdk\/(?:src|dist)\/(?:providers|packs\/provider-adapters|protocols|upload)\/)/.test(to)
      && !(kind === 'type' && to.startsWith('src/core/providers/base/'))) {
      return '组件不得依赖 provider 实现；走 SDK 公共契约与领域服务'
    }
  }
  if (from.startsWith('electron/main/') && to.startsWith('src/components/')) return '主进程不得依赖组件；提取纯契约或依赖注入'
  if (from.startsWith('src/models/presentation/') && /^src\/(?:services|components)\//.test(to)) return 'presentation 不得依赖服务或组件；提取纯契约'
  if (from.startsWith('src/core/application-control/')
    && /(?:^|\/)(?:components|stores?|electron)\/|^src\/features\/assistant\//.test(to)) {
    return 'Application API 必须调用方中立；提取纯契约或依赖注入'
  }
  if (isPureCoreViolation(edge)) return '纯 core 子域不得依赖 features/stores/components；提取共享实现或依赖注入'
  if (from.startsWith('src/core/') && /^src\/(?:features|stores)\//.test(to)) return 'core 反向依赖被冻结；把纯契约移至 core 或注入领域实现'
  return null
}

function featureCell(edge) {
  const from = /^src\/features\/([^/]+)\//.exec(edge.from)?.[1]
  const to = /^src\/features\/([^/]+)\//.exec(edge.to)?.[1]
  // 只豁免 feature 根公开入口；内部目录加 index 桶不能绕过矩阵冻结。
  return from && to && from !== to && !/^src\/features\/[^/]+\/index\.[^.]+$/.test(edge.to) ? `${from} → ${to}` : null
}

async function scan(root) {
  const files = ['src', 'electron'].flatMap((directory) => sourceFiles(path.join(root, directory)))
  const resolve = createImportResolver(root)
  const resolver = (specifier, file) => {
    const target = resolve(specifier, file)
    // 重包尚未安装或子路径解析失败也不能漏检；本地代码仍由正式 resolver 失败关闭。
    const pkg = FIRST_SCREEN_HEAVY_PACKAGES.find((name) => specifier === name || specifier.startsWith(`${name}/`))
    return target ?? (pkg ? `node_modules/${pkg}` : null)
  }
  const edges = sortEdges(files.flatMap((file) => readResolvedImports(file, root, resolver)))
  const codeFiles = new Set(files.map((file) => slash(path.relative(root, file))))
  // Madge 负责成熟依赖图构建；TS AST 校准语句数、类型和动态语义（不能让同目标去重漏计）。
  const result = await madge(files, {
    baseDir: root, fileExtensions: ['ts', 'tsx', 'mts', 'cts'], tsConfig: path.join(root, 'tsconfig.json'),
    dependencyFilter: (target) => codeFiles.has(slash(path.relative(root, target))),
    excludeRegExp: [/\.(?:test|spec)\.[^.]+$/, /(?:^|[\\/])packages[\\/]/],
  })
  const graph = result.obj()
  if (files.length && !Object.keys(graph).length) throw new Error('Madge 返回空图，拒绝生成或验证基线')
  // 分类以 TS 语法为准，Madge 的边用于交叉核对。inline type 等解析器遗漏仍由 TS 保留。
  for (const edge of edges.filter((entry) => entry.kind === 'static' && codeFiles.has(entry.to))) {
    if (!graph[edge.from]?.includes(edge.to)) throw new Error(`Madge 与 TypeScript 解析不一致：${edgeKey(edge)}`)
  }
  const valueGraph = Object.fromEntries([...codeFiles].map((file) => [file, []]))
  for (const edge of edges) {
    if (edge.kind === 'static' && codeFiles.has(edge.to)) valueGraph[edge.from].push(edge.to)
  }
  const directed = new Graph({ directed: true })
  for (const [from, targets] of Object.entries(valueGraph)) {
    directed.setNode(from)
    for (const to of targets) directed.setEdge(from, to)
  }
  const cycles = alg.tarjan(directed)
    .filter((members) => members.length > 1 || directed.hasEdge(members[0], members[0]))
    .map((members) => {
      members.sort()
      const memberSet = new Set(members)
      const internalEdges = [...new Map(edges.filter((edge) => edge.kind === 'static'
        && memberSet.has(edge.from) && memberSet.has(edge.to)).map((edge) => [edgeKey(edge), { from: edge.from, to: edge.to }])).values()]
      return { members, edges: sortEdges(internalEdges) }
    }).sort((a, b) => a.members[0].localeCompare(b.members[0], 'en'))
  const forbiddenEdges = sortEdges([...new Map(edges.filter(forbiddenReason)
    .map((edge) => [edgeKey(edge), { from: edge.from, to: edge.to, reason: forbiddenReason(edge) }])).values()])
  const featureEdges = edges.filter(featureCell).map((edge) => ({ ...edge, cell: featureCell(edge) }))
  const featureMatrix = {}
  for (const edge of featureEdges) featureMatrix[edge.cell] = (featureMatrix[edge.cell] ?? 0) + 1
  return { version: 1, cycles, forbiddenEdges, featureEdges, featureMatrix,
    firstScreen: firstScreenReachability(edges), dynamicBackEdges: dynamicBackEdges(edges, codeFiles) }
}

function cyclePath(cycle, addedEdge) {
  const start = addedEdge.to
  const queue = [[start]]
  const seen = new Set([start])
  for (let index = 0; index < queue.length; index += 1) {
    const route = queue[index]
    const last = route[route.length - 1]
    if (last === addedEdge.from) return [addedEdge.from, ...route].join(' → ')
    for (const edge of cycle.edges.filter((edge) => edge.from === last)) {
      if (!seen.has(edge.to)) { seen.add(edge.to); queue.push([...route, edge.to]) }
    }
  }
  throw new Error('循环基线没有实际回路')
}

function compare(current, baseline) {
  const failures = []
  const oldHeavy = new Set(baseline.firstScreen?.heavyModules.map((item) => item.target) ?? [])
  for (const item of current.firstScreen?.heavyModules ?? []) {
    if (!oldHeavy.has(item.target)) failures.push(`首屏静态值依赖到重模块：${item.route.join(' → ')}；分离纯契约，在任务执行处加载重模块。`)
  }
  // 同时看静态和动态值边，防止把真实环改写成 import() 后从 SCC 门禁消失。
  if (baseline.dynamicBackEdges) {
    const oldDynamic = new Map()
    for (const edge of baseline.dynamicBackEdges) oldDynamic.set(edgeKey(edge), (oldDynamic.get(edgeKey(edge)) ?? 0) + 1)
    for (const edge of current.dynamicBackEdges ?? []) {
      const remaining = oldDynamic.get(edgeKey(edge)) ?? 0
      if (!remaining) failures.push(`新增动态值回边：${edgeKey(edge)}；提取纯契约或依赖注入，不得用 import() 隐藏真实值环。`)
      else oldDynamic.set(edgeKey(edge), remaining - 1)
    }
  }
  const oldCycleEdges = new Set(baseline.cycles.flatMap((cycle) => cycle.edges.map(edgeKey)))
  for (const cycle of current.cycles) {
    for (const edge of cycle.edges) {
      if (!oldCycleEdges.has(edgeKey(edge))) failures.push(`新增静态值环：${cyclePath(cycle, edge)}；提取纯契约、走公开入口或依赖注入，不能增加环内边。`)
    }
  }
  const oldForbidden = new Set(baseline.forbiddenEdges.map(edgeKey))
  for (const edge of current.forbiddenEdges) {
    if (isPureCoreViolation(edge)) failures.push(`纯 core 禁止跨层边：${edgeKey(edge)}；${edge.reason}。`)
    else if (!oldForbidden.has(edgeKey(edge))) failures.push(`新增禁止跨层边：${edgeKey(edge)}；${edge.reason}。`)
  }
  for (const [cell, count] of Object.entries(current.featureMatrix)) {
    const limit = baseline.featureMatrix[cell] ?? 0
    if (count > limit) {
      const old = new Set(baseline.featureEdges.filter((edge) => edge.cell === cell)
        .map((edge) => `${edgeKey(edge)}:${edge.kind}:${edge.specifier}`))
      const candidates = current.featureEdges.filter((edge) => edge.cell === cell
        && !old.has(`${edgeKey(edge)}:${edge.kind}:${edge.specifier}`))
      failures.push(`跨 feature 非 index 导入 ${cell}：${count} > 基线 ${limit}；走公开 index 入口或提取纯契约。新增候选：${(candidates.length ? candidates : current.featureEdges.filter((edge) => edge.cell === cell)).map((edge) => `${edge.from}:${edge.line} → ${edge.to} (${edge.kind})`).join('；')}`)
    }
  }
  return failures
}

function writeBaseline(filename, current, baseline, reason) {
  if (current.forbiddenEdges.some(isPureCoreViolation)) throw new Error('纯 core 禁止跨层边不得登记基线或 --accept-new 例外')
  const failures = baseline ? compare(current, baseline) : ['初次建立基线']
  if (baseline?.firstScreen) {
    const oldHeavy = new Set(baseline.firstScreen.heavyModules.map((item) => item.target))
    if (current.firstScreen.heavyModules.some((item) => !oldHeavy.has(item.target))) {
      throw new Error('首屏重模块基线只许缩减，--accept-new 不能放宽；例外须在首次登记时写明理由。')
    }
  }
  if (failures.length && !reason?.trim()) throw new Error(`拒绝写入基线：\n${failures.join('\n')}\n仅经审查确认后使用 --accept-new <理由> 登记例外。`)
  const exceptions = [...(baseline?.exceptions ?? [])]
  if (failures.length) exceptions.push({ reason: reason.trim(), changes: failures })
  fs.writeFileSync(filename, `${JSON.stringify({ ...current, exceptions }, null, 2)}\n`)
}

async function main(argv = process.argv.slice(2)) {
  const started = performance.now()
  const root = path.resolve(__dirname, '..')
  if (!fs.existsSync(path.join(root, 'src/main.tsx'))) throw new Error('首屏入口 src/main.tsx 缺失，拒绝验证空图')
  const filename = path.join(__dirname, 'dependency-graph-baseline.json')
  const write = argv.includes('--write')
  const accept = argv.indexOf('--accept-new')
  const reason = accept < 0 ? undefined : argv[accept + 1]
  if (argv.some((arg, index) => arg !== '--write' && arg !== '--accept-new' && !(accept >= 0 && index === accept + 1))
    || (accept >= 0 && (!write || !reason?.trim() || reason.startsWith('--')))) throw new Error('用法：check-dependency-graph.cjs [--write [--accept-new <理由>]]')
  const baseline = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : null
  const current = await scan(root)
  if (write) writeBaseline(filename, current, baseline, reason)
  else {
    if (!baseline) throw new Error('缺少依赖基线，必须由审查者显式登记初值')
    const failures = compare(current, baseline)
    if (failures.length) throw new Error(failures.join('\n'))
  }
  process.stdout.write(`依赖图${write ? '基线已更新' : '门禁通过'}：${current.cycles.length} 个静态值 SCC，${current.forbiddenEdges.length} 条冻结跨层边，${current.featureEdges.length} 条跨 feature 非 index 导入；首屏 ${current.firstScreen.moduleCount} 模块 / ${current.firstScreen.heavyModules.length} 重模块，${current.dynamicBackEdges.length} 动态值回边；${((performance.now() - started) / 1000).toFixed(2)} 秒。\n`)
}

module.exports = { scan, compare, forbiddenReason, featureCell, writeBaseline, cyclePath, firstScreenReachability,
  FIRST_SCREEN_HEAVY_PACKAGES, FIRST_SCREEN_HEAVY_MODULE_PREFIXES, PURE_CORE_DIRECTORIES }
if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
