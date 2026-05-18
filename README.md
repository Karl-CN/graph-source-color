# Graph Source Color

Obsidian 图谱节点动态着色插件。根据笔记关联的"源点"种类，在图谱视图中显示多色节点。

## 功能特性

- **源点检测**：自动识别指定文件夹下的源点笔记（通过 frontmatter 的 `group` 字段分类）
- **关联计算**：递归查找笔记链接的所有源点，支持直接链接和反向链接
- **多色渲染**：
  - 双源点 → 左右分割
  - 多源点 → 扇形分割
- **只读 graph.json**：不修改 Obsidian 原生配置文件

## 安装

1. 编译插件：
   ```bash
   npm install
   npm run build
   ```

2. 复制 `main.js` 和 `manifest.json` 到 Obsidian 插件目录：
   ```
   <vault>/.obsidian/plugins/graph-source-color/
   ├── manifest.json
   └── main.js
   ```

3. 重启 Obsidian，在设置中启用 "Graph Source Color" 插件

## 配置

在 Obsidian 设置 → "图谱源点着色设置" 中配置：

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| sourceFolder | wiki/sources | 源点文件夹路径 |
| enableMultiColor | true | 启用多色节点 |

源节点颜色请在 Obsidian 图谱设置中修改，修改后子节点颜色会自动联动。

## 源点笔记格式

源点笔记需放在 `sourceFolder` 指定的目录下，并在 frontmatter 中定义 `group` 字段：

```yaml
---
title: 2026年政府工作报告
group: gov-report
---

笔记内容...
```

## 关联检测逻辑

1. **出链方向**：源点笔记链接到的笔记，自动关联该源点
2. **入链方向**：非源点笔记链接到源点，自动关联该源点
3. **传播**：已关联源点的笔记，其出链指向的笔记也继承该源点

示例：
```
新质生产力.md
  └── links to → 政府工作报告.md (group: gov-report)
  └── links to → 4月经济工作会议.md (group: april-meeting)

结果：新质生产力 显示双色
```

## 文件结构

```
graph-source-color/
├── main.ts              # 插件入口，overlay 渲染
├── sourceDetector.ts    # 源点检测，关联计算
├── colorManager.ts      # 颜色缓存管理
├── manifest.json        # 插件清单
├── package.json         # 依赖配置
├── tsconfig.json        # TypeScript 配置
├── esbuild.config.mjs   # 构建配置
└── README.md
```

## 开发

```bash
npm install
npm run build
```

## 许

MIT
