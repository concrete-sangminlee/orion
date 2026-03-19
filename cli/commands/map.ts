/**
 * Orion CLI - Repository Map Command (inspired by Aider's repo-map)
 * Generates a structural map of the repository for AI context.
 *
 * Usage:
 *   orion map                    # Generate repository structure map
 *   orion map --symbols          # Include function/class/interface symbols
 *   orion map --deps             # Include dependency graph (import analysis)
 *   orion map --output map.md    # Save map to a file
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  colors,
  printHeader,
  printSuccess,
  printError,
  printInfo,
  printWarning,
} from '../utils.js';
import { commandHeader, divider, statusLine, palette, table as uiTable, keyValue, box } from '../ui.js';
import { getPipelineOptions, jsonOutput } from '../pipeline.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output',
  'coverage', '.cache', '.turbo', '.vercel', '__pycache__', '.pytest_cache',
  'target', 'vendor', '.idea', '.vscode', '.orion', '.env', 'out',
  '.svelte-kit', '.angular', '.parcel-cache', 'tmp', 'temp',
]);

const IGNORE_FILES = new Set([
  '.DS_Store', 'Thumbs.db', '.gitkeep', 'package-lock.json',
  'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', 'Cargo.lock',
  'Gemfile.lock', 'poetry.lock',
]);

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.scala',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.swift',
  '.php', '.lua', '.dart', '.ex', '.exs', '.erl', '.hs',
  '.ml', '.clj', '.lisp', '.r', '.vue', '.svelte',
]);

const CATEGORY_MAP: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript (JSX)', '.js': 'JavaScript',
  '.jsx': 'JavaScript (JSX)', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.py': 'Python', '.rb': 'Ruby', '.go': 'Go', '.rs': 'Rust',
  '.java': 'Java', '.kt': 'Kotlin', '.scala': 'Scala',
  '.c': 'C', '.cpp': 'C++', '.h': 'C Header', '.hpp': 'C++ Header',
  '.cs': 'C#', '.swift': 'Swift', '.php': 'PHP', '.lua': 'Lua',
  '.dart': 'Dart', '.ex': 'Elixir', '.exs': 'Elixir',
  '.erl': 'Erlang', '.hs': 'Haskell', '.ml': 'OCaml',
  '.clj': 'Clojure', '.lisp': 'Lisp', '.r': 'R',
  '.vue': 'Vue', '.svelte': 'Svelte',
  '.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS', '.less': 'Less',
  '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML', '.toml': 'TOML',
  '.xml': 'XML', '.md': 'Markdown', '.sql': 'SQL',
  '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell', '.ps1': 'PowerShell',
  '.dockerfile': 'Docker', '.env': 'Environment',
};

// ─── Types ──────────────────────────────────────────────────────────────────

interface FileNode {
  name: string;
  relativePath: string;
  size: number;
  extension: string;
  isDirectory: boolean;
  children?: FileNode[];
  symbols?: SymbolInfo[];
  imports?: string[];
}

interface SymbolInfo {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const' | 'variable';
  exported: boolean;
  line: number;
}

interface MapStats {
  totalFiles: number;
  totalDirs: number;
  totalSize: number;
  byExtension: Record<string, { count: number; size: number }>;
  byLanguage: Record<string, number>;
  symbolCounts: { functions: number; classes: number; interfaces: number; types: number; enums: number };
}

interface DepEdge {
  from: string;
  to: string;
}

// ─── Symbol Extraction ──────────────────────────────────────────────────────

const SYMBOL_PATTERNS: Array<{
  kind: SymbolInfo['kind'];
  regex: RegExp;
  nameGroup: number;
  exported: boolean;
}> = [
  // Exported functions
  { kind: 'function', regex: /^export\s+(?:async\s+)?function\s+(\w+)/gm, nameGroup: 1, exported: true },
  { kind: 'function', regex: /^export\s+(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/gm, nameGroup: 1, exported: true },
  // Non-exported functions
  { kind: 'function', regex: /^(?:async\s+)?function\s+(\w+)/gm, nameGroup: 1, exported: false },
  // Exported classes
  { kind: 'class', regex: /^export\s+(?:abstract\s+)?class\s+(\w+)/gm, nameGroup: 1, exported: true },
  // Non-exported classes
  { kind: 'class', regex: /^(?:abstract\s+)?class\s+(\w+)/gm, nameGroup: 1, exported: false },
  // Exported interfaces (TS)
  { kind: 'interface', regex: /^export\s+interface\s+(\w+)/gm, nameGroup: 1, exported: true },
  // Non-exported interfaces
  { kind: 'interface', regex: /^interface\s+(\w+)/gm, nameGroup: 1, exported: false },
  // Exported type aliases
  { kind: 'type', regex: /^export\s+type\s+(\w+)/gm, nameGroup: 1, exported: true },
  // Non-exported type aliases
  { kind: 'type', regex: /^type\s+(\w+)\s*=/gm, nameGroup: 1, exported: false },
  // Exported enums
  { kind: 'enum', regex: /^export\s+(?:const\s+)?enum\s+(\w+)/gm, nameGroup: 1, exported: true },
  // Non-exported enums
  { kind: 'enum', regex: /^(?:const\s+)?enum\s+(\w+)/gm, nameGroup: 1, exported: false },
  // Python: class, def
  { kind: 'class', regex: /^class\s+(\w+)/gm, nameGroup: 1, exported: true },
  { kind: 'function', regex: /^def\s+(\w+)/gm, nameGroup: 1, exported: false },
  { kind: 'function', regex: /^async\s+def\s+(\w+)/gm, nameGroup: 1, exported: false },
  // Go: func, type struct
  { kind: 'function', regex: /^func\s+(?:\(.*?\)\s+)?(\w+)/gm, nameGroup: 1, exported: false },
  // Rust: fn, struct, enum, trait, impl
  { kind: 'function', regex: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm, nameGroup: 1, exported: false },
  { kind: 'class', regex: /^(?:pub\s+)?struct\s+(\w+)/gm, nameGroup: 1, exported: false },
  { kind: 'interface', regex: /^(?:pub\s+)?trait\s+(\w+)/gm, nameGroup: 1, exported: false },
];

function extractSymbols(content: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  const seen = new Set<string>();

  for (const pattern of SYMBOL_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      const key = `${pattern.kind}:${name}`;

      if (!seen.has(key)) {
        seen.add(key);
        const line = content.substring(0, match.index).split('\n').length;
        symbols.push({
          name,
          kind: pattern.kind,
          exported: pattern.exported || match[0].startsWith('export') || match[0].startsWith('pub'),
          line,
        });
      }
    }
  }

  return symbols.sort((a, b) => a.line - b.line);
}

// ─── Import Analysis ────────────────────────────────────────────────────────

const IMPORT_PATTERNS = [
  // ES6 imports: import X from './file'
  /(?:import\s+.*?\s+from\s+|import\s+)['"]([^'"]+)['"]/gm,
  // CommonJS: require('./file')
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm,
  // Python: from X import Y / import X
  /^(?:from|import)\s+([\w.]+)/gm,
  // Go: import "pkg"
  /import\s+["']([^"']+)["']/gm,
  // Rust: use crate::X
  /^use\s+([\w:]+)/gm,
];

function extractImports(content: string, filePath: string): string[] {
  const imports: string[] = [];
  const dir = path.dirname(filePath);

  for (const pattern of IMPORT_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const raw = match[1];
      // Resolve relative paths
      if (raw.startsWith('.')) {
        const resolved = path.normalize(path.join(dir, raw)).replace(/\\/g, '/');
        imports.push(resolved);
      } else {
        imports.push(raw);
      }
    }
  }

  return [...new Set(imports)];
}

// ─── Directory Scanner ──────────────────────────────────────────────────────

function scanDirectory(
  dirPath: string,
  rootPath: string,
  includeSymbols: boolean,
  includeDeps: boolean,
  depth: number = 0,
  maxDepth: number = 15
): FileNode | null {
  if (depth > maxDepth) return null;

  const name = path.basename(dirPath);
  if (IGNORE_DIRS.has(name) && depth > 0) return null;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return null;
  }

  const children: FileNode[] = [];

  // Sort: directories first, then files alphabetically
  const sortedEntries = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sortedEntries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(rootPath, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      const child = scanDirectory(fullPath, rootPath, includeSymbols, includeDeps, depth + 1, maxDepth);
      if (child && child.children && child.children.length > 0) {
        children.push(child);
      }
    } else {
      if (IGNORE_FILES.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;

      let size = 0;
      try {
        size = fs.statSync(fullPath).size;
      } catch { /* skip */ }

      const ext = path.extname(entry.name).toLowerCase();
      const node: FileNode = {
        name: entry.name,
        relativePath,
        size,
        extension: ext,
        isDirectory: false,
      };

      // Extract symbols if requested and is a source file
      if ((includeSymbols || includeDeps) && SOURCE_EXTENSIONS.has(ext)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (includeSymbols) {
            node.symbols = extractSymbols(content);
          }
          if (includeDeps) {
            node.imports = extractImports(content, relativePath);
          }
        } catch { /* skip unreadable files */ }
      }

      children.push(node);
    }
  }

  if (children.length === 0 && depth > 0) return null;

  return {
    name,
    relativePath: path.relative(rootPath, dirPath).replace(/\\/g, '/') || '.',
    size: 0,
    extension: '',
    isDirectory: true,
    children,
  };
}

// ─── Statistics Collector ────────────────────────────────────────────────────

function collectStats(node: FileNode): MapStats {
  const stats: MapStats = {
    totalFiles: 0,
    totalDirs: 0,
    totalSize: 0,
    byExtension: {},
    byLanguage: {},
    symbolCounts: { functions: 0, classes: 0, interfaces: 0, types: 0, enums: 0 },
  };

  function walk(n: FileNode) {
    if (n.isDirectory) {
      stats.totalDirs++;
      for (const child of n.children || []) {
        walk(child);
      }
    } else {
      stats.totalFiles++;
      stats.totalSize += n.size;

      const ext = n.extension || 'other';
      if (!stats.byExtension[ext]) {
        stats.byExtension[ext] = { count: 0, size: 0 };
      }
      stats.byExtension[ext].count++;
      stats.byExtension[ext].size += n.size;

      const lang = CATEGORY_MAP[ext] || 'Other';
      stats.byLanguage[lang] = (stats.byLanguage[lang] || 0) + 1;

      if (n.symbols) {
        for (const sym of n.symbols) {
          switch (sym.kind) {
            case 'function': stats.symbolCounts.functions++; break;
            case 'class': stats.symbolCounts.classes++; break;
            case 'interface': stats.symbolCounts.interfaces++; break;
            case 'type': stats.symbolCounts.types++; break;
            case 'enum': stats.symbolCounts.enums++; break;
          }
        }
      }
    }
  }

  walk(node);
  return stats;
}

// ─── Tree Renderer ──────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function renderTree(
  node: FileNode,
  prefix: string,
  isLast: boolean,
  showSymbols: boolean,
  lines: string[],
  isRoot: boolean = false
): void {
  const connector = isRoot ? '' : (isLast ? '\u2514\u2500 ' : '\u251C\u2500 ');
  const childPrefix = isRoot ? '' : (isLast ? '   ' : '\u2502  ');

  if (node.isDirectory) {
    const dirIcon = '\u{1F4C1}';
    const dirName = palette.violet.bold(node.name + '/');
    if (!isRoot) {
      lines.push(`  ${prefix}${connector}${dirName}`);
    }

    const children = node.children || [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childIsLast = i === children.length - 1;
      renderTree(child, prefix + childPrefix, childIsLast, showSymbols, lines);
    }
  } else {
    const sizeStr = palette.dim(` (${formatSize(node.size)})`);
    const ext = node.extension;
    const lang = CATEGORY_MAP[ext];
    const fileColor = SOURCE_EXTENSIONS.has(ext) ? palette.blue : palette.dim;
    const fileName = fileColor(node.name);

    lines.push(`  ${prefix}${connector}${fileName}${sizeStr}`);

    // Show symbols underneath the file
    if (showSymbols && node.symbols && node.symbols.length > 0) {
      const symPrefix = prefix + childPrefix;
      for (let s = 0; s < node.symbols.length; s++) {
        const sym = node.symbols[s];
        const isLastSym = s === node.symbols.length - 1;
        const symConnector = isLastSym ? '\u2514\u2500 ' : '\u251C\u2500 ';

        let kindIcon: string;
        let kindColor: (s: string) => string;
        switch (sym.kind) {
          case 'function': kindIcon = 'fn'; kindColor = palette.green; break;
          case 'class': kindIcon = 'cls'; kindColor = palette.yellow; break;
          case 'interface': kindIcon = 'ifc'; kindColor = palette.teal; break;
          case 'type': kindIcon = 'typ'; kindColor = palette.blue; break;
          case 'enum': kindIcon = 'enm'; kindColor = palette.orange; break;
          default: kindIcon = 'var'; kindColor = palette.dim; break;
        }

        const exportMark = sym.exported ? palette.green('\u2191') : palette.dim('\u2022');
        lines.push(`  ${symPrefix}${symConnector}${exportMark} ${kindColor(kindIcon)} ${palette.white(sym.name)}${palette.dim(':' + sym.line)}`);
      }
    }
  }
}

// ─── Dependency Graph Renderer ──────────────────────────────────────────────

function buildDepGraph(node: FileNode): { edges: DepEdge[]; nodes: Set<string> } {
  const edges: DepEdge[] = [];
  const nodes = new Set<string>();

  function walk(n: FileNode) {
    if (n.isDirectory) {
      for (const child of n.children || []) walk(child);
    } else {
      nodes.add(n.relativePath);
      if (n.imports) {
        for (const imp of n.imports) {
          // Only include internal (relative) dependencies
          if (imp.startsWith('.') || !imp.includes('/') === false) {
            // Try to find the actual file
            const candidates = [imp, imp + '.ts', imp + '.js', imp + '/index.ts', imp + '/index.js'];
            const target = candidates.find(c => nodes.has(c)) || imp;
            edges.push({ from: n.relativePath, to: target });
          }
        }
      }
    }
  }

  // First pass: collect all nodes
  function collectNodes(n: FileNode) {
    if (n.isDirectory) {
      for (const child of n.children || []) collectNodes(child);
    } else {
      nodes.add(n.relativePath);
    }
  }
  collectNodes(node);

  // Second pass: collect edges
  walk(node);

  return { edges, nodes };
}

function renderDepGraph(edges: DepEdge[]): string[] {
  const lines: string[] = [];

  if (edges.length === 0) {
    lines.push(statusLine('i', palette.dim('No internal dependencies detected.')));
    return lines;
  }

  // Group by source file
  const bySource = new Map<string, string[]>();
  for (const edge of edges) {
    if (!bySource.has(edge.from)) bySource.set(edge.from, []);
    bySource.get(edge.from)!.push(edge.to);
  }

  // Sort by number of deps (most connected first)
  const sorted = [...bySource.entries()].sort((a, b) => b[1].length - a[1].length);

  // Show top 30 most connected files
  const shown = sorted.slice(0, 30);

  for (const [source, targets] of shown) {
    lines.push(`  ${palette.blue(source)}`);
    for (let i = 0; i < targets.length; i++) {
      const isLast = i === targets.length - 1;
      const connector = isLast ? '\u2514\u2500\u2192 ' : '\u251C\u2500\u2192 ';
      lines.push(`    ${palette.dim(connector)}${palette.dim(targets[i])}`);
    }
  }

  if (sorted.length > 30) {
    lines.push(palette.dim(`  ... and ${sorted.length - 30} more files`));
  }

  // Summary stats
  const inDegree = new Map<string, number>();
  for (const edge of edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
  }
  const topImported = [...inDegree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  if (topImported.length > 0) {
    lines.push('');
    lines.push(`  ${palette.violet.bold('Most imported files:')}`);
    for (const [file, count] of topImported) {
      lines.push(`    ${palette.green(String(count).padStart(3))} imports \u2190 ${palette.blue(file)}`);
    }
  }

  return lines;
}

// ─── Output Formatter ────────────────────────────────────────────────────────

function generateMapOutput(
  root: FileNode,
  stats: MapStats,
  showSymbols: boolean,
  showDeps: boolean,
): string {
  const lines: string[] = [];
  const projectName = path.basename(process.cwd());

  // Header
  lines.push(commandHeader('Repository Map', [
    ['Project', projectName],
    ['Files', String(stats.totalFiles)],
    ['Directories', String(stats.totalDirs)],
    ['Total Size', formatSize(stats.totalSize)],
  ]));
  lines.push('');

  // Tree structure
  lines.push(`  ${palette.violet.bold('File Tree')}`);
  lines.push(divider());
  lines.push('');

  const treeLines: string[] = [];
  renderTree(root, '', true, showSymbols, treeLines, true);
  lines.push(...treeLines);
  lines.push('');

  // Language breakdown
  const langEntries = Object.entries(stats.byLanguage).sort((a, b) => b[1] - a[1]);
  if (langEntries.length > 0) {
    lines.push(divider('Languages'));
    lines.push('');
    const langHeaders = ['Language', 'Files', 'Share'];
    const langRows = langEntries.map(([lang, count]) => {
      const pct = ((count / stats.totalFiles) * 100).toFixed(1) + '%';
      return [lang, String(count), pct];
    });
    lines.push(uiTable(langHeaders, langRows));
    lines.push('');
  }

  // Extension breakdown
  const extEntries = Object.entries(stats.byExtension).sort((a, b) => b[1].count - a[1].count);
  if (extEntries.length > 0) {
    lines.push(divider('File Types'));
    lines.push('');
    const extHeaders = ['Extension', 'Count', 'Size'];
    const extRows = extEntries.slice(0, 15).map(([ext, data]) => [
      ext || '(none)',
      String(data.count),
      formatSize(data.size),
    ]);
    lines.push(uiTable(extHeaders, extRows));
    lines.push('');
  }

  // Symbol summary
  if (showSymbols) {
    const sc = stats.symbolCounts;
    const totalSymbols = sc.functions + sc.classes + sc.interfaces + sc.types + sc.enums;
    lines.push(divider('Symbols'));
    lines.push('');
    lines.push(keyValue([
      ['Total Symbols', String(totalSymbols)],
      ['Functions', String(sc.functions)],
      ['Classes', String(sc.classes)],
      ['Interfaces', String(sc.interfaces)],
      ['Types', String(sc.types)],
      ['Enums', String(sc.enums)],
    ]));
    lines.push('');
  }

  // Dependency graph
  if (showDeps) {
    const { edges } = buildDepGraph(root);
    lines.push(divider('Dependency Graph'));
    lines.push('');
    lines.push(...renderDepGraph(edges));
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Markdown Output (for file export) ──────────────────────────────────────

function generateMarkdownOutput(
  root: FileNode,
  stats: MapStats,
  showSymbols: boolean,
  showDeps: boolean,
): string {
  const lines: string[] = [];
  const projectName = path.basename(process.cwd());

  lines.push(`# Repository Map: ${projectName}`);
  lines.push('');
  lines.push(`> Generated by Orion CLI on ${new Date().toISOString().split('T')[0]}`);
  lines.push('');
  lines.push('## Overview');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Files | ${stats.totalFiles} |`);
  lines.push(`| Directories | ${stats.totalDirs} |`);
  lines.push(`| Total Size | ${formatSize(stats.totalSize)} |`);
  lines.push('');

  // Language breakdown
  const langEntries = Object.entries(stats.byLanguage).sort((a, b) => b[1] - a[1]);
  if (langEntries.length > 0) {
    lines.push('## Languages');
    lines.push('');
    lines.push('| Language | Files | Share |');
    lines.push('|----------|-------|-------|');
    for (const [lang, count] of langEntries) {
      const pct = ((count / stats.totalFiles) * 100).toFixed(1) + '%';
      lines.push(`| ${lang} | ${count} | ${pct} |`);
    }
    lines.push('');
  }

  // File tree
  lines.push('## File Tree');
  lines.push('');
  lines.push('```');
  const treeLines: string[] = [];
  renderPlainTree(root, '', true, showSymbols, treeLines, true);
  lines.push(...treeLines);
  lines.push('```');
  lines.push('');

  // Symbols
  if (showSymbols) {
    const sc = stats.symbolCounts;
    lines.push('## Symbols');
    lines.push('');
    lines.push(`| Kind | Count |`);
    lines.push(`|------|-------|`);
    lines.push(`| Functions | ${sc.functions} |`);
    lines.push(`| Classes | ${sc.classes} |`);
    lines.push(`| Interfaces | ${sc.interfaces} |`);
    lines.push(`| Types | ${sc.types} |`);
    lines.push(`| Enums | ${sc.enums} |`);
    lines.push('');
  }

  // Dependencies
  if (showDeps) {
    const { edges } = buildDepGraph(root);
    lines.push('## Dependencies');
    lines.push('');
    if (edges.length > 0) {
      const bySource = new Map<string, string[]>();
      for (const edge of edges) {
        if (!bySource.has(edge.from)) bySource.set(edge.from, []);
        bySource.get(edge.from)!.push(edge.to);
      }
      const sorted = [...bySource.entries()].sort((a, b) => b[1].length - a[1].length);
      for (const [source, targets] of sorted.slice(0, 30)) {
        lines.push(`- **${source}**`);
        for (const target of targets) {
          lines.push(`  - -> ${target}`);
        }
      }
    } else {
      lines.push('No internal dependencies detected.');
    }
    lines.push('');
  }

  return lines.join('\n');
}

function renderPlainTree(
  node: FileNode,
  prefix: string,
  isLast: boolean,
  showSymbols: boolean,
  lines: string[],
  isRoot: boolean = false
): void {
  const connector = isRoot ? '' : (isLast ? '\u2514\u2500 ' : '\u251C\u2500 ');
  const childPrefix = isRoot ? '' : (isLast ? '   ' : '\u2502  ');

  if (node.isDirectory) {
    if (!isRoot) {
      lines.push(`${prefix}${connector}${node.name}/`);
    }
    const children = node.children || [];
    for (let i = 0; i < children.length; i++) {
      renderPlainTree(children[i], prefix + childPrefix, i === children.length - 1, showSymbols, lines);
    }
  } else {
    const sizeStr = ` (${formatSize(node.size)})`;
    lines.push(`${prefix}${connector}${node.name}${sizeStr}`);
    if (showSymbols && node.symbols && node.symbols.length > 0) {
      const symPrefix = prefix + childPrefix;
      for (let s = 0; s < node.symbols.length; s++) {
        const sym = node.symbols[s];
        const isLastSym = s === node.symbols.length - 1;
        const symConn = isLastSym ? '\u2514\u2500 ' : '\u251C\u2500 ';
        const expMark = sym.exported ? '\u2191' : '\u2022';
        lines.push(`${symPrefix}${symConn}${expMark} ${sym.kind} ${sym.name}:${sym.line}`);
      }
    }
  }
}

// ─── Main Command ────────────────────────────────────────────────────────────

export async function mapCommand(options: {
  symbols?: boolean;
  deps?: boolean;
  output?: string;
}): Promise<void> {
  const pipeline = getPipelineOptions();
  const cwd = process.cwd();
  const showSymbols = options.symbols || false;
  const showDeps = options.deps || false;

  // Scan the project
  const root = scanDirectory(cwd, cwd, showSymbols, showDeps);
  if (!root) {
    printError('Could not scan the current directory.');
    process.exit(1);
  }

  const stats = collectStats(root);

  // JSON output mode
  if (pipeline.json) {
    jsonOutput('map', {
      project: path.basename(cwd),
      stats,
      tree: root,
    });
    return;
  }

  // File output mode
  if (options.output) {
    const markdown = generateMarkdownOutput(root, stats, showSymbols, showDeps);
    const outputPath = path.resolve(options.output);
    fs.writeFileSync(outputPath, markdown, 'utf-8');
    console.log();
    printSuccess(`Repository map saved to ${colors.file(outputPath)}`);
    printInfo(`${stats.totalFiles} files, ${stats.totalDirs} directories, ${formatSize(stats.totalSize)} total`);
    console.log();
    return;
  }

  // Terminal output
  const output = generateMapOutput(root, stats, showSymbols, showDeps);
  console.log(output);
}
