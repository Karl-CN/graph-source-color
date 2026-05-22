# Graph Source Color — Obsidian 插件

根据源点笔记分组动态给图谱节点着色，支持多色渲染。

## 构建命令

- `npm run dev` — 开发模式（watch）
- `npm run build` — 生产构建

## 部署

构建产物 `main.js` 需复制到 Obsidian 插件目录：
```
G:\Obsidian Vault\.obsidian\plugins\graph-source-color\main.js
```

## 技术栈

- TypeScript 4.7 + Obsidian API
- esbuild 打包
- 无额外依赖

## 代码结构

- `main.ts` — 插件入口、设置页、overlay 渲染
- `sourceDetector.ts` — 源点检测、链接传播、颜色继承
- `colorManager.ts` — 颜色缓存管理
- `folderTreeSelector.ts` — 设置页文件夹树选择器

## 约定

- TypeScript 严格模式，禁止 `any`
- 不随意引入新依赖
- 代码保持整洁，加必要注释
- Git commit 信息用中文，格式：`类型: 描述`
- Git 路径：`G:\Program Files\Git\cmd\git.exe`

## 数据目录

- 源码项目：`G:\CCproject\graph-source-color\`
- Obsidian Vault：`G:\Obsidian Vault\`
- 行业数据：`G:\Obsidian Vault\wiki\industries\`
