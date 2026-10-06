/**
 * 项目卡片网格的横向布局：列数由可用宽度算出，不写断点（设计稿 CanvasProjects，界面重设计 3.3）。
 *
 * 项目页的主区铺满左栏以外的全部宽度，不再封顶：auto-fill 让宽屏自动多排几列，
 * 每张卡不小于 15rem（240px），窗口窄于一张卡时 `min(15rem,100%)` 保证不横向溢出。
 */

/** 网格自身的列定义与间距（列 20、行 28）。 */
export const PROJECT_GRID_COLUMNS_CLASS = 'grid-cols-[repeat(auto-fill,minmax(min(15rem,100%),1fr))] gap-x-5 gap-y-7';
