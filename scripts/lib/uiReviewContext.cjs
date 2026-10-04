/**
 * 步骤描述（uiReviewSteps）用的操作助手：直接复用正式场景的 attach 函数（打开工作区、关闭浮层、
 * 打开模型面板、画布夹具工程），不复制它们的实现。
 *
 * 只挂载步骤动作用到的三组：通用、生成、画布工作区（后者在挂载时解构前两者的函数，顺序不能换）。
 * TAB_NAMES 与 uiInspectionScenes.cjs 中的同名常量一致（那份文件不导出它）；
 * 以后场景注册表导出共用上下文时，这里改为直接取用。
 */
const { attachUiInspectionCommon } = require('./uiInspectionSceneCommon.cjs')
const { attachUiInspectionGeneration } = require('./uiInspectionSceneGeneration.cjs')
const { attachUiInspectionCanvasWorkspace } = require('./uiInspectionSceneCanvasWorkspace.cjs')

const TAB_NAMES = Object.freeze({
  generation: /^(生成|Generation)$/i,
  canvas: /^(画布|Canvas)$/i,
  toolbox: /^(工具|Tools)$/i,
  assets: /^(资产|Assets)$/i,
})

/** 步骤动作依赖的助手；缺任何一个都说明正式场景的 attach 改了名字，应同步这里。 */
const REQUIRED_REVIEW_HELPERS = Object.freeze([
  'closeTransientUi', 'openWorkspace', 'openGenerationModelPanel', 'setupCanvas', 'reopenCanvasProjectFromStorage',
  'setupGeneration',
])

function createReviewStepContext({ canvasFixtureProjectId, settlePage }) {
  const context = {
    canvasFixtureProjectId,
    settlePage,
    TAB_NAMES,
    REFERENCE_FIXTURE_IMAGE: `${process.cwd()}/resources/icons/icon.png`,
  }
  attachUiInspectionCommon(context)
  attachUiInspectionGeneration(context)
  attachUiInspectionCanvasWorkspace(context)
  const missing = REQUIRED_REVIEW_HELPERS.filter((name) => typeof context[name] !== 'function')
  if (missing.length) throw new Error(`步骤描述缺少场景助手：${missing.join('、')}`)
  return context
}

module.exports = { REQUIRED_REVIEW_HELPERS, TAB_NAMES, createReviewStepContext }
