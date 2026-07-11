export default function QueryBar({ value, onChange, onSubmit, loading, summary, source, error, onClear }) {
  function handleSubmit(e) {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }

  return (
    <form className="query-bar" onSubmit={handleSubmit}>
      <div className="query-input-row">
        <input
          className="query-input"
          type="text"
          placeholder='e.g. "buildings over 100 feet" or "show commercial buildings"'
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="submit" className="query-submit" disabled={loading || !value.trim()}>
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </div>

      {summary && (
        <div className="query-result">
          <span className={`status-dot ${source === 'fallback' ? 'mock' : ''}`} />
          <span className="query-summary">{summary}</span>
          <button type="button" className="query-clear" onClick={onClear}>
            Clear
          </button>
        </div>
      )}

      {error && <div className="query-error">{error}</div>}
    </form>
  )
}
