import { useCallback, useRef } from 'react'

interface Props {
  direction: 'horizontal' | 'vertical'
  onResize: (delta: number) => void
}

export default function Resizer({ direction, onResize }: Props) {
  const startPos = useRef(0)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      startPos.current = direction === 'horizontal' ? e.clientX : e.clientY

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
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
    },
    [direction, onResize]
  )

  return (
    <div
      onMouseDown={onMouseDown}
      className={`${
        direction === 'horizontal'
          ? 'w-1 cursor-col-resize hover:bg-accent-blue'
          : 'h-1 cursor-row-resize hover:bg-accent-blue'
      } bg-border-primary transition-colors flex-shrink-0`}
    />
  )
}
