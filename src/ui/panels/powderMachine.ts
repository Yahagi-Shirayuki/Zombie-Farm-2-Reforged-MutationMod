import type { Hud } from "../../hud";
import { BASE } from "../../base";
import { UI } from "../uiAsset";
import {
  GRIND_CRYSTAL_CAPACITY,
  GRIND_TIME_PER_CRYSTAL,
  POWDER_COLORS,
  POWDER_PER_CRYSTAL_MAX,
  POWDER_PER_CRYSTAL_MIN,
  POWDER_STORAGE_DISPLAY,
  totalPowderCount,
  type PowderColor,
} from "../../powderMachine";

type GrindSelection = Record<PowderColor, number>;
let activeStop: (() => void) | null = null;

function tintOverlay(src: string, tint: number): HTMLElement {
  const overlay = document.createElement("span");
  overlay.className = "pwm-color";
  overlay.style.backgroundColor = `#${tint.toString(16).padStart(6, "0")}`;
  overlay.style.mask = `url("${src}") center / contain no-repeat`;
  overlay.style.webkitMask = `url("${src}") center / contain no-repeat`;
  return overlay;
}

function countBadge(count: number): HTMLElement {
  const badge = document.createElement("div");
  badge.className = "pwm-count";
  const tab = document.createElement("img");
  tab.src = `${BASE}assets/ui/market/tab.png`;
  tab.alt = "";
  const value = document.createElement("span");
  value.textContent = `${count}`;
  badge.append(tab, value);
  return badge;
}

function formatGrindTime(totalCrystals: number): string {
  const minutes = Math.round((totalCrystals * GRIND_TIME_PER_CRYSTAL) / 60_000);
  if (minutes <= 0) return "0 minutes";
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours} hour${hours === 1 ? "" : "s"}`;
}

function formatCountdown(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function crystalSlot(name: string, tint: number, count: number): HTMLElement {
  const slot = document.createElement("div");
  slot.className = "pwm-item";
  const icon = document.createElement("div");
  icon.className = "pwm-icon";
  const crystalSrc = `${BASE}assets/ui/storage/powder_crystal.png`;
  const crystal = document.createElement("img");
  crystal.className = "pwm-crystal";
  crystal.src = crystalSrc;
  crystal.alt = "";
  const color = tintOverlay(crystalSrc, tint);
  color.classList.add("pwm-crystal-color");
  icon.append(crystal, color, countBadge(count));
  const label = document.createElement("div");
  label.className = "pwm-name";
  label.textContent = `${name} Crystal`;
  slot.append(icon, label);
  return slot;
}

function powderSlot(name: string, tint: number, count: number): HTMLElement {
  const slot = document.createElement("div");
  slot.className = "pwm-item";
  const icon = document.createElement("div");
  icon.className = "pwm-icon";
  const bag = document.createElement("img");
  bag.className = "pwm-bag";
  bag.src = `${BASE}assets/ui/storage/powder_bag.png`;
  bag.alt = "";
  const powderSrc = `${BASE}assets/ui/storage/powder.png`;
  const powder = document.createElement("img");
  powder.className = "pwm-powder";
  powder.src = powderSrc;
  powder.alt = "";
  const color = tintOverlay(powderSrc, tint);
  color.classList.add("pwm-powder-color");
  icon.append(bag, powder, color, countBadge(count));
  const label = document.createElement("div");
  label.className = "pwm-name";
  label.textContent = `${name} Powder`;
  slot.append(icon, label);
  return slot;
}

function grindArrow(flipped: boolean, disabled: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "pwm-arrow" + (flipped ? " flip" : "") + (disabled ? " disabled" : "");
  button.type = "button";
  button.disabled = disabled;
  const icon = document.createElement("img");
  icon.src = `${BASE}assets/ui/market/arrow_right.png`;
  icon.alt = flipped ? "Decrease" : "Increase";
  button.appendChild(icon);
  button.onclick = onClick;
  return button;
}

function grindCrystalSlot(
  name: string,
  tint: number,
  count: number,
  canIncrease: boolean,
  onDecrease: () => void,
  onIncrease: () => void
): HTMLElement {
  const slot = document.createElement("div");
  slot.className = "pwm-grind-item";
  const icon = document.createElement("div");
  icon.className = "pwm-icon pwm-grind-icon";
  const crystalSrc = `${BASE}assets/ui/storage/powder_crystal.png`;
  const crystal = document.createElement("img");
  crystal.className = "pwm-crystal";
  crystal.src = crystalSrc;
  crystal.alt = "";
  const color = tintOverlay(crystalSrc, tint);
  color.classList.add("pwm-crystal-color");
  icon.append(crystal, color);

  const label = document.createElement("div");
  label.className = "pwm-name";
  label.textContent = `${name} Crystal`;

  const controls = document.createElement("div");
  controls.className = "pwm-grind-controls";
  controls.append(
    grindArrow(true, count <= 0, onDecrease),
    countBadge(count),
    grindArrow(false, !canIncrease, onIncrease)
  );
  slot.append(icon, label, controls);
  return slot;
}

export function openPowderMachine(hud: Hud, machineId: string): void {
  activeStop?.();
  document.querySelector("#hud .pwm-bg")?.remove();
  const bg = document.createElement("div");
  bg.className = "panelbg pwm-bg";
  const panel = document.createElement("div");
  panel.className = "panel pwm-panel";
  const close = document.createElement("button");
  close.className = "panelclose";
  const closeIcon = document.createElement("img");
  closeIcon.src = UI("button_close.png");
  close.appendChild(closeIcon);
  close.onclick = () => { stop(); bg.remove(); };

  const wrap = document.createElement("div");
  wrap.className = "pwm";
  const head = document.createElement("div");
  head.className = "cmb-head";
  head.innerHTML = `<h2>Powder Machine</h2>`;
  const tabs = document.createElement("div");
  tabs.className = "pwm-tabs";
  const body = document.createElement("div");
  body.className = "pwm-body";
  let tab: "Grinds" | "Storage" = "Grinds";
  const grindSelection: GrindSelection = { black: 0, green: 0, blue: 0, red: 0, white: 0 };
  let timer: number | undefined;
  const stop = () => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    if (activeStop === stop) activeStop = null;
  };
  activeStop = stop;

  const grindTotal = () => Object.values(grindSelection).reduce((sum, value) => sum + value, 0);

  const changeGrindCount = (color: PowderColor, delta: number) => {
    const total = grindTotal();
    if (delta > 0 && total >= GRIND_CRYSTAL_CAPACITY) return;
    const next = Math.max(0, grindSelection[color] + delta);
    if (next === grindSelection[color]) return;
    grindSelection[color] = next;
    hud.audio.play("menuClick");
    render();
  };

  const renderBusy = () => {
    const status = hud.getPowderGrindStatus?.(machineId);
    if (!status?.busy) return false;
    const totalCrystals = totalPowderCount(status.pending?.crystals);
    const view = document.createElement("div");
    view.className = "pwm-grind-busy";

    const summary = document.createElement("div");
    summary.className = "pwm-grind-summary";
    const time = document.createElement("div");
    time.className = "pwm-grind-stat";
    const output = document.createElement("div");
    output.className = "pwm-grind-stat";
    output.innerHTML = `<span>Expected Output:</span><strong>${totalCrystals * POWDER_PER_CRYSTAL_MIN}-${totalCrystals * POWDER_PER_CRYSTAL_MAX}</strong>`;
    const bar = document.createElement("div");
    bar.className = "cmb-prog pwm-prog";
    const fill = document.createElement("i");
    bar.appendChild(fill);
    const note = document.createElement("div");
    note.className = "cmb-note";
    const collect = document.createElement("button");
    collect.className = "pwm-start";
    collect.type = "button";
    collect.textContent = "Collect Powder";
    collect.onclick = () => {
      collect.disabled = true;
      if (hud.onCollectPowderGrind?.(machineId)) {
        hud.audio.play("menuClick");
        render();
      }
    };
    summary.append(time, output, bar, note, collect);
    view.appendChild(summary);
    body.appendChild(view);

    const tick = () => {
      const current = hud.getPowderGrindStatus?.(machineId);
      if (!current?.busy) { render(); return; }
      const progress = current.totalMs > 0 ? (current.totalMs - current.remainingMs) / current.totalMs : 1;
      fill.style.width = `${Math.min(100, Math.max(0, progress * 100))}%`;
      time.innerHTML = `<span>Total Time:</span><strong>${current.ready ? "Ready!" : formatCountdown(current.remainingMs)}</strong>`;
      note.textContent = current.ready
        ? "Grinding complete."
        : `Grinding... ${formatCountdown(current.remainingMs)} left`;
      collect.disabled = !current.ready;
    };
    tick();
    timer = window.setInterval(tick, 250);
    return true;
  };

  const render = () => {
    stop();
    activeStop = stop;
    body.innerHTML = "";
    if (tab === "Grinds") {
      if (renderBusy()) return;
      const total = grindTotal();
      const grind = document.createElement("div");
      grind.className = "pwm-grind";
      const crystals = document.createElement("div");
      crystals.className = "pwm-grind-col";
      for (const colorKey of POWDER_STORAGE_DISPLAY) {
        const color = POWDER_COLORS[colorKey];
        const available = hud.state.powderStorage.crystals[colorKey] ?? 0;
        crystals.appendChild(grindCrystalSlot(
          color.name,
          color.tint,
          grindSelection[colorKey],
          total < GRIND_CRYSTAL_CAPACITY && grindSelection[colorKey] < available,
          () => changeGrindCount(colorKey, -1),
          () => changeGrindCount(colorKey, 1),
        ));
      }

      const summary = document.createElement("div");
      summary.className = "pwm-grind-summary";
      const time = document.createElement("div");
      time.className = "pwm-grind-stat";
      time.innerHTML = `<span>Total Time:</span><strong>${formatGrindTime(total)}</strong>`;
      const output = document.createElement("div");
      output.className = "pwm-grind-stat";
      output.innerHTML = `<span>Expected Output:</span><strong>${total * POWDER_PER_CRYSTAL_MIN}-${total * POWDER_PER_CRYSTAL_MAX}</strong>`;
      const start = document.createElement("button");
      start.className = "pwm-start";
      start.type = "button";
      start.disabled = total <= 0;
      start.textContent = "Start Grinding";
      start.onclick = () => {
        start.disabled = true;
        if (hud.onStartPowderGrind?.(machineId, grindSelection)) {
          for (const key of Object.keys(grindSelection) as PowderColor[]) grindSelection[key] = 0;
          hud.audio.play("menuClick");
          render();
        } else start.disabled = false;
      };
      summary.append(time, output, start);
      grind.append(crystals, summary);
      body.appendChild(grind);
    } else {
      const grid = document.createElement("div");
      grid.className = "pwm-grid";
      const crystals = document.createElement("div");
      crystals.className = "pwm-col";
      const powders = document.createElement("div");
      powders.className = "pwm-col";
      for (const colorKey of POWDER_STORAGE_DISPLAY) {
        const color = POWDER_COLORS[colorKey];
        crystals.appendChild(crystalSlot(color.name, color.tint, hud.state.powderStorage.crystals[colorKey] ?? 0));
        powders.appendChild(powderSlot(color.name, color.tint, hud.state.powderStorage.powders[colorKey] ?? 0));
      }
      grid.append(crystals, powders);
      body.appendChild(grid);
    }
  };

  const buttons: HTMLButtonElement[] = [];
  for (const name of ["Grinds", "Storage"] as const) {
    const button = document.createElement("button");
    button.className = "st-tab" + (name === tab ? " sel" : "");
    button.textContent = name;
    button.onclick = () => {
      hud.audio.play("menuClick");
      tab = name;
      buttons.forEach((candidate) => candidate.classList.remove("sel"));
      button.classList.add("sel");
      render();
    };
    buttons.push(button);
    tabs.appendChild(button);
  }

  wrap.append(head, tabs, body);
  panel.append(close, wrap);
  bg.appendChild(panel);
  bg.onclick = (event) => { if (event.target === bg) { stop(); bg.remove(); } };
  hud.el.appendChild(bg);
  render();
}
