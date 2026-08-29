import { isNonMonetaryCurrency } from '@/core/types/PricingConfig'

export type PriceEstimateCurrency = 'CNY' | 'USD'

export type PriceEstimateCurrencyMode = 'auto' | 'cny' | 'usd'

export interface PriceEstimateDisplaySettings {
  showPriceEstimate: boolean
  currencyMode: PriceEstimateCurrencyMode
  usdToCnyRate: number
}

export interface FormatPriceEstimateOptions {
  amount: number
  sourceCurrencySymbol?: string
  displayCurrencyMode: PriceEstimateCurrencyMode
  language: string
  usdToCnyRate: number
}

export interface FormattedPriceEstimate {
  amount: number
  currency: PriceEstimateCurrency
  symbol: string
  display: string
  converted: boolean
  sourceCurrency?: PriceEstimateCurrency
}

export const DEFAULT_USD_TO_CNY_RATE = 6.77
export const SHOW_PRICE_ESTIMATE_STORAGE_KEY = 'show_price_estimate'
export const PRICE_ESTIMATE_CURRENCY_MODE_STORAGE_KEY = 'price_estimate_currency_mode'
export const USD_TO_CNY_RATE_STORAGE_KEY = 'usd_to_cny_rate'
export const PRICE_SETTING_CHANGED_EVENT = 'priceSettingChanged'

function trimPriceFraction(value: string): string {
  const [integer, fraction] = value.split('.')
  if (!fraction) return value

  let end = fraction.length
  while (end > 2 && fraction[end - 1] === '0') end -= 1
  return `${integer}.${fraction.slice(0, end)}`
}

function formatPrice(value: number): string {
  const absoluteValue = Math.abs(value)
  if (absoluteValue === 0 || absoluteValue >= 1) {
    return value.toFixed(2)
  }

  if (absoluteValue >= 0.01) {
    return trimPriceFraction(value.toFixed(3))
  }

  if (absoluteValue >= 0.0001) {
    return trimPriceFraction(value.toFixed(4))
  }

  // 更小的价格至少保留两位有效数字；去掉末尾补零后仍保证非零值可辨认。
  const fractionDigits = Math.max(5, Math.floor(-Math.log10(absoluteValue)) + 2)
  if (fractionDigits > 100) {
    return value.toExponential(1).replace(/\.0e/, 'e')
  }

  return trimPriceFraction(value.toFixed(fractionDigits))
}

/** 非货币单位（如魔搭魔粒）按整数数量展示，末尾多余的 0 去掉 */
function formatUnitAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}

export function normalizePriceEstimateCurrencyMode(
  input: DynamicValue
): PriceEstimateCurrencyMode {
  return input === 'cny' || input === 'usd' || input === 'auto' ? input : 'auto'
}

export function normalizeUsdToCnyRate(input: DynamicValue): number {
  const parsed = typeof input === 'number' ? input : Number(input)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_USD_TO_CNY_RATE
  }

  return Math.round(parsed * 10000) / 10000
}

export function resolveDisplayCurrency(
  mode: PriceEstimateCurrencyMode,
  language: string
): PriceEstimateCurrency {
  if (mode === 'cny') {
    return 'CNY'
  }

  if (mode === 'usd') {
    return 'USD'
  }

  return language.toLowerCase().startsWith('zh') ? 'CNY' : 'USD'
}

export function resolvePricingCurrency(
  currencySymbol?: string
): PriceEstimateCurrency | undefined {
  if (currencySymbol === '¥') {
    return 'CNY'
  }

  if (currencySymbol === '$') {
    return 'USD'
  }

  return undefined
}

export function resolveCurrencySymbol(currency: PriceEstimateCurrency): string {
  return currency === 'CNY' ? '¥' : '$'
}

export function convertPriceAmount(
  amount: number,
  sourceCurrency: PriceEstimateCurrency,
  targetCurrency: PriceEstimateCurrency,
  usdToCnyRate: number
): number {
  if (sourceCurrency === targetCurrency) {
    return amount
  }

  if (sourceCurrency === 'USD' && targetCurrency === 'CNY') {
    return amount * usdToCnyRate
  }

  return amount / usdToCnyRate
}

export function formatPriceEstimate(
  options: FormatPriceEstimateOptions
): FormattedPriceEstimate {
  const targetCurrency = resolveDisplayCurrency(
    options.displayCurrencyMode,
    options.language
  )
  const sourceCurrency = resolvePricingCurrency(options.sourceCurrencySymbol)

  if (!sourceCurrency) {
    const symbol = options.sourceCurrencySymbol || resolveCurrencySymbol(targetCurrency)

    // 非货币单位（魔粒等）不能换算，也不该写成 "魔粒2.00"，按「数量 + 单位」渲染
    if (isNonMonetaryCurrency(options.sourceCurrencySymbol)) {
      return {
        amount: options.amount,
        currency: targetCurrency,
        symbol,
        display: `${formatUnitAmount(options.amount)} ${symbol}`,
        converted: false,
      }
    }

    return {
      amount: options.amount,
      currency: targetCurrency,
      symbol,
      display: `${symbol}${formatPrice(options.amount)}`,
      converted: false,
    }
  }

  const convertedAmount = convertPriceAmount(
    options.amount,
    sourceCurrency,
    targetCurrency,
    normalizeUsdToCnyRate(options.usdToCnyRate)
  )
  const symbol = resolveCurrencySymbol(targetCurrency)

  return {
    amount: convertedAmount,
    currency: targetCurrency,
    symbol,
    display: `${symbol}${formatPrice(convertedAmount)}`,
    converted: sourceCurrency !== targetCurrency,
    sourceCurrency,
  }
}

export function readPriceEstimateDisplaySettings(): PriceEstimateDisplaySettings {
  if (typeof localStorage === 'undefined') {
    return {
      showPriceEstimate: true,
      currencyMode: 'auto',
      usdToCnyRate: DEFAULT_USD_TO_CNY_RATE,
    }
  }

  return {
    showPriceEstimate:
      localStorage.getItem(SHOW_PRICE_ESTIMATE_STORAGE_KEY) !== 'false',
    currencyMode: normalizePriceEstimateCurrencyMode(
      localStorage.getItem(PRICE_ESTIMATE_CURRENCY_MODE_STORAGE_KEY)
    ),
    usdToCnyRate: normalizeUsdToCnyRate(
      localStorage.getItem(USD_TO_CNY_RATE_STORAGE_KEY)
    ),
  }
}
