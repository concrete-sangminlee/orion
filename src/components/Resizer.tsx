import { useCallback, useRef, useState } from 'react'

interface Props {
  direction: 'horizontal' | 'vertical'
  onResize: (delta: number) => void
}

export default function Resizer({ direction, onResize }: Props) {
  const startPos = useRef(0)
  const [dragging, setDragging] = useState(false)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      startPos.current = direction === 'horizontal' ? e.clientX : e.clientY
      setDragging(true)

      const onMouseMove = (e: MouseEvent) => {
        const current = direction === 'horizontal' ? e.clientX : e.clientY
        const delta = current - startPos.current
        startPos.current = current
        onResize(delta)
      }

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        setDragging(false)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
    },
    [direction, onResize]
  )

  const isH = direction === 'horizontal'

  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: 'relative',
        flexShrink: 0,
        cursor: isH ? 'col-resize' : 'row-resize',
        zIndex: 10,
        ...(isH ? { width: 1 } : { height: 1 }),
      }}
    >
      {/* Visible line */}
      <div
        data-resizer-line=""
        style={{
          position: 'absolute',
          background: dragging ? 'var(--accent)' : 'var(--border)',
          transition: dragging ? 'none' : 'background 0.15s ease',
          ...(isH
            ? { width: 1, top: 0, bottom: 0, left: 0 }
            : { height: 1, left: 0, right: 0, top: 0 }),
        }}
      />
      {/* Wider hit target - 7px for comfortable grabbing */}
      <div
        style={{
          position: 'absolute',
          ...(isH
            ? { width: 7, top: 0, bottom: 0, left: -3 }
            : { height: 7, left: 0, right: 0, top: -3 }),
        }}
        onMouseEnter={(e) => {
          if (dragging) return
          const line = e.currentTarget.previousElementSibling as HTMLElement
          if (line) line.style.background = 'rgba(88, 166, 255, 0.5)'
        }}
        onMouseLeave={(e) => {
          if (dragging) return
          const line = e.currentTarget.previousElementSibling as HTMLElement
          if (line) line.style.background = 'var(--border)'
        }}
      />
    </div>
  )
}
