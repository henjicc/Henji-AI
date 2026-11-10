// 编辑器 UI 从 v3/editor 延迟加载；跨领域公开入口只暴露轻量应用操作。
export * from './v3/application/imageEditManagedSessionV3';
export * from './v3/application/imageEditMaterializationV3';
export { createImageDocument } from './documents/imageDocumentRuntime';
export { prepareImageEditSourceLocatorV3 } from './v3/application/imageEditSourceV3';
export * from './store/imageEditorUiStore';
