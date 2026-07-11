/**
 * filterEngine.js
 * ----------------
 * Single implementation of "does this building match these conditions",
 * used identically for a fresh LLM query result and for re-applying a
 * loaded saved project -- no duplicated matching logic between the two.
 *
 * Conditions arrive already unit-converted by the backend (see
 * backend/app/services/llm_service.py); this only ever does canonical-unit
 * comparisons, never unit math.
 */

function matchOne(building, { field, op, value }) {
  const actual = building[field]
  if (actual === null || actual === undefined) return false

  switch (op) {
    case 'gt':
      return Number(actual) > Number(value)
    case 'gte':
      return Number(actual) >= Number(value)
    case 'lt':
      return Number(actual) < Number(value)
    case 'lte':
      return Number(actual) <= Number(value)
    case 'eq':
      return typeof value === 'string'
        ? String(actual).toLowerCase() === value.toLowerCase()
        : Number(actual) === Number(value)
    case 'neq':
      return typeof value === 'string'
        ? String(actual).toLowerCase() !== value.toLowerCase()
        : Number(actual) !== Number(value)
    case 'contains':
      return String(actual).toLowerCase().includes(String(value).toLowerCase())
    case 'in':
      return Array.isArray(value) && value.some((v) => String(v).toLowerCase() === String(actual).toLowerCase())
    default:
      return false
  }
}

/**
 * Returns the Set of building ids matching ALL conditions (AND-combined).
 * An empty/null condition list returns an empty Set (caller decides
 * whether "no conditions" means "show everything" or "highlight nothing"
 * -- for this app, an empty Set with a non-null value still triggers the
 * filter-dimmed visual state, so callers should pass `null` instead of []
 * when there's no active filter at all).
 */
export function evaluateConditions(buildings, conditions) {
  const matched = new Set()
  if (!conditions || conditions.length === 0) return matched
  buildings.forEach((b) => {
    if (conditions.every((c) => matchOne(b, c))) matched.add(b.id)
  })
  return matched
}
