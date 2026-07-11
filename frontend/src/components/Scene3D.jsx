import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const CYAN = 0x5eead4
const BLUE = 0x5b9cf6
const AMBER = 0xf5a623
const GROUND = 0x0c1118
const GRID_LINE = 0x1c2734

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

export default function Scene3D({ buildings, selectedId, onSelectBuilding }) {
  const hostRef = useRef(null)
  const stateRef = useRef({})

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

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()

    function onPointerDown(event) {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObjects(buildingsGroup.children, false)
      if (hits.length > 0) {
        const building = hits[0].object.userData.building
        onSelectBuilding(building)
      } else {
        onSelectBuilding(null)
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

    stateRef.current = { scene, camera, renderer, controls, buildingsGroup, raycaster }

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

    // clear previous
    while (buildingsGroup.children.length) {
      const m = buildingsGroup.children.pop()
      m.geometry?.dispose()
      m.material?.dispose()
    }
    // remove old ground if present
    scene.children
      .filter((c) => c.userData?.isGround)
      .forEach((c) => scene.remove(c))

    if (buildings.length === 0) return

    let maxExtent = 50
    buildings.forEach((b) => {
      b.footprint.forEach(([x, y]) => {
        maxExtent = Math.max(maxExtent, Math.abs(x), Math.abs(y))
      })
    })

    const ground = buildGroundGrid(maxExtent * 2)
    ground.userData.isGround = true
    scene.add(ground)

    buildings.forEach((b) => {
      const mesh = buildingMesh(b)
      buildingsGroup.add(mesh)
    })

    // frame the camera to the data extent
    if (controls && camera) {
      const dist = Math.max(120, maxExtent * 1.6)
      camera.position.set(dist * 0.7, dist * 0.62, dist * 0.9)
      controls.target.set(0, 8, 0)
      controls.update()
    }
  }, [buildings])

  // ---- highlight selection ----
  useEffect(() => {
    const { buildingsGroup } = stateRef.current
    if (!buildingsGroup) return
    buildingsGroup.children.forEach((mesh) => {
      const isSelected = mesh.userData.building?.id === selectedId
      mesh.material.color.set(isSelected ? AMBER : mesh.userData.baseColor)
      mesh.material.opacity = isSelected ? 1 : 0.82
      mesh.scale.y = 1 // reserved for future pulse/animation
    })
  }, [selectedId])

  return <div ref={hostRef} className="canvas-host" />
}
