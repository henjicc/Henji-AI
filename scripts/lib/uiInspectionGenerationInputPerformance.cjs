const assert = require('node:assert/strict')

// Browser-only probe. Capture the trusted edit before React handles it, and wait
// for the input, result count and mounted card identities to agree together.
function createEditProbe({ input, counter, value, label, allowedIds }) {
  const allowed = new Set(allowedIds)
  let start = null, firstCorrect = null, previous = null, frame, timer, stable = 0, disposed = false, resolve
  const frames = [], longTasks = []
  const done = new Promise(callback => { resolve = callback })
  const record = entries => {
    for (const entry of entries) if (start !== null && entry.startTime + entry.duration > start) longTasks.push(entry.duration)
  }
  const observer = new PerformanceObserver(list => record(list.getEntries()))
  observer.observe({ type: 'longtask' })
  const read = () => ({ value: typeof input.value === 'string' ? input.value : input.textContent, label: counter.textContent,
    focused: document.activeElement === input,
    ids: [...document.querySelectorAll('[data-generation-task-id]')].map(element => element.dataset.generationTaskId) })
  const matches = actual => input.isConnected && counter.isConnected && actual.focused
    && actual.value === value && actual.label === label
    && (allowed.size ? actual.ids.length > 0 : actual.ids.length === 0)
    && new Set(actual.ids).size === actual.ids.length
    && actual.ids.every(id => allowed.has(id))
  const dispose = () => {
    disposed = true; cancelAnimationFrame(frame); clearTimeout(timer); observer.disconnect()
    input.removeEventListener('keydown', onEdit, true)
  }
  const finish = ok => {
    const ended = performance.now()
    record(observer.takeRecords()); dispose()
    const actual = read()
    resolve({ ok: ok && matches(actual), firstCorrectFrameMs: firstCorrect === null ? null : firstCorrect - start,
      settledMs: start === null ? null : ended - start, frames, longTasks, actual })
  }
  const tick = now => {
    if (previous !== null) frames.push(now - previous)
    previous = now
    const correct = matches(read())
    if (correct && firstCorrect === null) firstCorrect = performance.now()
    stable = correct ? stable + 1 : 0
    if (stable === 3) finish(true)
    else frame = requestAnimationFrame(tick)
  }
  function onEdit(event) {
    if (disposed || start !== null || !event.isTrusted) return
    start = performance.now(); frame = requestAnimationFrame(tick)
  }
  input.addEventListener('keydown', onEdit, true)
  timer = setTimeout(() => finish(false), 10000)
  return { done, dispose }
}

async function measureGenerationFiltering(page, count, inspection) {
  const search = page.getByPlaceholder(/^(搜索提示词 \/ 模型 \/ 提供商 \/ 错误信息|Search prompt \/ model \/ provider \/ error)$/)
  const expand = page.getByTitle(/^(展开搜索|Expand search)$/)
  if (await expand.count()) await expand.click()
  await search.focus()
  await page.evaluate(() => { document.querySelector('.app-scroll-container').scrollTop = 0 })
  await page.waitForTimeout(400)
  const counter = page.getByText(new RegExp(`^(显示 ${count} / ${count} 条|Showing ${count} / ${count})$`))
  await counter.waitFor()
  const input = await search.elementHandle(), countElement = await counter.elementHandle()
  const english = (await counter.textContent()).startsWith('Showing')
  const samples = []
  let value = ''
  try {
    // Broad -> narrow -> one -> empty -> broad. The fixture's numeric prompt
    // identity supplies an independent oracle, without importing app filtering.
    for (const key of ['9', '9', '9', '9', 'x', 'Backspace', 'Backspace', 'Backspace', 'Backspace', 'Backspace']) {
      value = key === 'Backspace' ? value.slice(0, -1) : value + key
      const allowedIds = Array.from({ length: count }, (_, i) => i).filter(i => String(i).includes(value))
        .map(i => `__generation_bench_${i}`)
      const label = english ? `Showing ${allowedIds.length} / ${count}` : `显示 ${allowedIds.length} / ${count} 条`
      const probe = await page.evaluateHandle(createEditProbe, { input, counter: countElement, value, label, allowedIds })
      try {
        await search.press(key)
        const sample = await probe.evaluate(state => state.done)
        assert.ok(sample.ok, `历史筛选结果、焦点或等待失败：${JSON.stringify({ value, sample })}`)
        samples.push({ value, matched: allowedIds.length, ...sample })
      } finally { await probe.evaluate(state => state.dispose()); await probe.dispose() }
    }
    assert.equal(await search.inputValue(), '')
    await inspection.capture(`filter-restored-${count}`)
    const latencies = samples.map(sample => sample.firstCorrectFrameMs).sort((a, b) => a - b)
    return { timing: 'trusted keydown to matching input, count and mounted cards at RAF; not physical presentation',
      samples, p95Ms: latencies[Math.ceil(latencies.length * 0.95) - 1], maxMs: latencies.at(-1) }
  } finally { await input.dispose(); await countElement.dispose() }
}

async function measureGenerationPromptInput(page, count, inspection) {
  const host = page.locator('[data-onboarding-target="prompt"]')
  await host.getByRole('textbox').click()
  const editor = host.locator('[contenteditable="true"]')
  await editor.waitFor()
  const seed = 'A detailed landscape with natural light, consistent composition and fine textures. '.repeat(16)
  await editor.fill(seed)
  await editor.press('End')
  await page.waitForTimeout(300)
  const counter = page.getByText(new RegExp(`^(显示 ${count} / ${count} 条|Showing ${count} / ${count})$`))
  const label = await counter.textContent()
  const input = await editor.elementHandle(), countElement = await counter.elementHandle()
  const allowedIds = Array.from({ length: count }, (_, i) => `__generation_bench_${i}`)
  const samples = []
  let value = seed
  try {
    for (const key of 'Soft morning light.') {
      value += key
      const probe = await page.evaluateHandle(createEditProbe, { input, counter: countElement, value, label, allowedIds })
      try {
        await editor.press(key === ' ' ? 'Space' : key)
        const sample = await probe.evaluate(state => state.done)
        assert.ok(sample.ok, `提示词输入丢失、焦点或历史结果异常：${JSON.stringify(sample)}`)
        samples.push({ ...sample, actual: { ...sample.actual, value: undefined }, characters: value.length })
      } finally { await probe.evaluate(state => state.dispose()); await probe.dispose() }
    }
    // Blur renders the document held by React, so a DOM-only edit cannot pass.
    await page.getByPlaceholder(/^(搜索提示词 \/ 模型 \/ 提供商 \/ 错误信息|Search prompt \/ model \/ provider \/ error)$/).focus()
    await page.waitForTimeout(100)
    assert.equal(await host.getByRole('textbox').textContent(), value)
    await inspection.capture(`prompt-input-${count}`)
    const latencies = samples.map(sample => sample.firstCorrectFrameMs).sort((a, b) => a - b)
    return { timing: 'trusted keydown to matching prompt and unchanged history at RAF; not physical presentation',
      seedCharacters: seed.length, samples, p95Ms: latencies[Math.ceil(latencies.length * 0.95) - 1], maxMs: latencies.at(-1) }
  } finally { await input.dispose(); await countElement.dispose() }
}

module.exports = { createEditProbe, measureGenerationFiltering, measureGenerationPromptInput }
