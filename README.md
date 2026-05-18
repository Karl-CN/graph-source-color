# Graph Source Color

Obsidian 图谱节点动态着色插件。根据笔记关联的"源点"种类，在图谱视图中显示多色节点。

## 功能特性

- **源点检测**：自动识别指定文件夹下的源点笔记（通过 frontmatter 的 `group` 字段分类）
- **关联计算**：递归查找笔记链接的所有源点，支持间接链接
- **多色渲染**：
  - 单源点 → 单色填充
  - 双源点 → 左右分割
  - 多源点 → 扇形分割

## 安装

1. 编译插件：
   ```bash
   npm install
   npm run build
   ```

2. 复制文件到 Obsidian 插件目录：
   ```
   G:\Obsidian Vault\.obsidian\plugins\graph-source-color\
   ├── manifest.json
   ├── main.js
   └── styles.css
   ```

3. 重启 Obsidian，在设置中启用 "Graph Source Color" 插件

## 配置

在 Obsidian 设置 → "图谱源点着色设置" 中配置：

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| sourceFolder | wiki/sources | 源点文件夹路径 |
| groupColors | 见下方 | 分组颜色映射 |
| enableMultiColor | true | 启用多色节点 |
| defaultColor | #888888 | 默认颜色 |

默认分组颜色：
```json
{
  "gov-report": "#4A90D9",
  "april-meeting": "#F5A623"
}
```

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

插件通过以下方式检测笔记关联的源点：

1. **直接链接**：笔记中直接链接到源点笔记
2. **frontmatter sources 字段**：笔记的 frontmatter 中声明 `sources: [group1, group2]`
3. **递归查找**：沿链接链向上查找，最多递归 3 层

示例：
```
新质生产力.md
  └── links to → 政府工作报告.md (group: gov-report)
  └── links to → 4月经济工作会议.md (group: april-meeting)

结果：新质生产力 显示双色（蓝+橙）
```

## 文件结构

```
G:\CCproject\graph-source-color\
├── main.ts              # 插件入口，事件监听，图谱集成
├── sourceDetector.ts    # 源点检测，关联计算
├── colorManager.ts      # 颜色缓存管理
├── nodeRenderer.ts      # Canvas 多色节点绘制
├── manifest.json        # 插件清单
├── package.json         # 依赖配置
├── tsconfig.json        # TypeScript 配置
├── esbuild.config.mjs   # 构建配置
└── styles.css           # 样式文件
```

## 技术实现

### 1. 源点检测 (sourceDetector.ts)

```typescript
// 扫描源点文件夹，缓存源点信息
buildSourceCache(): Map<路径, {group, color}>

// 递归查找笔记关联的所有源点
getLinkedSources(file: TFile): SourceInfo[]
```

关键点：
- 使用 `app.metadataCache.getFileCache()` 获取 frontmatter 和链接
- 使用 `app.metadataCache.getFirstLinkpathDest()` 解析链接目标
- 递归深度限制为 3 层，防止无限循环

### 2. 颜色管理 (colorManager.ts)

```typescript
// 获取节点应显示的颜色数组
getNodeColors(path: string): string[]

// 判断是否需要多色渲染
isMultiColorNode(path: string): boolean
```

使用缓存提高性能，避免重复计算。

### 3. 节点渲染 (nodeRenderer.ts)

使用 Canvas API 绘制多色节点：

```typescript
// 双色：左右分割
ctx.arc(x, y, r, Math.PI/2, 3*Math.PI/2);  // 左半
ctx.arc(x, y, r, -Math.PI/2, Math.PI/2);    // 右半

// 多色：扇形分割
const sliceAngle = (2 * Math.PI) / colors.length;
ctx.arc(x, y, r, startAngle, endAngle);
```

### 4. 图谱集成 (main.ts)

- 监听 `layout-change` 和 `active-leaf-change` 事件检测图谱视图
- 创建覆盖层 Canvas 在原生图谱上方绘制多色节点
- 使用 `requestAnimationFrame` 持续渲染（每 50ms 更新一次）

```typescript
// 坐标变换
const x = node.x * scale + offsetX + canvas.width / 2;
const y = node.y * scale + offsetY + canvas.height / 2;
```

## 命令

| 命令 ID | 名称 | 说明 |
|---------|------|------|
| refresh-graph-colors | 刷新图谱颜色 | 重建缓存并重新渲染 |
| debug-graph-nodes | 调试图谱节点 | 输出节点和源点信息到控制台 |
| debug-coordinates | 调试坐标系统 | 输出坐标变换信息到控制台 |

## 已知问题

1. **坐标偏移**：多色节点可能出现在原节点旁边，需要调整坐标计算
2. **性能**：每帧重绘可能影响大型图谱的性能

## 开发

```bash
# 安装依赖
npm install

# 开发模式（自动重编译）
npm run dev

# 生产编译
npm run build
```

## 许可

MIT
