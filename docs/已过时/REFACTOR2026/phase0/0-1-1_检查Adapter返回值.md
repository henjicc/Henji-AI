# 0-1-1 检查Adapter返回值

## 目标

验证所有 Adapter 的 generateImage/Video/Audio 方法返回结构中包含 filePath 字段，确保历史记录不会保存 Base64 数据

## 背景

当前问题：
- 历史记录保存在 history.json
- 如果保存了 Base64 图片数据会导致文件急剧膨胀
- 可能导致应用启动缓慢或崩溃

正确做法：
- 只保存 filePath
- 不保存 url 字段（可能包含 base64）

## 前置依赖

无

## 实施步骤

1. [ ] 检查 PPIOAdapter 所有生成方法
   - `src/adapters/ppio/PPIOAdapter.ts`
   - 验证 generateImage 返回 `{ url, filePath, taskId }`
   - 验证 generateVideo 返回 `{ url, filePath, taskId }`
   - 验证 generateAudio 返回 `{ url, filePath, taskId }`

2. [ ] 检查 FalAdapter 所有生成方法
   - `src/adapters/fal/FalAdapter.ts`
   - 验证所有方法返回包含 filePath

3. [ ] 检查 KIEAdapter 所有生成方法
   - `src/adapters/kie/KIEAdapter.ts`
   - 验证所有方法返回包含 filePath

4. [ ] 检查 ModelscopeAdapter 所有生成方法
   - `src/adapters/modelscope/ModelscopeAdapter.ts`
   - 验证所有方法返回包含 filePath

5. [ ] 检查 BaseAdapter 接口定义
   - `src/adapters/base/BaseAdapter.ts`
   - 确认 ImageResult/VideoResult/AudioResult 接口包含 filePath 字段

## 涉及文件

### 检查文件
- `src/adapters/base/BaseAdapter.ts` - 接口定义
- `src/adapters/ppio/PPIOAdapter.ts` - PPIO 实现
- `src/adapters/fal/FalAdapter.ts` - Fal 实现
- `src/adapters/kie/KIEAdapter.ts` - KIE 实现
- `src/adapters/modelscope/ModelscopeAdapter.ts` - ModelScope 实现

### 可能需要修改的文件
- 如果发现缺失 filePath，需要在对应 Adapter 中补充

## 验收标准

- [ ] 所有 Adapter 的所有生成方法都返回 filePath
- [ ] BaseAdapter 接口定义明确包含 filePath 字段
- [ ] 创建检查清单文档记录验证结果

## 测试方法

1. 使用每个 Provider 生成一次图片/视频/音频
2. 打印返回结果，验证包含 filePath
3. 检查 filePath 指向的文件是否真实存在

## 风险与注意事项

### 风险
- 某些 Adapter 可能只返回 url（特别是使用 CDN 的情况）

### 注意事项
- 不要修改现有业务逻辑，只做检查和记录
- 如果发现问题，创建单独的修复任务

## 回滚方案

本任务为只读检查，无需回滚
