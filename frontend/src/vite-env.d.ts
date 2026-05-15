/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  /** When ``true``, Farm loads client-only mock printers (see ``mockPrintersMode``). */
  readonly VITE_MOCK_PRINTERS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
