import { createRoot } from 'react-dom/client'
import { useEffect, useId, useState, type CSSProperties } from 'react'
import { Card } from '../kit/parts/Card'
import { Stage } from '../kit/stage'
import { experienceOutline, LEVEL_CAP_WIDTH, STAR_HIGHLIGHT, STAR_PATH, upgradePicture } from '../../../src/growth-visuals'
import './preview.css'

const backgrounds = {
  320: new URL('../../../artifacts/moonlight-growth-base-320.png', import.meta.url).href,
  390: new URL('../../../artifacts/moonlight-growth-base-390.png', import.meta.url).href,
}
const cards = [
  { name: '공격력', description: ['한 발이 더', '강해집니다.'], rank: 3, picture: 'attack' },
  { name: '이동 속도', description: ['더 빠르게', '움직입니다.'], rank: 1, picture: 'move' },
  { name: '치명타 피해', description: ['치명타가 더', '강해집니다.'], rank: 5, picture: 'burst' },
] as const
type View = 'combat' | 'choice'
type Width = keyof typeof backgrounds
const heights = { 320: 568, 390: 844 }
const tokens = { '--ss-font': 'Pretendard Preview, sans-serif', '--ss-surface': '#f3e7cb', '--ss-radius-lg': '16px', '--ss-line': 'transparent' }

function RankStars({ rank }: { rank: number }) {
  return <span className="growth-shard-stars" role="img" aria-label={`현재 ${rank - 1}단계, 선택하면 ${rank}단계`}>
    {Array.from({ length: 5 }, (_, index) => (
      <svg key={index} className="growth-rank-star" data-state={index < rank - 1 ? 'owned' : index === rank - 1 ? 'next' : 'empty'} viewBox="0 0 20 20" aria-hidden="true">
        <path className="growth-rank-shape" d={STAR_PATH} />
        {index === rank - 1 && <path className="growth-rank-light" d={STAR_HIGHLIGHT} />}
      </svg>
    ))}
  </span>
}

function ExperiencePreview({ width, level, progress }: { width: Width; level: number; progress: number }) {
  const gold = useId()
  const span = width - 24
  const end = span - LEVEL_CAP_WIDTH
  return <div className="growth-xp" role="progressbar" aria-label={`레벨 ${level} 경험치`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
    <svg viewBox={`0 0 ${span} 23`} aria-hidden="true">
      <defs><linearGradient id={gold} x2="0" y2="1">
        <stop stopColor="#f6dc9e" />
        <stop offset="1" stopColor="#d3a852" />
      </linearGradient></defs>
      <path className="growth-xp-outline" d={experienceOutline(span)} />
      <rect className="growth-xp-fill" x={1.75} y={8} width={(end - 0.75) * progress / 100} height={7} rx={3.5} fill={`url(#${gold})`} />
      <text className="growth-level" x={span - 13} y={12} textAnchor="middle" dominantBaseline="central">{level}</text>
    </svg>
  </div>
}

function GameStill({ view, width }: { view: View; width: Width }) {
  const choice = view === 'choice'
  const progress = choice ? 12 : 68
  const level = choice ? 9 : 8
  return (
    <section className="growth-game" data-view={view} data-width={width} aria-label={choice ? '강화 선택 시안' : '전투 시안'}>
      <img className="growth-game-photo" src={backgrounds[width]} alt="" />
      <ExperiencePreview width={width} level={level} progress={progress} />
      {choice && <div className="growth-choice">
        <div className="growth-choice-title">능력 선택</div>
        <div className="growth-choice-cards">
          {cards.map(card => <Card key={card.picture} className="growth-shard" pad="small" gap={8}>
            <strong>{card.name}</strong>
            <span className="growth-shard-art" aria-hidden="true">
              <span className="growth-shard-painting" style={upgradePicture(card.picture).variables as CSSProperties} />
            </span>
            <p>{card.description.map(line => <span key={line}>{line}</span>)}</p>
            <RankStars rank={card.rank} />
          </Card>)}
        </div>
      </div>}
    </section>
  )
}

function StripStill({ width, progress }: { width: Width; progress: number }) {
  return <section className="growth-game strip-scene" data-width={width} aria-label="달빛이 스민 띠 전투 시안">
    <img className="growth-game-photo" src={backgrounds[width]} alt="" />
    <div className="strip-sky" aria-hidden="true" />
    <div className="strip-meter" role="progressbar" aria-label="레벨 8 경험치" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
      <div className="strip-channel"><i style={{ '--strip-progress': `${progress}%` } as CSSProperties} /></div>
      <span className="strip-level">8</span>
    </div>
  </section>
}

function StripStudy() {
  return <Stage width={992} height={258} compact={{ below: 740, width: 320, height: 690 }} className="growth-stage" tokens={tokens} fidelity="realistic">
    {(_state, _rect, layout) => <div className="strip-study-board" data-layout={layout}>
      <div className="strip-study-title">달빛이 스민 띠</div>
      {[20, 50, 90].map(progress => <figure key={progress}>
        <figcaption>{progress}% 충전</figcaption>
        <div className="strip-crop"><StripStill width={320} progress={progress} /></div>
      </figure>)}
    </div>}
  </Stage>
}

function Preview() {
  const query = new URLSearchParams(location.search)
  const width = query.get('size') === '320' ? 320 : 390
  const requested = query.get('view')
  const [view, setView] = useState<View>(requested === 'choice' ? 'choice' : 'combat')
  const [compactWidth, setCompactWidth] = useState<Width>(() => matchMedia('(max-width: 350px)').matches ? 320 : 390)
  useEffect(() => {
    const narrow = matchMedia('(max-width: 350px)')
    const update = () => setCompactWidth(narrow.matches ? 320 : 390)
    narrow.addEventListener('change', update)
    return () => narrow.removeEventListener('change', update)
  }, [])
  if (requested === 'strip-study') return <StripStudy />
  if (requested === 'strip') {
    const progress = Number(query.get('progress') ?? 50)
    const stripWidth = query.has('size') ? width : compactWidth
    const fill = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 50
    return <Stage width={stripWidth} height={heights[stripWidth]} className="growth-stage" tokens={tokens} fidelity="realistic">
      {() => <StripStill width={stripWidth} progress={fill} />}
    </Stage>
  }
  if (requested === 'combat' || requested === 'choice') return <Stage width={width} height={heights[width]} className="growth-stage" tokens={tokens} fidelity="realistic">
    {() => <GameStill width={width} view={view} />}
  </Stage>
  return <>
    <nav className="growth-views" aria-label="시안 화면">
      <button type="button" aria-pressed={view === 'combat'} onClick={() => setView('combat')}>전투</button>
      <button type="button" aria-pressed={view === 'choice'} onClick={() => setView('choice')}>강화 선택</button>
    </nav>
    <Stage width={824} height={906} compact={{ below: 700, width: compactWidth, height: heights[compactWidth] }} className="growth-stage" tokens={tokens} fidelity="realistic">
      {(_state, _rect, layout) => layout === 'compact' ? <GameStill width={compactWidth} view={view} /> : (
        <div className="growth-board">
          <div className="growth-board-heading">달빛 성장 시안</div>
          <figure><figcaption>전투 · 경험치 충전</figcaption><GameStill width={390} view="combat" /></figure>
          <figure><figcaption>레벨업 · 능력 선택</figcaption><GameStill width={390} view="choice" /></figure>
        </div>
      )}
    </Stage>
  </>
}

const root = document.getElementById('growth-preview')!
root.dataset.preview = new URLSearchParams(location.search).get('view') ?? ''
createRoot(root).render(<Preview />)
