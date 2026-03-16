interface SizePresetTier {
  label: string
  pixels: number
}

export interface SizeDerivedOption {
  optionValue: string | number
  ratioText: string
  ratioValue: number
  tierLabel: string
  pixels: number
  disabled: boolean
}

export interface SizeDerivedSpec {
  options: SizeDerivedOption[]
  aspectOptions: Array<{ ratioText: string; ratioValue: number }>
  resolutionOptions: Array<{ tierLabel: string; sortKey: number }>
  valueMap: Map<string, SizeDerivedOption>
  pairMap: Map<string, string | number>
}

const SIZE_PRESET_TIERS: SizePresetTier[] = [
  { label: '480P', pixels: 480 * 832 },
  { label: '720P', pixels: 720 * 1280 },
  { label: '1080P', pixels: 1080 * 1920 },
  { label: '2K', pixels: 2048 * 2048 },
  { label: '4K', pixels: 4096 * 4096 },
]

export function parseRatio(value: string): { width: number; height: number } | null {
  const match = value.trim().match(/^(\d+)\s*:\s*(\d+)$/)
  if (!match) {
    return null
  }

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  return { width, height }
}

export function getRatioBoxSize(ratio: { width: number; height: number }): { width: number; height: number } {
  const max = 28
  const scale = Math.min(max / ratio.width, max / ratio.height)
  return {
    width: Math.max(8, Math.round(ratio.width * scale)),
    height: Math.max(8, Math.round(ratio.height * scale)),
  }
}

export function getResolutionGridColumns(optionCount: number): string {
  if (optionCount <= 2) return 'grid-cols-2'
  if (optionCount <= 3) return 'grid-cols-3'
  return 'grid-cols-4'
}

function parseDimensionText(text: string): { width: number; height: number } | null {
  const match = text.trim().match(/^(\d+)\s*[x*]\s*(\d+)$/i)
  if (!match) {
    return null
  }

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  return { width, height }
}

function getGcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a))
  let y = Math.abs(Math.round(b))
  while (y !== 0) {
    const temp = y
    y = x % y
    x = temp
  }
  return x || 1
}

function toRatioText(width: number, height: number): string {
  const gcd = getGcd(width, height)
  return `${Math.round(width / gcd)}:${Math.round(height / gcd)}`
}

function inferSizeTierLabel(pixels: number): { label: string; sortKey: number } {
  let best = SIZE_PRESET_TIERS[0]
  let bestDiff = Math.abs(pixels - best.pixels) / Math.max(1, best.pixels)

  for (const candidate of SIZE_PRESET_TIERS.slice(1)) {
    const diff = Math.abs(pixels - candidate.pixels) / Math.max(1, candidate.pixels)
    if (diff < bestDiff) {
      best = candidate
      bestDiff = diff
    }
  }

  if (bestDiff <= 0.4) {
    return { label: best.label, sortKey: best.pixels }
  }

  return { label: `${Math.round(Math.sqrt(pixels))}P`, sortKey: pixels }
}

interface BuildSizeDerivedSpecInputOption {
  value: string | number
  label: string
  disabled: boolean
}

export function buildSizeDerivedSpec(
  optionsInput: BuildSizeDerivedSpecInputOption[]
): SizeDerivedSpec | null {
  const options: SizeDerivedOption[] = []
  const aspectOptions: Array<{ ratioText: string; ratioValue: number }> = []
  const resolutionOptions: Array<{ tierLabel: string; sortKey: number }> = []
  const valueMap = new Map<string, SizeDerivedOption>()
  const pairMap = new Map<string, string | number>()
  const aspectSet = new Set<string>()
  const tierSet = new Set<string>()

  for (const option of optionsInput) {
    const fromValue =
      typeof option.value === 'string' ? parseDimensionText(option.value) : null
    const fromLabel = parseDimensionText(option.label)
    const dimension = fromValue ?? fromLabel
    if (!dimension) {
      return null
    }

    const ratioText = toRatioText(dimension.width, dimension.height)
    const ratioValue = dimension.width / dimension.height
    const pixels = dimension.width * dimension.height
    const tier = inferSizeTierLabel(pixels)
    const normalized = {
      optionValue: option.value,
      ratioText,
      ratioValue,
      tierLabel: tier.label,
      pixels,
      disabled: option.disabled,
    }

    options.push(normalized)
    valueMap.set(String(option.value), normalized)
    pairMap.set(`${ratioText}|${tier.label}`, option.value)

    if (!aspectSet.has(ratioText)) {
      aspectSet.add(ratioText)
      aspectOptions.push({ ratioText, ratioValue })
    }
    if (!tierSet.has(tier.label)) {
      tierSet.add(tier.label)
      resolutionOptions.push({ tierLabel: tier.label, sortKey: tier.sortKey })
    }
  }

  if (options.length === 0 || aspectOptions.length < 2 || resolutionOptions.length < 2) {
    return null
  }

  aspectOptions.sort((a, b) => b.ratioValue - a.ratioValue)
  resolutionOptions.sort((a, b) => a.sortKey - b.sortKey)

  return {
    options,
    aspectOptions,
    resolutionOptions,
    valueMap,
    pairMap,
  }
}

export function pickSizeDerivedValue(
  spec: SizeDerivedSpec,
  ratioText: string,
  tierLabel: string
): string | number | null {
  const exact = spec.pairMap.get(`${ratioText}|${tierLabel}`)
  if (exact !== undefined) {
    return exact
  }

  const sameRatio = spec.options.find((option) => option.ratioText === ratioText && !option.disabled)
  if (sameRatio) {
    return sameRatio.optionValue
  }

  const sameTier = spec.options.find((option) => option.tierLabel === tierLabel && !option.disabled)
  if (sameTier) {
    return sameTier.optionValue
  }

  const fallback = spec.options.find((option) => !option.disabled) ?? spec.options[0]
  return fallback ? fallback.optionValue : null
}

export function pickClosestRatioText(
  spec: SizeDerivedSpec,
  targetRatio: number
): string | null {
  if (spec.aspectOptions.length === 0) {
    return null
  }

  let best = spec.aspectOptions[0]
  let bestDiff = Math.abs(best.ratioValue - targetRatio)
  for (const candidate of spec.aspectOptions.slice(1)) {
    const diff = Math.abs(candidate.ratioValue - targetRatio)
    if (diff < bestDiff) {
      best = candidate
      bestDiff = diff
    }
  }
  return best.ratioText
}

export async function readImageRatio(source: string): Promise<number | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve(image.naturalWidth / image.naturalHeight)
        return
      }
      resolve(null)
    }
    image.onerror = () => resolve(null)
    image.src = source
  })
}
