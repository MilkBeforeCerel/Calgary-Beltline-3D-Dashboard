const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

export async function fetchBuildings() {
  const res = await fetch(`${API_BASE}/api/buildings`)
  if (!res.ok) {
    throw new Error(`Failed to fetch buildings: ${res.status} ${res.statusText}`)
  }
  return res.json()
}
