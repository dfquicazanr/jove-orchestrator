import { useEffect, useId, useRef, useState } from 'react'

type Props = {
  message: string
}

/**
 * Exclamation control next to the Error pill: show ``Last error`` text on hover (fine pointer)
 * or when pinned open by click (tap / keyboard). Click outside or Escape closes the pin.
 */
export function PrinterLastErrorHint({ message }: Props) {
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
      className={`printer-error-hint${open ? ' is-open' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={(ev) => {
        const rel = ev.relatedTarget as Node | null
        if (rel && wrapRef.current?.contains(rel)) return
        setHover(false)
      }}
    >
      <button
        type="button"
        className="printer-error-hint-btn"
        aria-expanded={open}
        aria-controls={popoverId}
        title="Last error (hover or click)"
        onClick={(ev) => {
          ev.stopPropagation()
          setPinned((p) => !p)
        }}
      >
        <svg className="printer-error-hint-icon" viewBox="0 0 20 20" aria-hidden>
          <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.35" />
          <path
            d="M10 5.4v5.2M10 14.1v.01"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.85"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <div className="printer-error-popover" id={popoverId} role="tooltip">
        <span className="printer-error-popover-label">Last error</span>
        <p className="printer-error-popover-text">{message}</p>
      </div>
    </span>
  )
}
