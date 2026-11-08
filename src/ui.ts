import { formatStat } from './stats';
import { TICKS_PER_SECOND } from './simulation';

type Page = 'menu' | 'stats' | 'settings' | 'restart';
interface Actions {
  pause(paused: boolean): void;
  restart(): void;
  effects(reduced: boolean): void;
}
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const SETTINGS_KEY = 'gongteo-survivor.settings.v1';

export class GameUI {
  private readonly listeners = new AbortController();
  private readonly dialog = element<HTMLDialogElement>('menu-dialog');
  private readonly menu = element<HTMLButtonElement>('menu-button');
  private readonly back = element<HTMLButtonElement>('menu-back');
  private readonly fullScreen = element<HTMLButtonElement>('fullscreen-button');
  private readonly reduced = element<HTMLInputElement>('reduced-effects');
  private readonly status = element('settings-status');
  private page: Page = 'menu';
  private ended = false;
  private growthBlocked = false;
  private titleMode = false;
  private returnToTitle = false;
  private tick = 0;
  private kills = 0;

  constructor(private readonly actions: Actions) {
    const { signal } = this.listeners;
    let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
      if (typeof saved?.reducedEffects === 'boolean') reduced = saved.reducedEffects;
    } catch { /* Browser settings may be unavailable. Keep a usable session. */ }
    this.reduced.checked = reduced;
    actions.effects(reduced);
    this.reduced.addEventListener('change', () => {
      actions.effects(this.reduced.checked);
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ reducedEffects: this.reduced.checked }));
        this.status.textContent = '';
      } catch {
        this.status.textContent = '이번 게임에 적용했습니다. 이 브라우저에서는 설정을 저장할 수 없습니다.';
      }
    }, { signal });
    this.menu.addEventListener('click', () => this.open(), { signal });
    element('title-settings').addEventListener('click', () => {
      if (!this.titleMode || this.dialog.open) return;
      this.returnToTitle = true;
      this.actions.pause(true);
      this.dialog.showModal();
      this.show('settings');
    }, { signal });
    element('menu-close').addEventListener('click', () => this.close(), { signal });
    this.dialog.addEventListener('click', event => {
      const action = (event.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'resume') this.close();
      else if (action === 'back') this.goBack();
      else if (action === 'confirm-restart') {
        this.close(false);
        this.actions.restart();
      } else if (action === 'stats' || action === 'settings' || action === 'restart') this.show(action);
    }, { signal });
    this.dialog.addEventListener('cancel', event => {
      event.preventDefault();
      this.goBack();
    }, { signal });
    this.dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(this.dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'))
        .filter(control => control.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }, { signal });
    window.addEventListener('keydown', event => {
      if (this.growthBlocked) return;
      if (this.ended && event.key === 'Tab') {
        event.preventDefault();
        element('restart').focus();
      }
      if (event.key !== 'Escape' || event.repeat) return;
      if (this.titleMode && !this.dialog.open) return;
      event.preventDefault();
      if (this.dialog.open) this.goBack();
      else this.open();
    }, { signal });
    this.fullScreen.addEventListener('click', () => { void this.toggleFullscreen(); }, { signal });
    document.addEventListener('fullscreenchange', () => this.syncFullscreen(), { signal });
    this.syncFullscreen();
    this.menu.disabled = false;
    element('game').inert = false;
    element('combat-hud').inert = false;
  }

  open(): void {
    if (this.titleMode || this.ended || this.growthBlocked || this.dialog.open) return;
    this.actions.pause(true);
    this.dialog.showModal();
    this.menu.setAttribute('aria-expanded', 'true');
    element('control-hint').hidden = true;
    this.show('menu');
  }

  private goBack(): void {
    if (this.returnToTitle || this.page === 'menu') this.close();
    else this.show('menu');
  }

  private show(page: Page): void {
    const previous = this.page;
    this.page = page;
    this.dialog.dataset.page = page;
    for (const section of this.dialog.querySelectorAll<HTMLElement>('[data-page]')) {
      section.hidden = section.dataset.page !== page;
    }
    element('menu-title').textContent = { menu: '일시 정지', stats: '플레이어 스탯', settings: '환경설정', restart: '다시 시작' }[page];
    element('menu-subtitle').textContent = page === 'menu'
      ? `생존 ${this.time()} · 처치 ${this.kills}`
      : { stats: '이번 게임에 적용된 능력치입니다.', settings: '플레이하기 편하게 조절하세요.', restart: '새 게임을 시작합니다.' }[page];
    this.back.hidden = page === 'menu' || page === 'restart';
    this.back.textContent = this.returnToTitle ? '타이틀로 돌아가기' : '메뉴로 돌아가기';
    this.dialog.querySelector('.dialog-body')!.scrollTop = 0;
    const target = page === 'menu'
      ? this.dialog.querySelector<HTMLButtonElement>(`[data-action="${previous === 'menu' ? 'resume' : previous}"]`)
      : page === 'stats' ? this.back
      : page === 'restart' ? this.dialog.querySelector<HTMLButtonElement>('[data-page="restart"] [data-action="back"]')
      : this.fullScreen.disabled ? this.reduced : this.fullScreen;
    target?.focus({ preventScroll: true });
  }

  private close(resume = true): void {
    if (!this.dialog.open) return;
    this.dialog.close();
    this.menu.setAttribute('aria-expanded', 'false');
    if (resume) {
      this.actions.pause(false);
      (this.returnToTitle ? element('title-settings') : this.menu).focus({ preventScroll: true });
    }
    this.returnToTitle = false;
  }

  private syncFullscreen(): void {
    this.fullScreen.disabled = !document.fullscreenEnabled;
    this.fullScreen.textContent = !document.fullscreenEnabled ? '지원 안 됨' : document.fullscreenElement ? '끄기' : '켜기';
    this.fullScreen.setAttribute('aria-label', document.fullscreenElement ? '전체 화면 끄기' : '전체 화면 켜기');
    this.fullScreen.setAttribute('aria-pressed', String(!!document.fullscreenElement));
  }

  private async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      this.status.textContent = '';
    } catch {
      this.status.textContent = '전체 화면을 열 수 없습니다. 현재 화면에서 계속 플레이할 수 있습니다.';
    }
    this.syncFullscreen();
  }

  private time(): string {
    const seconds = Math.floor(this.tick / TICKS_PER_SECOND);
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  update(hp: number, maxHp: number, kills: number, tick: number): void {
    this.tick = tick;
    this.kills = kills;
    element('health').textContent = `${formatStat(hp)} / ${formatStat(maxHp)}`;
    element('kills').textContent = String(kills);
    const ratio = Math.max(0, Math.min(1, hp / maxHp));
    element('health-fill').style.width = `${ratio * 100}%`;
    element('health-panel').dataset.critical = String(ratio <= 1 / 3);
    const meter = element('health-meter');
    meter.setAttribute('aria-valuenow', String(Math.min(maxHp, Math.max(0, hp))));
    meter.setAttribute('aria-valuemax', String(maxHp));
    element('run-time').textContent = this.time();
    element('control-hint').hidden = this.titleMode || tick >= 300 || this.dialog.open || this.ended;
  }

  setTitle(active: boolean): void {
    this.titleMode = active;
    element('title-screen').hidden = !active;
    document.querySelector<HTMLElement>('.game-shell')!.dataset.phase = active ? 'title' : 'playing';
    element('game').inert = active;
    element('combat-hud').inert = active;
    this.menu.disabled = active;
    (element('title-start') as HTMLButtonElement).disabled = false;
    (element('title-settings') as HTMLButtonElement).disabled = false;
    if (active) element('title-start').focus({ preventScroll: true });
  }

  setGrowthBlocked(blocked: boolean): void {
    this.growthBlocked = blocked;
    this.menu.disabled = blocked || this.ended || this.titleMode;
  }

  positionHealth(x: number, below: number, above: number, width: number, height: number): void {
    const panel = element('health-panel');
    const barWidth = panel.offsetWidth || 42;
    const barHeight = panel.offsetHeight || 8;
    panel.style.left = `${Math.max(barWidth / 2 + 3, Math.min(width - barWidth / 2 - 3, x))}px`;
    const top = below + barHeight <= height - 3 ? below : above - barHeight;
    panel.style.top = `${Math.max(3, Math.min(height - barHeight - 3, top))}px`;
    panel.dataset.placement = top === below ? 'below' : 'above';
  }

  end(): void {
    this.ended = true;
    document.querySelector<HTMLElement>('.game-shell')!.dataset.phase = 'results';
    this.close(false);
    this.menu.disabled = true;
    element('game').inert = true;
    element('combat-hud').inert = true;
    element('control-hint').hidden = true;
  }

  destroy(): void {
    this.listeners.abort();
    this.close(false);
  }
}
