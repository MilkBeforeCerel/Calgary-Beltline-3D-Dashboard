function fmtCurrency(v) {
  if (v === null || v === undefined) return '—'
  return `$${Number(v).toLocaleString('en-CA', { maximumFractionDigits: 0 })}`
}

function fmtMeters(v) {
  if (v === null || v === undefined) return '—'
  const feet = v * 3.28084
  return `${v.toFixed(1)} m  (${feet.toFixed(0)} ft)`
}

function BuildingDetails({ building }) {
  return (
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
  )
}

function PermitDetails({ permit }) {
  return (
    <>
      <div className="detail-eyebrow">Permit {permit.id}</div>
      <div className="detail-address">{permit.address || 'Address unavailable'}</div>

      <div className="detail-grid">
        <div className="detail-field">
          <div className="detail-field-label">Permit Type</div>
          <div className="detail-field-value">{permit.permit_type || '—'}</div>
        </div>
        <div className="detail-field">
          <div className="detail-field-label">Status</div>
          <div className="detail-field-value">{permit.status || '—'}</div>
        </div>
        <div className="detail-field">
          <div className="detail-field-label">Estimated Cost</div>
          <div className="detail-field-value">{fmtCurrency(permit.estimated_cost)}</div>
        </div>
        <div className="detail-field">
          <div className="detail-field-label">Issued</div>
          <div className="detail-field-value">{permit.issued_date || '—'}</div>
        </div>
        <div className="detail-field full">
          <div className="detail-field-label">Coordinates</div>
          <div className="detail-field-value">{permit.lat.toFixed(5)}, {permit.lon.toFixed(5)}</div>
        </div>
      </div>

      <div className="detail-source-note">
        source: {permit.source === 'live' ? 'City of Calgary Open Data (live)' : 'simulated demo data'}
      </div>
    </>
  )
}

function HydrantDetails({ hydrant }) {
  return (
    <>
      <div className="detail-eyebrow">Fire Hydrant {hydrant.id}</div>
      <div className="detail-address">{hydrant.hydrant_type || 'Fire hydrant'}</div>

      <div className="detail-grid">
        <div className="detail-field full">
          <div className="detail-field-label">Status</div>
          <div className="detail-field-value">{hydrant.status || '—'}</div>
        </div>
        <div className="detail-field full">
          <div className="detail-field-label">Coordinates</div>
          <div className="detail-field-value">{hydrant.lat.toFixed(5)}, {hydrant.lon.toFixed(5)}</div>
        </div>
      </div>

      <div className="detail-source-note">
        source: {hydrant.source === 'live' ? 'City of Calgary Open Data (live)' : 'simulated demo data'}
      </div>
    </>
  )
}

function TransitDetails({ stop }) {
  return (
    <>
      <div className="detail-eyebrow">Transit Stop {stop.id}</div>
      <div className="detail-address">{stop.stop_name || 'Stop'}</div>

      <div className="detail-grid">
        <div className="detail-field">
          <div className="detail-field-label">Mode</div>
          <div className="detail-field-value">{stop.route_type || '—'}</div>
        </div>
        <div className="detail-field">
          <div className="detail-field-label">Routes</div>
          <div className="detail-field-value">{stop.routes && stop.routes.length ? stop.routes.join(', ') : '—'}</div>
        </div>
        <div className="detail-field full">
          <div className="detail-field-label">Coordinates</div>
          <div className="detail-field-value">{stop.lat.toFixed(5)}, {stop.lon.toFixed(5)}</div>
        </div>
      </div>

      <div className="detail-source-note">
        source: {stop.source === 'live' ? 'City of Calgary Open Data (live)' : 'simulated demo data'}
      </div>
    </>
  )
}

export default function DetailPanel({ type, data, onClose }) {
  const open = Boolean(data)
  return (
    <aside className={`detail-panel ${open ? 'open' : ''}`}>
      <button className="detail-close" onClick={onClose} aria-label="Close">✕</button>
      {data && type === 'building' && <BuildingDetails building={data} />}
      {data && type === 'permit' && <PermitDetails permit={data} />}
      {data && type === 'hydrant' && <HydrantDetails hydrant={data} />}
      {data && type === 'transit' && <TransitDetails stop={data} />}
    </aside>
  )
}
