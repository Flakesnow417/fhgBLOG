import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { CORRIDOR_START_Z, SEGMENT_LENGTH } from '../constants/corridor'

/**
 * 分段可见性边界
 * ------------------------------------------------------------------
 * 唯一职责：相机走远后把整段的 group.visible 置 false，
 * 让渲染器完全跳过这一段的绘制提交。
 *
 * 坐标约定（务必理解，这里容易搞反）：
 *   - 相机从 z = +10 出发，朝 -Z 方向前进，z 越来越小。
 *   - 第 i 段占据 [startZ, endZ]，其中
 *       startZ = 10 - i * SEGMENT_LENGTH   （靠近相机出发点的"近端"，z 较大）
 *       endZ   = startZ - SEGMENT_LENGTH   （远端，z 较小）
 *   - 例：段 0 = [10, -10]，段 1 = [-10, -30]，段 -1 = [30, 10]。
 *
 * 判定逻辑（三段式，不要只写一半）：
 *   1) 段完全在相机**身后**：相机的 z 已经小于段的 endZ 減去余量
 *      → 即相机走过了这一段，段落在身后
 *   2) 段完全在相机**前方太远**：段的 startZ 比相机 z 大出很多
 *      → 段还在很前面，暂时不需要画
 *   3) 其余情况都可见
 *
 * 之前踩的坑：只判断了「相机 z > startZ + 30」这种针对正段索引的写法，
 * 对段 -1（startZ=30，位于相机身后）完全失效，导致身后的墙没被隐藏，
 * 白白多渲染一整段。现在改成基于「段的 Z 区间与相机距离」的统一判定，
 * 对任意段索引（含负数）都成立。
 *
 * 余量刻意不对称：
 *   - 身后留 5：刚走过的段保留一点，避免一转身看到墙凭空消失
 *   - 身前留 30：远处的段提前显示，避免"墙从雾里长出来"
 */
const BEHIND_MARGIN = 5
const AHEAD_MARGIN = 30

export default function CorridorSegmentBoundary({ segmentIndex, children }) {
  const groupRef = useRef(null)
  const { camera } = useThree()

  const startZ = CORRIDOR_START_Z - segmentIndex * SEGMENT_LENGTH
  const endZ = startZ - SEGMENT_LENGTH

  useFrame(() => {
    const g = groupRef.current
    if (!g) return

    const camZ = camera.position.z

    // 相机已经走过整段（段的远端也在相机前方之外）
    const isBehind = camZ < endZ - BEHIND_MARGIN
    // 整段还在相机很靠前的位置（段的近端远在相机之前）
    const isFarAhead = startZ > camZ + AHEAD_MARGIN

    const isVisible = !(isBehind || isFarAhead)

    if (g.visible !== isVisible) g.visible = isVisible
  })

  return <group ref={groupRef}>{children}</group>
}
