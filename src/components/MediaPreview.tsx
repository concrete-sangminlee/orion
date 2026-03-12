import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  Grid,
  Sun,
  Moon,
  Copy,
  Code,
  Eye,
  Pipette,
  Columns,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Type,
  Minus,
  Plus,
  Image as ImageIcon,
  FileText,
  Film,
  Music,
  Info,
  X,
  Download,
  RefreshCw,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

type MediaType = 'image' | 'svg' | 'video' | 'audio' | 'pdf' | 'font';

interface MediaFile {
  name: string;
  url: string;
  type: MediaType;
  size?: number;
}

interface ImageInfo {
  width: number;
  height: number;
  format: string;
  colorSpace: string;
  fileSize: string;
}

interface MediaPreviewProps {
  file: MediaFile;
  comparisonFile?: MediaFile;
  onClose?: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function detectFormat(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    png: 'PNG', jpg: 'JPEG', jpeg: 'JPEG', gif: 'GIF', webp: 'WebP',
    bmp: 'BMP', ico: 'ICO', svg: 'SVG', avif: 'AVIF', tiff: 'TIFF',
  };
  return map[ext] || ext.toUpperCase();
}

function detectColorSpace(format: string): string {
  if (['PNG', 'JPEG', 'WebP', 'AVIF'].includes(format)) return 'sRGB';
  if (format === 'GIF') return 'Indexed';
  return 'sRGB';
}

const CHECKERBOARD_BG = `repeating-conic-gradient(
  var(--checker-a, #ccc) 0% 25%,
  var(--checker-b, #fff) 0% 50%
) 0 0 / 16px 16px`;

const FONT_SAMPLE_TEXT = 'The quick brown fox jumps over the lazy dog.\nABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz\n0123456789 !@#$%^&*()';

// ─── Toolbar Button ─────────────────────────────────────────────────────────

const ToolbarButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}> = ({ icon, label, active, onClick, disabled }) => (
  <button
    title={label}
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 28,
      height: 28,
      border: 'none',
      borderRadius: 4,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      background: active ? 'var(--mp-btn-active, rgba(255,255,255,0.15))' : 'transparent',
      color: active ? 'var(--mp-accent, #4fc3f7)' : 'var(--mp-fg, #ccc)',
      transition: 'background 0.15s, color 0.15s',
    }}
  >
    {icon}
  </button>
);

// ─── Zoom Slider ────────────────────────────────────────────────────────────

const ZoomSlider: React.FC<{
  zoom: number;
  onChange: (z: number) => void;
}> = ({ zoom, onChange }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
    <ToolbarButton icon={<ZoomOut size={14} />} label="Zoom out" onClick={() => onChange(Math.max(10, zoom - 10))} />
    <input
      type="range"
      min={10}
      max={500}
      value={zoom}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ width: 90, accentColor: 'var(--mp-accent, #4fc3f7)' }}
      title={`Zoom: ${zoom}%`}
    />
    <ToolbarButton icon={<ZoomIn size={14} />} label="Zoom in" onClick={() => onChange(Math.min(500, zoom + 10))} />
    <span style={{ fontSize: 11, color: 'var(--mp-fg, #ccc)', minWidth: 40, textAlign: 'center' }}>
      {zoom}%
    </span>
  </div>
);

// ─── Image Info Panel ───────────────────────────────────────────────────────

const ImageInfoPanel: React.FC<{ info: ImageInfo | null }> = ({ info }) => {
  if (!info) return null;
  const rows = [
    ['Dimensions', `${info.width} x ${info.height}`],
    ['Format', info.format],
    ['Color space', info.colorSpace],
    ['File size', info.fileSize],
  ];
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 8,
        left: 8,
        background: 'var(--mp-panel-bg, rgba(30,30,30,0.92))',
        borderRadius: 6,
        padding: '8px 12px',
        fontSize: 11,
        color: 'var(--mp-fg, #ccc)',
        lineHeight: 1.7,
        zIndex: 5,
        backdropFilter: 'blur(6px)',
        border: '1px solid var(--mp-border, rgba(255,255,255,0.08))',
      }}
    >
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 12 }}>
          <span style={{ opacity: 0.6, minWidth: 72 }}>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
};

// ─── Color Picker Overlay ───────────────────────────────────────────────────

const ColorPickerOverlay: React.FC<{
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  imageRef: React.RefObject<HTMLImageElement | null>;
}> = ({ canvasRef, imageRef }) => {
  const [color, setColor] = useState<string | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const handleMove = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      const img = imageRef.current;
      if (!canvas || !img) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);

      const rect = img.getBoundingClientRect();
      const scaleX = img.naturalWidth / rect.width;
      const scaleY = img.naturalHeight / rect.height;
      const px = Math.floor((e.clientX - rect.left) * scaleX);
      const py = Math.floor((e.clientY - rect.top) * scaleY);

      if (px >= 0 && py >= 0 && px < canvas.width && py < canvas.height) {
        const [r, g, b, a] = ctx.getImageData(px, py, 1, 1).data;
        const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
        setColor(a < 255 ? `rgba(${r},${g},${b},${(a / 255).toFixed(2)})` : hex);
        setPos({ x: e.clientX, y: e.clientY });
      }
    },
    [canvasRef, imageRef],
  );

  const handleClick = useCallback(() => {
    if (color) {
      navigator.clipboard.writeText(color).catch(() => {});
    }
  }, [color]);

  return (
    <div
      onMouseMove={handleMove}
      onClick={handleClick}
      style={{
        position: 'absolute',
        inset: 0,
        cursor: 'crosshair',
        zIndex: 10,
      }}
    >
      {color && (
        <div
          style={{
            position: 'fixed',
            left: pos.x + 16,
            top: pos.y + 16,
            background: 'var(--mp-panel-bg, rgba(30,30,30,0.95))',
            borderRadius: 6,
            padding: '6px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11,
            color: 'var(--mp-fg, #ccc)',
            pointerEvents: 'none',
            border: '1px solid var(--mp-border, rgba(255,255,255,0.1))',
          }}
        >
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: 3,
              background: color,
              border: '1px solid rgba(255,255,255,0.2)',
            }}
          />
          <span style={{ fontFamily: 'monospace' }}>{color}</span>
          <span style={{ opacity: 0.5 }}>click to copy</span>
        </div>
      )}
    </div>
  );
};

// ─── PDF Preview ────────────────────────────────────────────────────────────

const PdfPreview: React.FC<{ file: MediaFile }> = ({ file }) => {
  const [page, setPage] = useState(1);
  const [totalPages] = useState(12); // placeholder

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: '8px 0',
          borderBottom: '1px solid var(--mp-border, rgba(255,255,255,0.08))',
        }}
      >
        <ToolbarButton
          icon={<ChevronLeft size={14} />}
          label="Previous page"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
        />
        <span style={{ fontSize: 12, color: 'var(--mp-fg, #ccc)' }}>
          Page {page} / {totalPages}
        </span>
        <ToolbarButton
          icon={<ChevronRight size={14} />}
          label="Next page"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages}
        />
      </div>
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--mp-fg, #999)',
          fontSize: 13,
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <FileText size={48} style={{ opacity: 0.3 }} />
        <span>{file.name}</span>
        <span style={{ fontSize: 11, opacity: 0.6 }}>
          PDF preview — {totalPages} pages
        </span>
        <span style={{ fontSize: 11, opacity: 0.4 }}>
          Viewing page {page}
        </span>
      </div>
    </div>
  );
};

// ─── Font Preview ───────────────────────────────────────────────────────────

const FontPreview: React.FC<{ file: MediaFile }> = ({ file }) => {
  const [fontSize, setFontSize] = useState(32);
  const [sampleText, setSampleText] = useState(FONT_SAMPLE_TEXT);
  const fontFace = useMemo(() => {
    const face = new FontFace('PreviewFont', `url(${file.url})`);
    face.load().then(() => document.fonts.add(face)).catch(() => {});
    return face;
  }, [file.url]);

  const presetSizes = [12, 16, 24, 32, 48, 64, 96];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--mp-border, rgba(255,255,255,0.08))',
          flexWrap: 'wrap',
        }}
      >
        <Type size={14} style={{ color: 'var(--mp-fg, #ccc)', opacity: 0.6 }} />
        <span style={{ fontSize: 11, color: 'var(--mp-fg, #ccc)', opacity: 0.6 }}>Size:</span>
        <ToolbarButton
          icon={<Minus size={12} />}
          label="Decrease size"
          onClick={() => setFontSize((s) => Math.max(8, s - 4))}
        />
        <span style={{ fontSize: 11, color: 'var(--mp-fg, #ccc)', minWidth: 30, textAlign: 'center' }}>
          {fontSize}px
        </span>
        <ToolbarButton
          icon={<Plus size={12} />}
          label="Increase size"
          onClick={() => setFontSize((s) => Math.min(128, s + 4))}
        />
        <div style={{ display: 'flex', gap: 2, marginLeft: 8 }}>
          {presetSizes.map((s) => (
            <button
              key={s}
              onClick={() => setFontSize(s)}
              style={{
                border: 'none',
                borderRadius: 3,
                padding: '2px 6px',
                fontSize: 10,
                cursor: 'pointer',
                background: fontSize === s ? 'var(--mp-accent, #4fc3f7)' : 'transparent',
                color: fontSize === s ? '#000' : 'var(--mp-fg, #999)',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <textarea
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value)}
          style={{
            width: '100%',
            minHeight: 200,
            fontFamily: fontFace.status === 'loaded' ? 'PreviewFont, sans-serif' : 'sans-serif',
            fontSize,
            lineHeight: 1.5,
            background: 'transparent',
            color: 'var(--mp-fg, #ccc)',
            border: '1px solid var(--mp-border, rgba(255,255,255,0.08))',
            borderRadius: 6,
            padding: 16,
            resize: 'vertical',
            outline: 'none',
          }}
        />
        <div style={{ marginTop: 16, fontSize: 11, color: 'var(--mp-fg, #999)', opacity: 0.6 }}>
          Font: {file.name}
        </div>
      </div>
    </div>
  );
};

// ─── Video / Audio Player ───────────────────────────────────────────────────

const MediaPlayer: React.FC<{ file: MediaFile }> = ({ file }) => {
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const togglePlay = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      el.play().catch(() => {});
    }
    setPlaying(!playing);
  }, [playing]);

  const toggleMute = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    el.muted = !muted;
    setMuted(!muted);
  }, [muted]);

  const handleTimeUpdate = useCallback(() => {
    const el = mediaRef.current;
    if (el) setCurrentTime(el.currentTime);
  }, []);

  const handleLoaded = useCallback(() => {
    const el = mediaRef.current;
    if (el) setDuration(el.duration);
  }, []);

  const seek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const el = mediaRef.current;
      if (el) {
        el.currentTime = Number(e.target.value);
        setCurrentTime(el.currentTime);
      }
    },
    [],
  );

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const isVideo = file.type === 'video';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
      {isVideo ? (
        <video
          ref={mediaRef}
          src={file.url}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoaded}
          onEnded={() => setPlaying(false)}
          style={{ maxWidth: '100%', maxHeight: 'calc(100% - 60px)', borderRadius: 4 }}
        />
      ) : (
        <>
          <Music size={64} style={{ color: 'var(--mp-fg, #555)', marginBottom: 16 }} />
          <div style={{ fontSize: 13, color: 'var(--mp-fg, #ccc)', marginBottom: 24 }}>{file.name}</div>
          <audio
            ref={mediaRef}
            src={file.url}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoaded}
            onEnded={() => setPlaying(false)}
          />
        </>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 16px',
          width: '100%',
          maxWidth: 600,
        }}
      >
        <ToolbarButton
          icon={playing ? <Pause size={14} /> : <Play size={14} />}
          label={playing ? 'Pause' : 'Play'}
          onClick={togglePlay}
        />
        <span style={{ fontSize: 10, color: 'var(--mp-fg, #999)', minWidth: 36 }}>
          {fmtTime(currentTime)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onChange={seek}
          style={{ flex: 1, accentColor: 'var(--mp-accent, #4fc3f7)' }}
        />
        <span style={{ fontSize: 10, color: 'var(--mp-fg, #999)', minWidth: 36 }}>
          {fmtTime(duration)}
        </span>
        <ToolbarButton
          icon={muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          label={muted ? 'Unmute' : 'Mute'}
          onClick={toggleMute}
        />
      </div>
    </div>
  );
};

// ─── Main MediaPreview Component ────────────────────────────────────────────

const MediaPreview: React.FC<MediaPreviewProps> = ({ file, comparisonFile, onClose }) => {
  // Image state
  const [zoom, setZoom] = useState(100);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const [checkerboard, setCheckerboard] = useState(true);
  const [darkBg, setDarkBg] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [svgSource, setSvgSource] = useState<string>('');
  const [comparisonMode, setComparisonMode] = useState(false);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const pickerCanvasRef = useRef<HTMLCanvasElement>(null);
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const isImage = file.type === 'image' || file.type === 'svg';

  // Load image info
  useEffect(() => {
    if (!isImage) return;
    const img = new Image();
    img.onload = () => {
      setImageInfo({
        width: img.naturalWidth,
        height: img.naturalHeight,
        format: detectFormat(file.name),
        colorSpace: detectColorSpace(detectFormat(file.name)),
        fileSize: file.size ? formatBytes(file.size) : 'Unknown',
      });
    };
    img.src = file.url;
  }, [file, isImage]);

  // Load SVG source
  useEffect(() => {
    if (file.type !== 'svg') return;
    fetch(file.url)
      .then((r) => r.text())
      .then(setSvgSource)
      .catch(() => setSvgSource('Failed to load SVG source'));
  }, [file]);

  // Fit to view
  const fitToView = useCallback(() => {
    const container = containerRef.current;
    const img = imageRef.current;
    if (!container || !img) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    if (iw && ih) {
      const scale = Math.min((cw - 40) / iw, (ch - 40) / ih, 1);
      setZoom(Math.round(scale * 100));
    }
    setPan({ x: 0, y: 0 });
    setActualSize(false);
  }, []);

  // Actual size toggle
  const toggleActualSize = useCallback(() => {
    if (actualSize) {
      fitToView();
    } else {
      setZoom(100);
      setPan({ x: 0, y: 0 });
      setActualSize(true);
    }
  }, [actualSize, fitToView]);

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isPanning.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  // Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -10 : 10;
    setZoom((z) => Math.max(10, Math.min(500, z + delta)));
  }, []);

  // Copy image to clipboard
  const copyToClipboard = useCallback(async () => {
    try {
      const img = imageRef.current;
      if (!img) return;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      }
    } catch {
      // clipboard write may fail in some contexts
    }
  }, []);

  // Reset transforms
  const resetTransforms = useCallback(() => {
    setZoom(100);
    setPan({ x: 0, y: 0 });
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setActualSize(false);
  }, []);

  // Build image transform
  const imageTransform = useMemo(() => {
    const parts: string[] = [];
    parts.push(`translate(${pan.x}px, ${pan.y}px)`);
    parts.push(`scale(${(flipH ? -1 : 1) * zoom / 100}, ${(flipV ? -1 : 1) * zoom / 100})`);
    parts.push(`rotate(${rotation}deg)`);
    return parts.join(' ');
  }, [zoom, pan, rotation, flipH, flipV]);

  // Canvas background
  const canvasBg = useMemo(() => {
    if (checkerboard) return CHECKERBOARD_BG;
    return darkBg ? 'var(--mp-dark-bg, #1a1a1a)' : 'var(--mp-light-bg, #f0f0f0)';
  }, [checkerboard, darkBg]);

  // ── Render non-image types ──────────────────────────────────────────────

  if (file.type === 'pdf') {
    return (
      <div style={rootStyle}>
        <Toolbar>
          <span style={{ fontSize: 12, color: 'var(--mp-fg, #ccc)' }}>{file.name}</span>
          {onClose && <ToolbarButton icon={<X size={14} />} label="Close" onClick={onClose} />}
        </Toolbar>
        <PdfPreview file={file} />
      </div>
    );
  }

  if (file.type === 'font') {
    return (
      <div style={rootStyle}>
        <Toolbar>
          <span style={{ fontSize: 12, color: 'var(--mp-fg, #ccc)' }}>{file.name}</span>
          {onClose && <ToolbarButton icon={<X size={14} />} label="Close" onClick={onClose} />}
        </Toolbar>
        <FontPreview file={file} />
      </div>
    );
  }

  if (file.type === 'video' || file.type === 'audio') {
    return (
      <div style={rootStyle}>
        <Toolbar>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {file.type === 'video' ? <Film size={14} /> : <Music size={14} />}
            <span style={{ fontSize: 12, color: 'var(--mp-fg, #ccc)' }}>{file.name}</span>
          </div>
          {onClose && <ToolbarButton icon={<X size={14} />} label="Close" onClick={onClose} />}
        </Toolbar>
        <MediaPlayer file={file} />
      </div>
    );
  }

  // ── Image / SVG toolbar and canvas ────────────────────────────────────

  return (
    <div style={rootStyle}>
      {/* Primary Toolbar */}
      <Toolbar>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <ImageIcon size={14} style={{ opacity: 0.5 }} />
          <span style={{ fontSize: 12, color: 'var(--mp-fg, #ccc)', marginRight: 8 }}>{file.name}</span>
          <ZoomSlider zoom={zoom} onChange={setZoom} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <ToolbarButton icon={<Maximize2 size={14} />} label="Fit to view" onClick={fitToView} />
          <ToolbarButton
            icon={<Minimize2 size={14} />}
            label="Actual size (1:1)"
            active={actualSize}
            onClick={toggleActualSize}
          />
          <Separator />
          <ToolbarButton icon={<RotateCw size={14} />} label="Rotate 90deg" onClick={() => setRotation((r) => (r + 90) % 360)} />
          <ToolbarButton icon={<FlipHorizontal size={14} />} label="Flip horizontal" active={flipH} onClick={() => setFlipH((f) => !f)} />
          <ToolbarButton icon={<FlipVertical size={14} />} label="Flip vertical" active={flipV} onClick={() => setFlipV((f) => !f)} />
          <ToolbarButton icon={<RefreshCw size={14} />} label="Reset transforms" onClick={resetTransforms} />
          <Separator />
          <ToolbarButton icon={<Grid size={14} />} label="Checkerboard" active={checkerboard} onClick={() => setCheckerboard((c) => !c)} />
          {!checkerboard && (
            <ToolbarButton
              icon={darkBg ? <Moon size={14} /> : <Sun size={14} />}
              label="Toggle background"
              onClick={() => setDarkBg((d) => !d)}
            />
          )}
          <Separator />
          <ToolbarButton icon={<Pipette size={14} />} label="Color picker" active={showColorPicker} onClick={() => setShowColorPicker((p) => !p)} />
          <ToolbarButton icon={<Info size={14} />} label="Image info" active={showInfo} onClick={() => setShowInfo((i) => !i)} />
          <ToolbarButton icon={<Copy size={14} />} label="Copy to clipboard" onClick={copyToClipboard} />
          <ToolbarButton icon={<Download size={14} />} label="Download" onClick={() => { const a = document.createElement('a'); a.href = file.url; a.download = file.name; a.click(); }} />
          {file.type === 'svg' && (
            <ToolbarButton icon={<Code size={14} />} label="View source" active={showSource} onClick={() => setShowSource((s) => !s)} />
          )}
          {comparisonFile && (
            <ToolbarButton icon={<Columns size={14} />} label="Compare" active={comparisonMode} onClick={() => setComparisonMode((c) => !c)} />
          )}
          {onClose && (
            <>
              <Separator />
              <ToolbarButton icon={<X size={14} />} label="Close" onClick={onClose} />
            </>
          )}
        </div>
      </Toolbar>

      {/* Canvas */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          background: canvasBg,
          cursor: showColorPicker ? 'crosshair' : isPanning.current ? 'grabbing' : 'grab',
          userSelect: 'none',
        }}
        onMouseDown={showColorPicker ? undefined : handleMouseDown}
        onMouseMove={showColorPicker ? undefined : handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        {/* SVG source view */}
        {showSource && file.type === 'svg' ? (
          <pre
            style={{
              margin: 0,
              padding: 16,
              height: '100%',
              overflow: 'auto',
              fontSize: 12,
              fontFamily: 'Consolas, Monaco, monospace',
              color: 'var(--mp-fg, #ccc)',
              background: 'var(--mp-dark-bg, #1e1e1e)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {svgSource}
          </pre>
        ) : comparisonMode && comparisonFile ? (
          /* Comparison view */
          <div style={{ display: 'flex', width: '100%', height: '100%' }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '2px solid var(--mp-accent, #4fc3f7)' }}>
              <img
                src={file.url}
                alt={file.name}
                style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }}
              />
              <div style={{ position: 'absolute', top: 8, left: 8, fontSize: 11, color: 'var(--mp-fg, #ccc)', background: 'rgba(0,0,0,0.6)', padding: '2px 8px', borderRadius: 4 }}>
                Before
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
              <img
                src={comparisonFile.url}
                alt={comparisonFile.name}
                style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }}
              />
              <div style={{ position: 'absolute', top: 8, right: 8, fontSize: 11, color: 'var(--mp-fg, #ccc)', background: 'rgba(0,0,0,0.6)', padding: '2px 8px', borderRadius: 4 }}>
                After
              </div>
            </div>
          </div>
        ) : (
          /* Normal image view */
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img
              ref={imageRef}
              src={file.url}
              alt={file.name}
              draggable={false}
              style={{
                transform: imageTransform,
                transformOrigin: 'center center',
                transition: isPanning.current ? 'none' : 'transform 0.15s ease-out',
                imageRendering: zoom > 200 ? 'pixelated' : 'auto',
                maxWidth: 'none',
                maxHeight: 'none',
              }}
              onLoad={() => {
                if (!actualSize) fitToView();
              }}
            />
          </div>
        )}

        {/* Color picker overlay */}
        {showColorPicker && isImage && !showSource && (
          <ColorPickerOverlay canvasRef={pickerCanvasRef} imageRef={imageRef} />
        )}

        {/* Info panel */}
        {showInfo && <ImageInfoPanel info={imageInfo} />}

        {/* Hidden canvas for color picking */}
        <canvas ref={pickerCanvasRef} style={{ display: 'none' }} />
      </div>
    </div>
  );
};

// ─── Shared layout pieces ───────────────────────────────────────────────────

const rootStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%',
  background: 'var(--mp-bg, #1e1e1e)',
  color: 'var(--mp-fg, #ccc)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  overflow: 'hidden',
};

const Toolbar: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '4px 8px',
      minHeight: 36,
      borderBottom: '1px solid var(--mp-border, rgba(255,255,255,0.08))',
      background: 'var(--mp-toolbar-bg, rgba(30,30,30,0.95))',
      gap: 8,
      flexWrap: 'wrap',
    }}
  >
    {children}
  </div>
);

const Separator: React.FC = () => (
  <div
    style={{
      width: 1,
      height: 18,
      background: 'var(--mp-border, rgba(255,255,255,0.1))',
      margin: '0 4px',
    }}
  />
);

export default MediaPreview;
