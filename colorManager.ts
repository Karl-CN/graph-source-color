import { App, TFile } from 'obsidian';
import { SourceDetector, SourceInfo } from './sourceDetector';

export interface NodeColorInfo {
    path: string;
    sources: SourceInfo[];
    colors: string[];
}

export class ColorManager {
    private app: App;
    private sourceDetector: SourceDetector;
    private colorCache: Map<string, NodeColorInfo> = new Map();

    constructor(app: App, sourceDetector: SourceDetector) {
        this.app = app;
        this.sourceDetector = sourceDetector;
    }

    /**
     * 清除缓存
     */
    clearCache(): void {
        this.colorCache.clear();
    }

    /**
     * 获取节点的颜色信息
     */
    getNodeColorInfo(path: string): NodeColorInfo {
        // 检查缓存
        if (this.colorCache.has(path)) {
            return this.colorCache.get(path)!;
        }

        // 获取关联的源点
        const sources = this.sourceDetector.getLinkedSourcesByPath(path);

        // 提取颜色
        const colors = sources.map(s => s.color);

        const info: NodeColorInfo = {
            path: path,
            sources: sources,
            colors: colors
        };

        this.colorCache.set(path, info);
        return info;
    }

    /**
     * 获取节点应显示的颜色数组
     */
    getNodeColors(path: string): string[] {
        const info = this.getNodeColorInfo(path);
        return info.colors;
    }


    /**
     * 刷新缓存
     */
    refresh(): void {
        this.sourceDetector.buildSourceCache();
        this.clearCache();
    }
}
