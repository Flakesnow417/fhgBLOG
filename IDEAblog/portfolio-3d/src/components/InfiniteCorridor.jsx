import { useState, useCallback, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import CorridorSegment from './CorridorSegment'
import CorridorSegmentBoundary from './CorridorSegmentBoundary'
import { SEGMENT_LENGTH, CORRIDOR_START_Z, getSegmentFromZ } from '../constants/corridor'

/**
 * 无限长廊管理器
 * ------------------------------------------------------------------
 * 核心思想：长廊不需要真的"无限长"，只需要**始终在相机前后各留几段**。
 * 相机走到哪，就把那一带的段挂上，走远的段卸载。
 *
 * 与参考实现的差异：
 *   参考项目把「可见性开关」和「段挂载」拆成两个组件
 *   （SegmentVisibilityWrapper 负责 visible，Manager 负责挂载列表）。
 *   我保留了这个双层结构，但：
 *     1. 段索引允许为负（出生点身后也有墙），用取模保证内容循环；
 *     2. 只在段索引集合真的变化时才 setState，避免每帧重渲染；
 *     3. 预挂载 0 和 1 段，让着色器在纸张还没撕开时就编译完 ——
 *        这是参考项目注释里特意强调的，能显著减少撕纸瞬间的卡顿。
 */

/** 相机前后各保留几段（1 就够，段长 20 单位，视野足够覆盖） */
const SEGMENTS_AHEAD = 1
const SEGMENTS_BEHIND = 1

export default function InfiniteCorridor() {
  const { camera } = useThree()

  // 预挂载 0 和 1：纸张遮罩期间就把 shader 编译掉
  const [activeSegments, setActiveSegments] = useState([0, 1])

  // 记录上一次的集合，用于快速判断是否需要更新
  const prevRef = useRef('0,1')

  const updateSegments = useCallback((currentSegment) => {
    const next = []
    for (let i = currentSegment - SEGMENTS_BEHIND; i <= currentSegment + SEGMENTS_AHEAD; i++) {
      next.push(i)
    }

    // 用字符串比对代替数组比对，避免每帧创建数组做 includes
    const key = next.join(',')
    if (key !== prevRef.current) {
      prevRef.current = key
      setActiveSegments(next)
    }
  }, [])

  useFrame(() => {
    updateSegments(getSegmentFromZ(camera.position.z))
  })

  return (
    <group>
      {activeSegments.map((segmentIndex) => (
        <CorridorSegmentBoundary key={`seg-${segmentIndex}`} segmentIndex={segmentIndex}>
          {/* 只有最靠后的那一段（段 0）需要封口：再往后没有墙了 */}
          <CorridorSegment segmentIndex={segmentIndex} isEndSegment={segmentIndex === 0} />
        </CorridorSegmentBoundary>
      ))}
    </group>
  )
}

export { SEGMENT_LENGTH, CORRIDOR_START_Z }
