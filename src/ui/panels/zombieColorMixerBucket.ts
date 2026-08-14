import type { Hud } from "../../hud";
import type { RosterEntry } from "../../zombie/types";
import { BASE } from "../../base";
import { POWDER_COLORS, POWDER_STORAGE_DISPLAY, type PowderColor } from "../../powderMachine";
import {
  applyZombieColorPowder,
  rgbToTint,
  maxUsefulZombieColorPowder,
  sanitizeDyePowderAmount,
} from "../../zombieColorMixerBucket";
import { UI } from "../uiAsset";
import { onFirstVisible } from "../onFirstVisible";

function rgbOf(hud: Hud, zombie: RosterEntry): [number, number, number] {
  return zombie.color ?? hud.zombieBaseColorOf?.(zombie.key) ?? [255, 255, 255];
}

function rgbLabel(rgb: readonly [number, number, number]): string {
  return `[${rgb[0]}, ${rgb[1]}, ${rgb[2]}]`;
}

function timeLabel(ms: number): string {
  const secs = Math.ceil(Math.max(0, ms) / 1000);
  if (secs <= 0) return "Ready!";
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m`;
}

function showPortrait(hud: Hud, el: HTMLElement, zombie: RosterEntry): void {
  const fallback = hud.zombiePortraitOf?.(zombie.key) || hud.zombiePortraitOf?.("ZombieActorRegularTier1") || "";
  if (fallback) el.style.backgroundImage = `url(${fallback})`;
  if (!hud.zombieMutationPortraitOf) return;
  onFirstVisible(el, () => {
    void hud.zombieMutationPortraitOf?.(zombie.key, zombie.mutation, zombie.color, zombie.mutationIds)
      .then((portrait) => {
        if (el.isConnected) el.style.backgroundImage = `url(${portrait})`;
      })
      .catch(() => { /* keep the static portrait */ });
  });
}

function powderIcon(colorKey: PowderColor, extraClass = ""): HTMLElement {
  const color = POWDER_COLORS[colorKey];
  const icon = document.createElement("div");
  icon.className = `zcm-powder-icon${extraClass ? ` ${extraClass}` : ""}`;
  const powder = document.createElement("img");
  powder.className = "zcm-powder";
  powder.src = `${BASE}assets/ui/storage/${color.powderIcon}`;
  powder.alt = "";
  icon.append(powder);
  return icon;
}

export function openZombieColorMixerBucket(hud: Hud, bucketId: string): void {
  document.querySelector("#hud .zcm-bg")?.remove();
  const bg = document.createElement("div");
  bg.className = "panelbg zcm-bg";
  const panel = document.createElement("div");
  panel.className = "panel zcm-panel";
  const close = document.createElement("button");
  close.className = "panelclose";
  const closeIcon = document.createElement("img");
  closeIcon.src = UI("button_close.png");
  closeIcon.alt = "Close";
  close.appendChild(closeIcon);
  let ticker: ReturnType<typeof setInterval> | null = null;
  const closePanel = () => {
    if (ticker) clearInterval(ticker);
    bg.remove();
  };
  close.onclick = closePanel;

  const wrap = document.createElement("div");
  wrap.className = "zcm";
  const head = document.createElement("div");
  head.className = "cmb-head";
  head.innerHTML = `<h2>Zombie Dyer</h2>`;
  const slots = document.createElement("div");
  slots.className = "cmb-slots zcm-slots";
  const list = document.createElement("div");
  list.className = "zcm-list";
  const dye = document.createElement("button");
  dye.className = "cmb-go zcm-dye";
  dye.type = "button";
  dye.textContent = "Dye";

  let selectedZombieId: string | null = null;
  let selectedPowder: PowderColor | null = null;
  let powderAmount = 1;

  const roster = () => thisRoster(hud);
  const selectedZombie = () => roster().find((zombie) => zombie.id === selectedZombieId) ?? null;
  const status = () => hud.getZombieColorDyeStatus?.(bucketId) ?? {
    busy: false,
    ready: false,
    remainingMs: 0,
    totalMs: 0,
    pending: null,
  };
  const stopMessage = () => selectedPowder
    ? `This zombie is too ${selectedPowder} to use more of this colored powder.`
    : "";
  const shortageMessage = () => selectedPowder
    ? `you don't have enough ${selectedPowder} powder, made more at the grinder`
    : "";
  const amountInfo = () => {
    const zombie = selectedZombie();
    if (!zombie || !selectedPowder) return { useful: 0, available: 0, cap: 0 };
    const useful = maxUsefulZombieColorPowder(rgbOf(hud, zombie), selectedPowder);
    const available = hud.state.powderStorage.powders[selectedPowder] ?? 0;
    return { useful, available, cap: Math.max(0, Math.min(255, useful, available)) };
  };
  const amountCap = () => {
    return amountInfo().cap;
  };
  const clampAmountForSelection = (value: unknown, notify = false) => {
    const { useful, available, cap } = amountInfo();
    const clean = sanitizeDyePowderAmount(value);
    if (cap <= 0) {
      if (notify && selectedPowder && selectedZombie()) hud.showToast(available <= 0 ? shortageMessage() : stopMessage());
      return 1;
    }
    if (clean > cap && notify) hud.showToast(clean > available ? shortageMessage() : clean > useful ? stopMessage() : "");
    return Math.min(clean, cap);
  };

  const amountInput = () => {
    const input = document.createElement("input");
    input.className = "zcm-amount";
    input.type = "number";
    input.min = "1";
    input.max = "255";
    input.step = "1";
    input.value = `${powderAmount}`;
    const commit = () => {
      powderAmount = clampAmountForSelection(input.value, true);
      input.value = `${powderAmount}`;
      render();
    };
    input.onchange = commit;
    input.onblur = commit;
    input.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      }
    };
    return input;
  };

  const slotEl = (which: "zombie" | "powder") => {
    const filled = which === "zombie" ? !!selectedZombie() : !!selectedPowder;
    const slot = document.createElement("div");
    slot.className = "cmb-slot zcm-slot" + (filled ? " filled" : "");
    if (which === "zombie") {
      const zombie = selectedZombie();
      if (!zombie) {
        const hint = document.createElement("div");
        hint.className = "cmb-hint";
        hint.textContent = "Slot 1 (zombie)";
        slot.appendChild(hint);
        return slot;
      }
      const portrait = document.createElement("div");
      portrait.className = "cmb-por";
      showPortrait(hud, portrait, zombie);
      const name = document.createElement("div");
      name.className = "cmb-sn";
      name.textContent = zombie.name;
      const rgb = document.createElement("div");
      rgb.className = "cmb-sm zcm-rgb";
      rgb.textContent = rgbLabel(rgbOf(hud, zombie));
      slot.append(portrait, name, rgb);
      slot.title = "Tap to remove";
      slot.onclick = () => {
        selectedZombieId = null;
        render();
      };
      return slot;
    }

    if (!selectedPowder) {
      const hint = document.createElement("div");
      hint.className = "cmb-hint";
      hint.textContent = "Slot 2 (powder)";
      slot.appendChild(hint);
      return slot;
    }
    const color = POWDER_COLORS[selectedPowder];
    const name = document.createElement("div");
    name.className = "cmb-sn";
    name.textContent = `${color.name} Powder`;
    const amount = document.createElement("label");
    amount.className = "zcm-amount-wrap";
    const caption = document.createElement("span");
    caption.textContent = "Amount";
    amount.append(caption, amountInput());
    slot.append(powderIcon(selectedPowder, "large"), name, amount);
    slot.title = "Tap powder below to change type";
    return slot;
  };

  const renderPowders = () => {
    const section = document.createElement("div");
    section.className = "zcm-section";
    const title = document.createElement("div");
    title.className = "zcm-section-title";
    title.textContent = "Powder";
    const grid = document.createElement("div");
    grid.className = "zcm-powders";
    for (const colorKey of POWDER_STORAGE_DISPLAY) {
      const color = POWDER_COLORS[colorKey];
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "zcm-powder-choice" + (selectedPowder === colorKey ? " chosen" : "");
      tile.appendChild(powderIcon(colorKey));
      const name = document.createElement("span");
      name.className = "zcm-powder-name";
      name.textContent = color.name;
      const count = document.createElement("span");
      count.className = "zcm-powder-count";
      count.textContent = `${hud.state.powderStorage.powders[colorKey] ?? 0}`;
      tile.append(name, count);
      tile.onclick = () => {
        selectedPowder = colorKey;
        powderAmount = clampAmountForSelection(powderAmount);
        hud.audio.play("menuClick");
        render();
      };
      grid.appendChild(tile);
    }
    section.append(title, grid);
    return section;
  };

  const renderZombies = () => {
    const section = document.createElement("div");
    section.className = "zcm-section";
    const title = document.createElement("div");
    title.className = "zcm-section-title";
    title.textContent = "Zombies";
    const grid = document.createElement("div");
    grid.className = "cmb-list zcm-zombies";
    const entries = roster();
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "cmb-empty";
      empty.textContent = "No zombies available.";
      grid.appendChild(empty);
    }
    for (const zombie of entries) {
      const chosen = zombie.id === selectedZombieId;
      const tile = document.createElement("div");
      tile.className = "cmb-z" + (chosen ? " chosen" : "");
      const portrait = document.createElement("div");
      portrait.className = "cmb-zpor";
      showPortrait(hud, portrait, zombie);
      const name = document.createElement("div");
      name.className = "cmb-zn";
      name.textContent = zombie.name;
      const rgb = document.createElement("div");
      rgb.className = "cmb-zty zcm-rgb";
      rgb.textContent = rgbLabel(rgbOf(hud, zombie));
      tile.append(portrait, name, rgb);
      if (!chosen) {
        tile.onclick = () => {
          selectedZombieId = zombie.id;
          hud.audio.play("menuClick");
          render();
        };
      }
      grid.appendChild(tile);
    }
    section.append(title, grid);
    return section;
  };

  const renderWorking = () => {
    const current = status();
    const job = current.pending;
    slots.innerHTML = "";
    list.innerHTML = "";
    if (!job) return;
    const zombie = job.reservedZombie ?? roster().find((entry) => entry.id === job.unitId) ?? null;
    const zombieSlot = document.createElement("div");
    zombieSlot.className = "cmb-slot zcm-slot filled";
    if (zombie) {
      const portrait = document.createElement("div");
      portrait.className = "cmb-por";
      showPortrait(hud, portrait, zombie);
      zombieSlot.appendChild(portrait);
    }
    const name = document.createElement("div");
    name.className = "cmb-sn";
    name.textContent = zombie?.name ?? job.zombieName ?? job.zombieKey;
    const rgb = document.createElement("div");
    rgb.className = "cmb-sm zcm-rgb";
    rgb.textContent = current.ready ? rgbLabel(job.outputColor) : rgbLabel(job.inputColor);
    zombieSlot.append(name, rgb);

    const plus = document.createElement("div");
    plus.className = "cmb-plus";
    plus.textContent = "+";

    const powderSlot = document.createElement("div");
    powderSlot.className = "cmb-slot zcm-slot filled";
    const color = POWDER_COLORS[job.powderColor];
    const powderName = document.createElement("div");
    powderName.className = "cmb-sn";
    powderName.textContent = `${color.name} Powder`;
    const amount = document.createElement("div");
    amount.className = "cmb-sm zcm-rgb";
    amount.textContent = `${job.amount}`;
    powderSlot.append(powderIcon(job.powderColor, "large"), powderName, amount);
    slots.append(zombieSlot, plus, powderSlot);

    const section = document.createElement("div");
    section.className = "zcm-section";
    const title = document.createElement("div");
    title.className = "zcm-section-title";
    title.textContent = current.ready ? "Ready" : "Dyeing";
    const summary = document.createElement("div");
    summary.className = "cmb-empty";
    summary.textContent = `Output ${rgbLabel(job.outputColor)} (#${rgbToTint(job.outputColor).toString(16).padStart(6, "0")}) - ${timeLabel(current.remainingMs)}`;
    section.append(title, summary);
    list.append(section);
    dye.textContent = current.ready ? "Collect" : "Dyeing...";
    dye.disabled = !current.ready;
  };

  const render = () => {
    if (status().busy) {
      renderWorking();
      return;
    }
    dye.textContent = "Dye";
    powderAmount = clampAmountForSelection(powderAmount);
    slots.innerHTML = "";
    const plus = document.createElement("div");
    plus.className = "cmb-plus";
    plus.textContent = "+";
    slots.append(slotEl("zombie"), plus, slotEl("powder"));
    list.innerHTML = "";
    list.append(renderPowders(), renderZombies());
    dye.disabled = !(selectedZombieId && selectedPowder) || amountCap() <= 0;
  };

  dye.onclick = async () => {
    const current = status();
    if (current.busy) {
      if (!current.ready) return;
      dye.disabled = true;
      const result = await hud.onCollectZombieColorDye?.(bucketId);
      if (result?.ok) hud.audio.play("menuClick");
      else hud.showToast(result?.message ?? "Could not collect that dye job.");
      render();
      return;
    }
    if (!selectedZombieId || !selectedPowder) return;
    const zombie = selectedZombie();
    if (!zombie) return;
    const cap = amountCap();
    if (cap <= 0) {
      const { available } = amountInfo();
      hud.showToast(available <= 0 ? shortageMessage() : stopMessage());
      return;
    }
    powderAmount = clampAmountForSelection(powderAmount, true);
    const preview = applyZombieColorPowder(rgbOf(hud, zombie), selectedPowder, powderAmount);
    if (preview.amountUsed <= 0) {
      hud.showToast(preview.stopReason ?? stopMessage());
      return;
    }
    dye.disabled = true;
    const result = await hud.onStartZombieColorDye?.(bucketId, selectedZombieId, selectedPowder, powderAmount);
    if (result?.ok) {
      hud.audio.play("menuClick");
      if (preview.amountUsed < powderAmount && preview.stopReason) hud.showToast(preview.stopReason);
    } else {
      hud.showToast(result?.message ?? "Could not dye that zombie.");
    }
    render();
  };

  wrap.append(head, slots, list, dye);
  panel.append(close, wrap);
  bg.appendChild(panel);
  bg.onclick = (event) => { if (event.target === bg) closePanel(); };
  hud.el.appendChild(bg);
  render();
  ticker = setInterval(() => {
    if (!bg.isConnected) {
      if (ticker) clearInterval(ticker);
      return;
    }
    if (status().busy) render();
  }, 1000);
}

function thisRoster(hud: Hud): RosterEntry[] {
  return hud.getRoster?.() ?? [];
}
