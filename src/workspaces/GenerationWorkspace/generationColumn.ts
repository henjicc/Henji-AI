/**
 * 生成页的内容列宽：命令带、生成记录列与输入卡片三者共用（设计稿 Generation：输入卡片与记录列外框同宽）。
 *
 * 任务 5.3：原先固定 896（max-w-4xl），1440 与 960 窗口下底栏完全一样，宽窗口下参数仍被收进“更多参数”。
 * 改为随窗口变宽、上限 1152（max-w-6xl）：1440 窗口下收纳行多出约 250px，常见视频模型的分辨率与时长
 * 能回到底栏；记录列同宽，卡片两侧与记录文字的对位关系不变。再宽则提示词与记录正文行长过长，不再放开。
 */
export const GENERATION_COLUMN_MAX_WIDTH_PX = 1152

/** 与 `GENERATION_COLUMN_MAX_WIDTH_PX` 对应的 Tailwind 类（72rem = 1152px）。 */
export const GENERATION_COLUMN_MAX_WIDTH_CLASS = 'max-w-6xl'
