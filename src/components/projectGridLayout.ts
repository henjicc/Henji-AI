/**
 * 项目卡片网格的横向布局：列数由可用宽度算出，不写断点。
 *
 * 这两个类必须放在一起改——列数上限是靠"限制可用宽度"反推出来的，
 * CSS 的 auto-fill 没有"最多几列"的写法。三个数（最小卡宽 / gap / 最大宽度）互相绑死。
 */

/** 网格自身的列定义。`min(16rem,100%)` 保证窗口窄于一张卡时不横向溢出。 */
export const PROJECT_GRID_COLUMNS_CLASS = 'grid-cols-[repeat(auto-fill,minmax(min(16rem,100%),1fr))]';

/**
 * 内容区最大宽度：**列数上限 7 就是靠这个数实现的**。
 *
 *   列数 = floor((可用宽 + gap) / (最小卡宽 + gap))
 *   要恰好 7 列：可用宽 ∈ [7×16rem + 6×1rem, 8×16rem + 7×1rem) = [118rem, 135rem)
 *
 * 取 134rem 是落在区间上沿，好让第 7 列成立时卡片还能长到约 292px，而不是贴着 256px 的下限。
 * 更宽的窗口两侧留白，不再加第 8 列。标题区与网格共用这个宽度，
 * 否则超宽屏上「新建」按钮会飞到网格右边之外。
 */
export const PROJECT_GRID_MAX_WIDTH_CLASS = 'max-w-[134rem]';
