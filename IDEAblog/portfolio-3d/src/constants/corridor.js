/**
 * 全局常量：长廊的几何与节奏参数。
 * 后续 Module 3 / 5 的渲染与着色器都从这里取值，避免各处硬编码。
 */

/* --- 长廊 --- */
export const CORRIDOR_WIDTH = 9 // 长廊宽度（墙面内侧间距）
export const CORRIDOR_HEIGHT = 5.2 // 墙面高度
export const SEGMENT_LENGTH = 20 // 单段长廊沿 Z 轴的长度，决定流式加载粒度
export const SEGMENTS_AHEAD = 1 // 相机前方预加载几段
export const SEGMENTS_BEHIND = 1 // 相机后方保留几段

/* --- 出生点与相机 --- */
export const CORRIDOR_START_Z = 14 // 第 0 段长廊的起始 Z（相机稍退后一点起步，先看到长廊全貌）
export const CAMERA_HEIGHT = 1.65 // 视高，接近人眼
export const CAMERA_SPEED = 3.2 // 漫游速度（单位/秒）

/* --- 画框 --- */
export const FRAME_SPACING = 5 // 同一侧相邻画框的 Z 轴间隔
export const FRAME_MARGIN = 2.15 // 画框中心距地面高度
export const FRAME_WIDTH = 1.5 // 画心宽度
export const FRAME_HEIGHT = 1.05 // 画心高度
/**
 * 画框中心距墙面的距离。
 * 画框是"贴"在墙上的平面组合（不占体积），但只要它和墙面共面就会出现
 * z-fighting（线稿框的白底和墙面的白底互相闪烁），所以必须留一点间距。
 * 0.02 已经足够消除闪烁，同时肉眼看仍是"挂"在墙上。
 */
export const FRAME_WALL_GAP = 0.02

/* --- 细节 --- */
export const BASEBOARD_HEIGHT = 0.42 // 踢脚线高度

/**
 * 由世界坐标 Z 反推它属于第几段长廊。
 * 注意：必须用 CORRIDOR_START_Z 而不是写死的 10 —— 之前写死过一次，
 * 后来把起点从 10 挪到 14 时忘了同步，导致段划分整体偏移。
 * 例：起点 14、段长 20 时，z=14 → 0，z=-6 → 1，z=-26 → 2 …
 */
export const getSegmentFromZ = (z) => Math.floor((CORRIDOR_START_Z - z) / SEGMENT_LENGTH)

/* --- 素描→上色着色器参数（Module 5 用） --- */
export const PAINT_REVEAL_DEFAULTS = {
  dirX: -1,
  dirY: 0,
  dirZ: 0.1,
  startDist: -5.0,
  endDist: 55.0,
}
