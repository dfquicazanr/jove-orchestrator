type Props = {
  onClick: () => void
}

export function AddPrinterCard({ onClick }: Props) {
  return (
    <button type="button" className="card printer-add-card" onClick={onClick}>
      <span className="printer-add-icon" aria-hidden>
        +
      </span>
      <span className="printer-add-label">Add printer</span>
    </button>
  )
}
