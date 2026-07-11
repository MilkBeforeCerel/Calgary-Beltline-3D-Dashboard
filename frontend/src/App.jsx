import { useEffect, useState } from 'react'
import Scene3D from './components/Scene3D.jsx'
import DetailPanel from './components/DetailPanel.jsx'
import { fetchBuildings } from './api.js'

export default function App() {
  const [buildings, setBuildings] = useState(null)
  const [source, setSource] = useState(null)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchBuildings()
      .then((data) => {
        if (cancelled) return
        setBuildings(data.buildings)
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

  const loading = !buildings && !error

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">
          <span className="brand-mark">MASIV</span>
          <div>
            <div className="brand-title">3D City Dashboard</div>
            <div className="brand-sub">Calgary Beltline · 4-block prototype</div>
          </div>
        </div>

        {source && (
          <div className="status-chip">
            <span className={`status-dot ${source === 'mock' ? 'mock' : ''}`} />
            {source === 'live'
              ? 'Live — City of Calgary Open Data'
              : 'Demo data — live API unreachable, showing simulated blocks'}
          </div>
        )}
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
          selectedId={selected?.id}
          onSelectBuilding={setSelected}
        />
      )}

      {buildings && (
        <div className="legend">
          <div className="legend-title">Zoning key</div>
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
          <div className="legend-hint">
            drag to orbit · scroll to zoom · click a building for details
            <br />
            {buildings.length} buildings loaded
          </div>
        </div>
      )}

      <DetailPanel building={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
