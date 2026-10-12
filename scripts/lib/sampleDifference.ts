/** 检查所有样本后集中断言；exact 使用 Object.is，close 保留 Vitest 的严格小于阈值。 */
export function sampleDifference(actual: ArrayLike<number>, expected: ArrayLike<number> | ((index: number) => number), precision?: number): { differences: number; first: number; maximumError: number; lengthDifference: number } {
  let differences = 0, first = -1, maximumError = 0
  for (let index = 0; index < actual.length; index++) {
    const target = typeof expected === 'function' ? expected(index) : expected[index]
    const error = Math.abs(actual[index] - target)
    const equal = precision === undefined ? Object.is(actual[index], target)
      : (actual[index] === target && !Number.isNaN(target)) || error < 10 ** -precision / 2
    if (!equal) { differences++; if (first === -1) first = index; maximumError = Math.max(maximumError, Number.isNaN(error) ? Infinity : error) }
  }
  return { differences, first, maximumError, lengthDifference: typeof expected === 'function' ? 0 : actual.length - expected.length }
}
