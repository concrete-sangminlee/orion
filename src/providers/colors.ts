/**
 * CSS color values in source text: the editor's inline swatches use
 * detectColors, and registerColorProviders gives Monaco's color picker.
 */
import type { Monaco } from '@monaco-editor/react'
import type { IRange } from 'monaco-editor'

// ── Named CSS colors (top 20) for inline color decorators ──────────────────
const NAMED_CSS_COLORS: Record<string, string> = {
  red: '#ff0000', blue: '#0000ff', green: '#008000', yellow: '#ffff00',
  orange: '#ffa500', purple: '#800080', white: '#ffffff', black: '#000000',
  gray: '#808080', pink: '#ffc0cb', brown: '#a52a2a', cyan: '#00ffff',
  magenta: '#ff00ff', lime: '#00ff00', navy: '#000080', teal: '#008080',
  silver: '#c0c0c0', gold: '#ffd700', coral: '#ff7f50', tomato: '#ff6347',
}
const NAMED_COLOR_PATTERN = Object.keys(NAMED_CSS_COLORS).join('|')

// ── CSS color regex for inline color decorators ──────────────────
const CSS_COLOR_REGEX = new RegExp(
  `#(?:[0-9a-fA-F]{3,4}){1,2}\\b` +
  `|rgba?\\(\\s*\\d+\\s*,\\s*\\d+\\s*,\\s*\\d+\\s*(?:,\\s*[\\d.]+\\s*)?\\)` +
  `|hsla?\\(\\s*\\d+\\s*,\\s*\\d+%?\\s*,\\s*\\d+%?\\s*(?:,\\s*[\\d.]+\\s*)?\\)` +
  `|\\b(?:${NAMED_COLOR_PATTERN})\\b`,
  'gi'
)

export interface ColorMatch {
  line: number
  startCol: number
  endCol: number
  color: string
}

/**
 * Detect color values in source text.
 * Returns an array of { line, startCol, endCol, color } objects.
 */
export function detectColors(content: string): ColorMatch[] {
  const results: ColorMatch[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const lineContent = lines[i]
    CSS_COLOR_REGEX.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = CSS_COLOR_REGEX.exec(lineContent)) !== null) {
      const raw = m[0]
      // For named colors, resolve to hex; otherwise use raw value
      const resolved = NAMED_CSS_COLORS[raw.toLowerCase()] || raw
      results.push({
        line: i + 1,
        startCol: m.index + 1,
        endCol: m.index + 1 + raw.length,
        color: resolved,
      })
    }
  }
  return results
}

/** Convert various color formats to an rgba() string for the color picker */
function colorToRGBA(color: string): { r: number; g: number; b: number; a: number } | null {
  // Hex
  const hexMatch = color.match(/^#([0-9a-fA-F]{3,8})$/)
  if (hexMatch) {
    const hex = hexMatch[1]
    let r: number, g: number, b: number, a = 1
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16) / 255
      g = parseInt(hex[1] + hex[1], 16) / 255
      b = parseInt(hex[2] + hex[2], 16) / 255
    } else if (hex.length === 4) {
      r = parseInt(hex[0] + hex[0], 16) / 255
      g = parseInt(hex[1] + hex[1], 16) / 255
      b = parseInt(hex[2] + hex[2], 16) / 255
      a = parseInt(hex[3] + hex[3], 16) / 255
    } else if (hex.length === 6) {
      r = parseInt(hex.slice(0, 2), 16) / 255
      g = parseInt(hex.slice(2, 4), 16) / 255
      b = parseInt(hex.slice(4, 6), 16) / 255
    } else if (hex.length === 8) {
      r = parseInt(hex.slice(0, 2), 16) / 255
      g = parseInt(hex.slice(2, 4), 16) / 255
      b = parseInt(hex.slice(4, 6), 16) / 255
      a = parseInt(hex.slice(6, 8), 16) / 255
    } else {
      return null
    }
    return { r, g, b, a }
  }
  // rgb/rgba
  const rgbMatch = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/)
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1]) / 255,
      g: parseInt(rgbMatch[2]) / 255,
      b: parseInt(rgbMatch[3]) / 255,
      a: rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1,
    }
  }
  // hsl/hsla – convert to rgb
  const hslMatch = color.match(/^hsla?\(\s*(\d+)\s*,\s*(\d+)%?\s*,\s*(\d+)%?\s*(?:,\s*([\d.]+)\s*)?\)$/)
  if (hslMatch) {
    const h = parseInt(hslMatch[1]) / 360
    const s = parseInt(hslMatch[2]) / 100
    const l = parseInt(hslMatch[3]) / 100
    const a = hslMatch[4] !== undefined ? parseFloat(hslMatch[4]) : 1
    let r: number, g: number, b: number
    if (s === 0) {
      r = g = b = l
    } else {
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1
        if (t > 1) t -= 1
        if (t < 1 / 6) return p + (q - p) * 6 * t
        if (t < 1 / 2) return q
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
        return p
      }
      const q2 = l < 0.5 ? l * (1 + s) : l + s - l * s
      const p2 = 2 * l - q2
      r = hue2rgb(p2, q2, h + 1 / 3)
      g = hue2rgb(p2, q2, h)
      b = hue2rgb(p2, q2, h - 1 / 3)
    }
    return { r, g, b, a }
  }
  return null
}

/** Languages that get the color picker; Monaco ids only. */
const COLOR_PROVIDER_LANGUAGES = ['css', 'scss', 'less', 'html', 'javascript', 'typescript', 'json']

export function registerColorProviders(monaco: Monaco): void {
  for (const lang of COLOR_PROVIDER_LANGUAGES) {
    monaco.languages.registerColorProvider(lang, {
      provideDocumentColors: (model) => {
        const results: { range: IRange; color: { red: number; green: number; blue: number; alpha: number } }[] = []
        for (const cm of detectColors(model.getValue())) {
          const rgba = colorToRGBA(cm.color)
          if (!rgba) continue
          results.push({
            range: new monaco.Range(cm.line, cm.startCol, cm.line, cm.endCol),
            color: { red: rgba.r, green: rgba.g, blue: rgba.b, alpha: rgba.a },
          })
        }
        return results
      },
      provideColorPresentations: (_model, colorInfo) => {
        const { red, green, blue, alpha } = colorInfo.color
        const r = Math.round(red * 255)
        const g = Math.round(green * 255)
        const b = Math.round(blue * 255)
        const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
        const hexLabel = alpha < 1 ? `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}` : hex
        const rgbLabel = alpha < 1 ? `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})` : `rgb(${r}, ${g}, ${b})`
        return [hexLabel, rgbLabel].map((label) => ({ label, textEdit: { range: colorInfo.range, text: label } }))
      },
    })
  }
}
