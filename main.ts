import { App, Plugin, PluginSettingTab, Setting, Notice, TFolder, TFile } from 'obsidian';
import { SourceDetector, SourceDetectorSettings, DEFAULT_SETTINGS as SOURCE_DEFAULT_SETTINGS } from './sourceDetector';
import { ColorManager } from './colorManager';
import { FolderTreeSelector } from './folderTreeSelector';

interface GraphColorGroup {
	query: string;
	color: { a: number; rgb: number };
}

interface GraphSourceColorSettings extends SourceDetectorSettings {
	enableMultiColor: boolean;
}

const DEFAULT_SETTINGS: GraphSourceColorSettings = {
	...SOURCE_DEFAULT_SETTINGS,
	enableMultiColor: true
};

const COLOR_PALETTE = [
	'#4A90D9', '#F5A623', '#7B68EE', '#50C878', '#FF6B6B',
	'#FFD93D', '#6BCB77', '#4D96FF', '#C084FC', '#FB923C',
	'#34D399', '#F472B6', '#60A5FA', '#A78BFA', '#38BDF8'
];

function rgbNumberToHex(rgb: number): string {
	return '#' + rgb.toString(16).padStart(6, '0');
}

function getNextColor(existingColors: Set<string>): string {
	for (const color of COLOR_PALETTE) {
		if (!existingColors.has(color)) return color;
	}
	const hue = Math.floor(Math.random() * 360);
	return '#' + ((1 << 24) + (hue << 16) + (0x65 << 8) + 0x55).toString(16).slice(1);
}

export default class GraphSourceColorPlugin extends Plugin {
	settings: GraphSourceColorSettings;
	sourceDetector: SourceDetector;
	colorManager: ColorManager;
	private overlayCanvases: Map<string, HTMLCanvasElement> = new Map();
	private renderRAF: number | null = null;
	private lastColorSync = 0;
	private removing = false;
	private obsidianColorMap: Map<string, string> = new Map();
	private nodeAlphaCache: Map<string, number> = new Map();
	private deletedPaths: Set<string> = new Set();

	async onload() {
		await this.loadSettings();

		this.app.workspace.onLayoutReady(async () => {
			this.removing = false;
			await this.migrateSettings();
			this.sourceDetector = new SourceDetector(this.app, this.settings);
			this.colorManager = new ColorManager(this.app, this.sourceDetector);
			console.log('[Graph Source Color] Initialized');

			await this.restoreColorsFromGraphJson();
			await this.loadObsidianColorMap();
			this.startOverlayRender();
		});

		this.registerEvent(
			this.app.metadataCache.on('changed', () => {
				if (this.colorManager) this.colorManager.refresh();
			})
		);

		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				const deletedPath = file instanceof TFile ? file.path : '';
				if (deletedPath) {
					this.deletedPaths.add(deletedPath);
					this.nodeAlphaCache.delete(deletedPath);
				}
				setTimeout(() => {
					if (this.colorManager) this.colorManager.refresh();
					setTimeout(() => {
						if (this.colorManager) this.colorManager.refresh();
						if (deletedPath) this.deletedPaths.delete(deletedPath);
					}, 2000);
				}, 500);
			})
		);

		this.registerEvent(
			this.app.vault.on('create', () => {
				if (this.colorManager) this.colorManager.refresh();
			})
		);

		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				setTimeout(() => this.setupOverlays(), 500);
			})
		);

		this.addCommand({
			id: 'refresh-graph-colors',
			name: '刷新图谱颜色',
			callback: () => {
				if (this.colorManager) this.colorManager.refresh();
				new Notice('图谱颜色已刷新');
			}
		});

		this.addCommand({
			id: 'debug-graph-nodes',
			name: '调试图谱节点',
			callback: () => this.debugGraphNodes()
		});

		this.addSettingTab(new GraphSourceColorSettingTab(this.app, this));
	}

	onunload() {
		this.removing = true;
		this.cleanupOverlay();
		console.log('[Graph Source Color] Unloaded');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		if (this.sourceDetector) {
			this.sourceDetector.updateSettings(this.settings);
		}
		if (this.colorManager) {
			this.colorManager.refresh();
		}
		if (!this.settings.enableMultiColor) {
			this.clearOverlaysAndRestoreNodes();
		} else {
			this.setupOverlays();
		}
	}

	private async migrateSettings(): Promise<void> {
		const loadedData = await this.loadData();
		if (!loadedData) return;

		let migrated = false;

		if (loadedData.sourceFolder !== undefined && loadedData.sourceFolders === undefined) {
			const oldFolder = loadedData.sourceFolder as string;
			loadedData.sourceFolders = oldFolder ? [oldFolder] : [];
			delete loadedData.sourceFolder;
			migrated = true;

			const newGroupColors: Record<string, string> = {};
			for (const [oldGroup, color] of Object.entries(loadedData.groupColors || {})) {
				if (oldFolder) {
					const candidatePath = oldFolder + '/' + oldGroup;
					const exists = this.app.vault.getAbstractFileByPath(candidatePath) instanceof TFolder;
					if (exists) {
						newGroupColors[candidatePath] = color as string;
					} else if (!newGroupColors[oldFolder]) {
						newGroupColors[oldFolder] = color as string;
					}
				} else {
					newGroupColors[oldGroup] = color as string;
				}
			}
			if (oldFolder && !newGroupColors[oldFolder]) {
				newGroupColors[oldFolder] = '#4A90D9';
			}
			loadedData.groupColors = newGroupColors;
		}

		if (migrated) {
			await this.saveData(loadedData);
			this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
		}
	}

	private async restoreColorsFromGraphJson(): Promise<void> {
		if (!this.sourceDetector) return;

		try {
			const existingGroups = (await this.readExistingColorGroups()) ?? [];
			if (existingGroups.length === 0) return;

			for (const cg of existingGroups) {
				if (!cg.query?.startsWith('path:')) continue;
				if (cg.color?.rgb === undefined || cg.color?.rgb === 0 || cg.color?.rgb === 0xFFFFFF) continue;

				const queryPath = cg.query.replace('path:', '');
				if (this.settings.sourceFolders.includes(queryPath)) {
					const color = '#' + cg.color.rgb.toString(16).padStart(6, '0');
					if (color !== '#000000' && color !== '#ffffff') {
						this.settings.groupColors[queryPath] = color;
					}
				}
			}

			this.sourceDetector.updateSettings(this.settings);
			this.saveData(this.settings);
		} catch (e) {
			console.warn('[Graph Source Color] Failed to restore colors from graph.json', e);
		}
	}

	private async readExistingColorGroups(): Promise<GraphColorGroup[] | null> {
		try {
			const adapter = this.app.vault.adapter;
			const graphJsonPath = this.app.vault.configDir + '/graph.json';
			if (!(await adapter.exists(graphJsonPath))) return null;
			const raw = await adapter.read(graphJsonPath);
			const config = JSON.parse(raw);
			const groups = config.colorGroups;
			if (!Array.isArray(groups)) return null;
			return groups;
		} catch {
			return null;
		}
	}

	private async loadObsidianColorMap(): Promise<void> {
		const newMap = new Map<string, string>();
		const groups = await this.readExistingColorGroups();
		if (!groups) {
			this.obsidianColorMap = newMap;
			return;
		}
		for (const cg of groups) {
			if (!cg.query) continue;
			if (cg.color?.rgb === undefined || cg.color?.rgb === 0 || cg.color?.rgb === 0xFFFFFF) continue;
			const color = '#' + cg.color.rgb.toString(16).padStart(6, '0');
			if (color === '#000000' || color === '#ffffff') continue;
			const pathMatch = cg.query.match(/^path:(\S+)/);
			if (!pathMatch) continue;
			const pathPart = pathMatch[1];
			const fileMatch = cg.query.match(/\bfile:(\S+)/);
			if (fileMatch) {
				const filePath = pathPart + '/' + fileMatch[1] + '.md';
				newMap.set(filePath, color);
			} else {
				newMap.set(pathPart, color);
			}
		}
		this.obsidianColorMap = newMap;
	}

	private hasObsidianColorGroup(path: string): boolean {
		for (const groupPath of this.obsidianColorMap.keys()) {
			if (path === groupPath) return true;
			if (path === groupPath + '.md') return true;
			if (path.endsWith('.md') && path.slice(0, -3) === groupPath) return true;
			const prefix = groupPath.endsWith('/') ? groupPath : groupPath + '/';
			if (path.startsWith(prefix)) return true;
		}
		return false;
	}

	private getObsidianColor(path: string): string | undefined {
		for (const [groupPath, color] of this.obsidianColorMap) {
			if (path === groupPath) return color;
			if (path === groupPath + '.md') return color;
			if (path.endsWith('.md') && path.slice(0, -3) === groupPath) return color;
		}
		return undefined;
	}

	private getEffectiveSourceColor(sourcePath: string): string | undefined {
		const obsColor = this.getObsidianColor(sourcePath);
		if (obsColor) return obsColor;
		const sourceInfo = this.sourceDetector?.getSourceInfo(sourcePath);
		return sourceInfo?.color || undefined;
	}

	private getChildNodeColors(nodeId: string): string[] {
		if (!this.sourceDetector || !this.colorManager) return [];

		const info = this.colorManager.getNodeColorInfo(nodeId);
		if (!info || info.sources.length === 0) return [];

		const colorSet: string[] = [];
		const seenColors = new Set<string>();

		for (const source of info.sources) {
			const color = this.getEffectiveSourceColor(source.path);
			if (color && !seenColors.has(color)) {
				seenColors.add(color);
				colorSet.push(color);
			}
		}

		return colorSet;
	}

	private syncColorsFromRenderer(): boolean {
		this.loadObsidianColorMap();
		return false;
	}

	private getNodeScreenPos(node: any, scale: number, panX: number, panY: number, nodeScale: number): { x: number; y: number; r: number } {
		if (node.circle && typeof node.circle.getBounds === 'function') {
			const bounds = node.circle.getBounds();
			return {
				x: bounds.x + bounds.width / 2,
				y: bounds.y + bounds.height / 2,
				r: bounds.width / 2
			};
		}
		return {
			x: node.x * scale + panX,
			y: node.y * scale + panY,
			r: 3 * nodeScale * scale
		};
	}

	private getNodeAlpha(nodeId: string, currentAlpha: number): number {
		if (currentAlpha > 0) {
			this.nodeAlphaCache.set(nodeId, currentAlpha);
		}
		return this.nodeAlphaCache.get(nodeId) ?? 1;
	}

	private releaseNodeAlpha(nodeId: string): void {
		this.nodeAlphaCache.delete(nodeId);
	}

	private isNodeAlive(nodeId: string): boolean {
		if (this.deletedPaths.has(nodeId)) return false;
		return !!this.app.vault.getAbstractFileByPath(nodeId);
	}

	// --- Canvas Overlay ---

	private setupOverlays(): void {
		for (const viewType of ['graph', 'localgraph']) {
			this.app.workspace.getLeavesOfType(viewType).forEach((leaf) => {
				const view = leaf.view as any;
				const containerEl = view.contentEl as HTMLElement;
				if (!containerEl) return;

				const key = (leaf as any).id ?? '';
				if (this.overlayCanvases.has(key)) {
					const existing = this.overlayCanvases.get(key)!;
					if (existing.isConnected) return;
					existing.remove();
					this.overlayCanvases.delete(key);
				}

				const canvas = document.createElement('canvas');
				canvas.style.position = 'absolute';
				canvas.style.top = '0';
				canvas.style.left = '0';
				canvas.style.width = '100%';
				canvas.style.height = '100%';
				canvas.style.pointerEvents = 'none';
				canvas.style.zIndex = '10';
				canvas.className = 'graph-source-color-overlay';

				containerEl.style.position = 'relative';
				containerEl.appendChild(canvas);

				this.overlayCanvases.set(key, canvas);

				const syncSize = () => {
					const r = (leaf.view as any)?.dataEngine?.renderer;
					const pxRenderer = r?.px?.renderer;
					if (pxRenderer) {
						canvas.width = pxRenderer.width;
						canvas.height = pxRenderer.height;
					} else {
						canvas.width = containerEl.clientWidth;
						canvas.height = containerEl.clientHeight;
					}
				};
				syncSize();

				const ro = new ResizeObserver(() => syncSize());
				ro.observe(containerEl);
				this.register(() => ro.disconnect());
			});
		}
	}

	private cleanupOverlay(): void {
		this.removing = true;
		if (this.renderRAF) {
			cancelAnimationFrame(this.renderRAF);
			this.renderRAF = null;
		}
		this.clearOverlaysAndRestoreNodes();
	}

	private clearOverlaysAndRestoreNodes(): void {
		this.overlayCanvases.forEach((canvas) => {
			const ctx = canvas.getContext('2d');
			if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
			canvas.style.display = 'none';
			if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
		});
		this.overlayCanvases.clear();

		document.querySelectorAll('.graph-source-color-overlay').forEach((el) => el.remove());

		for (const viewType of ['graph', 'localgraph']) {
			this.app.workspace.getLeavesOfType(viewType).forEach((leaf) => {
				const view = leaf.view as any;
				const containerEl = view.contentEl as HTMLElement;
				const renderer = view.dataEngine?.renderer;
				if (!containerEl) return;
				containerEl.querySelectorAll('canvas').forEach((canvas) => {
					const el = canvas as HTMLElement;
					if (el.style.pointerEvents === 'none' && el.style.zIndex === '10') {
						const ctx = canvas.getContext('2d');
						if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
						el.style.display = 'none';
						if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
					}
				});
				if (!renderer?.nodes) return;
				for (const node of renderer.nodes) {
					if (node.id && node.circle && node.circle.alpha === 0) {
						node.circle.alpha = 1;
					}
				}
			});
		}
	}

	private startOverlayRender(): void {
		this.setupOverlays();

		const renderLoop = () => {
			if (this.removing) return;
			try {
				this.renderOverlayNodes();
			} catch (e) {
				console.warn('[Graph Source Color] Render loop error:', e);
			}
			this.renderRAF = requestAnimationFrame(renderLoop);
		};
		this.renderRAF = requestAnimationFrame(renderLoop);
	}

	private renderOverlayNodes(): void {
		if (!this.colorManager || !this.settings.enableMultiColor) return;

		const now = Date.now();
		if (now - this.lastColorSync > 2000) {
			this.syncColorsFromRenderer();
			this.lastColorSync = now;
		}

		for (const viewType of ['graph', 'localgraph']) {
			this.app.workspace.getLeavesOfType(viewType).forEach((leaf) => {
				try {
					const view = leaf.view as any;
					const dataEngine = view.dataEngine;
					const renderer = dataEngine?.renderer;
					if (!renderer?.nodes) return;

					const key = (leaf as any).id ?? '';
					const canvas = this.overlayCanvases.get(key);
					if (!canvas) return;

					const ctx = canvas.getContext('2d');
					if (!ctx) return;

					const pxRenderer = renderer.px?.renderer;
					if (pxRenderer) {
						const pw = pxRenderer.width;
						const ph = pxRenderer.height;
						if (canvas.width !== pw || canvas.height !== ph) {
							canvas.width = pw;
							canvas.height = ph;
						}
					}

					ctx.clearRect(0, 0, canvas.width, canvas.height);

					const scale = renderer.scale || 1;
					const panX = renderer.panX || 0;
					const panY = renderer.panY || 0;
					const nodeScale = renderer.nodeScale || 1;

					for (const node of renderer.nodes) {
						try {
							if (!node.id) continue;

							// 跳过已删除文件的幽灵节点
							if (!this.isNodeAlive(node.id)) {
								if (node.circle && node.circle.alpha === 0) node.circle.alpha = 1;
								this.releaseNodeAlpha(node.id);
								continue;
							}

							const currentAlpha = node.circle?.alpha ?? 1;
							const nodeAlpha = this.getNodeAlpha(node.id, currentAlpha);

							if (this.sourceDetector?.isSourcePath(node.id)) {
								if (this.hasObsidianColorGroup(node.id)) {
									if (node.circle && node.circle.alpha === 0) node.circle.alpha = 1;
									this.releaseNodeAlpha(node.id);
									continue;
								}
								const folderColor = this.getEffectiveSourceColor(node.id);
								if (!folderColor) {
									if (node.circle && node.circle.alpha === 0) node.circle.alpha = 1;
									this.releaseNodeAlpha(node.id);
									continue;
								}
								if (node.circle) node.circle.alpha = 0;
								const pos = this.getNodeScreenPos(node, scale, panX, panY, nodeScale);
								this.drawSingleColorNode(ctx, pos.x, pos.y, pos.r, folderColor, nodeAlpha);
								continue;
							}

							// 子节点：Obsidian 手动设色优先
							if (this.hasObsidianColorGroup(node.id)) {
								if (node.circle && node.circle.alpha === 0) node.circle.alpha = 1;
								this.releaseNodeAlpha(node.id);
								continue;
							}

							const colors = this.getChildNodeColors(node.id);
							if (colors.length === 0) {
								if (node.circle && node.circle.alpha === 0) node.circle.alpha = 1;
								this.releaseNodeAlpha(node.id);
								continue;
							}

							const pos = this.getNodeScreenPos(node, scale, panX, panY, nodeScale);
							if (node.circle) node.circle.alpha = 0;
							if (colors.length === 1) {
								this.drawSingleColorNode(ctx, pos.x, pos.y, pos.r, colors[0], nodeAlpha);
							} else {
								this.drawMultiColorNode(ctx, pos.x, pos.y, pos.r, colors, nodeAlpha);
							}
						} catch (e) {
							// 单个节点出错不影响其他节点
							try {
								if (node?.circle && node.circle.alpha === 0) node.circle.alpha = 1;
							} catch {}
						}
					}
				} catch (e) {
					console.warn('[Graph Source Color] View render error:', e);
				}
			});
		}
	}

	private drawSingleColorNode(
		ctx: CanvasRenderingContext2D,
		x: number,
		y: number,
		radius: number,
		color: string,
		alpha: number
	): void {
		ctx.globalAlpha = alpha;
		ctx.beginPath();
		ctx.arc(x, y, radius, 0, 2 * Math.PI);
		ctx.fillStyle = color;
		ctx.fill();
		ctx.strokeStyle = '#333333';
		ctx.lineWidth = 1;
		ctx.stroke();
		ctx.globalAlpha = 1;
	}

	private drawMultiColorNode(
		ctx: CanvasRenderingContext2D,
		x: number,
		y: number,
		radius: number,
		colors: string[],
		alpha: number
	): void {
		ctx.globalAlpha = alpha;
		if (colors.length === 2) {
			ctx.beginPath();
			ctx.arc(x, y, radius, Math.PI / 2, 3 * Math.PI / 2);
			ctx.fillStyle = colors[0];
			ctx.fill();

			ctx.beginPath();
			ctx.arc(x, y, radius, -Math.PI / 2, Math.PI / 2);
			ctx.fillStyle = colors[1];
			ctx.fill();
		} else {
			const sliceAngle = (2 * Math.PI) / colors.length;
			colors.forEach((color, i) => {
				const startAngle = -Math.PI / 2 + i * sliceAngle;
				const endAngle = startAngle + sliceAngle;
				ctx.beginPath();
				ctx.moveTo(x, y);
				ctx.arc(x, y, radius, startAngle, endAngle);
				ctx.closePath();
				ctx.fillStyle = color;
				ctx.fill();
			});
		}

		ctx.beginPath();
		ctx.arc(x, y, radius, 0, 2 * Math.PI);
		ctx.strokeStyle = '#333333';
		ctx.lineWidth = 1;
		ctx.stroke();
		ctx.globalAlpha = 1;
	}

	// --- Debug ---

	private debugGraphNodes(): void {
		console.log('=== Graph Source Color Debug ===');
		console.log('Settings:', JSON.stringify(this.settings, null, 2));
		console.log('Obsidian colorGroups:', Object.fromEntries(this.obsidianColorMap));
		console.log('Deleted paths:', Array.from(this.deletedPaths));

		if (this.colorManager) {
			const files = this.app.vault.getMarkdownFiles();
			for (const file of files) {
				if (this.sourceDetector?.isSourcePath(file.path)) {
					const effectiveColor = this.getEffectiveSourceColor(file.path);
					const hasObsidian = this.hasObsidianColorGroup(file.path);
					console.log(`  [SOURCE] "${file.path}": effectiveColor=${effectiveColor}, obsidianSet=${hasObsidian}`);
				} else {
					const colors = this.getChildNodeColors(file.path);
					if (colors.length > 0) {
						const tag = colors.length > 1 ? 'MULTI' : 'single';
						console.log(`  [${tag}] "${file.path}": colors=${JSON.stringify(colors)}`);
					}
				}
			}
		}

		for (const [key, canvas] of this.overlayCanvases) {
			console.log(`Overlay canvas "${key}": ${canvas.width}x${canvas.height}`);
		}

		new Notice('调试信息已输出到控制台');
	}
}

// --- Settings Tab ---

class GraphSourceColorSettingTab extends PluginSettingTab {
	plugin: GraphSourceColorPlugin;

	constructor(app: App, plugin: GraphSourceColorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: '图谱源点着色设置' });

		new Setting(containerEl)
			.setName('启用多色节点')
			.setDesc('为链接多个源点的笔记显示多色节点')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableMultiColor)
				.onChange(async (value) => {
					this.plugin.settings.enableMultiColor = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h3', { text: '源点文件夹' });
		containerEl.createEl('p', {
			text: '选择包含源点笔记的文件夹，每个文件夹对应一种颜色分组',
			cls: 'setting-item-description'
		});

		const treeContainer = containerEl.createDiv({ cls: 'folder-tree-container' });
		const treeSelector = new FolderTreeSelector(this.app, treeContainer, this.plugin.settings.sourceFolders);
		treeSelector.onCheckChange = async (checkedFolders: string[]) => {
			this.plugin.settings.sourceFolders = checkedFolders;
			for (const folder of checkedFolders) {
				if (!this.plugin.settings.groupColors[folder]) {
					const usedColors = new Set(Object.values(this.plugin.settings.groupColors));
					this.plugin.settings.groupColors[folder] = getNextColor(usedColors);
				}
			}
			await this.plugin.saveSettings();
			this.display();
		};

		containerEl.createEl('h3', { text: '分组颜色' });
		containerEl.createEl('p', {
			text: '为源点文件夹设置颜色，源点节点和子节点都会使用对应颜色',
			cls: 'setting-item-description'
		});

		for (const folder of this.plugin.settings.sourceFolders) {
			const color = this.plugin.settings.groupColors[folder] || '#4A90D9';
			new Setting(containerEl)
				.setName(folder)
				.addColorPicker(picker => picker
					.setValue(color)
					.onChange(async (value) => {
						this.plugin.settings.groupColors[folder] = value;
						await this.plugin.saveSettings();
					}));
		}
	}
}
