# Graph Source Color

An Obsidian plugin that dynamically colors graph nodes based on their linked "source" notes.

## Demo

[View the interactive demo](https://karl-cn.github.io/graph-source-color/demo.html) — Step-by-step animation showing how source colors propagate through links.

## Features

- **Source Detection** — Automatically identifies source notes within configured folders. Each folder becomes a color group.
- **Link Propagation** — Recursively traces outgoing and incoming links to associate notes with their relevant sources. Linked notes inherit source colors through BFS propagation.
- **Multi-Color Nodes** — Notes linked to multiple sources display split-color nodes:
  - 2 sources → left/right split
  - 3+ sources → pie-chart split
- **Read-Only** — Does not modify Obsidian's native `graph.json` configuration.
- **Folder Tree Selector** — Visual folder picker in settings for easy source folder configuration.
- **Color Inheritance** — Parent folder colors cascade to sub-folders that don't have an explicit color set.

## Installation

### From Obsidian Community Plugins

1. Open Settings → Community Plugins
2. Search for "Graph Source Color"
3. Install and enable

### Manual Installation

1. Download `main.js` and `manifest.json` from the [latest release](https://github.com/Karl-CN/graph-source-color/releases)
2. Copy both files to your vault: `<vault>/.obsidian/plugins/graph-source-color/`
3. Restart Obsidian and enable the plugin in Settings → Community Plugins

## Configuration

Open Settings → "Graph Source Color" to configure:

| Setting | Default | Description |
|---------|---------|-------------|
| Enable Multi-Color Nodes | true | Show split-color nodes for notes linked to multiple sources |
| Source Folders | — | Folders containing source notes (each folder = one color group) |
| Group Colors | auto-assigned | Color for each source folder |

**Note:** Source folder colors can also be set in Obsidian's native graph settings (color groups with `path:` queries). The plugin will read and respect those colors.

## How It Works

### Source Identification

Notes inside configured **source folders** are automatically treated as source notes. Their group is determined by the folder they belong to.

### Association Logic

1. **Outgoing links** — A source note's outgoing links associate the target note with that source
2. **Incoming links** — A non-source note linking to a source becomes associated with that source
3. **Propagation** — Notes already associated with sources propagate those associations through their own outgoing links (BFS)

## Commands

| Command | Description |
|---------|-------------|
| Refresh Graph Colors | Rebuild color cache and re-render overlay |
| Debug Graph Nodes | Output node color info to developer console |

## Compatibility

- Minimum Obsidian version: 0.15.0
- Desktop and mobile supported

## Development

```bash
npm install
npm run dev    # Watch mode
npm run build  # Production build
```

## License

[MIT](LICENSE)
