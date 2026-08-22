/**
 * 真实 Electron 场景的运行时证据收集器。
 *
 * 浏览器异常直接订阅 Playwright；应用日志通过 preload 暴露的正式 logging 查询接口按
 * afterTimestamp + level 下沉过滤。这里不打开、更不整份读取 JSONL 日志文件。
 */

const LOG_QUERY_LIMIT = 500

function compactLogEvent(event) {
  return {
    timestamp: event.timestamp,
    level: event.level,
    source: event.source,
    domain: event.domain,
    event: event.event,
    message: event.message,
    requestId: event.requestId,
    taskId: event.taskId,
    modelId: event.modelId,
    providerId: event.providerId,
    truncatedByLimit: event.truncatedByLimit,
  }
}

function dateRange(startIso, endIso) {
  const dates = [startIso.slice(0, 10)]
  const endDate = endIso.slice(0, 10)
  if (endDate !== dates[0]) dates.push(endDate)
  return dates
}

async function queryApplicationLogs(page, { afterTimestamp, endTimestamp, level }) {
  const batches = []
  for (const date of dateRange(afterTimestamp, endTimestamp)) {
    const result = await page.evaluate(async ({ queryDate, queryAfter, queryLevel, limit }) => {
      const logging = window.henjiNative?.logging
      if (!logging?.queryLogEvents) throw new Error('应用未暴露结构化日志查询接口')
      return await logging.queryLogEvents({
        date: queryDate,
        afterTimestamp: queryAfter,
        level: queryLevel,
        limit,
      })
    }, { queryDate: date, queryAfter: afterTimestamp, queryLevel: level, limit: LOG_QUERY_LIMIT })
    batches.push(result)
  }
  return {
    events: batches.flatMap((batch) => batch.events).map(compactLogEvent),
    truncated: batches.some((batch) => batch.hasMore),
    corruptedLines: batches.reduce((sum, batch) => sum + batch.corruptedLines, 0),
  }
}

function createRuntimeEvidenceCollector(page) {
  let active = null
  const browserErrors = []

  const onConsole = (message) => {
    if (message.type() !== 'error') return
    browserErrors.push({
      kind: 'console',
      scene: active?.key ?? null,
      timestamp: new Date().toISOString(),
      message: message.text(),
    })
  }
  const onPageError = (error) => {
    browserErrors.push({
      kind: 'pageerror',
      scene: active?.key ?? null,
      timestamp: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    })
  }
  page.on('console', onConsole)
  page.on('pageerror', onPageError)

  return {
    begin(key) {
      if (active) throw new Error(`运行时证据场景尚未结束：${active.key}`)
      active = { key, startedAt: new Date().toISOString(), browserErrorOffset: browserErrors.length }
    },
    async finish() {
      if (!active) throw new Error('运行时证据场景尚未开始')
      const current = active
      active = null
      const finishedAt = new Date().toISOString()
      const [errors, warnings] = await Promise.all([
        queryApplicationLogs(page, { afterTimestamp: current.startedAt, endTimestamp: finishedAt, level: 'error' }),
        queryApplicationLogs(page, { afterTimestamp: current.startedAt, endTimestamp: finishedAt, level: 'warn' }),
      ])
      const browser = browserErrors.slice(current.browserErrorOffset)
      return {
        startedAt: current.startedAt,
        finishedAt,
        browserErrors: browser,
        logErrors: errors.events,
        logWarnings: warnings.events,
        logQuery: {
          truncated: errors.truncated || warnings.truncated,
          corruptedLines: errors.corruptedLines + warnings.corruptedLines,
        },
        passed: browser.length === 0 && errors.events.length === 0 && !errors.truncated,
      }
    },
    cancel() {
      active = null
    },
    dispose() {
      active = null
      page.off('console', onConsole)
      page.off('pageerror', onPageError)
    },
  }
}

module.exports = {
  LOG_QUERY_LIMIT,
  createRuntimeEvidenceCollector,
  queryApplicationLogs,
}
