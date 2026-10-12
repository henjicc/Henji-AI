const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { siblingTests, TEST_PATTERN, CODE_PATTERN } = require('./changedVerificationPlan.cjs')
const { readResolvedImports, createImportResolver } = require('./resolvedImports.cjs')

// 使用已安装 Vitest 的同一依赖分析；只变换模块，不收集/执行测试，不启用缓存写入。
async function resolveChangedTests(options, root) {
  const sources = options.files.filter((file) => CODE_PATTERN.test(file) && !TEST_PATTERN.test(file))
  const exact = [...new Set([...options.files.filter((file) => TEST_PATTERN.test(file)),
    ...sources.flatMap((file) => siblingTests(root, file)), ...(options.directTests ?? [])])]
  const resolver = createImportResolver(root)
  const covered = new Set(exact.filter(file => /\.[jt]sx?$/.test(file)).flatMap(file =>
    readResolvedImports(path.join(root, file), root, resolver).map(edge => edge.to)))
  const relatedSources = options.directTests?.length ? [] : sources.filter((file) =>
    !siblingTests(root, file).length && !covered.has(file) && /^(src|electron|packages)\//.test(file) && /\.[jt]sx?$/.test(file))
  if (!relatedSources.length) return exact
  const { createVitest } = await import(pathToFileURL(path.join(root, 'node_modules/vitest/dist/node.js')).href)
  const ctx = await createVitest('test', { root, watch: false, run: true, cache: false, related: relatedSources })
  try {
    return [...new Set([...exact, ...await collectRelatedTests(ctx, relatedSources, root)])]
  } finally { await ctx.close() }
}

async function collectRelatedTests(ctx, relatedSources, root) {
    const deadline = Date.now() + 45000
    const specs = await ctx.globTestFiles()
    const normalize = file => path.resolve(file).replaceAll('\\', '/')
    const targets = new Set(relatedSources.map(file => normalize(path.resolve(root, file))))
    const uncovered = new Set(targets)
    const related = []
    // 不先构建全仓测试图：逐批解析，达到规模预算立即停止，不执行任何用例。
    for (let offset = 0; offset < specs.length; offset += 8) {
      const batch = specs.slice(offset, offset + 8)
      let timer
      const graphs = await Promise.race([
        Promise.all(batch.map(async (spec) => [spec, await ctx.getTestDependencies(spec)])),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('related 解析超过 45 秒预算；停止自动执行，请用 --test 指定直接消费者')), Math.max(1, deadline - Date.now())) }),
      ]).finally(() => clearTimeout(timer))
      for (const [[, file], dependencies] of graphs) {
        const imports = new Set([...dependencies, file].map(normalize))
        const matches = [...targets].filter(target => imports.has(target))
        if (matches.length) related.push(path.relative(root, file).split(path.sep).join('/'))
        for (const target of matches) uncovered.delete(target)
      }
      if (new Set(related).size > 20) throw new Error(`related 集合过大（已找到至少 ${new Set(related).size} 文件 > 20），停止自动执行；请用 --test <直接消费者测试> 指定覆盖：${relatedSources.join('、')}`)
    }
    if (uncovered.size) throw new Error(`缺覆盖：related 未找到测试：${[...uncovered].map(file => path.relative(root, file)).join('、')}；请补测试或用 --test 指定直接消费者`)
    return [...new Set(related)]
}

module.exports = { resolveChangedTests, collectRelatedTests }
