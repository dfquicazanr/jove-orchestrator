import { useEffect, useId, useRef, useState } from 'react'

type Props = {
  message: string
}

/**
 * One-line Moonraker error with ellipsis; full text in a hover/click popover.
 */
export function PrinterErrorLine({ message }: Props) {
  const [pinned, setPinned] = useState(false)
  const [hover, setHover] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const popoverId = useId()
  const open = pinned || hover

  useEffect(() => {
    if (!pinned) return
    function onDoc(ev: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) {
        setPinned(false)
      }
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') setPinned(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [pinned])

  return (
    <span
      ref={wrapRef}
      className={`printer-error-line${open ? ' is-open' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={(ev) => {
        const rel = ev.relatedTarget as Node | null
        if (rel && wrapRef.current?.contains(rel)) return
        setHover(false)
      }}
    >
      <button
        type="button"
        className="printer-error-line-text"
        aria-expanded={open}
        aria-controls={popoverId}
        title={message}
        onClick={(ev) => {
          ev.stopPropagation()
          setPinned((p) => !p)
        }}
      >
        {message}
      </button>
      <span className="printer-error-line-popover" id={popoverId} role="tooltip">
        {message}
      </span>
    </span>
  )
}
