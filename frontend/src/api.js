const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

export async function fetchBuildings() {
  const res = await fetch(`${API_BASE}/api/buildings`)
  if (!res.ok) {
    throw new Error(`Failed to fetch buildings: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

export async function fetchQuery(queryText) {
  const res = await fetch(`${API_BASE}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query_text: queryText }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail?.[0]?.msg || `Query failed: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

export async function saveProject({ username, name, queryText, conditions }) {
  const res = await fetch(`${API_BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, name, query_text: queryText, conditions }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail?.[0]?.msg || `Save failed: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

export async function fetchProjects(username) {
  const res = await fetch(`${API_BASE}/api/projects?username=${encodeURIComponent(username)}`)
  if (!res.ok) {
    throw new Error(`Failed to fetch projects: ${res.status} ${res.statusText}`)
  }
  const data = await res.json()
  return data.projects
}
