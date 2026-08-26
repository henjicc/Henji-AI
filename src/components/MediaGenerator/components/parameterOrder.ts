import type { ParamDef } from '@/core/types'

/**
 * 判断参数是否为「主选择器」——渠道 / 模式 / 版本 / 变体这类决定其余参数含义的入口选择。
 * 主选择器在生成面板中被提到比例 / 分辨率合并面板之前渲染。
 *
 * 只认 schema 里显式声明的 role，不按参数名文案猜测：文案猜测遇到没进白名单的新写法
 * （例如渠道多于两档时改用的自定义标签）会静默失效，参数掉回普通排序且不报错。
 * 漏写 role 由 modelParamConventionValidator 在模型注册时拦下。
 */
export function isPrimarySelectorParam(param: ParamDef): boolean {
  return param.role === 'channel' || param.role === 'mode'
}
