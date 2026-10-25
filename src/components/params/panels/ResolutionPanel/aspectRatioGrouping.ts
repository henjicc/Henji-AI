/** 比例格按形状分行（重要记录 021），AspectRatioTiles 的排布规则。 */
export interface AspectRatioTileOption {
  value: string | number
  label: string
  /** 宽高比；解析不出的选项（如“跟随输入”）排在第一行 */
  ratio: { width: number; height: number } | null
  smart?: boolean
}

export interface AspectTierOption {
  value: string | number
  label: string
  disabled?: boolean
}

export type RatioRow = { key: 'lead' | 'landscape' | 'portrait'; options: AspectRatioTileOption[] }

const SINGLE_ROW_LIMIT = 6

/** 按形状分行；少于等于 6 个时整体一行、保持原顺序。 */
export function groupAspectRatioOptions(options: readonly AspectRatioTileOption[]): RatioRow[] {
  if (options.length <= SINGLE_ROW_LIMIT) return [{ key: 'lead', options: [...options] }]
  const lead: AspectRatioTileOption[] = []
  const landscape: AspectRatioTileOption[] = []
  const portrait: AspectRatioTileOption[] = []
  for (const option of options) {
    if (option.smart || !option.ratio || option.ratio.width === option.ratio.height) lead.push(option)
    else if (option.ratio.width > option.ratio.height) landscape.push(option)
    else portrait.push(option)
  }
  const elongation = (option: AspectRatioTileOption): number => {
    const ratio = option.ratio as { width: number; height: number }
    return Math.max(ratio.width, ratio.height) / Math.min(ratio.width, ratio.height)
  }
  landscape.sort((left, right) => elongation(left) - elongation(right))
  portrait.sort((left, right) => elongation(left) - elongation(right))
  const rows: RatioRow[] = [
    { key: 'lead', options: lead },
    { key: 'landscape', options: landscape },
    { key: 'portrait', options: portrait },
  ]
  return rows.filter(row => row.options.length > 0)
}

