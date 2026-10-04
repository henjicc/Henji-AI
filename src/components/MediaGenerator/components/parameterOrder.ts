import { getI18nText, type ModelParamPresentation, type ParamDef } from '@/core/types'
import {
  buildParamPresentationItems,
  getPresentedParamIds,
  type ParamPresentationItem,
} from '@/core/params/paramPresentation'

/**
 * 判断参数是否为「主选择器」——渠道 / 模式 / 版本 / 变体这类决定其余参数含义的入口选择。
 * 主选择器在生成面板中被提到比例 / 分辨率合并面板之前渲染。
 *
 * 只认 schema 里显式声明的 role，不按参数名文案猜测：文案猜测遇到没进白名单的新写法
 * （例如渠道多于两档时改用的自定义标签）会静默失效，参数掉回普通排序且不报错。
 * 漏写 role 由 modelParamConventionValidator 在模型注册时拦下（字面量中文名与共享词表 key 都认）。
 */
export function isPrimarySelectorParam(param: ParamDef): boolean {
  return param.role === 'channel' || param.role === 'mode'
}

const DURATION_PARAM_HINT = /(duration|video[_\s-]?length|时长|秒)/i

export function isDurationParam(param: ParamDef): boolean {
  const searchText = [
    param.id,
    param.apiField,
    String(getI18nText(param.name, 'zh') || ''),
    String(getI18nText(param.name, 'en') || ''),
  ]
    .filter(Boolean)
    .join(' ')
  return DURATION_PARAM_HINT.test(searchText)
}

/**
 * 工具条（单行参数条）里放不下的大块控件：多行文本、提示词编辑器、单选卡片、带刻度的数值、
 * 缩略图上传、无面板的复合控件。单行排布下它们固定收进“更多参数”浮层（任务 4.3），
 * 与 `ParamField inline={false}` / `ParamRenderer.asFormBlock` 的判定保持一致。
 */
export function isToolbarBlockParam(param: ParamDef): boolean {
  switch (param.type) {
    case 'radio':
    case 'textarea':
      return true
    case 'text':
      return param.multiline === true || param.editor?.kind === 'prompt'
    case 'number':
      return Array.isArray(param.marks) && param.marks.length > 0
    case 'image-upload':
      return !param.derivedMediaAuthoring
    case 'video-upload':
      return true
    case 'composite':
      return !param.panel
    default:
      return false
  }
}

export interface ParameterPanelLayout {
  /** 渠道 / 模式等主选择器，排在最前 */
  primary: ParamDef[]
  /** 是否渲染比例 / 分辨率合并面板（紧随主选择器） */
  hasSpecialPanel: boolean
  /** 其余参数与展示分组，按渲染顺序 */
  items: ParamPresentationItem[]
}

/**
 * 生成面板的参数渲染顺序（`ParameterPanel` 与单行溢出共用）：
 * 主选择器 → 比例/分辨率面板 → 时长（有合并面板且无展示分组时提前）→ 其余按 order，展示分组按自身 order。
 *
 * @param renderParams 已过滤可见性、且去掉被合并面板消费的参数
 */
export function resolveParameterPanelLayout(
  renderParams: ParamDef[],
  presentation: ModelParamPresentation | undefined,
  hasSpecialPanel: boolean,
): ParameterPanelLayout {
  const presentedParamIds = getPresentedParamIds(presentation)
  const primary = renderParams.filter((param) => !presentedParamIds.has(param.id) && isPrimarySelectorParam(param))
  const remaining = renderParams.filter((param) => presentedParamIds.has(param.id) || !isPrimarySelectorParam(param))
  if (presentation) {
    return { primary, hasSpecialPanel, items: buildParamPresentationItems(remaining, presentation) }
  }
  const ordered = hasSpecialPanel
    ? [...remaining.filter(isDurationParam), ...remaining.filter((param) => !isDurationParam(param))]
    : remaining
  return {
    primary,
    hasSpecialPanel,
    items: ordered.map((param) => ({ kind: 'param' as const, order: param.order, param })),
  }
}
