/**
 * When true, the Farm page loads static mock printers instead of ``GET /printers``.
 *
 * Enable either:
 * - URL: add ``?mockPrinters=1`` while on the Farm page (index route)
 * - Env: ``VITE_MOCK_PRINTERS=true`` in ``frontend/.env`` (persistent for local dev)
 */
export function mockPrintersMode(): boolean {
  if (import.meta.env.VITE_MOCK_PRINTERS === 'true') return true
  if (typeof window === 'undefined') return false
  try {
    return new URLSearchParams(window.location.search).get('mockPrinters') === '1'
  } catch {
    return false
  }
}
