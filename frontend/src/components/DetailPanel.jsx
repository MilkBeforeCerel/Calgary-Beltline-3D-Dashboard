function fmtCurrency(v) {
  if (v === null || v === undefined) return '—'
  return `$${Number(v).toLocaleString('en-CA', { maximumFractionDigits: 0 })}`
}

function fmtMeters(v) {
  if (v === null || v === undefined) return '—'
  const feet = v * 3.28084
  return `${v.toFixed(1)} m  (${feet.toFixed(0)} ft)`
}

export default function DetailPanel({ building, onClose }) {
  const open = Boolean(building)
  return (
    <aside className={`detail-panel ${open ? 'open' : ''}`}>
      <button className="detail-close" onClick={onClose} aria-label="Close">✕</button>
      {building && (
        <>
          <div className="detail-eyebrow">Building {building.id}</div>
          <div className="detail-address">{building.address || 'Address unavailable'}</div>

          <div className="detail-grid">
            <div className="detail-field">
              <div className="detail-field-label">Height</div>
              <div className="detail-field-value">{fmtMeters(building.height_m)}</div>
            </div>
            <div className="detail-field">
              <div className="detail-field-label">Year Built</div>
              <div className="detail-field-value">{building.year_built || '—'}</div>
            </div>
            <div className="detail-field">
              <div className="detail-field-label">Zoning</div>
              <div className="detail-field-value">{building.zoning || '—'}</div>
            </div>
            <div className="detail-field">
              <div className="detail-field-label">Assessed Value</div>
              <div className="detail-field-value">{fmtCurrency(building.assessed_value)}</div>
            </div>
            <div className="detail-field full">
              <div className="detail-field-label">Land Use</div>
              <div className="detail-field-value">{building.land_use || '—'}</div>
            </div>
            <div className="detail-field full">
              <div className="detail-field-label">Coordinates</div>
              <div className="detail-field-value">{building.lat.toFixed(5)}, {building.lon.toFixed(5)}</div>
            </div>
          </div>

          <div className="detail-source-note">
            source: {building.source === 'live' ? 'City of Calgary Open Data (live)' : 'simulated demo data'}
          </div>
        </>
      )}
    </aside>
  )
}
