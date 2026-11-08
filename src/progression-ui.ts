import { MAX_UPGRADE_RANK, type Progression, type UpgradeChoice, type UpgradeId } from './progression';
import { STAR_HIGHLIGHT, STAR_PATH, upgradePicture } from './growth-visuals';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const LEVEL_FILL_MS = 140;

export class ProgressionUI {
  private readonly listeners = new AbortController();
  private readonly dialog = element<HTMLDialogElement>('level-up-dialog');
  private readonly cards = element('upgrade-choices');
  private readonly hint = element('growth-resume-hint');
  private readonly fill = element('experience-fill');
  private readonly levelLabel = element('player-level');
  private readonly systemReduced = matchMedia('(prefers-reduced-motion: reduce)');
  private lastLevel: number | undefined;
  private lastPercent = 0;
  private levelFill?: Animation;
  private token = 0;
  private offered: readonly UpgradeChoice[] = [];

  constructor(private readonly choose: (token: number, id: UpgradeId) => void, private readonly reducedEffects: () => boolean) {
    const { signal } = this.listeners;
    this.dialog.addEventListener('cancel', event => event.preventDefault(), { signal });
    this.cards.addEventListener('click', event => {
      if ((event as MouseEvent).detail > 1) return;
      const button = (event.target as Element).closest<HTMLButtonElement>('button[data-upgrade]');
      if (!button || button.disabled) return;
      this.choose(Number(button.dataset.offer), button.dataset.upgrade as UpgradeId);
    }, { signal });
    this.dialog.addEventListener('keydown', event => {
      if (event.repeat) return;
      const index = Number(event.key) - 1;
      if (['1', '2', '3'].includes(event.key) && this.offered[index]) {
        event.preventDefault();
        this.choose(this.token, this.offered[index].id);
      }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(this.cards.querySelectorAll<HTMLButtonElement>('button'));
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }, { signal });
  }

  show(progression: Progression): void {
    if (this.dialog.open && this.token === progression.offerId) return;
    this.token = progression.offerId;
    this.offered = progression.choices;
    this.hint.hidden = true;
    element('upgrade-level').textContent = `레벨 ${progression.rewardLevel}`;
    element('upgrade-subtitle').textContent = '강화 하나를 선택하세요';
    this.cards.replaceChildren();
    for (const choice of this.offered) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'upgrade-card';
      button.dataset.upgrade = choice.id;
      button.dataset.offer = String(this.token);
      button.setAttribute('aria-label', `${choice.name}, 현재 ${choice.rank - 1}단계, 선택하면 ${choice.rank}단계. ${choice.description}`);
      const icon = document.createElement('span');
      icon.className = 'upgrade-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.dataset.picture = choice.symbol;
      const picture = upgradePicture(choice.symbol);
      const painting = document.createElement('span');
      painting.className = 'upgrade-painting';
      painting.dataset.atlas = picture.atlas;
      for (const [name, value] of Object.entries(picture.variables)) painting.style.setProperty(name, String(value));
      icon.append(painting);
      const title = document.createElement('strong'); title.textContent = choice.name;
      const stars = document.createElement('span'); stars.className = 'upgrade-stars';
      stars.setAttribute('aria-hidden', 'true');
      stars.innerHTML = Array.from({ length: MAX_UPGRADE_RANK }, (_, index) => {
        const state = index < choice.rank - 1 ? 'owned' : index === choice.rank - 1 ? 'next' : 'empty';
        const highlight = state === 'next' ? `<path class="rank-highlight" d="${STAR_HIGHLIGHT}"/>` : '';
        return `<svg class="upgrade-star" data-state="${state}" viewBox="0 0 20 20"><path class="rank-shape" d="${STAR_PATH}"/>${highlight}</svg>`;
      }).join('');
      const description = document.createElement('span'); description.className = 'upgrade-description'; description.textContent = choice.description;
      button.append(title, icon, description, stars);
      this.cards.append(button);
    }
    this.cards.dataset.count = String(this.offered.length);
    if (!this.dialog.open) {
      this.dialog.dataset.motion = this.motionReduced() ? 'off' : 'on';
      this.dialog.showModal();
    }
    this.cards.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }

  close(awaitInput = false): void {
    if (this.dialog.open) this.dialog.close();
    this.offered = [];
    this.hint.hidden = !awaitInput;
    if (awaitInput) {
      const canvas = document.querySelector<HTMLCanvasElement>('#game canvas');
      if (canvas) { canvas.tabIndex = -1; canvas.focus({ preventScroll: true }); }
    }
  }

  update(progression: Progression, awaitingInput: boolean): void {
    const level = progression.level;
    const percent = progression.complete ? 100 : progression.xp / progression.nextXp * 100;
    const previousLevel = this.lastLevel;
    const previousPercent = this.lastPercent;
    this.lastLevel = level;
    this.lastPercent = percent;
    this.fill.style.width = `${percent}%`;
    this.levelLabel.setAttribute('aria-label', `플레이어 레벨 ${level}`);
    const animate = !this.motionReduced() && progression.pending > 0 && !progression.complete;
    if (!animate || (previousLevel !== undefined && level < previousLevel)) {
      this.levelFill?.cancel();
      this.levelFill = undefined;
    } else if (previousLevel !== undefined && level > previousLevel && typeof this.fill.animate === 'function') {
      this.levelFill?.cancel();
      this.levelLabel.textContent = String(previousLevel);
      const animation = this.fill.animate([{ width: `${previousPercent}%` }, { width: '100%' }], {
        duration: LEVEL_FILL_MS, easing: 'ease-out',
      });
      this.levelFill = animation;
      animation.onfinish = () => {
        if (this.levelFill !== animation) return;
        this.levelFill = undefined;
        this.levelLabel.textContent = String(this.lastLevel);
      };
    }
    if (!this.levelFill) this.levelLabel.textContent = String(level);
    element('experience-copy').textContent = progression.complete ? '모든 강화 완료' : `${progression.xp} / ${progression.nextXp}`;
    const meter = element('experience-meter');
    meter.setAttribute('aria-valuenow', String(progression.complete ? progression.nextXp : progression.xp));
    meter.setAttribute('aria-valuemax', String(progression.nextXp));
    this.hint.hidden = !awaitingInput;
  }

  private motionReduced(): boolean { return this.systemReduced.matches || this.reducedEffects(); }

  destroy(): void {
    this.levelFill?.cancel();
    this.levelFill = undefined;
    this.listeners.abort();
    this.close();
  }
}
