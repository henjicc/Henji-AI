'use strict'

const fs = require('node:fs')

/*
 * 真实 Electron 脚本（Reality / 巡检 / 基准）造画布数据的 Node 侧入口（3.4 起画布是 `.henji-canvas` 文档）。
 *
 * 转给页面里的 window.henjiNative.testFixtures 画布方法（只在自动化 / 隔离测试模式下存在，
 * 实现见 electron/preload/canvas-test-fixtures.ts，全部经正式文档接口，不再直接写数据库）：
 * - 内容（节点、连线、媒体池、内嵌包位置）在文档文件里；
 * - 视口与撤销记录按文档 ID 存程序目录的会话状态；
 * - 新建可以沿用固定文档 ID，名称落在作品目录“画布/”。
 * 页面里的 evaluate 直接调 window.henjiNative.testFixtures.readCanvas / writeCanvas 即可，形状相同。
 *
 * 应用里已经打开的画布有内存实例：直接改文件后要 reload（或先返回列表关闭会话）再打开，才会按文件重新读取。
 */

/** 读一份画布：{ id, name, path, revision, draft, nodes, edges, imagePool, layerPackages, viewport, history }；不存在返回 null。 */
async function readCanvasDocument(page, id) {
  return await page.evaluate((docId) => window.henjiNative.testFixtures.readCanvas(docId), id)
}

/** 按名称找画布（最新的一份）；没有返回 null。 */
async function findCanvasDocumentByName(page, name) {
  return await page.evaluate((documentName) => window.henjiNative.testFixtures.findCanvasByName(documentName), name)
}

/** 改写画布内容（只改给了的 nodes / edges / imagePool，保留其他字段），给了 viewport 一并写会话状态。返回新版本号。 */
async function writeCanvasDocument(page, id, patch = {}) {
  return await page.evaluate(({ docId, value }) => window.henjiNative.testFixtures.writeCanvas(docId, value), {
    docId: id,
    value: JSON.parse(JSON.stringify(patch)),
  })
}

/**
 * 新建一份已命名的画布（默认作品目录“画布/”），可沿用给定 ID。已有同 ID 的：replace 时改写内容，否则原样保留。
 * 返回 { id, name, path, created }。
 */
async function createCanvasDocument(page, request) {
  return await page.evaluate((value) => window.henjiNative.testFixtures.createCanvas(value), JSON.parse(JSON.stringify(request)))
}

/**
 * 清理脚本造的画布：删掉文档文件并从作品索引移除（不存在的跳过）。不往系统回收站里放测试文件
 * （与口播夹具 audioEditDocumentFixture.cjs 同一做法）；画布若正打开着，先返回列表让会话关闭。
 */
async function removeCanvasDocuments(page, ids) {
  for (const id of ids) {
    try {
      const document = await readCanvasDocument(page, id)
      if (!document) continue
      fs.rmSync(document.path, { force: true })
      await page.evaluate((docId) => window.henjiNative.documents.forgetDocument(docId), id)
    } catch {
      // 场景可能已经删除或移动了它
    }
  }
}

module.exports = {
  createCanvasDocument,
  findCanvasDocumentByName,
  readCanvasDocument,
  removeCanvasDocuments,
  writeCanvasDocument,
}
