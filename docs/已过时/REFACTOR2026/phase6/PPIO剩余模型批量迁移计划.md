# PPIO 剩余模型批量迁移计划

> 创建日期：2026-01-22
> 状态：规划中

## 一、迁移进度总览

### 已完成（6/13）- 46%
1. ✅ seedream-4.5 (图片)
2. ✅ kling-2.6-pro (视频)
3. ✅ kling-o1 (视频)
4. ✅ wan-2.6 (视频)
5. ✅ seedance-1.5-pro (视频)
6. ✅ kling-2.5-turbo (视频)

### 待迁移（7/13）- 54%

#### 视频模型（6个）
7. ⏳ seedance-v1 (Seedance V1)
8. ⏳ wan-2.5-preview (Wan 2.5 Preview)
9. ⏳ pixverse-v4.5 (Pixverse V4.5)
10. ⏳ vidu-q1 (Vidu Q1)
11. ⏳ minimax-hailuo-2.3 (Minimax 海螺 2.3)
12. ⏳ minimax-hailuo-02 (Minimax 海螺 02)

#### 音频模型（1个）
13. ⏳ minimax-speech-2.6 (Minimax 语音 2.6)

---

## 二、模型详细分析

### 2.1 复杂度分级

| 级别 | 模型数量 | 模型列表 |
|------|---------|---------|
| 简单 | 0 | - |
| 中等 | 5 | Wan 2.5 Preview, PixVerse V4.5, Minimax Hailuo 2.3, Minimax Hailuo 02, Seedance V1 |
| 复杂 | 2 | Vidu Q1, Minimax Speech 2.6 |

### 2.2 按优先级排序（推荐迁移顺序）

1. ✅ **Wan 2.5 Preview** - 结构清晰，逻辑简单
2. ✅ **PixVerse V4.5** - 有辅助函数，但逻辑直观
3. ✅ **Minimax Hailuo 2.3** - 共享辅助函数
4. ✅ **Minimax Hailuo 02** - 共享辅助函数
5. ✅ **Seedance V1** - 变体系统需要注意
6. ⚠️ **Vidu Q1** - 多模式需要仔细测试
7. ⚠️ **Minimax Speech 2.6** - 参数最多，需要详细验证

---

## 三、批量迁移策略

### 3.1 分批次迁移

**第一批（简单模型）- 预计 30 分钟**
- Wan 2.5 Preview
- PixVerse V4.5

**第二批（中等复杂度）- 预计 45 分钟**
- Minimax Hailuo 2.3
- Minimax Hailuo 02
- Seedance V1

**第三批（复杂模型）- 预计 60 分钟**
- Vidu Q1
- Minimax Speech 2.6

### 3.2 迁移模板

每个模型的迁移步骤：
1. 创建 `.model.ts` 文件
2. 定义 meta 信息
3. 定义 params（按 order 排序）
4. 定义 linkages（如果需要）
5. 定义 endpoints 选择器
6. 定义 request builder
7. 定义 pricing 计算器
8. 更新 PPIO 模型注册中心
9. 验证编译通过

### 3.3 共享代码处理

**需要创建的辅助函数：**
1. `normalizeHailuo()` - Hailuo 2.3 和 Hailuo 02 共享
2. `normalizePixverseResolution()` - PixVerse V4.5 使用

**位置建议：** `src/models/ppio/utils/` 目录

---

## 四、执行计划

### 4.1 准备工作
- [x] 分析所有待迁移模型
- [x] 制定迁移策略
- [ ] 创建辅助函数文件
- [ ] 准备测试环境

### 4.2 第一批迁移（2个模型）
- [ ] Wan 2.5 Preview
- [ ] PixVerse V4.5

### 4.3 第二批迁移（3个模型）
- [ ] Minimax Hailuo 2.3
- [ ] Minimax Hailuo 02
- [ ] Seedance V1

### 4.4 第三批迁移（2个模型）
- [ ] Vidu Q1
- [ ] Minimax Speech 2.6

### 4.5 验证与测试
- [ ] 编译验证
- [ ] 类型检查
- [ ] 更新文档

---

## 五、注意事项

### 5.1 特殊处理项
1. **Vidu Q1** - 使用 `includes()` 匹配，需确认是否有其他变体
2. **Seedance V1** - 变体逻辑需要在新架构中妥善处理
3. **Minimax Speech 2.6** - 同步端点（非 /async/ 前缀）

### 5.2 风险点
1. 参数映射可能遗漏
2. 端点选择逻辑可能有边界情况
3. 定价计算需要验证准确性

---

## 六、完成标准

- [ ] 所有 7 个模型迁移完成
- [ ] 编译无错误
- [ ] 类型检查通过
- [ ] 所有模型已注册到 PPIO 注册中心
- [ ] 更新项目进度文档
