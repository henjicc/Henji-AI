# 项目结构与架构说明

> 本文档描述 Refactor 2026 重构后的系统架构与目录结构。

## 1. 核心架构理念

Henji-AI 采用 **配置驱动 (Configuration-Driven)** 与 **适配器模式 (Adapter Pattern)** 相结合的架构。

*   **Model Definitions (`src/models`)**: 声明式地定义模型参数、校验规则、UI 布局和联动逻辑。
*   **Core Kernel (`src/core`)**: 负责加载模型定义、处理参数联动、构建请求 pipeline。
*   **Adapters (`src/adapters`)**: 处理不同厂商的具体 API 调用细节。
*   **UI Layer (`src/components`)**: 根据 Core 提供的元数据动态渲染界面。

## 2. 目录结构概览 (File Tree)

```text
src/
├── adapters/               # [适配层] 厂商 API 对接实现
│   ├── base/               # 基础适配器类
│   ├── ppio/               # PPIO (皮皮) 适配器
│   ├── fal/                # Fal.ai 适配器
│   └── ...
├── components/             # [视图层] React 组件
│   ├── MediaGenerator/     # 核心生成器界面 (重构重点)
│   ├── ui/                 # 基础 UI 组件库
│   └── ...
├── core/                   # [内核] 核心业务逻辑 (不含 UI)
│   ├── linkage/            # 参数联动引擎
│   ├── panels/             # 面板注册表
│   ├── request/            # 请求构建器 (RequestBuilder)
│   ├── types/              # 核心类型定义 (ModelDefinition 等)
│   ├── ModelRegistry.ts    # 模型注册中心
│   ├── defineModel.ts      # 模型定义工具函数
│   └── tags.ts             # 标签系统
├── models/                 # [定义层] 具体的模型配置文件
│   ├── ppio/               # PPIO 模型定义 (e.g., wan2_6.ts)
│   ├── fal/                # Fal 模型定义
│   └── ...
├── services/               # [服务层] 数据与后台服务
│   ├── database/           # SQLite 数据库集成
│   ├── presets/            # 预设管理服务
│   ├── customModels/       # 自定义模型服务
│   └── taskQueue.ts        # 任务队列
├── hooks/                  # [Hooks] 通用 React Hooks
├── utils/                  # [工具] 纯函数工具库
└── workspaces/             # [工作区] 顶层页面布局
```

## 3. 详细模块说明

### 3.1 Core (内核层)

`src/core` 是系统的 "大脑"，负责逻辑流转。

*   **`ModelRegistry`**: 单例注册中心，管理所有已注册的模型、适配器和面板。
*   **`linkage/`**: 处理参数之间的动态依赖关系（例如：选择 "Video" 模式时隐藏 "Image Size" 选项）。
*   **`request/`**: `RequestBuilder` 负责将用户的 UI 参数转换为最终的 API Payload。
*   **`NodeConverter`**: 负责将模型配置转换为 ComfyUI 风格的节点结构（为将来的工作流编排做准备）。

### 3.2 Models (定义层)

`src/models` 包含纯配置代码，不包含复杂逻辑。

*   使用 `defineModel` 定义模型。
*   描述参数 Schema (Zod)、UI 分组、默认值。
*   定义 `autoSwitch` 和 `effect` 等联动规则。

### 3.3 Adapters (适配层)

`src/adapters` 屏蔽厂商差异。

*   每个厂商有一个主 Adapter (如 `PPIOAdapter`)。
*   每个模型可以有专属的 Handler (如 `Wan26Handler`) 来处理特殊的参数映射。
*   统一输出标准化的流式响应或完成事件。

### 3.4 Services (服务层)

`src/services` 处理持久化和后台任务。

*   **Database**: 使用 `sqlite` 存储历史记录、草稿和自定义模型配置。
*   **Presets**: 管理用户保存的参数预设。

### 3.5 Components (视图层)

*   **`MediaGenerator`**: 主界面容器。
*   **`ParamsPanel`**: 根据当前模型的 Schema 自动渲染参数表单。
*   **`PreviewArea`**: 展示生成的媒体结果。

---

> 如需修改模型参数或添加新模型，通常只需要在 `src/models` 添加定义，并在 `src/adapters` 添加简单的映射逻辑，核心 UI 会自动适配。
