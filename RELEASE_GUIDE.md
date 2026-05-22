# Graph Source Color — 发布指南

本文档记录将插件发布到 GitHub 和 Obsidian 社区插件市场的完整步骤。

---

## 一、发布前检查清单

### 必需文件

| 文件 | 状态 | 说明 |
|------|------|------|
| `manifest.json` | ✅ | 插件清单，包含 id、version、minAppVersion |
| `versions.json` | ✅ | 版本兼容性映射 |
| `main.js` | ⚠️ 需构建 | 生产构建产物 |
| `README.md` | ✅ | 英文说明文档 |
| `LICENSE` | ✅ | MIT 许可证 |
| `.gitignore` | ✅ | 排除 node_modules、main.js 等 |

### 必需信息

| 项目 | 值 |
|------|-----|
| 插件 ID | `graph-source-color` |
| 作者 | Karl |
| GitHub | Karl-CN |
| 仓库地址 | `https://github.com/Karl-CN/obsidian-graph-source-color` |
| 许可证 | MIT |
| 最低 Obsidian 版本 | 0.15.0 |
| 当前版本 | 1.1.0 |

---

## 二、GitHub 仓库准备

### 1. 初始化 Git 仓库

```bash
cd G:\CCproject\graph-source-color
git init
git add .
git commit -m "初始化: Graph Source Color v1.1.0"
```

### 2. 创建 GitHub 仓库

- 访问 https://github.com/new
- 仓库名：`obsidian-graph-source-color`
- 设为 Public（社区插件要求公开仓库）
- 不要勾选 Initialize with README（已有本地文件）
- 不要添加 .gitignore 或 LICENSE（已有本地文件）

### 3. 推送到 GitHub

```bash
git remote add origin https://github.com/Karl-CN/obsidian-graph-source-color.git
git branch -M main
git push -u origin main
```

---

## 三、构建与发布 Release

### 1. 生产构建

```bash
npm run build
```

构建产物 `main.js` 出现在项目根目录。

### 2. 创建 Git Tag 和 Release

```bash
git tag 1.1.0
git push origin 1.1.0
```

然后在 GitHub 上创建 Release：

- 访问 `https://github.com/Karl-CN/obsidian-graph-source-color/releases/new`
- Tag：`1.1.0`
- Release title：`1.1.0`
- Description：简要说明此版本功能

### 3. 上传 Release 资产

**必须上传以下 3 个文件到 Release：**

| 文件 | 说明 |
|------|------|
| `manifest.json` | 插件清单 |
| `main.js` | 构建产物 |
| `styles.css` | 仅当存在 CSS 样式时需要（本插件不需要） |

上传方式：
- 在 Release 页面拖拽上传
- 或使用 `gh` CLI：

```bash
gh release create 1.1.0 \
  ./main.js \
  ./manifest.json \
  --title "1.1.0" \
  --notes "Initial release"
```

**关键：** 文件名必须是 `main.js`、`manifest.json`（不能有前缀路径），Obsidian 的更新机制依赖这些固定文件名。

---

## 四、提交到 Obsidian 社区插件市场

### 前置条件

- [x] GitHub 仓库为 Public
- [x] 仓库包含 `manifest.json`、`main.js`（Release 中）、`README.md`、`LICENSE`
- [x] `manifest.json` 中的 `id` 与仓库名无冲突
- [x] Release 中包含 `manifest.json` 和 `main.js`

### 提交流程

1. Fork 仓库 `https://github.com/obsidianmd/obsidian-releases`
2. 编辑 `community-plugins.json`，在数组末尾添加：

```json
"graph-source-color"
```

3. 编辑 `community-plugin-stats.json`，添加：

```json
{
  "graph-source-color": {
    "repo": "Karl-CN/obsidian-graph-source-color"
  }
}
```

4. 提交 Pull Request，标题格式：`Plugin submission: Graph Source Color`
5. PR 描述模板：

```
## Plugin Submission

**Plugin ID:** graph-source-color
**Plugin Name:** Graph Source Color
**Repository:** https://github.com/Karl-CN/obsidian-graph-source-color
**Version:** 1.1.0

### Description

Dynamically colors graph nodes based on their linked source notes. Supports multi-color rendering for notes connected to multiple sources.

### Checklist

- [x] My plugin is MIT licensed
- [x] My plugin has a valid README.md
- [x] My plugin has a valid manifest.json
- [x] My plugin has been tested on Obsidian desktop
- [x] My plugin does not use any restricted APIs
```

### 审核流程

- Obsidian 团队会进行代码审查和自动检查
- 审核周期通常为数天到数周
- 如需修改，在原 PR 中更新即可
- 通过后插件会出现在社区插件列表中

---

## 五、后续版本更新流程

### 1. 修改代码

### 2. 更新版本号

同时修改三个位置：

- `manifest.json` → `"version": "1.2.0"`
- `package.json` → `"version": "1.2.0"`
- `versions.json` → 添加 `"1.2.0": "0.15.0"`

或使用已有的 npm script：

```bash
npm run version
```

### 3. 构建并发布

```bash
npm run build
git add .
git commit -m "发布: v1.2.0"
git tag 1.2.0
git push origin main --tags
gh release create 1.2.0 ./main.js ./manifest.json --title "1.2.0" --notes "更新说明"
```

---

## 六、注意事项

1. **main.js 不入 Git** — 已在 `.gitignore` 中排除，仅通过 GitHub Release 分发
2. **manifest.json 必须同时存在于仓库和 Release** — 仓库中的用于审核，Release 中的用于自动更新
3. **版本号语义化** — 遵循 semver，重大变更升级主版本号
4. **minAppVersion** — 如使用了新 API，需相应提高最低版本号并在 `versions.json` 中更新映射
5. **styles.css** — 如果未来添加 CSS 样式，需同时放入 Release
6. **仓库命名** — Obsidian 社区推荐 `obsidian-` 前缀，但不是强制要求
