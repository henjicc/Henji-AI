import type { ComponentType as ReactComponentType } from 'react';

import type { CanvasNodeDefinition } from '@/features/canvas/domain/nodeRegistry';
import { registerCanvasNode } from '@/features/canvas/domain/nodeRegistry';

/**
 * 第三方画布节点扩展接口（预留，本期不接安装/加载 IO）。
 *
 * 设计目标：第三方节点 = "又一个被注册的 CanvasNodeDefinition"。
 * 扩展通过 registerNodes 提供节点定义、registerWidgets 提供自定义取值控件，
 * 由 applyCanvasExtension 注入到与内置节点一致的注册表中。
 *
 * 借鉴 ComfyUI 的 ComfyExtension：name + 节点注册 + widget 注册 + 生命周期钩子。
 */
export interface CanvasExtension {
  /** 扩展唯一名（用于去重与诊断） */
  name: string;
  /** 返回要注册的节点定义列表 */
  registerNodes?: () => CanvasNodeDefinition[];
  /** 返回自定义参数控件（按 componentType / socketType 索引） */
  registerWidgets?: () => Record<string, CanvasWidgetRenderer>;
  /** 扩展加载完成后的回调（预留） */
  onReady?: () => void;
}

/** 自定义参数控件渲染器签名（与 src/components/params 的控件 props 对齐） */
export type CanvasWidgetRenderer = ReactComponentType<{
  value: DynamicValue;
  onChange: (value: DynamicValue) => void;
  disabled?: boolean;
}>;

/** 自定义控件注册表（按 componentType / socketType 索引） */
const widgetRegistry = new Map<string, CanvasWidgetRenderer>();

export function registerCanvasWidget(key: string, renderer: CanvasWidgetRenderer): void {
  widgetRegistry.set(key, renderer);
}

export function getCanvasWidget(key: string): CanvasWidgetRenderer | undefined {
  return widgetRegistry.get(key);
}

const appliedExtensions = new Set<string>();

/** 应用一个扩展：注册其节点与控件（幂等，按 name 去重） */
export function applyCanvasExtension(extension: CanvasExtension): void {
  if (appliedExtensions.has(extension.name)) {
    return;
  }
  appliedExtensions.add(extension.name);

  for (const definition of extension.registerNodes?.() ?? []) {
    registerCanvasNode(definition);
  }
  const widgets = extension.registerWidgets?.() ?? {};
  for (const [key, renderer] of Object.entries(widgets)) {
    registerCanvasWidget(key, renderer);
  }
  extension.onReady?.();
}

/**
 * 加载第三方画布扩展（Phase 3 实现）。
 *
 * TODO: 接入扩展目录扫描 / 动态 import / 安全沙箱与权限校验。
 * 目前仅占位，确保上层调用点与注册链路已就位。
 */
export async function loadThirdPartyCanvasExtensions(): Promise<void> {
  // 预留接口：本期不实现安装/加载 IO。
}
