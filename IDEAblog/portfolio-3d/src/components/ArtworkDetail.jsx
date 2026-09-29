import { useEffect, useMemo, useRef, useState } from 'react'
import { CORRIDOR_ARTWORKS } from '../constants/artworks'
import { useInteraction } from '../context/InteractionContext'

/**
 * 画作详情弹窗
 * ==================================================================
 * Module 4 的出口。它是一张「从画框里抽出来的卡纸」，覆盖在 3D 场景之上。
 *
 * 为什么弹窗做在 DOM 里而不是 3D 里：
 *   1. 长文本在 3D 里渲染要么用 troika/SDF 文字（无法选中、无法复制、
 *      排版能力弱），要么贴一张大 canvas 贴图（清晰度随距离掉）。
 *      而这段内容是"简历正文"，用户很可能想复制邮箱、想用 Ctrl+F；
 *   2. 无障碍：DOM 才能给屏幕阅读器正确的语义和焦点管理；
 *   3. 动画自由度：CSS 做衬纸抽出的手感，比在 3D 里算要容易得多。
 *   参考项目里房间内的信息面板也是 DOM 化的（GlobalOverlay.jsx）。
 *
 * ------------------------------------------------------------------
 * 交互要点（这些都是"弹窗好不好用"的关键，不是装饰）：
 *   - 打开后焦点移入弹窗，关闭后焦点还回触发元素 → 键盘用户不会迷失；
 *   - Esc 关闭；点遮罩关闭；右上角有明确的关闭按钮；
 *   - 打开时锁住底层滚动与漫游（通过 context 的 isOpen 让相机停下）；
 *   - 内容超长时弹窗内部滚动，不撑破页面；
 *   - 进入用 CSS 动画（卡纸抽出 + 轻微旋转回正），退出用状态延迟卸载，
 *     这样"关闭"也能播完动画而不是瞬间消失。
 */

/** 把 detail.blocks 里的 items 归类：字符串是普通条目，{label,value} 是定义项。 */
function isLabeled(item) {
  return item !== null && typeof item === 'object' && 'label' in item
}

export default function ArtworkDetail() {
  const { activeId, closeArtwork, setHoveredId } = useInteraction()

  // 「正在显示的画」与「正在播放退出动画的画」要分开：
  // activeId 一变成 null，如果直接卸载 DOM，退出动画就没机会播。
  // 所以用 displayedId 记住最后打开的那一幅，延迟到动画结束再清。
  const [displayedId, setDisplayedId] = useState(null)
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef(null)

  const artwork = useMemo(
    () => CORRIDOR_ARTWORKS.find((a) => a.id === displayedId) || null,
    [displayedId],
  )

  useEffect(() => {
    if (activeId) {
      // 打开（或从一幅切到另一幅）
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
      setClosing(false)
      setDisplayedId(activeId)
      // 打开弹窗时清掉 hover 高亮 —— 否则鼠标位置不变，
      // 背后那幅画仍然亮着，与"进入详情"的状态冲突。
      setHoveredId(null)
      return
    }
    // 关闭
    if (!displayedId) return
    setClosing(true)
    closeTimer.current = window.setTimeout(() => {
      setDisplayedId(null)
      setClosing(false)
    }, 280)
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
    }
  }, [activeId, displayedId, setHoveredId])

  // --- Esc 关闭 ---
  useEffect(() => {
    if (!activeId) return
    const onKey = (e) => {
      if (e.key === 'Escape') closeArtwork()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeId, closeArtwork])

  // --- 焦点管理 ---
  const panelRef = useRef(null)
  const lastFocused = useRef(null)
  useEffect(() => {
    if (activeId) {
      lastFocused.current = document.activeElement
      // 延一帧再聚焦，等动画开始、元素可见，否则会被浏览器忽略
      const t = window.setTimeout(() => panelRef.current?.focus(), 30)
      return () => window.clearTimeout(t)
    }
    // 关闭后把焦点还给原来的位置
    if (lastFocused.current && typeof lastFocused.current.focus === 'function') {
      lastFocused.current.focus()
    }
  }, [activeId])

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
  }, [])

  if (!artwork || !artwork.detail) return null

  const { detail } = artwork

  return (
    <div
      className={`detail ${closing ? 'detail--closing' : ''}`}
      // 点遮罩关闭。用 role="presentation" 是因为遮罩本身无交互语义，
      // 真正的可访问关闭入口是弹窗里的按钮。
      role="presentation"
      onPointerDown={(e) => {
        // 只在"按下的目标就是遮罩自己"时关闭。
        // 用 onPointerDown + target 判断，而不是 onClick —— onClick
        // 会在弹窗内按下、拖到遮罩上松手时也触发，误关。
        if (e.target === e.currentTarget) closeArtwork()
      }}
    >
      <div
        className="detail__panel"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`detail-title-${artwork.id}`}
        style={{ '--detail-accent': artwork.accent || 'var(--accent)' }}
      >
        {/* 卡纸左侧的「装订条」：纯装饰，呼应画框的墨线语言 */}
        <span className="detail__binding" aria-hidden="true" />

        {/* 右上角关闭按钮 */}
        <button type="button" className="detail__close" onClick={closeArtwork} aria-label="关闭详情">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M5 5 L19 19 M19 5 L5 19"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </button>

        <header className="detail__head">
          <p className="detail__eyebrow">素描长廊 · 第 {CORRIDOR_ARTWORKS.indexOf(artwork) + 1} 幅</p>
          <h2 className="detail__title" id={`detail-title-${artwork.id}`}>
            {artwork.title}
          </h2>
          <p className="detail__caption">{artwork.caption}</p>
        </header>

        <div className="detail__body">
          {detail.lead && <p className="detail__lead">{detail.lead}</p>}

          {detail.blocks?.map((block) => (
            <section className="detail__block" key={block.heading}>
              <h3 className="detail__heading">
                <span className="detail__headingRule" aria-hidden="true" />
                {block.heading}
              </h3>

              <ul className="detail__list">
                {block.items.map((item, i) =>
                  isLabeled(item) ? (
                    <li className="detail__item detail__item--labeled" key={`${item.label}-${i}`}>
                      <span className="detail__label">{item.label}</span>
                      <span className="detail__value">{item.value}</span>
                    </li>
                  ) : (
                    <li className="detail__item" key={i}>
                      {item}
                    </li>
                  ),
                )}
              </ul>
            </section>
          ))}
        </div>

        <footer className="detail__foot">
          <span className="detail__hintPress">
            按 <kbd>Esc</kbd> 或点击空白处关闭
          </span>
        </footer>
      </div>
    </div>
  )
}
