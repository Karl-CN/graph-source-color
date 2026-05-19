import { App, TFolder } from 'obsidian';

interface FolderNode {
	path: string;
	name: string;
	children: FolderNode[];
	checked: boolean;
	expanded: boolean;
}

export class FolderTreeSelector {
	private app: App;
	private containerEl: HTMLElement;
	private checkedFolders: Set<string>;
	private tree: FolderNode[] = [];
	public onCheckChange: (checkedFolders: string[]) => void = () => {};

	constructor(app: App, containerEl: HTMLElement, initialChecked: string[]) {
		this.app = app;
		this.containerEl = containerEl;
		this.checkedFolders = new Set(initialChecked);
		this.buildTree();
		this.render();
	}

	private buildTree(): void {
		const root = this.app.vault.getRoot();
		this.tree = this.buildNodes(root);
	}

	private buildNodes(parent: TFolder): FolderNode[] {
		const nodes: FolderNode[] = [];
		for (const child of parent.children) {
			if (child instanceof TFolder) {
				const node: FolderNode = {
					path: child.path,
					name: child.name,
					children: this.buildNodes(child),
					checked: this.checkedFolders.has(child.path),
					expanded: this.checkedFolders.has(child.path)
				};
				nodes.push(node);
			}
		}
		nodes.sort((a, b) => {
			if (a.children.length > 0 && b.children.length === 0) return -1;
			if (a.children.length === 0 && b.children.length > 0) return 1;
			return a.name.localeCompare(b.name);
		});
		return nodes;
	}

	private render(): void {
		this.containerEl.empty();
		this.containerEl.addClass('folder-tree');
		for (const node of this.tree) {
			this.renderNode(node, this.containerEl);
		}
	}

	private renderNode(node: FolderNode, container: HTMLElement): void {
		const item = container.createDiv({ cls: 'folder-tree-item' });
		const row = item.createDiv({ cls: 'folder-tree-row' });

		// Expand/collapse toggle
		const toggle = row.createSpan({ cls: 'folder-tree-toggle' });
		if (node.children.length > 0) {
			toggle.setText(node.expanded ? '▾' : '▸');
			toggle.addEventListener('click', () => {
				node.expanded = !node.expanded;
				toggle.setText(node.expanded ? '▾' : '▸');
				if (childContainer) {
					childContainer.style.display = node.expanded ? 'block' : 'none';
				}
			});
		} else {
			toggle.setText(' ');
			toggle.style.visibility = 'hidden';
		}

		// Checkbox
		const checkbox = row.createEl('input', { type: 'checkbox' });
		checkbox.addClass('folder-tree-checkbox');
		checkbox.checked = node.checked;
		checkbox.addEventListener('change', () => {
			node.checked = checkbox.checked;
			if (node.checked) {
				this.checkedFolders.add(node.path);
			} else {
				this.checkedFolders.delete(node.path);
			}
			this.onCheckChange(Array.from(this.checkedFolders));
		});

		// Folder name
		row.createSpan({ text: node.name, cls: 'folder-tree-name' });

		// Children container
		let childContainer: HTMLElement | null = null;
		if (node.children.length > 0) {
			childContainer = item.createDiv({ cls: 'folder-tree-children' });
			if (!node.expanded) childContainer.style.display = 'none';
			for (const child of node.children) {
				this.renderNode(child, childContainer);
			}
		}
	}
}
