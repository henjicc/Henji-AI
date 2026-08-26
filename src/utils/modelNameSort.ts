import { pinyin } from 'pinyin-pro'

const CJK_RUN = /[㐀-鿿]+/g

/** 把字符串里的中文替换成不带声调、按音节留空格的拼音，西文原样保留。 */
function toPinyinSortKey(name: string): string {
  return name.replace(CJK_RUN, (run) => pinyin(run, { toneType: 'none', type: 'array' }).join(' '))
}

/**
 * 设置面板专用的模型名称排序：中英文混排统一按 A-Z（中文按拼音首字母）排列，
 * 不再按类型/系列分组。只用于设置里的"显示与管理"和"别名"两个分区——
 * 画布、生成面板等其他模型列表继续沿用各自现有的类型/系列排序，不受影响。
 */
export function compareModelNamesForSettings(a: string, b: string): number {
  return toPinyinSortKey(a).localeCompare(toPinyinSortKey(b), 'en', { numeric: true, sensitivity: 'base' })
}
