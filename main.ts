import { App, Plugin, PluginSettingTab, Setting, Notice } from 'obsidian';
import { SourceDetector, SourceDetectorSettings, DEFAULT_SETTINGS as SOURCE_DEFAULT_SETTINGS } from './sourceDetector';
import { ColorManager } from './colorManager';

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

function rgbNumberToHex(rgb: number): string {
	return '#' + rgb.toString(16).padStart(6, '0');
}

export default class GraphSourceColorPlugin extends Plugin {
	settings: GraphSourceColorSettings;
	sourceDetector: SourceDetector;
	colorManager: ColorManager;
	private overlayCanvases: Map<string, HTMLCanvasElement> = new Map();
	private renderRAF: number | null = null;
	private lastColorSync = 0;
	private removing = false;

	async onload() {
		await this.loadSettings();

		this.app.workspace.onLayoutReady(async () => {
			this.removing = false;
			this.sourceDetector = new SourceDetector(this.app, this.settings);
			this.colorManager = new ColorManager(this.app, this.sourceDetector);
			console.log('[Graph Source Color] Initialized');

			await this.restoreColorsFromGraphJson();
			this.startOverlayRender();
		});

		this.registerEvent(
			this.app.metadataCache.on('changed', () => {
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
			// Just clear overlay and restore nodes, don't stop render loop
			this.clearOverlaysAndRestoreNodes();
		} else {
			// Re-enable: ensure overlays are set up
			this.setupOverlays();
		}
	}

	private async restoreColorsFromGraphJson(): Promise<void> {
		if (!this.sourceDetector) return;

		try {
			const existingGroups = (await this.readExistingColorGroups()) ?? [];
			if (existingGroups.length === 0) return;

			const pathColorMap = new Map<string, string>();
			for (const cg of existingGroups) {
				if (cg.query?.startsWith('path:') && cg.color?.rgb !== undefined && cg.color?.rgb !== 0 && cg.color?.rgb !== 0xFFFFFF) {
					pathColorMap.set(cg.query.replace('path:', '') + '.md', '#' + cg.color.rgb.toString(16).padStart(6, '0'));
				}
			}

			for (const source of this.sourceDetector.getAllSources()) {
				const color = pathColorMap.get(source.path);
				if (color && color !== '#000000' && color !== '#ffffff') {
					this.settings.groupColors[source.group] = color;
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

	private getSourceColorsFromRenderer(): Map<string, string> {
		const colorMap = new Map<string, string>();

		for (const viewType of ['graph', 'localgraph']) {
			this.app.workspace.getLeavesOfType(viewType).forEach((leaf) => {
				const view = leaf.view as any;
				const renderer = view.dataEngine?.renderer;
				if (!renderer?.nodes) return;

				for (const node of renderer.nodes) {
					if (!node.id || !this.sourceDetector?.isSourcePath(node.id)) continue;
					if (node.circle?.tint !== undefined && node.circle?.tint !== 0xFFFFFF && node.circle?.tint !== 0x000000) {
						colorMap.set(node.id, rgbNumberToHex(node.circle.tint));
					}
				}
			});
		}

		return colorMap;
	}

	private syncColorsFromRenderer(): boolean {
		if (!this.sourceDetector) return false;

		const tintMap = this.getSourceColorsFromRenderer();
		if (tintMap.size === 0) return false;

		let changed = false;
		for (const source of this.sourceDetector.getAllSources()) {
			const tintColor = tintMap.get(source.path);
			if (tintColor && tintColor !== '#000000' && this.settings.groupColors[source.group] !== tintColor) {
				this.settings.groupColors[source.group] = tintColor;
				changed = true;
			}
		}

		if (changed) {
			console.log('[Graph Source Color] Synced from tint:', JSON.stringify(this.settings.groupColors));
			this.sourceDetector.updateSettings(this.settings);
			this.saveData(this.settings);
			this.colorManager.refresh();
		}

		return changed;
	}

	private getNodeColorsLive(nodeId: string, tintMap: Map<string, string>): string[] {
		if (!this.sourceDetector || !this.colorManager) return [];

		const info = this.colorManager.getNodeColorInfo(nodeId);
		if (!info || info.sources.length === 0) return [];

		const colorSet: string[] = [];
		const seenGroups = new Set<string>();

		for (const source of info.sources) {
			if (seenGroups.has(source.group)) continue;
			seenGroups.add(source.group);

			const tintColor = tintMap.get(source.path);
			const color = tintColor || source.color;
			if (color) {
				colorSet.push(color);
			}
		}

		return colorSet;
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
			this.renderMultiColorNodes();
			this.renderRAF = requestAnimationFrame(renderLoop);
		};
		this.renderRAF = requestAnimationFrame(renderLoop);
	}

	private renderMultiColorNodes(): void {
		if (!this.colorManager || !this.settings.enableMultiColor) return;

		const now = Date.now();
		if (now - this.lastColorSync > 2000) {
			this.syncColorsFromRenderer();
			this.lastColorSync = now;
		}

		const tintMap = this.getSourceColorsFromRenderer();

		for (const viewType of ['graph', 'localgraph']) {
			this.app.workspace.getLeavesOfType(viewType).forEach((leaf) => {
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
					if (!node.id) continue;

					// Source nodes: always let Obsidian handle
					if (this.sourceDetector?.isSourcePath(node.id)) {
						if (node.circle && node.circle.alpha === 0) node.circle.alpha = 1;
						continue;
					}

					const colors = this.getNodeColorsLive(node.id, tintMap);
					if (colors.length <= 1) {
						if (node.circle && node.circle.alpha === 0) node.circle.alpha = 1;
						continue;
					}

					let screenX: number, screenY: number, radius: number;

					if (node.circle && typeof node.circle.getBounds === 'function') {
						const bounds = node.circle.getBounds();
						screenX = bounds.x + bounds.width / 2;
						screenY = bounds.y + bounds.height / 2;
						radius = bounds.width / 2;
					} else {
						screenX = node.x * scale + panX;
						screenY = node.y * scale + panY;
						radius = 3 * nodeScale * scale;
					}

					if (node.circle) {
						node.circle.alpha = 0;
					}

					this.drawMultiColorNode(ctx, screenX, screenY, radius, colors);
				}
			});
		}
	}

	private drawMultiColorNode(
		ctx: CanvasRenderingContext2D,
		x: number,
		y: number,
		radius: number,
		colors: string[]
	): void {
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
	}

	// --- Debug ---

	private debugGraphNodes(): void {
		console.log('=== Graph Source Color Debug ===');
		console.log('Plugin groupColors:', JSON.stringify(this.settings.groupColors));

		const tintMap = this.getSourceColorsFromRenderer();
		console.log('PixiJS tint colors:', Object.fromEntries(tintMap));

		if (this.colorManager) {
			const files = this.app.vault.getMarkdownFiles();
			for (const file of files) {
				const liveColors = this.getNodeColorsLive(file.path, tintMap);
				if (liveColors.length > 0) {
					const tag = liveColors.length > 1 ? 'MULTI' : 'single';
					console.log(`  [${tag}] "${file.path}": colors=${JSON.stringify(liveColors)}`);
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

		new Setting(containerEl)
			.setName('源点文件夹')
			.setDesc('存放源点笔记的文件夹路径')
			.addText(text => text
				.setValue(this.plugin.settings.sourceFolder)
				.onChange(async (value) => {
					this.plugin.settings.sourceFolder = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h3', { text: '分组颜色' });
		containerEl.createEl('p', {
			text: '源节点颜色请在 Obsidian 图谱设置中修改，修改后子节点颜色会自动联动',
			cls: 'setting-item-description'
		});
	}
}
