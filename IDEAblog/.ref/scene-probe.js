(() => {
  // R3F 把内部状态挂在 canvas 元素的 __r3f 上
  const canvas = document.querySelector('canvas')
  if (!canvas) return JSON.stringify({ error: 'no canvas' })

  let root = canvas.__r3f
  // 向上找 root store
  let guard = 0
  while (root && !root.root && guard++ < 10) root = root.parent
  if (!root) return JSON.stringify({ error: 'no __r3f root', keys: Object.keys(canvas.__r3f || {}) })

  const store = root.root ? root.root.getState() : root.getState?.()
  if (!store) return JSON.stringify({ error: 'no store' })

  const scene = store.scene
  const camera = store.camera

  const summary = {
    camera: {
      pos: [camera.position.x.toFixed(2), camera.position.y.toFixed(2), camera.position.z.toFixed(2)],
      rot: [camera.rotation.x.toFixed(3), camera.rotation.y.toFixed(3), camera.rotation.z.toFixed(3)],
      fov: camera.fov,
    },
    fog: scene.fog ? { color: '#' + scene.fog.color.getHexString(), near: scene.fog.near, far: scene.fog.far } : null,
    background: scene.background ? '#' + scene.background.getHexString() : null,
    meshCount: 0,
    lightCount: 0,
    visibleGroups: [],
    wallX: [],
    frameZ: [],
    meshes: [],
  }

  const seen = new Set()
  scene.traverse((o) => {
    if (seen.has(o)) return
    seen.add(o)
    if (o.isMesh) {
      summary.meshCount++
      const p = o.getWorldPosition(new (o.position.constructor)())
      const g = o.geometry
      const box = g?.boundingBox || (g?.computeBoundingBox?.(), g?.boundingBox)
      summary.meshes.push({
        type: g?.type?.replace('Geometry', '') ?? '?',
        pos: [p.x.toFixed(2), p.y.toFixed(2), p.z.toFixed(2)],
        visible: o.visible,
        parentVisible: (() => { let q = o.parent, v = true; while (q) { if (!q.visible) v = false; q = q.parent } return v })(),
        size: box ? [ (box.max.x-box.min.x).toFixed(2), (box.max.y-box.min.y).toFixed(2), (box.max.z-box.min.z).toFixed(2) ] : null,
        color: o.material?.color ? '#' + o.material.color.getHexString() : null,
      })
    }
    if (o.isLight) summary.lightCount++
    if (o.isGroup) {
      const p = o.getWorldPosition(new (o.position.constructor)())
      summary.visibleGroups.push({
        visible: o.visible,
        pos: [p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(1)],
        children: o.children.length,
      })
    }
  })

  // 压缩输出：只带前 40 个 mesh
  summary.meshes = summary.meshes.slice(0, 40)
  return JSON.stringify(summary)
})()
