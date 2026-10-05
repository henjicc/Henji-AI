/**
 * 剪辑场景共用的界面几何常量（5.8）。必须与源码同值：精确测试 uiInspection.test.cjs 比对
 * src/features/videoEdit/timeline/timelineGeometry.ts 的 TIMELINE_HEADER_WIDTH。
 * 单独成文件：剪辑场景模块之间互相引用，放进它们任何一个里都会在循环依赖里读到 undefined。
 */
const VIDEO_EDIT_TRACK_HEADER_WIDTH = 232

module.exports = { VIDEO_EDIT_TRACK_HEADER_WIDTH }
