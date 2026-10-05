/**
 * 口播文档夹具（3.3 口播接入）：真实场景经正式 preload 接口造口播数据。
 *
 * 口播是 `.henji-audio` 文档：先用 `audio.probeEditSource` 探测素材，再用 `documents.createDocument`
 * 以给定名称（非草稿）新建；改内容用 `documents.saveDocument`（核对版本）；清理时删掉文件并从作品索引移除，
 * 不往系统回收站里放测试文件。文档 ID 由仓库生成，调用方取返回值，不能写死。
 */
const fs = require('node:fs')

const DEFAULT_BATCH_SETTINGS = { silenceThresholdMs: 800, retainedSilenceMs: 350, noiseDb: -40, trimEdges: false, fillers: ['嗯', '呃', '额'] }

/**
 * 新建一份口播文档。`patch` 合并进内容（如 transcript、cuts）；`transcriptRows` 是
 * `[id, 文字, 开始秒, 结束秒, 是否保留]` 的简写，按素材采样率换算成词块。同名时自动加时间戳。
 * 返回 `{ id, path, name, source }`。
 */
async function createAudioEditDocument(page, { sourcePath, name, patch = {}, transcriptRows = null, granularity = 'segment' }) {
  return await page.evaluate(async ({ sourcePath, name, patch, transcriptRows, granularity, batchSettings }) => {
    const audio = window.henjiNative?.audio
    const documents = window.henjiNative?.documents
    if (!audio || !documents) throw new Error('口播或文档 preload 不可用')
    const source = await audio.probeEditSource(sourcePath)
    const transcript = transcriptRows
      ? transcriptRows.map(([id, text, start, end, included]) => ({
        id, text, startFrame: Math.round(start * source.sampleRate), endFrame: Math.round(end * source.sampleRate), included, locked: false, granularity,
      }))
      : []
    const content = { source, referenceScript: '', transcript, suggestions: [], vstEnabled: false, cuts: [], processorChain: [], batchSettings, ...patch }
    const create = (documentName) => documents.createDocument({ kind: 'audio_edit', container: { kind: 'user' }, name: documentName, content })
    let read
    try {
      read = await create(name)
    } catch (error) {
      if (!String(error?.message ?? error).includes('同名')) throw error
      read = await create(`${name} ${Date.now()}`)
    }
    return { id: read.meta.id, path: read.meta.path, name: read.meta.name, source }
  }, { sourcePath, name, patch, transcriptRows, granularity, batchSettings: DEFAULT_BATCH_SETTINGS })
}

/** 读口播文档（元信息 + 内容，内容里的位置是绝对路径）。 */
async function readAudioEditDocument(page, id) {
  return await page.evaluate((id) => window.henjiNative.documents.readDocument({ id }), id)
}

/** 改口播内容：`patch` 合并进当前内容后按版本写回。 */
async function updateAudioEditDocument(page, id, patch) {
  return await page.evaluate(async ({ id, patch }) => {
    const documents = window.henjiNative.documents
    const read = await documents.readDocument({ id })
    return (await documents.saveDocument({ target: { id }, expectedRevision: read.meta.revision, content: { ...read.content, ...patch } })).meta
  }, { id, patch })
}

/**
 * 在测试进程里轮询口播文件内容，直到 `predicate(content)` 为真（自动保存有防抖）。
 * 不用 page.waitForFunction 的异步谓词：它返回的 Promise 恒为真值，等于没等。
 */
async function waitForAudioEditContent(page, id, predicate, { timeout = 10000, message = '口播文件内容没有达到预期' } = {}) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    last = (await readAudioEditDocument(page, id)).content
    if (predicate(last)) return last
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`${message}（等待 ${timeout} 毫秒）`)
}

/** 清理：删掉文档文件并从作品索引移除（不进系统回收站）。失败只忽略，不影响场景结论。 */
async function removeAudioEditDocument(page, id) {
  if (!id) return
  try {
    const read = await readAudioEditDocument(page, id)
    fs.rmSync(read.meta.path, { force: true })
    await page.evaluate((id) => window.henjiNative.documents.forgetDocument(id), id)
  } catch {
    // 场景可能已经删除或移动了它
  }
}

module.exports = { createAudioEditDocument, readAudioEditDocument, updateAudioEditDocument, waitForAudioEditContent, removeAudioEditDocument }
