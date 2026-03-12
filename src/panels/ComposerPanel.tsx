import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  memo,
} from 'react';
import {
  Plus,
  X,
  Send,
  Check,
  CheckCheck,
  XCircle,
  ChevronDown,
  ChevronRight,
  FileCode,
  FileDiff,
  Loader2,
  Sparkles,
  RotateCcw,
  Copy,
  Trash2,
  FolderOpen,
  MessageSquare,
  Zap,
  Settings,
  Hash,
  ArrowDownToLine,
  ArrowUpFromLine,
  FilePlus,
  Minus,
  Bot,
  User,
} from 'lucide-react';
import { useEditorStore } from '@/store/editor';
import { useFileStore } from '@/store/files';
import { useChatStore } from '@/store/chat';
import { useToastStore } from '@/store/toast';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DiffHunk {
  id: string;
  startLine: number;
  endLine: number;
  oldContent: string[];
  newContent: string[];
  status: 'pending' | 'accepted' | 'rejected';
}

interface FileChange {
  filePath: string;
  hunks: DiffHunk[];
  status: 'pending' | 'accepted' | 'rejected' | 'partial';
  language: string;
}

interface ComposerMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  fileChanges?: FileChange[];
  isStreaming?: boolean;
}

interface ContextFile {
  path: string;
  language: string;
  lineRange?: { start: number; end: number };
}

type ModelOption = {
  id: string;
  label: string;
  provider: string;
  maxTokens: number;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const AVAILABLE_MODELS: ModelOption[] = [
  { id: 'claude-opus-4-20250514', label: 'Claude Opus 4', provider: 'Anthropic', maxTokens: 200000 },
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', provider: 'Anthropic', maxTokens: 200000 },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'OpenAI', maxTokens: 128000 },
  { id: 'gpt-4-turbo', label: 'GPT-4 Turbo', provider: 'OpenAI', maxTokens: 128000 },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'Google', maxTokens: 1000000 },
];

let hunkIdCounter = 0;
const generateHunkId = () => `hunk-${++hunkIdCounter}-${Date.now()}`;
let messageIdCounter = 0;
const generateMessageId = () => `msg-${++messageIdCounter}-${Date.now()}`;

// ─── Utility: estimate token count ──────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.8);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

const DiffLine = memo(function DiffLine({
  type,
  content,
  lineNum,
}: {
  type: 'add' | 'remove' | 'context';
  content: string;
  lineNum?: number;
}) {
  const bgMap = {
    add: 'rgba(var(--success-rgb, 46, 160, 67), 0.15)',
    remove: 'rgba(var(--error-rgb, 248, 81, 73), 0.15)',
    context: 'transparent',
  };
  const colorMap = {
    add: 'var(--success)',
    remove: 'var(--error)',
    context: 'var(--text-secondary)',
  };
  const prefixMap = { add: '+', remove: '-', context: ' ' };

  return (
    <div
      style={{
        display: 'flex',
        fontFamily: 'monospace',
        fontSize: 12,
        lineHeight: '20px',
        backgroundColor: bgMap[type],
        padding: '0 8px',
        whiteSpace: 'pre',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      <span
        style={{
          width: 40,
          minWidth: 40,
          textAlign: 'right',
          paddingRight: 8,
          color: 'var(--text-tertiary)',
          userSelect: 'none',
        }}
      >
        {lineNum ?? ''}
      </span>
      <span style={{ color: colorMap[type], marginRight: 4, userSelect: 'none' }}>
        {prefixMap[type]}
      </span>
      <span style={{ color: colorMap[type] }}>{content}</span>
    </div>
  );
});

const HunkView = memo(function HunkView({
  hunk,
  onAccept,
  onReject,
}: {
  hunk: DiffHunk;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const isResolved = hunk.status !== 'pending';

  return (
    <div
      style={{
        border: '1px solid var(--border-primary)',
        borderRadius: 4,
        marginBottom: 8,
        overflow: 'hidden',
        opacity: isResolved ? 0.6 : 1,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 8px',
          backgroundColor: 'var(--bg-tertiary)',
          borderBottom: '1px solid var(--border-primary)',
          fontSize: 11,
          color: 'var(--text-secondary)',
        }}
      >
        <span>
          Lines {hunk.startLine}–{hunk.endLine}
          {isResolved && (
            <span
              style={{
                marginLeft: 8,
                color: hunk.status === 'accepted' ? 'var(--success)' : 'var(--error)',
                fontWeight: 600,
              }}
            >
              {hunk.status === 'accepted' ? 'Accepted' : 'Rejected'}
            </span>
          )}
        </span>
        {!isResolved && (
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => onAccept(hunk.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                padding: '2px 8px',
                fontSize: 11,
                backgroundColor: 'var(--success)',
                color: '#fff',
                border: 'none',
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              <Check size={12} /> Accept
            </button>
            <button
              onClick={() => onReject(hunk.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                padding: '2px 8px',
                fontSize: 11,
                backgroundColor: 'var(--error)',
                color: '#fff',
                border: 'none',
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              <X size={12} /> Reject
            </button>
          </div>
        )}
      </div>
      <div style={{ backgroundColor: 'var(--bg-primary)' }}>
        {hunk.oldContent.map((line, i) => (
          <DiffLine
            key={`rm-${i}`}
            type="remove"
            content={line}
            lineNum={hunk.startLine + i}
          />
        ))}
        {hunk.newContent.map((line, i) => (
          <DiffLine
            key={`add-${i}`}
            type="add"
            content={line}
            lineNum={hunk.startLine + i}
          />
        ))}
      </div>
    </div>
  );
});

const FileChangeCard = memo(function FileChangeCard({
  fileChange,
  expanded,
  onToggleExpand,
  onAcceptFile,
  onRejectFile,
  onAcceptHunk,
  onRejectHunk,
}: {
  fileChange: FileChange;
  expanded: boolean;
  onToggleExpand: () => void;
  onAcceptFile: (path: string) => void;
  onRejectFile: (path: string) => void;
  onAcceptHunk: (hunkId: string) => void;
  onRejectHunk: (hunkId: string) => void;
}) {
  const pendingCount = fileChange.hunks.filter((h) => h.status === 'pending').length;
  const acceptedCount = fileChange.hunks.filter((h) => h.status === 'accepted').length;
  const totalCount = fileChange.hunks.length;

  const statusColor =
    fileChange.status === 'accepted'
      ? 'var(--success)'
      : fileChange.status === 'rejected'
        ? 'var(--error)'
        : fileChange.status === 'partial'
          ? 'var(--warning)'
          : 'var(--text-secondary)';

  const fileName = fileChange.filePath.split('/').pop() || fileChange.filePath;
  const dirPath = fileChange.filePath.substring(
    0,
    fileChange.filePath.length - fileName.length
  );

  return (
    <div
      style={{
        border: '1px solid var(--border-primary)',
        borderRadius: 6,
        marginBottom: 8,
        overflow: 'hidden',
      }}
    >
      <div
        onClick={onToggleExpand}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 12px',
          backgroundColor: 'var(--bg-secondary)',
          cursor: 'pointer',
          gap: 8,
          userSelect: 'none',
        }}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <FileDiff size={14} style={{ color: statusColor, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 500 }}>
            {fileName}
          </span>
          {dirPath && (
            <span
              style={{
                color: 'var(--text-tertiary)',
                fontSize: 11,
                marginLeft: 6,
              }}
            >
              {dirPath}
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>
          {acceptedCount}/{totalCount} hunks
        </span>
        {pendingCount > 0 && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAcceptFile(fileChange.filePath);
              }}
              title="Accept all hunks in this file"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                padding: '2px 8px',
                fontSize: 11,
                backgroundColor: 'var(--success)',
                color: '#fff',
                border: 'none',
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              <CheckCheck size={12} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRejectFile(fileChange.filePath);
              }}
              title="Reject all hunks in this file"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                padding: '2px 8px',
                fontSize: 11,
                backgroundColor: 'var(--error)',
                color: '#fff',
                border: 'none',
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              <XCircle size={12} />
            </button>
          </div>
        )}
      </div>
      {expanded && (
        <div style={{ padding: 8, backgroundColor: 'var(--bg-primary)' }}>
          {fileChange.hunks.map((hunk) => (
            <HunkView
              key={hunk.id}
              hunk={hunk}
              onAccept={onAcceptHunk}
              onReject={onRejectHunk}
            />
          ))}
        </div>
      )}
    </div>
  );
});

const ContextFilePill = memo(function ContextFilePill({
  file,
  onRemove,
}: {
  file: ContextFile;
  onRemove: (path: string) => void;
}) {
  const name = file.path.split('/').pop() || file.path;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        backgroundColor: 'var(--bg-tertiary)',
        border: '1px solid var(--border-primary)',
        borderRadius: 12,
        fontSize: 11,
        color: 'var(--text-secondary)',
        maxWidth: 200,
      }}
    >
      <FileCode size={11} style={{ flexShrink: 0 }} />
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={file.path}
      >
        {name}
        {file.lineRange && `:${file.lineRange.start}-${file.lineRange.end}`}
      </span>
      <button
        onClick={() => onRemove(file.path)}
        style={{
          display: 'flex',
          background: 'none',
          border: 'none',
          color: 'var(--text-tertiary)',
          cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
        }}
      >
        <X size={11} />
      </button>
    </div>
  );
});

const ModelSelector = memo(function ModelSelector({
  selectedModel,
  onSelectModel,
}: {
  selectedModel: string;
  onSelectModel: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const current = AVAILABLE_MODELS.find((m) => m.id === selectedModel) || AVAILABLE_MODELS[0];

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 8px',
          fontSize: 11,
          backgroundColor: 'var(--bg-tertiary)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: 4,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        <Sparkles size={11} />
        {current.label}
        <ChevronDown size={11} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            marginBottom: 4,
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: 100,
            minWidth: 220,
            overflow: 'hidden',
          }}
        >
          {AVAILABLE_MODELS.map((model) => (
            <button
              key={model.id}
              onClick={() => {
                onSelectModel(model.id);
                setOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '8px 12px',
                fontSize: 12,
                backgroundColor:
                  model.id === selectedModel ? 'var(--accent-primary)' : 'transparent',
                color:
                  model.id === selectedModel ? '#fff' : 'var(--text-primary)',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span>{model.label}</span>
              <span
                style={{
                  fontSize: 10,
                  color:
                    model.id === selectedModel
                      ? 'rgba(255,255,255,0.7)'
                      : 'var(--text-tertiary)',
                }}
              >
                {model.provider}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

const ProgressBar = memo(function ProgressBar({ progress }: { progress: number }) {
  return (
    <div
      style={{
        height: 2,
        backgroundColor: 'var(--bg-tertiary)',
        borderRadius: 1,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${Math.min(progress, 100)}%`,
          backgroundColor: 'var(--accent-primary)',
          transition: 'width 0.3s ease',
          borderRadius: 1,
        }}
      />
    </div>
  );
});

// ─── Main Component ──────────────────────────────────────────────────────────

function ComposerPanel() {
  const [messages, setMessages] = useState<ComposerMessage[]>([
    {
      id: generateMessageId(),
      role: 'system',
      content:
        'Composer is ready. Add files for context, then describe the changes you want to make across your codebase.',
      timestamp: Date.now(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [contextFiles, setContextFiles] = useState<ContextFile[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [selectedModel, setSelectedModel] = useState(AVAILABLE_MODELS[0].id);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [showFileSidebar, setShowFileSidebar] = useState(true);
  const [fileAddInput, setFileAddInput] = useState('');
  const [showFileAddInput, setShowFileAddInput] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileAddInputRef = useRef<HTMLInputElement>(null);

  // Derived state: all file changes across all messages
  const allFileChanges = useMemo(() => {
    const changeMap = new Map<string, FileChange>();
    messages.forEach((msg) => {
      if (msg.fileChanges) {
        msg.fileChanges.forEach((fc) => {
          changeMap.set(fc.filePath, fc);
        });
      }
    });
    return Array.from(changeMap.values());
  }, [messages]);

  const totalTokenEstimate = useMemo(() => {
    let total = 0;
    messages.forEach((m) => (total += estimateTokens(m.content)));
    contextFiles.forEach((f) => (total += estimateTokens(f.path) + 500)); // rough estimate
    total += estimateTokens(inputValue);
    return total;
  }, [messages, contextFiles, inputValue]);

  const pendingChangesCount = useMemo(() => {
    return allFileChanges.reduce(
      (sum, fc) => sum + fc.hunks.filter((h) => h.status === 'pending').length,
      0
    );
  }, [allFileChanges]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus the add-file input when shown
  useEffect(() => {
    if (showFileAddInput) fileAddInputRef.current?.focus();
  }, [showFileAddInput]);

  // ── Callbacks ────────────────────────────────────────────────────────────

  const addContextFile = useCallback((path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    setContextFiles((prev) => {
      if (prev.some((f) => f.path === trimmed)) return prev;
      const ext = trimmed.split('.').pop()?.toLowerCase() || '';
      const langMap: Record<string, string> = {
        ts: 'typescript',
        tsx: 'typescriptreact',
        js: 'javascript',
        jsx: 'javascriptreact',
        py: 'python',
        rs: 'rust',
        go: 'go',
        css: 'css',
        html: 'html',
        json: 'json',
        md: 'markdown',
      };
      return [...prev, { path: trimmed, language: langMap[ext] || 'plaintext' }];
    });
    setFileAddInput('');
    setShowFileAddInput(false);
  }, []);

  const removeContextFile = useCallback((path: string) => {
    setContextFiles((prev) => prev.filter((f) => f.path !== path));
  }, []);

  const toggleFileExpanded = useCallback((path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const updateHunkStatus = useCallback(
    (hunkId: string, status: 'accepted' | 'rejected') => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (!msg.fileChanges) return msg;
          const updatedChanges = msg.fileChanges.map((fc) => {
            const updatedHunks = fc.hunks.map((h) =>
              h.id === hunkId ? { ...h, status } : h
            );
            const allAccepted = updatedHunks.every((h) => h.status === 'accepted');
            const allRejected = updatedHunks.every((h) => h.status === 'rejected');
            const anyAccepted = updatedHunks.some((h) => h.status === 'accepted');
            let fileStatus: FileChange['status'] = 'pending';
            if (allAccepted) fileStatus = 'accepted';
            else if (allRejected) fileStatus = 'rejected';
            else if (anyAccepted) fileStatus = 'partial';
            return { ...fc, hunks: updatedHunks, status: fileStatus };
          });
          return { ...msg, fileChanges: updatedChanges };
        })
      );
    },
    []
  );

  const acceptHunk = useCallback(
    (id: string) => updateHunkStatus(id, 'accepted'),
    [updateHunkStatus]
  );
  const rejectHunk = useCallback(
    (id: string) => updateHunkStatus(id, 'rejected'),
    [updateHunkStatus]
  );

  const acceptAllFile = useCallback(
    (filePath: string) => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (!msg.fileChanges) return msg;
          return {
            ...msg,
            fileChanges: msg.fileChanges.map((fc) => {
              if (fc.filePath !== filePath) return fc;
              return {
                ...fc,
                status: 'accepted' as const,
                hunks: fc.hunks.map((h) => ({ ...h, status: 'accepted' as const })),
              };
            }),
          };
        })
      );
    },
    []
  );

  const rejectAllFile = useCallback(
    (filePath: string) => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (!msg.fileChanges) return msg;
          return {
            ...msg,
            fileChanges: msg.fileChanges.map((fc) => {
              if (fc.filePath !== filePath) return fc;
              return {
                ...fc,
                status: 'rejected' as const,
                hunks: fc.hunks.map((h) => ({ ...h, status: 'rejected' as const })),
              };
            }),
          };
        })
      );
    },
    []
  );

  const acceptAllChanges = useCallback(() => {
    setMessages((prev) =>
      prev.map((msg) => {
        if (!msg.fileChanges) return msg;
        return {
          ...msg,
          fileChanges: msg.fileChanges.map((fc) => ({
            ...fc,
            status: 'accepted' as const,
            hunks: fc.hunks.map((h) => ({ ...h, status: 'accepted' as const })),
          })),
        };
      })
    );
  }, []);

  const rejectAllChanges = useCallback(() => {
    setMessages((prev) =>
      prev.map((msg) => {
        if (!msg.fileChanges) return msg;
        return {
          ...msg,
          fileChanges: msg.fileChanges.map((fc) => ({
            ...fc,
            status: 'rejected' as const,
            hunks: fc.hunks.map((h) => ({ ...h, status: 'rejected' as const })),
          })),
        };
      })
    );
  }, []);

  const simulateAIResponse = useCallback(
    (userMessage: string) => {
      setIsGenerating(true);
      setGenerationProgress(0);

      const progressInterval = setInterval(() => {
        setGenerationProgress((p) => {
          if (p >= 90) return p;
          return p + Math.random() * 15;
        });
      }, 300);

      // Simulate a response with file changes after a delay
      setTimeout(() => {
        clearInterval(progressInterval);
        setGenerationProgress(100);

        const mockFileChanges: FileChange[] = contextFiles.length > 0
          ? contextFiles.slice(0, 3).map((cf) => ({
              filePath: cf.path,
              language: cf.language,
              status: 'pending' as const,
              hunks: [
                {
                  id: generateHunkId(),
                  startLine: 1 + Math.floor(Math.random() * 20),
                  endLine: 10 + Math.floor(Math.random() * 30),
                  oldContent: [
                    `  // Original implementation`,
                    `  const data = fetchData();`,
                    `  return data;`,
                  ],
                  newContent: [
                    `  // Refactored implementation with error handling`,
                    `  try {`,
                    `    const data = await fetchData();`,
                    `    if (!data) throw new Error('No data received');`,
                    `    return data;`,
                    `  } catch (error) {`,
                    `    console.error('Failed to fetch:', error);`,
                    `    throw error;`,
                    `  }`,
                  ],
                  status: 'pending' as const,
                },
                {
                  id: generateHunkId(),
                  startLine: 45 + Math.floor(Math.random() * 10),
                  endLine: 55 + Math.floor(Math.random() * 10),
                  oldContent: [
                    `  function processItems(items) {`,
                    `    return items.map(item => transform(item));`,
                    `  }`,
                  ],
                  newContent: [
                    `  function processItems(items: Item[]): ProcessedItem[] {`,
                    `    if (!items?.length) return [];`,
                    `    return items`,
                    `      .filter(item => item.isValid)`,
                    `      .map(item => transform(item));`,
                    `  }`,
                  ],
                  status: 'pending' as const,
                },
              ],
            }))
          : [
              {
                filePath: 'src/components/Example.tsx',
                language: 'typescriptreact',
                status: 'pending' as const,
                hunks: [
                  {
                    id: generateHunkId(),
                    startLine: 12,
                    endLine: 24,
                    oldContent: [
                      `export function Example() {`,
                      `  const [state, setState] = useState(null);`,
                      `  return <div>{state}</div>;`,
                      `}`,
                    ],
                    newContent: [
                      `export function Example() {`,
                      `  const [state, setState] = useState<string | null>(null);`,
                      `  const [loading, setLoading] = useState(false);`,
                      `  const [error, setError] = useState<Error | null>(null);`,
                      ``,
                      `  if (loading) return <Spinner />;`,
                      `  if (error) return <ErrorBanner message={error.message} />;`,
                      `  return <div>{state ?? 'No data'}</div>;`,
                      `}`,
                    ],
                    status: 'pending' as const,
                  },
                ],
              },
            ];

        const aiMessage: ComposerMessage = {
          id: generateMessageId(),
          role: 'assistant',
          content: `I've analyzed your request: "${userMessage.slice(0, 80)}${userMessage.length > 80 ? '...' : ''}"\n\nHere are the proposed changes across ${mockFileChanges.length} file(s). Review each diff below and accept or reject individual hunks, or use the bulk actions.`,
          timestamp: Date.now(),
          fileChanges: mockFileChanges,
        };

        setMessages((prev) => [...prev, aiMessage]);
        setIsGenerating(false);
        setGenerationProgress(0);

        // Auto-expand changed files
        mockFileChanges.forEach((fc) => {
          setExpandedFiles((prev) => new Set([...prev, fc.filePath]));
        });
      }, 2000 + Math.random() * 1500);
    },
    [contextFiles]
  );

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text || isGenerating) return;

    const userMsg: ComposerMessage = {
      id: generateMessageId(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    simulateAIResponse(text);
  }, [inputValue, isGenerating, simulateAIResponse]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const clearSession = useCallback(() => {
    setMessages([
      {
        id: generateMessageId(),
        role: 'system',
        content: 'Composer session cleared. Add files and describe your changes.',
        timestamp: Date.now(),
      },
    ]);
    setContextFiles([]);
    setExpandedFiles(new Set());
    setIsGenerating(false);
    setGenerationProgress(0);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        overflow: 'hidden',
      }}
    >
      {/* File Sidebar */}
      {showFileSidebar && (
        <div
          style={{
            width: 220,
            minWidth: 220,
            borderRight: '1px solid var(--border-primary)',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'var(--bg-secondary)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderBottom: '1px solid var(--border-primary)',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            <span>Changed Files</span>
            <span
              style={{
                backgroundColor: pendingChangesCount > 0 ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                color: pendingChangesCount > 0 ? '#fff' : 'var(--text-tertiary)',
                padding: '1px 6px',
                borderRadius: 10,
                fontSize: 10,
              }}
            >
              {allFileChanges.length}
            </span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 4 }}>
            {allFileChanges.length === 0 ? (
              <div
                style={{
                  padding: 16,
                  textAlign: 'center',
                  color: 'var(--text-tertiary)',
                  fontSize: 12,
                }}
              >
                No changes yet. Describe what you want to change and the AI will propose edits.
              </div>
            ) : (
              allFileChanges.map((fc) => {
                const name = fc.filePath.split('/').pop() || fc.filePath;
                const statusIcon =
                  fc.status === 'accepted' ? (
                    <Check size={12} style={{ color: 'var(--success)' }} />
                  ) : fc.status === 'rejected' ? (
                    <X size={12} style={{ color: 'var(--error)' }} />
                  ) : fc.status === 'partial' ? (
                    <Minus size={12} style={{ color: 'var(--warning)' }} />
                  ) : (
                    <FileDiff size={12} style={{ color: 'var(--accent-primary)' }} />
                  );
                return (
                  <div
                    key={fc.filePath}
                    onClick={() => toggleFileExpanded(fc.filePath)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '5px 8px',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      backgroundColor: expandedFiles.has(fc.filePath)
                        ? 'var(--bg-tertiary)'
                        : 'transparent',
                    }}
                    title={fc.filePath}
                  >
                    {statusIcon}
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                      }}
                    >
                      {name}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                      {fc.hunks.filter((h) => h.status === 'pending').length > 0
                        ? `${fc.hunks.filter((h) => h.status === 'pending').length}p`
                        : ''}
                    </span>
                  </div>
                );
              })
            )}
          </div>
          {allFileChanges.length > 0 && pendingChangesCount > 0 && (
            <div
              style={{
                padding: 8,
                borderTop: '1px solid var(--border-primary)',
                display: 'flex',
                gap: 4,
              }}
            >
              <button
                onClick={acceptAllChanges}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  padding: '6px 0',
                  fontSize: 11,
                  fontWeight: 500,
                  backgroundColor: 'var(--success)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                <CheckCheck size={13} />
                Accept All
              </button>
              <button
                onClick={rejectAllChanges}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  padding: '6px 0',
                  fontSize: 11,
                  fontWeight: 500,
                  backgroundColor: 'var(--error)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                <XCircle size={13} />
                Reject All
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main Chat Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 12px',
            borderBottom: '1px solid var(--border-primary)',
            backgroundColor: 'var(--bg-secondary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={16} style={{ color: 'var(--accent-primary)' }} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Composer</span>
            <span
              style={{
                fontSize: 10,
                color: 'var(--text-tertiary)',
                backgroundColor: 'var(--bg-tertiary)',
                padding: '1px 6px',
                borderRadius: 3,
              }}
            >
              Multi-file Edit
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => setShowFileSidebar(!showFileSidebar)}
              title="Toggle file sidebar"
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: 4,
                backgroundColor: 'transparent',
                border: 'none',
                color: showFileSidebar ? 'var(--accent-primary)' : 'var(--text-tertiary)',
                cursor: 'pointer',
                borderRadius: 3,
              }}
            >
              <FolderOpen size={14} />
            </button>
            <button
              onClick={clearSession}
              title="Clear composer session"
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: 4,
                backgroundColor: 'transparent',
                border: 'none',
                color: 'var(--text-tertiary)',
                cursor: 'pointer',
                borderRadius: 3,
              }}
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>

        {/* Generation progress */}
        {isGenerating && <ProgressBar progress={generationProgress} />}

        {/* Messages */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px 16px',
          }}
        >
          {messages.map((msg) => (
            <div key={msg.id} style={{ marginBottom: 16 }}>
              {/* Message header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 6,
                }}
              >
                {msg.role === 'user' ? (
                  <User size={14} style={{ color: 'var(--accent-primary)' }} />
                ) : msg.role === 'assistant' ? (
                  <Bot size={14} style={{ color: 'var(--success)' }} />
                ) : (
                  <Settings size={14} style={{ color: 'var(--text-tertiary)' }} />
                )}
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color:
                      msg.role === 'user'
                        ? 'var(--accent-primary)'
                        : msg.role === 'assistant'
                          ? 'var(--success)'
                          : 'var(--text-tertiary)',
                  }}
                >
                  {msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'Composer AI' : 'System'}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
              </div>

              {/* Message content */}
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: 'var(--text-primary)',
                  padding: '8px 12px',
                  backgroundColor:
                    msg.role === 'user' ? 'var(--bg-secondary)' : 'transparent',
                  borderRadius: 6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {msg.content}
              </div>

              {/* File changes */}
              {msg.fileChanges && msg.fileChanges.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {msg.fileChanges.map((fc) => (
                    <FileChangeCard
                      key={fc.filePath}
                      fileChange={fc}
                      expanded={expandedFiles.has(fc.filePath)}
                      onToggleExpand={() => toggleFileExpanded(fc.filePath)}
                      onAcceptFile={acceptAllFile}
                      onRejectFile={rejectAllFile}
                      onAcceptHunk={acceptHunk}
                      onRejectHunk={rejectHunk}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}

          {isGenerating && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 0',
                color: 'var(--text-tertiary)',
                fontSize: 12,
              }}
            >
              <Loader2
                size={14}
                style={{ animation: 'spin 1s linear infinite' }}
              />
              Generating changes...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Context files bar */}
        {(contextFiles.length > 0 || showFileAddInput) && (
          <div
            style={{
              padding: '6px 12px',
              borderTop: '1px solid var(--border-primary)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              alignItems: 'center',
              backgroundColor: 'var(--bg-secondary)',
            }}
          >
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginRight: 4 }}>
              Context:
            </span>
            {contextFiles.map((f) => (
              <ContextFilePill key={f.path} file={f} onRemove={removeContextFile} />
            ))}
            {showFileAddInput && (
              <input
                ref={fileAddInputRef}
                value={fileAddInput}
                onChange={(e) => setFileAddInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    addContextFile(fileAddInput);
                  } else if (e.key === 'Escape') {
                    setShowFileAddInput(false);
                    setFileAddInput('');
                  }
                }}
                onBlur={() => {
                  if (!fileAddInput.trim()) {
                    setShowFileAddInput(false);
                  }
                }}
                placeholder="path/to/file.ts"
                style={{
                  padding: '2px 6px',
                  fontSize: 11,
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--accent-primary)',
                  borderRadius: 4,
                  outline: 'none',
                  width: 160,
                }}
              />
            )}
          </div>
        )}

        {/* Input area */}
        <div
          style={{
            borderTop: '1px solid var(--border-primary)',
            padding: 12,
            backgroundColor: 'var(--bg-secondary)',
          }}
        >
          <div
            style={{
              display: 'flex',
              border: '1px solid var(--border-primary)',
              borderRadius: 8,
              backgroundColor: 'var(--bg-primary)',
              overflow: 'hidden',
              flexDirection: 'column',
            }}
          >
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe changes across your codebase... (e.g., 'Add error handling to all API routes', 'Refactor auth to use hooks')"
              disabled={isGenerating}
              rows={3}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: 13,
                lineHeight: 1.5,
                backgroundColor: 'transparent',
                color: 'var(--text-primary)',
                border: 'none',
                outline: 'none',
                resize: 'none',
                fontFamily: 'inherit',
              }}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 8px',
                borderTop: '1px solid var(--border-primary)',
                backgroundColor: 'var(--bg-secondary)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  onClick={() => setShowFileAddInput(true)}
                  title="Add file to context"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                    padding: '3px 8px',
                    fontSize: 11,
                    backgroundColor: 'var(--bg-tertiary)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  <FilePlus size={11} />
                  Add File
                </button>
                <ModelSelector
                  selectedModel={selectedModel}
                  onSelectModel={setSelectedModel}
                />
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--text-tertiary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                  }}
                >
                  <Hash size={10} />
                  ~{totalTokenEstimate.toLocaleString()} tokens
                </span>
              </div>
              <button
                onClick={handleSend}
                disabled={isGenerating || !inputValue.trim()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 14px',
                  fontSize: 12,
                  fontWeight: 500,
                  backgroundColor:
                    isGenerating || !inputValue.trim()
                      ? 'var(--bg-tertiary)'
                      : 'var(--accent-primary)',
                  color:
                    isGenerating || !inputValue.trim()
                      ? 'var(--text-tertiary)'
                      : '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor:
                    isGenerating || !inputValue.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {isGenerating ? (
                  <>
                    <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                    Generating
                  </>
                ) : (
                  <>
                    <Zap size={13} />
                    Compose
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Inline keyframe styles for spinner animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default ComposerPanel;
