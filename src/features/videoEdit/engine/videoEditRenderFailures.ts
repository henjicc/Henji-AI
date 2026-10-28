import type { RenderResponse } from './videoEditWorker'

/**
 * 一帧渲染里算作失败的效果错误。片子数据里会让画面缺内容的问题（sceneIssues）也列在 effectErrors 里给节目监视器提示，
 * 但不是效果或源码的错：试渲染、样片预览与验收探针不因它失败，而是收进 notices 作为提示返回。
 */
export function videoEditRenderFailures(result: Pick<RenderResponse, 'effectErrors' | 'sceneIssues'>, notices?: Set<string>): string[] {
  for (const message of result.sceneIssues ?? []) notices?.add(message)
  return (result.effectErrors ?? []).filter(message => !result.sceneIssues?.includes(message))
}
