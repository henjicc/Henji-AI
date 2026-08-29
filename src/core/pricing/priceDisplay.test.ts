import { describe, expect, it } from 'vitest'

import { formatPriceEstimate } from './priceDisplay'

describe('formatPriceEstimate', () => {
  it('一元或一美元以上的常规价格维持两位小数', () => {
    expect(formatPriceEstimate({
      amount: 1.5,
      sourceCurrencySymbol: '$',
      displayCurrencyMode: 'usd',
      language: 'en-US',
      usdToCnyRate: 6.77,
    }).display).toBe('$1.50')
  })

  it('一美分到一美元之间最多保留三位，避免抹掉有意义的小数', () => {
    expect(formatPriceEstimate({
      amount: 0.039,
      sourceCurrencySymbol: '$',
      displayCurrencyMode: 'usd',
      language: 'en-US',
      usdToCnyRate: 6.77,
    }).display).toBe('$0.039')

    expect(formatPriceEstimate({
      amount: 0.102,
      sourceCurrencySymbol: '$',
      displayCurrencyMode: 'usd',
      language: 'en-US',
      usdToCnyRate: 6.77,
    }).display).toBe('$0.102')

    expect(formatPriceEstimate({
      amount: 0.1,
      sourceCurrencySymbol: '$',
      displayCurrencyMode: 'usd',
      language: 'en-US',
      usdToCnyRate: 6.77,
    }).display).toBe('$0.10')
  })

  it('低于一美分的非零价格保留四位或动态扩展，不显示成零', () => {
    expect(formatPriceEstimate({
      amount: 0.00524288,
      sourceCurrencySymbol: '$',
      displayCurrencyMode: 'usd',
      language: 'en-US',
      usdToCnyRate: 6.77,
    }).display).toBe('$0.0052')

    expect(formatPriceEstimate({
      amount: 0.000042,
      sourceCurrencySymbol: '$',
      displayCurrencyMode: 'usd',
      language: 'en-US',
      usdToCnyRate: 6.77,
    }).display).toBe('$0.000042')
  })

  it('H3 美元估价在中文自动币种下只换算一次', () => {
    expect(formatPriceEstimate({
      amount: 0.65,
      sourceCurrencySymbol: '$',
      displayCurrencyMode: 'auto',
      language: 'zh-CN',
      usdToCnyRate: 6.77,
    }).display).toBe('¥4.40')
  })

  it('自动币种按语言双向换算，并使用用户设置的汇率', () => {
    expect(formatPriceEstimate({
      amount: 0.65,
      sourceCurrencySymbol: '$',
      displayCurrencyMode: 'auto',
      language: 'zh-CN',
      usdToCnyRate: 8,
    }).display).toBe('¥5.20')

    expect(formatPriceEstimate({
      amount: 3.6,
      sourceCurrencySymbol: '¥',
      displayCurrencyMode: 'auto',
      language: 'en-US',
      usdToCnyRate: 8,
    }).display).toBe('$0.45')
  })

  it('零价格仍维持两位小数', () => {
    expect(formatPriceEstimate({
      amount: 0,
      sourceCurrencySymbol: '$',
      displayCurrencyMode: 'usd',
      language: 'en-US',
      usdToCnyRate: 6.77,
    }).display).toBe('$0.00')
  })
})
