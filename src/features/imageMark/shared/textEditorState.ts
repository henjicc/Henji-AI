/** 原位文字输入框的状态：V3 标注覆盖层与快速标记编辑器（MarkEditor）共用。 */
export interface TextEditorState {
  /** text: 独立文字;label: 挂在图形旁的标签 */
  kind: 'text' | 'label';
  /** text 模式为文字项 id(新建为 null);label 模式为宿主图形 id */
  itemId: string | null;
  x: number;
  y: number;
  value: string;
  /** 原位输入使用的字号(图片像素)与颜色,与最终渲染一致 */
  fontSize: number;
  color: string;
  /** 缺省表示关闭纯色背景。 */
  backgroundColor?: string;
}
