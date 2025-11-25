/**
 * 计算进度，支持渐近式增长
 * @param current 当前消耗（时间或次数）
 * @param expected 预期消耗（时间或次数）
 * @returns 进度值 (0-99)
 */
export const calculateProgress = (current: number, expected: number): number => {
    if (current <= expected) {
        // 预期范围内：使用 easeOutQuad 快速到达 95%
        const ratio = current / expected
        // easeOutQuad: 1 - (1 - t) * (1 - t)
        const easeProgress = 1 - (1 - ratio) * (1 - ratio)
        return Math.floor(easeProgress * 95)
    } else {
        // 超过预期：缓慢逼近 99%
        // 使用指数衰减
        // 假设衰减常数为预期的 50% (即超过预期时间的一半后，差距缩小约 63%)
        const extra = current - expected
        const decay = expected * 0.5
        const extraProgress = 4 * (1 - Math.exp(-extra / decay))
        return Math.min(99, 95 + Math.floor(extraProgress))
    }
}
