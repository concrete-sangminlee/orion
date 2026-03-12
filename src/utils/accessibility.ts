/**
 * Accessibility utilities for WCAG 2.1 AA compliance.
 * Screen reader support, focus management, and ARIA helpers.
 */

/* ── Focus Management ─────────────────────────────────── */

const focusHistory: HTMLElement[] = []

export function pushFocus(element: HTMLElement | null): void {
  const current = document.activeElement as HTMLElement
  if (current) focusHistory.push(current)
  element?.focus()
}

export function popFocus(): void {
  const prev = focusHistory.pop()
  prev?.focus()
}

export function trapFocus(container: HTMLElement): () => void {
  const focusableSelector = [
    'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
    'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
    '[contenteditable]',
  ].join(', ')

  const handler = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return

    const focusable = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
      .filter(el => el.offsetParent !== null)

    if (focusable.length === 0) {
      e.preventDefault()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  container.addEventListener('keydown', handler)
  return () => container.removeEventListener('keydown', handler)
}

export function focusFirstFocusable(container: HTMLElement): void {
  const el = container.querySelector<HTMLElement>(
    'button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), a[href]'
  )
  el?.focus()
}

/* ── Screen Reader Announcements ──────────────────────── */

let liveRegion: HTMLElement | null = null

function getLiveRegion(): HTMLElement {
  if (liveRegion) return liveRegion

  liveRegion = document.createElement('div')
  liveRegion.setAttribute('role', 'status')
  liveRegion.setAttribute('aria-live', 'polite')
  liveRegion.setAttribute('aria-atomic', 'true')
  liveRegion.style.cssText = `
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  `
  document.body.appendChild(liveRegion)
  return liveRegion
}

export function announce(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
  const region = getLiveRegion()
  region.setAttribute('aria-live', priority)
  region.textContent = ''
  // Force reflow to ensure screen readers pick up the change
  void region.offsetHeight
  region.textContent = message
}

export function announceAssertive(message: string): void {
  announce(message, 'assertive')
}

/* ── Color Contrast ───────────────────────────────────── */

export function getContrastRatio(color1: string, color2: string): number {
  const lum1 = getLuminance(parseColor(color1))
  const lum2 = getLuminance(parseColor(color2))
  const lighter = Math.max(lum1, lum2)
  const darker = Math.min(lum1, lum2)
  return (lighter + 0.05) / (darker + 0.05)
}

export function meetsAA(foreground: string, background: string, large = false): boolean {
  const ratio = getContrastRatio(foreground, background)
  return large ? ratio >= 3 : ratio >= 4.5
}

export function meetsAAA(foreground: string, background: string, large = false): boolean {
  const ratio = getContrastRatio(foreground, background)
  return large ? ratio >= 4.5 : ratio >= 7
}

function parseColor(color: string): [number, number, number] {
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
      ]
    }
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ]
  }

  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (rgbMatch) {
    return [parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3])]
  }

  return [0, 0, 0]
}

function getLuminance([r, g, b]: [number, number, number]): number {
  const [rs, gs, bs] = [r, g, b].map(c => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

/* ── Keyboard Navigation Helpers ──────────────────────── */

export function handleArrowNavigation(
  e: React.KeyboardEvent,
  items: HTMLElement[],
  currentIndex: number,
  options: {
    vertical?: boolean
    horizontal?: boolean
    loop?: boolean
    onSelect?: (index: number) => void
  } = {}
): void {
  const { vertical = true, horizontal = false, loop = true, onSelect } = options

  let newIndex = currentIndex

  if (vertical) {
    if (e.key === 'ArrowDown') newIndex = currentIndex + 1
    if (e.key === 'ArrowUp') newIndex = currentIndex - 1
  }
  if (horizontal) {
    if (e.key === 'ArrowRight') newIndex = currentIndex + 1
    if (e.key === 'ArrowLeft') newIndex = currentIndex - 1
  }

  if (e.key === 'Home') newIndex = 0
  if (e.key === 'End') newIndex = items.length - 1

  if (newIndex !== currentIndex) {
    e.preventDefault()

    if (loop) {
      newIndex = ((newIndex % items.length) + items.length) % items.length
    } else {
      newIndex = Math.max(0, Math.min(items.length - 1, newIndex))
    }

    items[newIndex]?.focus()
    onSelect?.(newIndex)
  }

  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    onSelect?.(currentIndex)
  }
}

/* ── ARIA Helpers ─────────────────────────────────────── */

export function generateId(prefix = 'orion'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

export function getAriaProps(role: string, options: {
  label?: string
  labelledBy?: string
  describedBy?: string
  expanded?: boolean
  selected?: boolean
  checked?: boolean | 'mixed'
  disabled?: boolean
  hidden?: boolean
  level?: number
  setSize?: number
  posInSet?: number
  current?: boolean | 'page' | 'step' | 'location' | 'date' | 'time'
  hasPopup?: boolean | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog'
  controls?: string
  owns?: string
  live?: 'polite' | 'assertive'
  valueMin?: number
  valueMax?: number
  valueNow?: number
  valueText?: string
} = {}): Record<string, any> {
  const props: Record<string, any> = { role }

  if (options.label !== undefined) props['aria-label'] = options.label
  if (options.labelledBy !== undefined) props['aria-labelledby'] = options.labelledBy
  if (options.describedBy !== undefined) props['aria-describedby'] = options.describedBy
  if (options.expanded !== undefined) props['aria-expanded'] = options.expanded
  if (options.selected !== undefined) props['aria-selected'] = options.selected
  if (options.checked !== undefined) props['aria-checked'] = options.checked
  if (options.disabled !== undefined) props['aria-disabled'] = options.disabled
  if (options.hidden !== undefined) props['aria-hidden'] = options.hidden
  if (options.level !== undefined) props['aria-level'] = options.level
  if (options.setSize !== undefined) props['aria-setsize'] = options.setSize
  if (options.posInSet !== undefined) props['aria-posinset'] = options.posInSet
  if (options.current !== undefined) props['aria-current'] = options.current
  if (options.hasPopup !== undefined) props['aria-haspopup'] = options.hasPopup
  if (options.controls !== undefined) props['aria-controls'] = options.controls
  if (options.owns !== undefined) props['aria-owns'] = options.owns
  if (options.live !== undefined) props['aria-live'] = options.live
  if (options.valueMin !== undefined) props['aria-valuemin'] = options.valueMin
  if (options.valueMax !== undefined) props['aria-valuemax'] = options.valueMax
  if (options.valueNow !== undefined) props['aria-valuenow'] = options.valueNow
  if (options.valueText !== undefined) props['aria-valuetext'] = options.valueText

  return props
}

/* ── Reduced Motion Detection ─────────────────────────── */

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function prefersHighContrast(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-contrast: more)').matches
}

export function prefersDarkMode(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/* ── Skip Link Helper ─────────────────────────────────── */

export function createSkipLink(targetId: string, text = 'Skip to main content'): HTMLElement {
  const link = document.createElement('a')
  link.href = `#${targetId}`
  link.className = 'skip-link'
  link.textContent = text
  link.style.cssText = `
    position: absolute; left: -9999px; top: auto; width: 1px; height: 1px;
    overflow: hidden; z-index: 10000;
  `

  link.addEventListener('focus', () => {
    link.style.cssText = `
      position: fixed; left: 50%; top: 8px; transform: translateX(-50%);
      padding: 8px 16px; background: var(--accent-primary); color: white;
      border-radius: 4px; font-size: 14px; z-index: 10000; text-decoration: none;
    `
  })

  link.addEventListener('blur', () => {
    link.style.cssText = `
      position: absolute; left: -9999px; top: auto; width: 1px; height: 1px;
      overflow: hidden; z-index: 10000;
    `
  })

  return link
}

/* ── Roving Tabindex Manager ──────────────────────────── */

export class RovingTabindex {
  private items: HTMLElement[] = []
  private activeIndex = 0

  constructor(container: HTMLElement, selector: string) {
    this.items = Array.from(container.querySelectorAll<HTMLElement>(selector))
    this.updateTabindex()

    container.addEventListener('keydown', (e) => this.handleKeyDown(e))
    container.addEventListener('focusin', (e) => this.handleFocusIn(e))
  }

  private updateTabindex(): void {
    this.items.forEach((item, i) => {
      item.setAttribute('tabindex', i === this.activeIndex ? '0' : '-1')
    })
  }

  private handleKeyDown(e: KeyboardEvent): void {
    let newIndex = this.activeIndex

    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        newIndex = (this.activeIndex + 1) % this.items.length
        break
      case 'ArrowUp':
      case 'ArrowLeft':
        newIndex = (this.activeIndex - 1 + this.items.length) % this.items.length
        break
      case 'Home':
        newIndex = 0
        break
      case 'End':
        newIndex = this.items.length - 1
        break
      default:
        return
    }

    e.preventDefault()
    this.activeIndex = newIndex
    this.updateTabindex()
    this.items[newIndex]?.focus()
  }

  private handleFocusIn(e: FocusEvent): void {
    const target = e.target as HTMLElement
    const index = this.items.indexOf(target)
    if (index >= 0) {
      this.activeIndex = index
      this.updateTabindex()
    }
  }

  destroy(): void {
    this.items.forEach(item => item.removeAttribute('tabindex'))
  }
}
