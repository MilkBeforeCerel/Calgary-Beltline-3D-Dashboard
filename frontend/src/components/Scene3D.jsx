import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { lonlatToLocalXY, localXYToLonLat, bboxAroundMeters, tileBoundsLonLat, tilesForBbox } from '../lib/mapTiles.js'

const CYAN = 0x5eead4
const BLUE = 0x5b9cf6
const AMBER = 0xf5a623
const HIGHLIGHT = 0x39ff88 // filter-match color -- distinct from CYAN/BLUE/AMBER and permit colors
const GROUND = 0x0c1118

const PIN_HEIGHT = 20
const PIN_STEM_RADIUS = 0.6
const PIN_HEAD_RADIUS = 2.2
const PERMIT_STATUS_COLORS = {
  Issued: 0x4ade80,
  'In Review': 0xf5a623,
  Completed: 0x5b9cf6,
  Applied: 0x9ca8b6,
}
const PERMIT_DEFAULT_COLOR = 0x9ca8b6

const HYDRANT_STATUS_COLORS = {
  'In Service': 0xe63946,
  'Out of Service': 0x555c66,
  'Needs Repair': 0xf5a623,
}
const HYDRANT_DEFAULT_COLOR = 0xe63946

const TRANSIT_TYPE_COLORS = {
  Bus: 0xfacc15,
  LRT: 0xa78bfa,
}
const TRANSIT_DEFAULT_COLOR = 0xa78bfa

/**
 * Maps a building's zoning code to a base color. Falls back to a
 * height-based gradient when zoning is unknown, so the scene still reads
 * clearly even with live data that lacks a zoning join.
 */
function colorForBuilding(b) {
  const zoning = (b.zoning || '').toUpperCase()
  if (zoning.startsWith('CC') || zoning.startsWith('DC')) return BLUE
  if (zoning.startsWith('R-') || zoning.startsWith('M-')) return CYAN
  // fallback: taller = bluer, shorter = cyan-er
  return b.height_m > 30 ? BLUE : CYAN
}

function colorForPermit(p) {
  return PERMIT_STATUS_COLORS[p.status] ?? PERMIT_DEFAULT_COLOR
}

function colorForHydrant(h) {
  return HYDRANT_STATUS_COLORS[h.status] ?? HYDRANT_DEFAULT_COLOR
}

function colorForTransit(t) {
  return TRANSIT_TYPE_COLORS[t.route_type] ?? TRANSIT_DEFAULT_COLOR
}

/**
 * Builds an extruded THREE.Mesh from a building's footprint (array of
 * [x, y] local meters, ground-plane) and height_m. Footprint coordinates
 * map to the XZ plane (three.js is Y-up); height extrudes along Y.
 */
function buildingMesh(building) {
  const shape = new THREE.Shape()
  const ring = building.footprint
  ring.forEach(([x, y], i) => {
    // three.js XZ plane <- local (x=east, y=north); flip sign on the
    // second coordinate because Shape() is defined in a 2D plane that we
    // then rotate into XZ.
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  })
  shape.closePath()

  const height = Math.max(building.height_m, 3)
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    steps: 1,
  })
  // ExtrudeGeometry extrudes along +Z in shape-local space; rotate so it
  // extrudes along +Y (up) and the footprint lies flat on XZ.
  geometry.rotateX(-Math.PI / 2)

  const color = colorForBuilding(building)
  const material = new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity: 0.82,
    metalness: 0.15,
    roughness: 0.55,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.userData.building = building
  mesh.userData.baseColor = color

  // Edge outline for that "architectural massing model" look.
  const edges = new THREE.EdgesGeometry(geometry, 20)
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x0a0f15, transparent: true, opacity: 0.5 })
  const edgeLines = new THREE.LineSegments(edges, edgeMat)
  mesh.add(edgeLines)

  return mesh
}

/**
 * Builds a "pin" (thin stem + head) as two flat sibling meshes, NOT nested
 * in a THREE.Group -- Object3D.raycast() is a no-op, so a Group would
 * silently swallow raycasts and make pins unclickable. Both meshes carry
 * userData[userKey] = item so either one can be hit directly.
 *
 * Shared by every point-overlay layer (permits, hydrants, transit)
 * -- only the color, size, and head shape vary per layer.
 *
 * Positions must match the same world-space transform buildings undergo:
 * buildingMesh() rotates the footprint shape so local (x, y) -> world
 * (x, -y) (see the rotateX(-Math.PI/2) comment above). Marker x/y are
 * already local meters relative to the same study-area origin, so pins use
 * worldZ = -item.y to line up with the buildings they sit beside.
 */
function buildMarkerMeshes(item, userKey, color, opts = {}) {
  const {
    height = PIN_HEIGHT,
    stemRadius = PIN_STEM_RADIUS,
    headRadius = PIN_HEAD_RADIUS,
    headGeometry,
  } = opts

  const worldX = item.x
  const worldZ = -item.y

  const stemGeo = new THREE.CylinderGeometry(stemRadius * 0.4, stemRadius, height, 8)
  const stemMat = new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.5 })
  const stem = new THREE.Mesh(stemGeo, stemMat)
  stem.position.set(worldX, height / 2, worldZ)
  stem.userData[userKey] = item
  stem.userData.baseColor = color

  const headGeo = headGeometry || new THREE.SphereGeometry(headRadius, 12, 10)
  const headMat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.2,
    roughness: 0.35,
    emissive: color,
    emissiveIntensity: 0.25,
  })
  const head = new THREE.Mesh(headGeo, headMat)
  head.position.set(worldX, height + headRadius * 0.6, worldZ)
  head.userData[userKey] = item
  head.userData.baseColor = color

  return [stem, head]
}

function buildPermitMeshes(permit) {
  return buildMarkerMeshes(permit, 'permit', colorForPermit(permit))
}

function buildHydrantMeshes(hydrant) {
  return buildMarkerMeshes(hydrant, 'hydrant', colorForHydrant(hydrant), {
    height: 4,
    stemRadius: 0.8,
    headRadius: 1.2,
  })
}

function buildTransitMeshes(stop) {
  return buildMarkerMeshes(stop, 'transitStop', colorForTransit(stop), {
    height: 11,
    stemRadius: 0.5,
    headRadius: 1.6,
    headGeometry: new THREE.BoxGeometry(2.4, 2.4, 2.4),
  })
}

// Fixed multi-resolution "rings" (a sharp patch + a coarser patch + a wide
// city layer, all loaded simultaneously) always had a visible boundary the
// moment the camera crossed from one ring into the next -- three different
// images stitched together, not one map. A real map instead shows exactly
// ONE resolution at a time, chosen from how far the camera actually is, and
// swaps to a new resolution+extent as the camera moves -- see the dynamic
// tile-loading effect below (keyed on camera distance from
// controls.target, not a fixed set of pre-baked bboxes).
const ZOOM_REFERENCE_DISTANCE = 300 // camera distance (m) this reference zoom looks right at
const ZOOM_REFERENCE_LEVEL = 17
const MIN_TILE_ZOOM = 10
const MAX_TILE_ZOOM = 18
const MIN_BBOX_RADIUS_M = 300
const MAX_BBOX_RADIUS_M = 60000
const BBOX_RADIUS_FACTOR = 2.5 // ground visible at an oblique angle extends well past the straight-down distance

/** Ground resolution roughly halves each time distance doubles -- invert that to pick a tile zoom. */
function zoomForDistance(distance) {
  const raw = ZOOM_REFERENCE_LEVEL - Math.log2(Math.max(distance, 1) / ZOOM_REFERENCE_DISTANCE)
  return Math.max(MIN_TILE_ZOOM, Math.min(MAX_TILE_ZOOM, Math.round(raw)))
}

function bboxRadiusForDistance(distance) {
  return Math.max(MIN_BBOX_RADIUS_M, Math.min(MAX_BBOX_RADIUS_M, distance * BBOX_RADIUS_FACTOR))
}

const MAP_TILE_SUBDOMAINS = ['a', 'b', 'c', 'd']

// CARTO ships both styles from the same CORS-enabled CDN -- swapping the
// path segment is the whole theme switch, no separate provider needed.
// Placeholder colors (shown before a tile's texture loads, or if it fails)
// match each style so the loading flash isn't a jarring wrong-theme flat
// rectangle.
const MAP_THEME_STYLES = {
  light: { path: 'light_all', placeholder: 0xd9dde2 },
  dark: { path: 'dark_all', placeholder: 0x0c1118 },
}
const MAP_BACKGROUND_COLOR = { light: 0xc9ced4, dark: GROUND }

function mapTileUrl(x, y, zoom, theme) {
  const s = MAP_TILE_SUBDOMAINS[(x + y) % MAP_TILE_SUBDOMAINS.length]
  const style = MAP_THEME_STYLES[theme] ?? MAP_THEME_STYLES.light
  return `https://${s}.basemaps.cartocdn.com/${style.path}/${zoom}/${x}/${y}.png`
}

/**
 * Real map background, replacing the old flat dark ground plane. One
 * textured quad per tile (CARTO, CORS-enabled, no API key) positioned via
 * the exact same equirectangular projection (mapTiles.js#lonlatToLocalXY)
 * the backend used for buildings/pins, using the same origin
 * (`center` from the API response) -- so the map lines up with everything
 * already in the scene without a separate alignment step. Each tile starts
 * as a flat-colored placeholder and swaps in its texture once loaded, so a
 * slow/failed tile degrades to a plain rectangle instead of a hole in the
 * map.
 *
 * Always called with exactly one (bbox, zoom) pair -- the caller (the
 * dynamic-reload effect below) picks both from the current camera distance,
 * so there is only ever one resolution on screen at a time, like a real
 * map. `maxAnisotropy` is queried from the actual GPU
 * (renderer.capabilities) rather than guessed, so oblique-angle sharpening
 * uses everything the hardware supports.
 */
function buildMapTilesGroup(bbox, zoom, originLon, originLat, theme, maxAnisotropy) {
  const group = new THREE.Group()
  const loader = new THREE.TextureLoader()
  loader.setCrossOrigin('anonymous')
  const placeholder = (MAP_THEME_STYLES[theme] ?? MAP_THEME_STYLES.light).placeholder

  tilesForBbox(bbox, zoom).forEach(({ x, y, zoom: z }) => {
    const { west, east, north, south } = tileBoundsLonLat(x, y, z)
    const [x0, y0] = lonlatToLocalXY(west, south, originLon, originLat)
    const [x1, y1] = lonlatToLocalXY(east, north, originLon, originLat)

    const geo = new THREE.PlaneGeometry(x1 - x0, y1 - y0)
    const mat = new THREE.MeshBasicMaterial({ color: placeholder })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set((x0 + x1) / 2, -0.5, -(y0 + y1) / 2)
    mesh.userData.isMapTile = true
    group.add(mesh)

    loader.load(
      mapTileUrl(x, y, z, theme),
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = maxAnisotropy
        mat.map = texture
        mat.color.set(0xffffff)
        mat.needsUpdate = true
      },
      undefined,
      () => {} // leave the flat-colored placeholder on failure
    )
  })

  return group
}

/**
 * Visual-state precedence for a building mesh: click-selected beats
 * filter-matched beats filter-dimmed beats normal zoning color. Called
 * both from the dedicated selection/filter effect AND immediately after
 * (re)building meshes, so a data refetch never flashes unstyled meshes.
 */
function applyBuildingVisualState(mesh, selectedType, selectedId, matchedIds) {
  const b = mesh.userData.building
  const isSelected = selectedType === 'building' && b.id === selectedId
  const filterActive = matchedIds != null
  const isMatched = filterActive && matchedIds.has(b.id)

  if (isSelected) {
    mesh.material.color.set(AMBER)
    mesh.material.opacity = 1
  } else if (isMatched) {
    mesh.material.color.set(HIGHLIGHT)
    mesh.material.opacity = 0.95
  } else if (filterActive) {
    mesh.material.color.set(mesh.userData.baseColor)
    mesh.material.opacity = 0.12
  } else {
    mesh.material.color.set(mesh.userData.baseColor)
    mesh.material.opacity = 0.82
  }
}

function applyMarkerVisualState(mesh, userKey, type, selectedType, selectedId) {
  const item = mesh.userData[userKey]
  const isSelected = selectedType === type && item.id === selectedId
  mesh.material.color.set(isSelected ? AMBER : mesh.userData.baseColor)
  mesh.material.emissiveIntensity = isSelected ? 0.6 : 0.25
}

function applyAllVisualStates(state) {
  const {
    buildingsGroup,
    permitsGroup,
    hydrantsGroup,
    transitGroup,
    selectedType,
    selectedId,
    matchedIds,
  } = state
  if (buildingsGroup) {
    buildingsGroup.children.forEach((mesh) => applyBuildingVisualState(mesh, selectedType, selectedId, matchedIds))
  }
  if (permitsGroup) {
    permitsGroup.children.forEach((mesh) => applyMarkerVisualState(mesh, 'permit', 'permit', selectedType, selectedId))
  }
  if (hydrantsGroup) {
    hydrantsGroup.children.forEach((mesh) => applyMarkerVisualState(mesh, 'hydrant', 'hydrant', selectedType, selectedId))
  }
  if (transitGroup) {
    transitGroup.children.forEach((mesh) =>
      applyMarkerVisualState(mesh, 'transitStop', 'transit', selectedType, selectedId)
    )
  }
}

function disposeObject3D(obj) {
  obj.traverse((child) => {
    child.geometry?.dispose()
    child.material?.dispose()
  })
}

export default function Scene3D({
  buildings,
  permits,
  hydrants,
  transitStops,
  mapCenter,
  mapTheme,
  showPermits,
  showHydrants,
  showTransit,
  matchedIds,
  selectedType,
  selectedId,
  onSelect,
}) {
  const hostRef = useRef(null)
  const stateRef = useRef({})

  // Keep the latest selection/filter/visibility state available to effects
  // and callbacks that intentionally don't re-subscribe on every render
  // (the pointerdown handler in particular, set up once below).
  stateRef.current.selectedType = selectedType
  stateRef.current.selectedId = selectedId
  stateRef.current.matchedIds = matchedIds
  stateRef.current.permits = permits
  stateRef.current.hydrants = hydrants
  stateRef.current.transitStops = transitStops
  stateRef.current.showPermits = showPermits
  stateRef.current.showHydrants = showHydrants
  stateRef.current.showTransit = showTransit

  // ---- one-time scene setup ----
  useEffect(() => {
    const host = hostRef.current
    const width = host.clientWidth
    const height = host.clientHeight

    const scene = new THREE.Scene()
    // Fallback for anything beyond the map-tile grid (or before tiles
    // load) instead of default WebGL black; both this and the fog color
    // get kept in sync with the light/dark theme in the map-tiles effect
    // below (a hardcoded dark fog over a light-theme map is what caused
    // the whole map to fade to a solid dark wall while still well short of
    // maxDistance -- see that effect for the actual per-theme colors).
    scene.background = new THREE.Color(GROUND)
    // far must clear controls.maxDistance (45000) with room to spare, or
    // the camera can reach a distance that's already fully fogged out --
    // i.e. zooming out "all the way" makes the whole scene disappear into
    // flat fog color before you even stop scrolling.
    scene.fog = new THREE.Fog(0x080b10, 4000, 55000)

    // near=0.1 with far=60000 is a 600,000:1 ratio -- way more than a
    // standard (non-logarithmic) depth buffer can resolve, which is what
    // caused the flickering/"buzzy" z-fighting between the stacked map
    // tile layers (and roads/ground) at oblique angles once the camera
    // could pull back to city scale. A near plane of 1 (nothing in this
    // scene needs sub-meter near-clip precision) plus a logarithmic depth
    // buffer on the renderer fixes that properly instead of just shrinking
    // far and losing the city view.
    const camera = new THREE.PerspectiveCamera(50, width / height, 1, 60000)
    camera.position.set(160, 140, 200)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    host.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.49
    controls.minDistance = 30
    // Large enough to pull back and see the full Calgary map background,
    // not just the immediate study area.
    controls.maxDistance = 45000
    controls.target.set(0, 8, 0)

    const hemi = new THREE.HemisphereLight(0x7fa8d9, 0x0c1118, 0.9)
    scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xffffff, 1.15)
    sun.position.set(120, 220, 80)
    scene.add(sun)
    const fill = new THREE.DirectionalLight(0x5b9cf6, 0.25)
    fill.position.set(-150, 100, -100)
    scene.add(fill)

    const buildingsGroup = new THREE.Group()
    scene.add(buildingsGroup)

    const permitsGroup = new THREE.Group()
    permitsGroup.visible = stateRef.current.showPermits
    scene.add(permitsGroup)

    const hydrantsGroup = new THREE.Group()
    hydrantsGroup.visible = stateRef.current.showHydrants
    scene.add(hydrantsGroup)

    const transitGroup = new THREE.Group()
    transitGroup.visible = stateRef.current.showTransit
    scene.add(transitGroup)

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()

    function onPointerDown(event) {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)

      const targets = [...buildingsGroup.children]
      if (stateRef.current.showPermits) targets.push(...permitsGroup.children)
      if (stateRef.current.showHydrants) targets.push(...hydrantsGroup.children)
      if (stateRef.current.showTransit) targets.push(...transitGroup.children)

      const hits = raycaster.intersectObjects(targets, false)

      if (hits.length > 0) {
        const hit = hits[0].object
        if (hit.userData.building) onSelect('building', hit.userData.building)
        else if (hit.userData.permit) onSelect('permit', hit.userData.permit)
        else if (hit.userData.hydrant) onSelect('hydrant', hit.userData.hydrant)
        else if (hit.userData.transitStop) onSelect('transit', hit.userData.transitStop)
        else onSelect(null, null)
      } else {
        onSelect(null, null)
      }
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)

    let frameId
    function animate() {
      frameId = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    function onResize() {
      const w = host.clientWidth
      const h = host.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    stateRef.current = {
      ...stateRef.current,
      scene,
      camera,
      renderer,
      controls,
      buildingsGroup,
      permitsGroup,
      hydrantsGroup,
      transitGroup,
      raycaster,
    }

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', onResize)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.dispose()
      host.removeChild(renderer.domElement)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- (re)build building meshes whenever the data set changes ----
  useEffect(() => {
    const { scene, buildingsGroup, controls, camera } = stateRef.current
    if (!scene || !buildings) return

    while (buildingsGroup.children.length) {
      const m = buildingsGroup.children.pop()
      m.geometry?.dispose()
      m.material?.dispose()
    }

    if (buildings.length === 0) return

    let maxExtent = 50
    buildings.forEach((b) => {
      b.footprint.forEach(([x, y]) => {
        maxExtent = Math.max(maxExtent, Math.abs(x), Math.abs(y))
      })
    })
    ;[stateRef.current.permits, stateRef.current.hydrants, stateRef.current.transitStops].forEach((layer) => {
      ;(layer || []).forEach((p) => {
        maxExtent = Math.max(maxExtent, Math.abs(p.x), Math.abs(p.y))
      })
    })

    buildings.forEach((b) => buildingsGroup.add(buildingMesh(b)))
    applyAllVisualStates(stateRef.current)

    if (controls && camera) {
      const dist = Math.max(120, maxExtent * 1.6)
      camera.position.set(dist * 0.7, dist * 0.62, dist * 0.9)
      controls.target.set(0, 8, 0)
      controls.update()
    }
  }, [buildings])

  // ---- dynamic map-tile background: exactly one resolution on screen at a
  // time, picked from the camera's current distance and positioned around
  // wherever controls.target currently is -- the same "one zoom level at a
  // time" behavior a normal 2D map has, so there's never a seam between
  // simultaneously-visible resolutions the way a fixed set of pre-baked
  // rings had. Rebuilds (debounced, so a drag/zoom gesture doesn't spam
  // reloads mid-motion) as the camera moves; the light/dark theme swap also
  // forces a rebuild since it's a different set of tile images, not
  // something a texture swap alone can handle.
  useEffect(() => {
    const { scene, renderer, camera, controls } = stateRef.current
    if (!scene || !mapCenter || !camera || !controls) return

    const theme = mapTheme === 'dark' ? 'dark' : 'light'
    scene.background = new THREE.Color(MAP_BACKGROUND_COLOR[theme])
    if (scene.fog) scene.fog.color.set(MAP_BACKGROUND_COLOR[theme])
    const maxAnisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1
    const [originLon, originLat] = mapCenter

    let currentGroup = null
    let lastKey = null
    let debounceId = null

    function rebuild() {
      const distance = camera.position.distanceTo(controls.target)
      const zoom = zoomForDistance(distance)
      const radius = bboxRadiusForDistance(distance)
      const [centerLon, centerLat] = localXYToLonLat(controls.target.x, -controls.target.z, originLon, originLat)

      // Snap to a grid coarser than incidental damping jitter so settling
      // after a gesture doesn't re-trigger a rebuild it just did.
      const gridDeg = 0.0005
      const key = `${zoom}:${Math.round(centerLon / gridDeg)}:${Math.round(centerLat / gridDeg)}`
      if (key === lastKey) return
      lastKey = key

      const bbox = bboxAroundMeters(centerLon, centerLat, radius)
      const nextGroup = buildMapTilesGroup(bbox, zoom, originLon, originLat, theme, maxAnisotropy)
      scene.add(nextGroup)
      if (currentGroup) {
        disposeObject3D(currentGroup)
        scene.remove(currentGroup)
      }
      currentGroup = nextGroup
    }

    rebuild()

    function onChange() {
      if (debounceId) clearTimeout(debounceId)
      debounceId = setTimeout(rebuild, 200)
    }
    controls.addEventListener('change', onChange)

    return () => {
      controls.removeEventListener('change', onChange)
      if (debounceId) clearTimeout(debounceId)
      if (currentGroup) {
        disposeObject3D(currentGroup)
        scene.remove(currentGroup)
      }
    }
  }, [mapCenter, mapTheme])

  // ---- (re)build permit pins whenever the permits data set changes ----
  useEffect(() => {
    const { scene, permitsGroup } = stateRef.current
    if (!scene || !permits) return

    while (permitsGroup.children.length) {
      const m = permitsGroup.children.pop()
      m.geometry?.dispose()
      m.material?.dispose()
    }

    permits.forEach((p) => buildPermitMeshes(p).forEach((m) => permitsGroup.add(m)))
    applyAllVisualStates(stateRef.current)
  }, [permits])

  // ---- (re)build hydrant pins whenever that data set changes ----
  useEffect(() => {
    const { scene, hydrantsGroup } = stateRef.current
    if (!scene || !hydrants) return

    while (hydrantsGroup.children.length) {
      const m = hydrantsGroup.children.pop()
      m.geometry?.dispose()
      m.material?.dispose()
    }

    hydrants.forEach((h) => buildHydrantMeshes(h).forEach((m) => hydrantsGroup.add(m)))
    applyAllVisualStates(stateRef.current)
  }, [hydrants])

  // ---- (re)build transit stop pins whenever that data set changes ----
  useEffect(() => {
    const { scene, transitGroup } = stateRef.current
    if (!scene || !transitStops) return

    while (transitGroup.children.length) {
      const m = transitGroup.children.pop()
      m.geometry?.dispose()
      m.material?.dispose()
    }

    transitStops.forEach((t) => buildTransitMeshes(t).forEach((m) => transitGroup.add(m)))
    applyAllVisualStates(stateRef.current)
  }, [transitStops])

  // ---- toggle layer visibility (no rebuild) ----
  useEffect(() => {
    const { permitsGroup } = stateRef.current
    if (permitsGroup) permitsGroup.visible = showPermits
  }, [showPermits])

  useEffect(() => {
    const { hydrantsGroup } = stateRef.current
    if (hydrantsGroup) hydrantsGroup.visible = showHydrants
  }, [showHydrants])

  useEffect(() => {
    const { transitGroup } = stateRef.current
    if (transitGroup) transitGroup.visible = showTransit
  }, [showTransit])

  // ---- selection + filter highlight precedence ----
  useEffect(() => {
    applyAllVisualStates(stateRef.current)
  }, [selectedType, selectedId, matchedIds])

  return <div ref={hostRef} className="canvas-host" />
}
