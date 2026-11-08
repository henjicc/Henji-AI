/** 比例格按“横竖成对”排列，AspectRatioTiles 的排布规则。 */
export interface AspectRatioTileOption {
  value: string | number
  label: string
  /** 宽高比；解析不出的选项（如“跟随输入”）与智能、方形一起排在最前 */
  ratio: { width: number; height: number } | null
  smart?: boolean
}

export interface AspectTierOption {
  value: string | number
  label: string
  disabled?: boolean
}

/** 一列两格：上横下竖。缺的那一格留空，保持“上面一行都是横的、下面一行都是竖的”。 */
export interface RatioColumn {
  key: string
  top: AspectRatioTileOption | null
  bottom: AspectRatioTileOption | null
}

function elongation(ratio: { width: number; height: number }): number {
  return Math.max(ratio.width, ratio.height) / Math.min(ratio.width, ratio.height)
}

/**
 * 智能、方形和解析不出的选项按声明顺序两两成列放在最前；其余每个横比例与它的转置竖比例（4:3 与 3:4）
 * 合成一列，按从接近方形到最极端排开。找不到转置的也单独成列，横的在上、竖的在下。
 */
export function pairAspectRatioColumns(options: readonly AspectRatioTileOption[]): RatioColumn[] {
  const lead: AspectRatioTileOption[] = []
  const landscape: AspectRatioTileOption[] = []
  const portrait: AspectRatioTileOption[] = []
  for (const option of options) {
    if (option.smart || !option.ratio || option.ratio.width === option.ratio.height) lead.push(option)
    else if (option.ratio.width > option.ratio.height) landscape.push(option)
    else portrait.push(option)
  }

  const columns: RatioColumn[] = []
  for (let index = 0; index < lead.length; index += 2) {
    columns.push({ key: `lead-${index}`, top: lead[index], bottom: lead[index + 1] ?? null })
  }

  const shaped: Array<RatioColumn & { elongation: number }> = []
  const unpaired = [...portrait]
  for (const top of landscape) {
    const ratio = top.ratio as { width: number; height: number }
    const matchIndex = unpaired.findIndex(candidate => {
      const other = candidate.ratio as { width: number; height: number }
      return Math.abs(other.width / other.height - ratio.height / ratio.width) < 1e-6
    })
    const bottom = matchIndex >= 0 ? unpaired.splice(matchIndex, 1)[0] : null
    shaped.push({ key: String(top.value), top, bottom, elongation: elongation(ratio) })
  }
  for (const bottom of unpaired) {
    shaped.push({ key: String(bottom.value), top: null, bottom, elongation: elongation(bottom.ratio as { width: number; height: number }) })
  }
  shaped.sort((left, right) => left.elongation - right.elongation)
  return [...columns, ...shaped.map(({ key, top, bottom }) => ({ key, top, bottom }))]
}
