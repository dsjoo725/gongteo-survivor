import { StrictMode, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowRight, ArrowUpRight, ChevronLeft, Heart, Pause, Play, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { Stage, Button, Popover, type ButtonProps, type LookTokens } from './kit'
import combatPlate from './assets/moonlight-combat-revised.png'
import titlePlate from './assets/moonlight-title.png'
import './dream.css'

type Screen = 'title' | 'combat' | 'pause'
type Panel = 'pause' | 'stats' | 'settings' | 'restart'
const tokens: LookTokens = {
  '--ss-font': "'Pretendard', 'Malgun Gothic', sans-serif",
  '--ss-accent': '#f6edd3', '--ss-accent-text': '#244b53', '--ss-surface': '#244b53',
  '--ss-text-strong': '#f6edd3', '--ss-text': '#dce1cc', '--ss-text-faint': '#c8d6c8',
  '--ss-line': '#789c8e', '--ss-radius-sm': '14px', '--ss-radius-md': '18px',
  '--ss-radius-lg': '28px', '--ss-radius-pill': '999px', '--ss-success': '#89b7a8',
}

// Painted scene plates preserve the selected concept. UI remains native DOM.
function World({ combat = false }: { combat?: boolean }) {
  return <img className="dream-world" src={combat ? combatPlate : titlePlate} width={910} height={1728} alt="" aria-hidden="true" draggable={false} />
}
function sceneStyle(width: number, height: number): CSSProperties {
  return {
    '--scene-width': `${width}px`,
    '--scene-height': `${height}px`,
  } as CSSProperties
}
// Reuse the game's existing round foe silhouette for its kill counter.
function FoeMark() {
  return <svg width="18" height="18" viewBox="-19 -19 39 37" aria-hidden="true"><path d="M-14 6Q-17 0 -12 -6Q-13 -14 -5 -13Q1 -19 7 -13Q15 -14 15 -5Q20 2 15 8Q14 14 8 11Q2 16 -3 12Q-12 16 -14 6Z" fill="currentColor" /><g fill="#244b53"><ellipse cx="-4" cy="-2" rx="1.8" ry="2.4" /><ellipse cx="5" cy="-2" rx="1.8" ry="2.4" /></g></svg>
}
function Action({ children, onClick, variant = 'ghost', className = '', icon, trailingIcon, ...props }: ButtonProps) {
  // These labels are static. Keep their natural font width instead of measuring
  // them before the webfont loads through the kit's animated Roll label.
  return <Button variant={variant} size="large" className={`dream-action ${className}`} icon={icon} trailingIcon={trailingIcon} onClick={onClick} {...props}><span className="action-copy">{children}</span></Button>
}
function HUD({ onPause, inactive = false }: { onPause?: () => void; inactive?: boolean }) {
  return <div className="dream-hud" aria-hidden={inactive || undefined}>
    <Action className="pause-trigger" aria-label="일시정지 메뉴" onClick={onPause} onPointerDown={event => event.stopPropagation()} tabIndex={inactive ? -1 : undefined} data-target="pause"><Pause size={22} strokeWidth={0} fill="currentColor" aria-hidden="true" /></Action>
    <div className="hud-time" role="timer" aria-label="생존 시간"><strong>03:24</strong></div>
    <div className="hud-kills"><span><FoeMark />처치</span><strong>128</strong></div>
  </div>
}
function PlayerHealth() {
  return <div className="player-health"><div className="health-track" role="meter" aria-label="플레이어 체력" aria-valuemin={0} aria-valuemax={100} aria-valuenow={72}><span /></div><div className="health-copy"><Heart size={10} strokeWidth={2} aria-hidden="true" /><strong>72 <small>/ 100</small></strong></div></div>
}
function Joystick() {
  return <div className="dream-joystick" aria-hidden="true"><span /></div>
}
const statRows = [['최대 체력', '100'], ['공격력', '24'], ['공격 속도', '1.2 / 초'], ['이동 속도', '100%'], ['치명타 확률', '5%'], ['치명타 피해', '150%'], ['피해 감소', '0%'], ['흡혈', '0%']]
function PausePanel({ onResume, onTitle, active = false }: { onResume?: () => void; onTitle?: () => void; active?: boolean }) {
  const [panel, setPanel] = useState<Panel>('pause')
  const [reduced, setReduced] = useState(false)
  const back = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (panel === 'pause') onResume?.()
      else { setPanel('pause'); requestAnimationFrame(() => back.current?.focus()) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [panel, onResume, active])
  return <div className="pause-overlay">
    <Popover show origin="center" className="dream-pause-surface">
    <section className="dream-pause-panel" aria-label="일시정지 메뉴">
      <div className="pause-overline">일시정지</div>
      {panel === 'pause' ? <>
        <div className="pause-intro"><div className="pause-title">잠깐,<br />숨 고르기.</div>
        <div className="pause-subtitle">꿈은 여기서 기다릴게요.</div></div>
        <div className="pause-actions">
          <Action variant="primary" className="primary" onClick={onResume} trailingIcon={<Play size={16} strokeWidth={1.8} />}>계속하기</Action>
          <Action onClick={() => setPanel('stats')} trailingIcon={<ArrowUpRight size={16} strokeWidth={1.8} />}>플레이어 스탯</Action>
          <Action onClick={() => setPanel('settings')} trailingIcon={<SlidersHorizontal size={16} strokeWidth={1.8} />}>환경설정</Action>
          <Action onClick={() => setPanel('restart')} trailingIcon={<RotateCcw size={16} strokeWidth={1.8} />}>다시 시작</Action>
        </div>
        <div className="pause-foot"><span className="key-cap">ESC</span> 돌아가기</div>
      </> : <>
        <button type="button" ref={back} className="panel-back" onClick={() => setPanel('pause')}><ChevronLeft size={15} /> 돌아가기</button>
        <div className="subpanel-title">{panel === 'stats' ? '지금의 나' : panel === 'settings' ? '편안한 꿈' : '처음부터 다시?'}</div>
        {panel === 'stats' ? <dl className="stat-list">{statRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : panel === 'settings' ? <div className="settings-preview"><label><span>피격 효과 줄이기</span><input type="checkbox" checked={reduced} onChange={e => setReduced(e.target.checked)} /></label><p>이 시안에서만 설정을 미리 봅니다.</p></div> : <><p className="restart-copy">지금의 기록을 내려놓고<br />꿈의 입구로 돌아갑니다.</p><Action variant="primary" className="primary" onClick={onTitle}>처음으로</Action></>}
      </>}
    </section>
    </Popover>
  </div>
}
function usePreviewViewport(enabled: boolean) {
  const [size, setSize] = useState({ width: 360, height: 640 })
  useLayoutEffect(() => {
    if (!enabled) return
    const pointer = window.matchMedia('(pointer: coarse)')
    const measure = () => {
      const height = Math.round(window.visualViewport?.height ?? innerHeight)
      const width = pointer.matches || innerWidth <= 600 ? innerWidth : Math.min(innerWidth, Math.round(height * 9 / 16))
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height })
    }
    measure()
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    pointer.addEventListener('change', measure)
    return () => {
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
      pointer.removeEventListener('change', measure)
    }
  }, [enabled])
  return size
}
function DreamScreen({ screen, onScreen, live = false, fullViewport = false }: { screen: Screen; onScreen?: (s: Screen) => void; live?: boolean; fullViewport?: boolean }) {
  const [titleSettings, setTitleSettings] = useState(false)
  const viewport = usePreviewViewport(fullViewport)
  return <Stage width={fullViewport ? viewport.width : 360} height={fullViewport ? viewport.height : 640} compact={fullViewport ? undefined : { below: 350, width: 288, height: 640 }} fidelity="realistic" tokens={tokens} className={`dream-stage dream-${screen}${fullViewport ? ' full-viewport' : ''}`}>
    {(_state, _rect, layout) => <div className="dream-screen" style={sceneStyle(fullViewport ? viewport.width : layout === 'compact' ? 288 : 360, fullViewport ? viewport.height : 640)} data-screen={screen} aria-label={screen === 'title' ? '타이틀 화면' : screen === 'combat' ? '전투 HUD 시안' : '일시정지 화면'}>
      <World combat={screen !== 'title'} />
      {screen === 'title' ? <>
        <div className="title-content"><div className="title-overline">STILL ASLEEP</div><div className="game-title">아직, 꿈<span className="title-dot">.</span></div><div className="title-subtitle">익숙한데, 처음 오는 곳.</div></div>
        <div className="title-actions"><Action variant="primary" className="primary enter-dream" onClick={() => onScreen?.('combat')} trailingIcon={<ArrowRight size={16} strokeWidth={1.8} />}>꿈으로 들어가기</Action><Action onClick={() => setTitleSettings(true)}>환경설정</Action></div>
        <div className="title-bottom">화살표 · 드래그로 이동</div>
        {titleSettings && <div className="pause-overlay"><div className="dream-pause-panel title-settings"><div className="pause-overline">SETTINGS</div><div className="subpanel-title">편안한 꿈</div><div className="settings-preview"><label><span>피격 효과 줄이기</span><input type="checkbox" defaultChecked={false} /></label><p>설정 화면의 시각 시안입니다.</p></div><Action className="primary" variant="primary" onClick={() => setTitleSettings(false)}>돌아가기</Action></div></div>}
      </> : <>
        <HUD onPause={() => onScreen?.('pause')} inactive={screen === 'pause'} />
        <PlayerHealth />

        <Joystick />
        {screen === 'pause' && <PausePanel active={live} onResume={() => onScreen?.('combat')} onTitle={() => onScreen?.('title')} />}
      </>}

    </div>}
  </Stage>
}

const screenInfo: { id: Screen; number: string; title: string; description: string }[] = [
  { id: 'title', number: '01', title: '꿈의 입구', description: '익숙한 물건, 어긋난 크기. 문 너머에 다른 하늘.' },
  { id: 'combat', number: '02', title: '꿈속의 공터', description: '달빛의 크림색 정보 · 붓결의 회분홍 정지 표시.' },
  { id: 'pause', number: '03', title: '잠깐의 쉼', description: '청록빛에 잠시 멈춰, 크림색 버튼으로 돌아가기.' },
]
function App() {
  const params = new URLSearchParams(location.search)
  const solo = params.get('screen') as Screen | null
  const [preview, setPreview] = useState<Screen | null>(null)
  const openButton = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (preview) dialog.current?.showModal()
    else if (dialog.current?.open) { dialog.current.close(); openButton.current?.focus() }
  }, [!!preview])
  useEffect(() => {
    if (!preview) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && preview === 'combat') { event.preventDefault(); setPreview('pause') } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [preview])
  if (solo && ['title', 'combat', 'pause'].includes(solo)) return <main className="solo-screen"><DreamScreen screen={solo} onScreen={s => location.search = `?screen=${s}`} live fullViewport /></main>
  return <main className="concept-page">
    <header className="concept-header"><div className="study-label"><span className="study-line" />DREAM STUDY — 07<span className="study-date">2026.11.05</span></div><div className="header-main"><div><h1>익숙한데, 조금 다른 꿈.</h1><p>가제 ‘아직, 꿈’ · 선택한 3안 · 달빛의 공터 · 모바일 우선 HUD</p></div><button type="button" ref={openButton} className="open-preview" onClick={() => setPreview('title')}>화면 눌러보기 <ArrowUpRight size={16} strokeWidth={1.8} /></button></div></header>
    <section className="screen-grid" aria-label="꿈속 콘셉트 화면 3종">
      {screenInfo.map(({ id, number, title, description }) => <figure className="screen-figure" key={id}><figcaption><span className="screen-number">{number}</span><strong>{title}</strong><span className="screen-type">{id === 'title' ? 'TITLE' : id === 'combat' ? 'IN GAME' : 'PAUSE'}</span></figcaption><DreamScreen screen={id} onScreen={setPreview} /><p className="screen-description">{description}</p></figure>)}
    </section>
    <footer className="concept-footer"><div className="concept-idea"><span className="footer-label">VISUAL DIRECTION</span><p>몽글몽글한 꿈에,<br /><strong>조금은 낯선 친구들.</strong></p></div><div className="palette-block"><span className="footer-label">PALETTE</span><div className="palette"><span style={{ '--swatch': '#f4ecd2' } as CSSProperties}>달빛</span><span style={{ '--swatch': '#719d96' } as CSSProperties}>풀빛</span><span style={{ '--swatch': '#bf8984' } as CSSProperties}>기억</span><span style={{ '--swatch': '#244b53' } as CSSProperties}>밤빛</span><span style={{ '--swatch': '#b36b5e' } as CSSProperties}>위험</span></div></div><p className="footer-note">CONCEPT PROPOSAL · V0.7<br />화면·명칭·수치는 검토용 시안입니다.</p></footer>
    <dialog ref={dialog} className="preview-dialog" aria-label="꿈속 화면 미리보기" onCancel={e => { e.preventDefault(); if (preview === 'combat') setPreview('pause'); else if (preview !== 'pause') setPreview(null) }}>
      <div className="preview-toolbar"><span>시안 미리보기</span><button type="button" onClick={() => setPreview(null)} aria-label="미리보기 닫기"><X size={18} /></button></div>
      {preview && <DreamScreen screen={preview} onScreen={setPreview} live />}
      <div className="preview-switches">{screenInfo.map(({ id, title }) => <button type="button" key={id} aria-pressed={preview === id} onClick={() => setPreview(id)}>{title}</button>)}</div>
    </dialog>
  </main>
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
