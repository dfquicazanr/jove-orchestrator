const raw = import.meta.env.VITE_API_URL
export const API_URL = (raw && String(raw).trim()) || 'http://localhost:8000'
