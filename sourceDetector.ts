import { App, TFile, TFolder } from 'obsidian';

export interface SourceInfo {
    file: TFile;
    path: string;
    group: string;
    color: string;
}

export interface SourceDetectorSettings {
    sourceFolders: string[];
    groupColors: Record<string, string>;
}

export const DEFAULT_SETTINGS: SourceDetectorSettings = {
    sourceFolders: [],
    groupColors: {},
};

export class SourceDetector {
    private app: App;
    private settings: SourceDetectorSettings;
    private sourceCache: Map<string, SourceInfo> = new Map();
    // 源点出链指向的笔记 → 该笔记属于源点的子节点
    private childMap: Map<string, Set<string>> = new Map();

    constructor(app: App, settings: SourceDetectorSettings) {
        this.app = app;
        this.settings = settings;
        this.buildSourceCache();
    }

    /**
     * 构建源点缓存
     * 文件夹下的所有文件自动成为源点，group = 文件夹路径
     */
    buildSourceCache(): void {
        this.sourceCache.clear();
        this.childMap.clear();

        const files = this.app.vault.getMarkdownFiles();
        const sourceFolders = this.settings.sourceFolders;

        // 1. 按 sourceFolders 识别源点，group = 最长匹配的文件夹路径
        for (const file of files) {
            let bestFolder = '';
            for (const folder of sourceFolders) {
                const prefix = folder.endsWith('/') ? folder : folder + '/';
                if (file.path.startsWith(prefix) || file.path === folder + '.md') {
                    if (folder.length > bestFolder.length) {
                        bestFolder = folder;
                    }
                }
            }
            if (bestFolder) {
                this.sourceCache.set(file.path, {
                    file: file,
                    path: file.path,
                    group: bestFolder,
                    color: this.resolveFolderColor(bestFolder)
                });
            }
        }

        // 2. 从源点出发，通过源点的出链建立子节点映射
        for (const [sourcePath, sourceInfo] of this.sourceCache) {
            const cache = this.app.metadataCache.getFileCache(sourceInfo.file);
            if (!cache?.links) continue;

            for (const link of cache.links) {
                const resolved = this.app.metadataCache.getFirstLinkpathDest(link.link, sourcePath);
                if (!resolved) continue;
                const resolvedPath = resolved.path;
                // 排除源点自身之间的互链
                if (this.sourceCache.has(resolvedPath)) continue;

                if (!this.childMap.has(resolvedPath)) {
                    this.childMap.set(resolvedPath, new Set());
                }
                this.childMap.get(resolvedPath)!.add(sourcePath);
            }
        }

        // 2b. 从非源点笔记的出链反向建立关联
        const excludePaths = new Set(['wiki/index.md']);
        for (const file of files) {
            if (this.sourceCache.has(file.path)) continue;
            if (excludePaths.has(file.path)) continue;

            const cache = this.app.metadataCache.getFileCache(file);
            if (!cache?.links) continue;

            for (const link of cache.links) {
                const resolved = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path);
                if (!resolved) continue;
                if (!this.sourceCache.has(resolved.path)) continue;

                if (!this.childMap.has(file.path)) {
                    this.childMap.set(file.path, new Set());
                }
                this.childMap.get(file.path)!.add(resolved.path);
            }
        }

        // 3. 沿 concept 之间的链接传播源点关系
        this.propagateSources();
    }

    /**
     * 沿 concept 之间的链接传播源点关系
     * BFS：已关联源点的节点，其出链指向的节点也继承该源点
     */
    private propagateSources(): void {
        const queue: string[] = [];
        const visited = new Set<string>();

        for (const path of this.childMap.keys()) {
            queue.push(path);
            visited.add(path);
        }

        while (queue.length > 0) {
            const currentPath = queue.shift()!;
            const currentSources = this.childMap.get(currentPath);
            if (!currentSources || currentSources.size === 0) continue;

            const file = this.app.vault.getAbstractFileByPath(currentPath);
            if (!(file instanceof TFile)) continue;

            const cache = this.app.metadataCache.getFileCache(file);
            if (!cache?.links) continue;

            for (const link of cache.links) {
                const resolved = this.app.metadataCache.getFirstLinkpathDest(link.link, currentPath);
                if (!resolved) continue;
                const resolvedPath = resolved.path;
                if (this.sourceCache.has(resolvedPath)) continue;

                let changed = false;
                if (!this.childMap.has(resolvedPath)) {
                    this.childMap.set(resolvedPath, new Set());
                }
                const targetSources = this.childMap.get(resolvedPath)!;
                for (const sp of currentSources) {
                    if (!targetSources.has(sp)) {
                        targetSources.add(sp);
                        changed = true;
                    }
                }

                if (changed && !visited.has(resolvedPath)) {
                    visited.add(resolvedPath);
                    queue.push(resolvedPath);
                }
            }
        }
    }

    /**
     * 获取 group 对应的颜色
     */
    getGroupColor(group: string): string {
        return this.settings.groupColors[group] || '';
    }

    /**
     * 解析文件夹颜色，含继承逻辑
     * 1. 如果 groupColors[folder] 有值 → 返回该值
     * 2. 否则向上查找父文件夹，递归继承
     * 3. 都没有 → 返回空串
     */
    resolveFolderColor(folder: string): string {
        const color = this.settings.groupColors[folder];
        if (color) return color;

        // 向上查找父文件夹
        const lastSlash = folder.lastIndexOf('/');
        if (lastSlash <= 0) return '';
        const parent = folder.substring(0, lastSlash);
        return this.resolveFolderColor(parent);
    }

    /**
     * 检查文件是否为源点
     */
    isSourceFile(file: TFile): boolean {
        return this.sourceCache.has(file.path);
    }

    /**
     * 检查路径是否为源点
     */
    isSourcePath(path: string): boolean {
        return this.sourceCache.has(path);
    }

    /**
     * 获取源点信息
     */
    getSourceInfo(path: string): SourceInfo | undefined {
        return this.sourceCache.get(path);
    }

    /**
     * 获取所有源点
     */
    getAllSources(): SourceInfo[] {
        return Array.from(this.sourceCache.values());
    }

    /**
     * 更新设置
     */
    updateSettings(settings: SourceDetectorSettings): void {
        this.settings = settings;
        this.buildSourceCache();
    }

    /**
     * 获取笔记关联的所有源点
     */
    getLinkedSources(file: TFile): SourceInfo[] {
        const linkedSources: SourceInfo[] = [];

        const sourcePaths = this.childMap.get(file.path);
        if (!sourcePaths) return linkedSources;

        for (const sourcePath of sourcePaths) {
            const sourceInfo = this.sourceCache.get(sourcePath);
            if (sourceInfo) {
                linkedSources.push(sourceInfo);
            }
        }

        return linkedSources;
    }

    /**
     * 通过路径获取关联的所有源点
     */
    getLinkedSourcesByPath(path: string): SourceInfo[] {
        const linkedSources: SourceInfo[] = [];

        const sourcePaths = this.childMap.get(path);
        if (!sourcePaths) return linkedSources;

        for (const sourcePath of sourcePaths) {
            const sourceInfo = this.sourceCache.get(sourcePath);
            if (sourceInfo) {
                linkedSources.push(sourceInfo);
            }
        }

        return linkedSources;
    }
}
