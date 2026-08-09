import type { Hud } from "../../hud";
import type { RosterEntry } from "../../zombie/types";
import { BASE } from "../../base";
import { POWDER_COLORS, POWDER_STORAGE_DISPLAY, type PowderColor } from "../../powderMachine";
import {
  applyZombieColorPowder,
  maxUsefulZombieColorPowder,
  sanitizeDyePowderAmount,
} from "../../zombieColorMixerBucket";
import { UI } from "../uiAsset";
import { onFirstVisible } from "../onFirstVisible";

function tintOverlay(src: string, tint: number): HTMLElement {
  const overlay = document.createElement("span");
  overlay.className = "zcm-color";
  overlay.style.backgroundColor = `#${tint.toString(16).padStart(6, "0")}`;
  overlay.style.mask = `url("${src}") center / contain no-repeat`;
  overlay.style.webkitMask = `url("${src}") center / contain no-repeat`;
  return overlay;
}

function rgbOf(hud: Hud, zombie: RosterEntry): [number, number, number] {
  return zombie.color ?? hud.zombieBaseColorOf?.(zombie.key) ?? [255, 255, 255];
}

function rgbLabel(rgb: readonly [number, number, number]): string {
  return `[${rgb[0]}, ${rgb[1]}, ${rgb[2]}]`;
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
  const bag = document.createElement("img");
  bag.className = "zcm-bag";
  bag.src = `${BASE}assets/ui/storage/powder_bag.png`;
  bag.alt = "";
  const powderSrc = `${BASE}assets/ui/storage/powder.png`;
  const powder = document.createElement("img");
  powder.className = "zcm-powder";
  powder.src = powderSrc;
  powder.alt = "";
  icon.append(bag, powder, tintOverlay(powderSrc, color.tint));
  return icon;
}

export function openZombieColorMixerBucket(hud: Hud): void {
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
  close.onclick = () => bg.remove();

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
  const stopMessage = () => selectedPowder
    ? `This zombie is too ${selectedPowder} to use more of this colored powder.`
    : "";
  const amountCap = () => {
    const zombie = selectedZombie();
    if (!zombie || !selectedPowder) return 0;
    const useful = maxUsefulZombieColorPowder(rgbOf(hud, zombie), selectedPowder);
    const available = hud.state.powderStorage.powders[selectedPowder] ?? 0;
    return Math.max(0, Math.min(255, useful, available));
  };
  const clampAmountForSelection = (value: unknown, notify = false) => {
    const cap = amountCap();
    const clean = sanitizeDyePowderAmount(value);
    if (cap <= 0) {
      if (notify && selectedPowder && selectedZombie()) hud.showToast(stopMessage());
      return 1;
    }
    if (clean > cap && notify) hud.showToast(stopMessage());
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

  const render = () => {
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
    if (!selectedZombieId || !selectedPowder) return;
    const zombie = selectedZombie();
    if (!zombie) return;
    const cap = amountCap();
    if (cap <= 0) {
      hud.showToast(stopMessage());
      return;
    }
    powderAmount = clampAmountForSelection(powderAmount, true);
    const preview = applyZombieColorPowder(rgbOf(hud, zombie), selectedPowder, powderAmount);
    if (preview.amountUsed <= 0) {
      hud.showToast(preview.stopReason ?? stopMessage());
      return;
    }
    dye.disabled = true;
    const result = await hud.onDyeZombieColor?.(selectedZombieId, selectedPowder, powderAmount);
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
  bg.onclick = (event) => { if (event.target === bg) bg.remove(); };
  hud.el.appendChild(bg);
  render();
}

function thisRoster(hud: Hud): RosterEntry[] {
  return hud.getRoster?.() ?? [];
}
