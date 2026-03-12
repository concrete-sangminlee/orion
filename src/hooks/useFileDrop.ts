/**
 * File drop handling hooks.
 * Provides drag-and-drop file opening, folder import,
 * and external file drop zone management.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/* ── Types ─────────────────────────────────────────────── */

export interface DroppedFile {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number
  mimeType?: string
  content?: string
}

export interface DropZoneState {
  isDragging: boolean
  isOverTarget: boolean
  droppedFiles: DroppedFile[]
  error: string | null
}

export interface DropZoneOptions {
  accept?: string[]  // Accepted file extensions (e.g., ['.ts', '.js'])
  multiple?: boolean
  maxFileSize?: number  // In bytes
  maxFiles?: number
  onDrop?: (files: DroppedFile[]) => void
  onError?: (error: string) => void
  preventDefaults?: boolean
}

/* ── File Drop Hook ────────────────────────────────────── */

export function useFileDrop(options: DropZoneOptions = {}) {
  const {
    accept,
    multiple = true,
    maxFileSize = 50 * 1024 * 1024, // 50MB
    maxFiles = 100,
    onDrop,
    onError,
    preventDefaults = true,
  } = options

  const [state, setState] = useState<DropZoneState>({
    isDragging: false,
    isOverTarget: false,
    droppedFiles: [],
    error: null,
  })

  const dragCounter = useRef(0)
  const dropRef = useRef<HTMLDivElement>(null)

  const handleDragEnter = useCallback((e: DragEvent) => {
    if (preventDefaults) {
      e.preventDefault()
      e.stopPropagation()
    }
    dragCounter.current++
    if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
      setState(s => ({ ...s, isDragging: true }))
    }
  }, [preventDefaults])

  const handleDragLeave = useCallback((e: DragEvent) => {
    if (preventDefaults) {
      e.preventDefault()
      e.stopPropagation()
    }
    dragCounter.current--
    if (dragCounter.current === 0) {
      setState(s => ({ ...s, isDragging: false, isOverTarget: false }))
    }
  }, [preventDefaults])

  const handleDragOver = useCallback((e: DragEvent) => {
    if (preventDefaults) {
      e.preventDefault()
      e.stopPropagation()
    }
    setState(s => ({ ...s, isOverTarget: true }))

    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [preventDefaults])

  const handleDrop = useCallback(async (e: DragEvent) => {
    if (preventDefaults) {
      e.preventDefault()
      e.stopPropagation()
    }

    dragCounter.current = 0
    setState(s => ({ ...s, isDragging: false, isOverTarget: false, error: null }))

    const items = e.dataTransfer?.items
    const fileList = e.dataTransfer?.files

    if (!items && !fileList) return

    try {
      const files: DroppedFile[] = []

      // Try using DataTransferItemList (supports directories)
      if (items) {
        for (let i = 0; i < items.length && files.length < maxFiles; i++) {
          const item = items[i]

          if (item.kind === 'file') {
            const entry = (item as any).webkitGetAsEntry?.() || (item as any).getAsEntry?.()

            if (entry) {
              const entryFiles = await readEntry(entry, maxFileSize, accept)
              files.push(...entryFiles)
            } else {
              const file = item.getAsFile()
              if (file) {
                const droppedFile = await processFile(file, accept, maxFileSize)
                if (droppedFile) files.push(droppedFile)
              }
            }
          }
        }
      } else if (fileList) {
        for (let i = 0; i < fileList.length && files.length < maxFiles; i++) {
          const droppedFile = await processFile(fileList[i], accept, maxFileSize)
          if (droppedFile) files.push(droppedFile)
        }
      }

      if (!multiple && files.length > 1) {
        files.length = 1
      }

      setState(s => ({ ...s, droppedFiles: files }))
      onDrop?.(files)
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to process dropped files'
      setState(s => ({ ...s, error: errorMsg }))
      onError?.(errorMsg)
    }
  }, [accept, maxFileSize, maxFiles, multiple, onDrop, onError, preventDefaults])

  // Global drag/drop handlers
  useEffect(() => {
    const element = dropRef.current || document.body

    element.addEventListener('dragenter', handleDragEnter)
    element.addEventListener('dragleave', handleDragLeave)
    element.addEventListener('dragover', handleDragOver)
    element.addEventListener('drop', handleDrop)

    return () => {
      element.removeEventListener('dragenter', handleDragEnter)
      element.removeEventListener('dragleave', handleDragLeave)
      element.removeEventListener('dragover', handleDragOver)
      element.removeEventListener('drop', handleDrop)
    }
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop])

  const clearFiles = useCallback(() => {
    setState(s => ({ ...s, droppedFiles: [], error: null }))
  }, [])

  return {
    ...state,
    dropRef,
    clearFiles,
  }
}

/* ── Editor Drop Zone Hook ─────────────────────────────── */

export function useEditorFileDrop(onOpenFile: (path: string) => void) {
  return useFileDrop({
    accept: [
      '.ts', '.tsx', '.js', '.jsx', '.json', '.html', '.css', '.scss',
      '.md', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp',
      '.yaml', '.yml', '.toml', '.xml', '.sql', '.sh', '.bash',
      '.vue', '.svelte', '.astro', '.rb', '.php', '.swift', '.kt',
      '.dart', '.lua', '.r', '.jl', '.zig', '.nim', '.ex', '.exs',
      '.hs', '.ml', '.clj', '.scala', '.graphql', '.proto', '.tf',
      '.prisma', '.env', '.gitignore', '.dockerfile',
      '.txt', '.log', '.csv', '.ini', '.cfg', '.conf',
    ],
    onDrop: (files) => {
      for (const file of files) {
        if (file.type === 'file' && file.path) {
          onOpenFile(file.path)
        }
      }
    },
  })
}

/* ── Helpers ───────────────────────────────────────────── */

async function processFile(
  file: File,
  accept?: string[],
  maxSize?: number
): Promise<DroppedFile | null> {
  // Check extension
  if (accept && accept.length > 0) {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!accept.includes(ext)) return null
  }

  // Check size
  if (maxSize && file.size > maxSize) return null

  // Try to get path from Electron
  const electronPath = (file as any).path

  return {
    name: file.name,
    path: electronPath || file.name,
    type: 'file',
    size: file.size,
    mimeType: file.type,
  }
}

async function readEntry(
  entry: any,
  maxSize: number,
  accept?: string[]
): Promise<DroppedFile[]> {
  const files: DroppedFile[] = []

  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      entry.file(resolve, reject)
    })
    const processed = await processFile(file, accept, maxSize)
    if (processed) files.push(processed)
  } else if (entry.isDirectory) {
    const reader = entry.createReader()
    const entries = await new Promise<any[]>((resolve, reject) => {
      reader.readEntries(resolve, reject)
    })

    // Add directory entry
    files.push({
      name: entry.name,
      path: entry.fullPath || entry.name,
      type: 'directory',
      size: 0,
    })

    // Recursively read directory contents
    for (const childEntry of entries) {
      const childFiles = await readEntry(childEntry, maxSize, accept)
      files.push(...childFiles)
    }
  }

  return files
}

/* ── Drop Overlay Component Helper ─────────────────────── */

export interface DropOverlayProps {
  isDragging: boolean
  message?: string
}

export function getDropOverlayStyle(isDragging: boolean): React.CSSProperties {
  return {
    position: 'fixed',
    inset: 0,
    zIndex: isDragging ? 9999 : -1,
    opacity: isDragging ? 1 : 0,
    pointerEvents: isDragging ? 'auto' : 'none',
    background: 'rgba(0, 122, 204, 0.1)',
    border: '2px dashed var(--accent-primary, #007acc)',
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'opacity 0.2s ease',
  }
}
