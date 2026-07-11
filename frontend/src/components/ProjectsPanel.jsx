import { useState } from 'react'

export default function ProjectsPanel({
  username,
  onUsernameChange,
  projects,
  loading,
  error,
  canSave,
  onSave,
  onLoad,
  saveStatus,
}) {
  const [name, setName] = useState('')

  function handleSave(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onSave(trimmed)
    setName('')
  }

  return (
    <div className="projects-panel">
      <div className="projects-title">Projects</div>

      <input
        className="username-input"
        type="text"
        placeholder="Your username"
        value={username}
        onChange={(e) => onUsernameChange(e.target.value)}
      />

      {username.trim() && (
        <>
          <form className="project-save-row" onSubmit={handleSave}>
            <input
              type="text"
              className="project-name-input"
              placeholder="Project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canSave}
            />
            <button type="submit" className="project-save-btn" disabled={!canSave || !name.trim()}>
              Save
            </button>
          </form>
          {!canSave && <div className="projects-hint">Run a query to build a filter before saving.</div>}
          {saveStatus && <div className="projects-hint">{saveStatus}</div>}

          <div className="project-list">
            {loading && <div className="projects-hint">Loading…</div>}
            {error && <div className="projects-hint projects-hint-error">{error}</div>}
            {!loading && projects.length === 0 && <div className="projects-hint">No saved projects yet.</div>}
            {projects.map((p) => (
              <button key={p.id} type="button" className="project-row" onClick={() => onLoad(p)}>
                <span className="project-row-name">{p.name}</span>
                <span className="project-row-meta">
                  {p.conditions.length} condition{p.conditions.length === 1 ? '' : 's'}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
