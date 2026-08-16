# 应用能力定义范式

## 目录

- 结构边界
- 字段选择
- 查询、计划与提交
- 稳定引用
- 前后端归属
- 测试清单

## 结构边界

实体、属性和集合 CRUD 放在 Application Control 反射注册表；只有无法用 CRUD 表达的算法操作才放在 `src/core/assistant/` 的领域模块，并汇入统一 `ApplicationCapabilityRegistry`。两类定义都只包含跨层契约，不导入组件、Store 实现、Electron 主进程服务或业务处理器。

渲染层和主进程分别维护模块级处理器注册。Agent Runtime 从同一份定义生成模型工具，不再手写第二份 `AgentToolDefinition` 元数据。

## 字段选择

| 字段 | 选择规则 |
|---|---|
| `id` | 使用稳定业务动词与名词，不包含页面组件名 |
| `domain` | 使用业务领域，如 `settings`、`generation`、`assets`、`canvas` |
| `aliases` | 覆盖用户自然语言、当前页面指代和常见英文 |
| `readOnly` | 不改变持久或可见应用状态时才为 `true` |
| `risk` | R0 读取/导航；R1 可逆普通写入；R2 付费或外部写入；R3 删除/覆盖；R4 拒绝 |
| `dataClasses` | C0 公共状态；C1 普通用户数据；C2 敏感状态；C3 禁止进入模型 |
| `permission` | 使用稳定的 `领域:read` 或 `领域:write` 权限 |
| `idempotent` | 相同输入重复执行不会产生额外副作用时才为 `true` |
| `requiredScopes` | 只声明真正参与 revision 与可用性判断的作用域 |
| `availability` | 描述业务可用条件，不以“页面已打开”代替可复用服务 |
| `successEvidence` | 写明可由输出或宿主状态确定性验证的事实 |
| `failureRecovery` | 写明刷新、重读 schema、重新获取引用或请求澄清；禁止猜名称 |

AI 输入 schema 还必须满足：

- 顶层 `additionalProperties: false`，所有可执行参数均显式列出。
- 除 `run_henji_script@1` 的受限 `source` 外，不得出现 `patch`、`storePatch`、`executeScript`、`script`、`code` 等开放式控制字段；`source` 只允许解析为自有 IR，永不执行 JavaScript。
- 不得接受 Store 对象、组件状态、原始文件路径或任意键值对象来间接修改业务数据。
- 需要扩展公开参数时，先扩展领域 schema/注册表，再由能力引用同一真相源。

## 公共控制面覆盖

新增用户可见功能时按真实注册源补齐：

| 对象 | 必须覆盖 |
|---|---|
| 实体/属性 | 稳定 ID、schemaRef、权限、revision、正式反射提供者 |
| 语义操作 | 输入/输出 schema、影响声明、风险、撤销/补偿、成功证据 |
| Surface | 打开策略、稳定目标、观察提供者、捕获范围、数据等级、遮罩、模态与失效条件 |
| 模型/媒体 | 唯一模态声明、provider 可表达性、primary/observer 路由、大小/时长/编码限制 |
| 长任务 | 正式服务、等待/取消/恢复状态、Artifact 与结构化日志 |

Application Control 反射注册表是实体、属性与集合 CRUD 的唯一真相源，`ApplicationCapabilityDefinition` 是算法操作的唯一真相源，领域注册表和 Surface 目录分别维护执行与界面事实；`scriptApi` 和覆盖清单只聚合、投影并验证，不复制第二份业务 schema。

## Henji Script 编排与提交

模型侧的复杂或批量应用操作统一使用一次 `run_henji_script@1`：

1. 能力发现返回当前租约允许的 `app.entities`、`app.action`、`app.recipe` 和 `app.assert`，并合并真实反射 schema。
2. 模型只表达业务参数和数据依赖；宿主编译为受控 IR，注入版本、revision、权限、availability、Effect Contract 与验证契约。
3. 无输出依赖的相邻实体写入自动合并到同一 Application Control 事务；算法操作经 `app.action` 进入相同 Gateway。
4. 每个步骤从正式状态源读回验证，最终以 Effect Receipt 和状态差异双向对账结算。

领域内部确需“预览/审批后提交”的高风险算法操作，可以保留不透明计划引用，但它是业务能力契约，不是模型逐步编排协议。禁止让模型手工管理能力版本、expected revision、输出路径或引用占位符。

删除、覆盖、付费和外部写入继续经过统一审批，不在处理器内部自行降低风险等级。

## 稳定引用

跨模块只传：

```ts
{
  kind: 'generation.result',
  id: 'opaque-id',
  revision: 3,
  label: '最后一张图片'
}
```

- `kind` 表示稳定实体类型。
- `id` 使用不透明标识，不使用原始本地路径。
- `revision` 在实体会变化时提供。
- `label` 只供用户理解，不用于实体查找。

大结果继续走 artifact offload，能力输出只返回摘要和引用。

## 前后端归属

放渲染层：

- 当前 Surface、选中状态和焦点。
- 打开、关闭或定位界面。
- 依赖已挂载编辑器实例的即时预览。

放主进程或独立核心服务：

- 文件、数据库、网络和系统设置。
- 生成任务、导入导出和长耗时处理。
- 跨页面复用的查询、校验、计划和持久化写入。

不得为了复用现有组件状态，把本应属于业务服务的能力长期留在页面组件里。

## 测试清单

- 注册重复 ID、版本冲突、空权限和空成功证据时失败。
- 输入和输出分别经过 schema 校验。
- expected revision 不匹配时不执行写入。
- 权限模式覆盖明确用户意图、推断写入和高风险操作。
- 敏感值、密钥、授权头与原始路径不进入输出、日志和会话。
- 搜索别名能找到目标能力，错误 Router 分类不阻断发现。
- 处理器成功后输出包含成功证据；失败时返回稳定错误码。
- 跨模块引用失效时重新读取来源，不创建无关项目。
- 首次 `scriptApi` 投影能看到真实 enum、范围、引用形状和写 operation；非法字面量及条件分支候选在 Gateway 调用数为 0 时拒绝。
- 多步骤脚本只通过同一 IR/解释器执行，Recipe 不得拥有第二套执行器、Effect、补偿或验证逻辑。
- 写入后的每项正式状态差异都有 Effect Receipt，每项 receipt 都能在最终状态找到对应变化；evidence 不能推动结算。
