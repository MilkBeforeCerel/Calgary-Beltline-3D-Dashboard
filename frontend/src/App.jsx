import { useEffect, useState } from 'react'
import Scene3D from './components/Scene3D.jsx'
import DetailPanel from './components/DetailPanel.jsx'
import QueryBar from './components/QueryBar.jsx'
import ProjectsPanel from './components/ProjectsPanel.jsx'
import { fetchBuildings, fetchQuery, saveProject, fetchProjects } from './api.js'
import { evaluateConditions } from './lib/filterEngine.js'

const USERNAME_STORAGE_KEY = 'masiv:username'

export default function App() {
  const [buildings, setBuildings] = useState(null)
  const [permits, setPermits] = useState([])
  const [hydrants, setHydrants] = useState([])
  const [transitStops, setTransitStops] = useState([])
  const [mapCenter, setMapCenter] = useState(null)
  const [mapTheme, setMapTheme] = useState('light')
  const [source, setSource] = useState(null)
  const [error, setError] = useState(null)
  const [selectedType, setSelectedType] = useState(null)
  const [selectedData, setSelectedData] = useState(null)
  const [showPermits, setShowPermits] = useState(true)
  const [showHydrants, setShowHydrants] = useState(true)
  const [showTransit, setShowTransit] = useState(true)
  const [showZoningKey, setShowZoningKey] = useState(true)
  const [showLiveDataLayers, setShowLiveDataLayers] = useState(true)

  // Active filter: conditions come either from a fresh LLM query or a
  // loaded saved project -- both paths funnel through applyFilter() below
  // so matching logic (filterEngine.evaluateConditions) only lives once.
  const [queryText, setQueryText] = useState('')
  const [queryLoading, setQueryLoading] = useState(false)
  const [queryError, setQueryError] = useState(null)
  const [activeConditions, setActiveConditions] = useState(null)
  const [activeSummary, setActiveSummary] = useState(null)
  const [activeSource, setActiveSource] = useState(null)
  const [matchedIds, setMatchedIds] = useState(null)

  // Project persistence (username identification + save/load)
  const [username, setUsername] = useState(() => localStorage.getItem(USERNAME_STORAGE_KEY) || '')
  const [projects, setProjects] = useState([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectsError, setProjectsError] = useState(null)
  const [saveStatus, setSaveStatus] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchBuildings()
      .then((data) => {
        if (cancelled) return
        setBuildings(data.buildings)
        setPermits(data.permits)
        setHydrants(data.hydrants)
        setTransitStops(data.transit_stops)
        setMapCenter(data.center)
        setSource(data.source)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(USERNAME_STORAGE_KEY, username)
  }, [username])

  useEffect(() => {
    const trimmed = username.trim()
    if (!trimmed) {
      setProjects([])
      return
    }
    let cancelled = false
    setProjectsLoading(true)
    setProjectsError(null)
    fetchProjects(trimmed)
      .then((list) => {
        if (!cancelled) setProjects(list)
      })
      .catch((err) => {
        if (!cancelled) setProjectsError(err.message)
      })
      .finally(() => {
        if (!cancelled) setProjectsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [username])

  function handleSelect(type, data) {
    setSelectedType(type)
    setSelectedData(data)
  }

  function applyFilter({ conditions, summary, source: filterSource, text }) {
    setActiveConditions(conditions)
    setActiveSummary(summary)
    setActiveSource(filterSource)
    setQueryText(text ?? '')
    setMatchedIds(conditions && conditions.length > 0 ? evaluateConditions(buildings || [], conditions) : new Set())
  }

  async function handleQuerySubmit(text) {
    setQueryLoading(true)
    setQueryError(null)
    try {
      const result = await fetchQuery(text)
      applyFilter({ conditions: result.conditions, summary: result.summary, source: result.source, text })
    } catch (err) {
      setQueryError(err.message)
    } finally {
      setQueryLoading(false)
    }
  }

  function handleClearFilter() {
    setActiveConditions(null)
    setActiveSummary(null)
    setActiveSource(null)
    setMatchedIds(null)
    setQueryText('')
    setQueryError(null)
  }

  function handleLoadProject(project) {
    applyFilter({
      conditions: project.conditions,
      summary: `Loaded "${project.name}"${project.query_text ? ` — ${project.query_text}` : ''}`,
      source: 'saved',
      text: project.query_text || '',
    })
  }

  async function handleSaveProject(name) {
    const trimmedUsername = username.trim()
    if (!trimmedUsername || !activeConditions || activeConditions.length === 0) return
    try {
      await saveProject({ username: trimmedUsername, name, queryText: queryText, conditions: activeConditions })
      const list = await fetchProjects(trimmedUsername)
      setProjects(list)
      setSaveStatus(`Saved "${name}".`)
    } catch (err) {
      setSaveStatus(err.message)
    }
  }

  const loading = !buildings && !error

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">
          <div className="brand-text">
            <div className="brand-title">3D City Dashboard</div>
            <div className="brand-sub">Calgary Beltline</div>
          </div>
        </div>
      </div>

      {loading && (
        <div className="center-message">
          <div className="spinner" />
          <div className="center-message-text">fetching building footprints + heights…</div>
        </div>
      )}

      {error && (
        <div className="center-message">
          <div className="center-message-error">
            Could not load building data: {error}
            <br />
            Is the backend running at the configured API URL?
          </div>
        </div>
      )}

      {buildings && buildings.length > 0 && (
        <Scene3D
          buildings={buildings}
          permits={permits}
          hydrants={hydrants}
          transitStops={transitStops}
          mapCenter={mapCenter}
          mapTheme={mapTheme}
          showPermits={showPermits}
          showHydrants={showHydrants}
          showTransit={showTransit}
          matchedIds={matchedIds}
          selectedType={selectedType}
          selectedId={selectedData?.id}
          onSelect={handleSelect}
        />
      )}

      {buildings && (
        <QueryBar
          value={queryText}
          onChange={setQueryText}
          onSubmit={handleQuerySubmit}
          loading={queryLoading}
          summary={activeSummary}
          source={activeSource}
          error={queryError}
          onClear={handleClearFilter}
        />
      )}

      {buildings && (
        <ProjectsPanel
          username={username}
          onUsernameChange={setUsername}
          projects={projects}
          loading={projectsLoading}
          error={projectsError}
          canSave={Boolean(activeConditions && activeConditions.length > 0)}
          onSave={handleSaveProject}
          onLoad={handleLoadProject}
          saveStatus={saveStatus}
        />
      )}

      {buildings && (
        <div className="legend">
          <button
            type="button"
            className="legend-title legend-title-collapsible"
            onClick={() => setShowZoningKey((v) => !v)}
            aria-expanded={showZoningKey}
          >
            Zoning key
            <span className={`legend-arrow ${showZoningKey ? 'open' : ''}`} aria-hidden="true">▾</span>
          </button>
          {showZoningKey && (
            <>
              <div className="legend-row">
                <span className="legend-swatch" style={{ background: '#5eead4' }} />
                Residential (R-*, M-*)
              </div>
              <div className="legend-row">
                <span className="legend-swatch" style={{ background: '#5b9cf6' }} />
                Commercial / Direct Control (CC-*, DC)
              </div>
              <div className="legend-row">
                <span className="legend-swatch" style={{ background: '#f5a623' }} />
                Selected building
              </div>
              {matchedIds && (
                <div className="legend-row">
                  <span className="legend-swatch" style={{ background: '#39ff88' }} />
                  Matches active query ({matchedIds.size})
                </div>
              )}
            </>
          )}
          <button
            type="button"
            className="legend-title legend-title-spaced legend-title-collapsible"
            onClick={() => setShowLiveDataLayers((v) => !v)}
            aria-expanded={showLiveDataLayers}
          >
            Live city data layers
            <span className={`legend-arrow ${showLiveDataLayers ? 'open' : ''}`} aria-hidden="true">▾</span>
          </button>
          {showLiveDataLayers && (
            <>
              <label className="legend-row legend-toggle">
                <input
                  type="checkbox"
                  checked={showPermits}
                  onChange={(e) => setShowPermits(e.target.checked)}
                />
                <span className="legend-swatch" style={{ background: '#4ade80' }} />
                Building permits ({permits.length})
              </label>
              <label className="legend-row legend-toggle">
                <input
                  type="checkbox"
                  checked={showHydrants}
                  onChange={(e) => setShowHydrants(e.target.checked)}
                />
                <span className="legend-swatch" style={{ background: '#e63946' }} />
                Fire hydrants ({hydrants.length})
              </label>
              <label className="legend-row legend-toggle">
                <input
                  type="checkbox"
                  checked={showTransit}
                  onChange={(e) => setShowTransit(e.target.checked)}
                />
                <span className="legend-swatch" style={{ background: '#a78bfa' }} />
                Transit stops ({transitStops.length})
              </label>
            </>
          )}

          <div className="legend-title legend-title-spaced">Base map</div>
          <div className="map-theme-toggle" role="group" aria-label="Map theme">
            <button
              type="button"
              className={mapTheme === 'light' ? 'active' : ''}
              onClick={() => setMapTheme('light')}
            >
              Light
            </button>
            <button
              type="button"
              className={mapTheme === 'dark' ? 'active' : ''}
              onClick={() => setMapTheme('dark')}
            >
              Dark
            </button>
          </div>

          <div className="legend-hint">
            drag to orbit · scroll to zoom · click a building or pin for details
            <br />
            {buildings.length} buildings loaded
          </div>
        </div>
      )}

      {buildings && buildings.length > 0 && (
        <div className="map-attribution">
          Map: © <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>, ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            OpenStreetMap
          </a>{' '}
          contributors
        </div>
      )}

      <DetailPanel
        type={selectedType}
        data={selectedData}
        onClose={() => handleSelect(null, null)}
      />
    </div>
  )
}
