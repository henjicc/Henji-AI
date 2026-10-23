/*
 * 项目制作进度：项目文件夹根目录的一份 Markdown（用户也能直接打开看、改）。
 * 做片子往往跨很多轮对话和会话，对话会被压缩或换人接手；进度写在项目里，谁接手都从这里接上。
 * 它只记进度，偏好与规则仍进项目记忆（document.project_memory），不另起一套。
 */

export const PROJECT_PROGRESS_FILE_NAME = '制作进度.md'

/** 单文件上限：保持一眼能读完，也防止整份工程说明塞进来。 */
export const PROJECT_PROGRESS_MAX_LENGTH = 20_000

export const PROJECT_PROGRESS_RULES = `项目里的长期任务（做一支片子、分多轮完成的创作）用项目属性 documents.project.progress 维护制作进度，它就是项目根目录的 ${PROJECT_PROGRESS_FILE_NAME}。开始在某个项目里工作先读它，按里面的“下一步”接着做；任务会跨多轮或多次会话而它还不存在时创建。完成一个阶段、做了决定、遇到卡点或收工前更新，整份写回（set），保留用户写的内容。结构：当前阶段、资料位置、进度清单（- [x] / - [ ]）、已定的决定、下一步、卡点/待确认；每条一行，写日期，过时的删掉，保持一眼能读完。只记进度，不记密钥；偏好与项目规则仍写项目记忆，验收仍以回读结果为准。`
