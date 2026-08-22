/**
 * 样式渲染（深度/线稿等）在场景图上的两个标记位。
 *
 * 样式渲染整场替换材质，three.js 侧看不出"这块是主体、那块是编辑辅助"，
 * 因此由挂载方在节点 userData 上标出来，渲染器只认这两个键。
 */

/** 参与深度范围统计的主体节点（场景对象根 group）。地面等背景不算主体，否则深度范围会被地面拉平。 */
export const STAGE_STYLE_SUBJECT_KEY = 'stageStyleSubject'

/** 样式渲染期间隐藏的编辑辅助节点（无限网格线等），避免它们被当成实体几何画进成片。 */
export const STAGE_STYLE_HIDDEN_KEY = 'stageStyleHidden'
