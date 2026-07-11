import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const CYAN = 0x5eead4
const BLUE = 0x5b9cf6
const AMBER = 0xf5a623
const HIGHLIGHT = 0x39ff88 // filter-match color -- distinct from CYAN/BLUE/AMBER and permit colors
const GROUND = 0x0c1118
const GRID_LINE = 0x1c2734

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
 * Builds a permit "pin" (thin stem + head) as two flat sibling meshes, NOT
 * nested in a THREE.Group -- Object3D.raycast() is a no-op, so a Group
 * would silently swallow raycasts and make pins unclickable. Both meshes
 * carry userData.permit so either one can be hit directly.
 *
 * Positions must match the same world-space transform buildings undergo:
 * buildingMesh() rotates the footprint shape so local (x, y) -> world
 * (x, -y) (see the rotateX(-Math.PI/2) comment above). Permit x/y are
 * already local meters relative to the same study-area origin, so pins
 * use worldZ = -permit.y to line up with the buildings they sit beside.
 */
function buildPermitMeshes(permit) {
  const color = colorForPermit(permit)
  const worldX = permit.x
  const worldZ = -permit.y

  const stemGeo = new THREE.CylinderGeometry(PIN_STEM_RADIUS * 0.4, PIN_STEM_RADIUS, PIN_HEIGHT, 8)
  const stemMat = new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.5 })
  const stem = new THREE.Mesh(stemGeo, stemMat)
  stem.position.set(worldX, PIN_HEIGHT / 2, worldZ)
  stem.userData.permit = permit
  stem.userData.baseColor = color

  const headGeo = new THREE.SphereGeometry(PIN_HEAD_RADIUS, 12, 10)
  const headMat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.2,
    roughness: 0.35,
    emissive: color,
    emissiveIntensity: 0.25,
  })
  const head = new THREE.Mesh(headGeo, headMat)
  head.position.set(worldX, PIN_HEIGHT + PIN_HEAD_RADIUS * 0.6, worldZ)
  head.userData.permit = permit
  head.userData.baseColor = color

  return [stem, head]
}

function buildGroundGrid(sizeMeters) {
  const group = new THREE.Group()

  const groundGeo = new THREE.PlaneGeometry(sizeMeters * 1.6, sizeMeters * 1.6)
  const groundMat = new THREE.MeshBasicMaterial({ color: GROUND })
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.05
  group.add(ground)

  const grid = new THREE.GridHelper(sizeMeters * 1.6, 40, GRID_LINE, GRID_LINE)
  grid.position.y = -0.02
  group.add(grid)

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

function applyPermitVisualState(mesh, selectedType, selectedId) {
  const p = mesh.userData.permit
  const isSelected = selectedType === 'permit' && p.id === selectedId
  mesh.material.color.set(isSelected ? AMBER : mesh.userData.baseColor)
  mesh.material.emissiveIntensity = isSelected ? 0.6 : 0.25
}

function applyAllVisualStates(state) {
  const { buildingsGroup, permitsGroup, selectedType, selectedId, matchedIds } = state
  if (buildingsGroup) {
    buildingsGroup.children.forEach((mesh) => applyBuildingVisualState(mesh, selectedType, selectedId, matchedIds))
  }
  if (permitsGroup) {
    permitsGroup.children.forEach((mesh) => applyPermitVisualState(mesh, selectedType, selectedId))
  }
}

export default function Scene3D({ buildings, permits, showPermits, matchedIds, selectedType, selectedId, onSelect }) {
  const hostRef = useRef(null)
  const stateRef = useRef({})

  // Keep the latest selection/filter/visibility state available to effects
  // and callbacks that intentionally don't re-subscribe on every render
  // (the pointerdown handler in particular, set up once below).
  stateRef.current.selectedType = selectedType
  stateRef.current.selectedId = selectedId
  stateRef.current.matchedIds = matchedIds
  stateRef.current.permits = permits
  stateRef.current.showPermits = showPermits

  // ---- one-time scene setup ----
  useEffect(() => {
    const host = hostRef.current
    const width = host.clientWidth
    const height = host.clientHeight

    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(0x080b10, 260, 900)

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 3000)
    camera.position.set(160, 140, 200)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    host.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.49
    controls.minDistance = 30
    controls.maxDistance = 700
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

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()

    function onPointerDown(event) {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)

      const targets = stateRef.current.showPermits
        ? [...buildingsGroup.children, ...permitsGroup.children]
        : buildingsGroup.children
      const hits = raycaster.intersectObjects(targets, false)

      if (hits.length > 0) {
        const hit = hits[0].object
        if (hit.userData.building) onSelect('building', hit.userData.building)
        else if (hit.userData.permit) onSelect('permit', hit.userData.permit)
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

  // ---- (re)build building meshes + ground whenever the data set changes ----
  useEffect(() => {
    const { scene, buildingsGroup, controls, camera } = stateRef.current
    if (!scene || !buildings) return

    while (buildingsGroup.children.length) {
      const m = buildingsGroup.children.pop()
      m.geometry?.dispose()
      m.material?.dispose()
    }
    scene.children.filter((c) => c.userData?.isGround).forEach((c) => scene.remove(c))

    if (buildings.length === 0) return

    let maxExtent = 50
    buildings.forEach((b) => {
      b.footprint.forEach(([x, y]) => {
        maxExtent = Math.max(maxExtent, Math.abs(x), Math.abs(y))
      })
    })
    ;(stateRef.current.permits || []).forEach((p) => {
      maxExtent = Math.max(maxExtent, Math.abs(p.x), Math.abs(p.y))
    })

    const ground = buildGroundGrid(maxExtent * 2)
    ground.userData.isGround = true
    scene.add(ground)

    buildings.forEach((b) => buildingsGroup.add(buildingMesh(b)))
    applyAllVisualStates(stateRef.current)

    if (controls && camera) {
      const dist = Math.max(120, maxExtent * 1.6)
      camera.position.set(dist * 0.7, dist * 0.62, dist * 0.9)
      controls.target.set(0, 8, 0)
      controls.update()
    }
  }, [buildings])

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

  // ---- toggle permit layer visibility (no rebuild) ----
  useEffect(() => {
    const { permitsGroup } = stateRef.current
    if (permitsGroup) permitsGroup.visible = showPermits
  }, [showPermits])

  // ---- selection + filter highlight precedence ----
  useEffect(() => {
    applyAllVisualStates(stateRef.current)
  }, [selectedType, selectedId, matchedIds])

  return <div ref={hostRef} className="canvas-host" />
}
