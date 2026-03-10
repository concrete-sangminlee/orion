import { useFileStore } from '@/store/files'
import { useEditorStore } from '@/store/editor'
import type { FileNode } from '@shared/types'

function FileTreeNode({ node, depth }: { node: FileNode; depth: number }) {
  const { expandedDirs, toggleDir } = useFileStore()
  const openFile = useEditorStore((s) => s.openFile)
  const isExpanded = expandedDirs.has(node.path)

  const handleClick = async () => {
    if (node.type === 'directory') {
      toggleDir(node.path)
    } else {
      try {
        const result = await window.api.readFile(node.path)
        openFile({
          path: node.path,
          name: node.name,
          content: result.content,
          language: result.language,
          isModified: false,
          aiModified: false,
        })
      } catch (e) {
        console.error('Failed to open file:', e)
      }
    }
  }

  const gitColor = node.gitStatus === 'modified' ? 'text-accent-yellow'
    : node.gitStatus === 'added' ? 'text-accent-green'
    : node.gitStatus === 'deleted' ? 'text-accent-red'
    : node.gitStatus === 'untracked' ? 'text-accent-orange'
    : ''

  return (
    <div>
      <div
        onClick={handleClick}
        className={`flex items-center py-0.5 px-2 cursor-pointer hover:bg-bg-hover rounded text-xs ${gitColor || 'text-text-primary'}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <span className="mr-1.5 text-[11px]">
          {node.type === 'directory' ? (isExpanded ? '📂' : '📁') : '📄'}
        </span>
        <span className="truncate">{node.name}</span>
      </div>
      {node.type === 'directory' && isExpanded && node.children?.map((child) => (
        <FileTreeNode key={child.path} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}

export default function FileExplorer() {
  const { fileTree, rootPath } = useFileStore()
  const setRootPath = useFileStore((s) => s.setRootPath)
  const setFileTree = useFileStore((s) => s.setFileTree)

  const handleOpenFolder = async () => {
    const path = await window.api.openFolder()
    if (path) {
      setRootPath(path)
      const tree = await window.api.readDir(path)
      setFileTree(tree)
      window.api.watchStart(path)
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-3 py-2.5 border-b border-border-primary flex items-center">
        <span className="text-text-secondary text-[10px] font-semibold tracking-wider">EXPLORER</span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {fileTree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <p className="text-text-muted text-xs">No folder open</p>
            <button
              onClick={handleOpenFolder}
              className="text-accent-blue text-xs hover:underline"
            >
              Open Folder
            </button>
          </div>
        ) : (
          fileTree.map((node) => <FileTreeNode key={node.path} node={node} depth={0} />)
        )}
      </div>
    </div>
  )
}
