# 痕迹AI

痕迹AI是一个基于派欧云API的多媒体生成工具，支持图片、视频和音频的生成。

## 功能特性

- 支持派欧云多种AI模型
  - 即梦图片生成 4.0 (Seedream 4.0)
  - Vidu Q1 文生视频
- 简洁的黑白主题界面
- 响应式设计，支持桌面端使用
- API密钥设置和管理
- 结果展示和历史记录

## 技术栈

- React 18 + TypeScript
- Vite 构建工具
- Tailwind CSS 样式框架
- Axios HTTP客户端

## 安装和运行

1. 安装依赖：
```bash
npm install
```

2. 启动开发服务器：
```bash
npm run dev
```

3. 构建生产版本：
```bash
npm run build
```

4. 预览生产构建：
```bash
npm run preview
```

## 使用说明

1. 点击右上角"设置"按钮配置派欧云API密钥
2. 选择需要的模型类型
3. 在底部输入框输入提示词或上传图片
4. 点击"生成"按钮开始生成
5. 生成结果将显示在上方区域

## 项目结构

```
src/
├── adapters/              # API适配器
├── components/            # UI组件
├── config/                # 配置文件
├── services/              # 业务逻辑
├── types/                 # 类型定义
├── App.tsx                # 主应用组件
├── main.tsx               # 应用入口
└── index.css              # 全局样式
```

## 配置

在使用之前，需要在设置中配置派欧云API密钥。您可以在派欧云控制台获取API密钥。
