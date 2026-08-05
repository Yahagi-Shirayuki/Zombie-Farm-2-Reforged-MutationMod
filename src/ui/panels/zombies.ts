// The Zombies menu (right bar) and the zombie inspect-card cluster, extracted
// from the Hud class: these functions take the Hud instance and render into it,
// exactly as the former methods did. The menu now has two tabs:
//   • My Zombies — the owned roster, every unit as its full inspect card.
//   • Zombie Almanac — the collection: one entry per obtainable species, shown
//     as a silhouette until one has been obtained (any acquisition counts).
// The inspect-card builders are also used by the Mausoleum grid and the Black
// Market listing views, which stay in hud.ts and import them from here.
import type { Hud } from "../../hud";
import { openModal } from "../Modal";
import type { AlmanacEntryView, ZombieInfo } from "../hudTypes";
import { zombieSellValue } from "../../economy";
import { MAX_ZOMBIE_NAME_LENGTH, RosterEntry } from "../../zombie/types";
import { mutationBonus } from "../../zombie/mutations";
import {
  STATS, veterancy, STAT_TILE, VALUE_FILL, VALUE_END, ABILITY_FRAME, MUTATION_FRAME,
  ABILITY_POOL, unitAbilityAt, TIER_BOSS, MAX_ABILITY_TIER,
} from "../../zombie/traits";
import { mutationEntries, mutationTipText } from "../../zombie/mutationDisplay";
import { statBreakdown } from "../../zombie/statDisplay";
import { classTierRank } from "../../zombie/taxonomy";
import { ZOMBIE_SORTS, isZombieSort, sortZombies, type ZombieSort } from "../../zombie/rosterSort";
import { getZombieSort, setZombieSort } from "../../prefs";

// A closeable modal: the zombie's trading-card (portrait, name board, veterancy /
// type / invasions) on the LEFT, and its stats (icon row) over abilities (icon
// row) on the RIGHT. Tapping a stat or ability icon shows a small tooltip that
// any further interaction dismisses.
/** Build the inspect "card" (trading card + stats + abilities) for one zombie.
 *  Stat/ability tooltips attach to the modal backdrop so a scrolling panel
 *  cannot clip them. Shared by the single-zombie modal and the Zombies list. */
export function buildZombieCard(hud: Hud, info: ZombieInfo, host: HTMLElement): HTMLElement {
  // --- tooltip: one small popup at a time; any interaction dismisses it ---
  let tip: HTMLElement | null = null;
  const closeTip = () => { tip?.remove(); tip = null; };
  const showTip = (anchor: HTMLElement, title: string, body: string) => {
    closeTip();
    tip = document.createElement("div");
    tip.className = "ztip";
    tip.innerHTML = `<b>${title}</b><span>${body}</span>`;
    // On compact layouts the panel itself scrolls. Put the popup beside the
    // panel in its full-viewport backdrop so it can extend beyond the card.
    const portal = host.parentElement ?? host;
    portal.appendChild(tip);
    const ar = anchor.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    const edge = 8;
    const gap = 8;
    const halfWidth = tr.width / 2;
    const anchorCenter = ar.left + ar.width / 2;
    const left = Math.min(
      window.innerWidth - edge - halfWidth,
      Math.max(edge + halfWidth, anchorCenter)
    );
    tip.style.left = `${left}px`;

    // Prefer the familiar above-anchor position, but flip below when needed.
    // If neither side alone is tall enough, detach just enough from the anchor
    // to keep the whole popup inside the viewport.
    const roomAbove = ar.top - gap - edge;
    const roomBelow = window.innerHeight - ar.bottom - gap - edge;
    const below = roomAbove < tr.height;
    tip.classList.toggle("below", below);
    if (!below) {
      tip.style.top = `${ar.top - gap}px`;
    } else if (roomBelow >= tr.height) {
      tip.style.top = `${ar.bottom + gap}px`;
    } else {
      tip.style.top = `${Math.max(edge, window.innerHeight - edge - tr.height)}px`;
    }
    // The NEXT pointer-down anywhere closes it (this click's down already fired).
    document.addEventListener("pointerdown", closeTip, { capture: true, once: true });
  };

  const wrap = document.createElement("div");
  wrap.className = "zdetail";

  // ---- LEFT: the card ----
  const card = document.createElement("div");
  card.className = "zcard";
  const nailL = document.createElement("span");
  nailL.className = "zcard-nail tl";
  const nailR = document.createElement("span");
  nailR.className = "zcard-nail tr";
  const board = document.createElement("div");
  board.className = "zcard-board";
  board.textContent = info.name;
  card.append(nailL, nailR, board);
  if (info.id && hud.onZombieRename) {
    board.classList.add("renameable");
    board.title = "Click to rename";
    board.tabIndex = 0;
    const edit = () => {
      if (!board.isConnected) return;
      const input = document.createElement("input");
      input.className = "zcard-name-input";
      input.value = info.name;
      input.maxLength = MAX_ZOMBIE_NAME_LENGTH;
      board.replaceWith(input);
      let active = true;
      const cancel = () => {
        if (!active) return;
        active = false;
        input.replaceWith(board);
      };
      const commit = () => {
        if (!active) return;
        active = false;
        const renamed = hud.onZombieRename?.(info.id!, input.value);
        if (renamed) info.name = renamed;
        board.textContent = info.name;
        input.replaceWith(board);
      };
      input.onkeydown = (event) => {
        if (event.key === "Enter") { event.preventDefault(); commit(); }
        else if (event.key === "Escape") { event.preventDefault(); cancel(); }
      };
      input.onblur = commit;
      input.focus();
      input.select();
    };
    board.onclick = edit;
    board.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); edit(); }
    };
  }
  const port = document.createElement("div");
  port.className = "zcard-port";
  port.style.backgroundImage = `url(${info.portrait})`;
  // Use the static catalog portrait immediately, then replace it with the cached
  // individual rig once its mutation-aware render is available.
  if (hud.zombieMutationPortraitOf) {
    void hud.zombieMutationPortraitOf(info.key, info.mutation, info.color)
      .then((portrait) => {
        if (port.isConnected) port.style.backgroundImage = `url(${portrait})`;
      })
      .catch(() => { /* retain the static species portrait if extraction fails */ });
  }
  const meta = document.createElement("div");
  meta.className = "zcard-meta";
  meta.innerHTML =
    `<div class="zvet">${veterancy(info.invasions)}</div>` +
    `<div class="ztype">${info.typeName}</div>` +
    `<div class="zinv">Invasions: ${info.invasions}</div>`;
  card.append(port, meta);

  // ---- RIGHT: stats (top) + abilities (bottom), both horizontal ----
  const right = document.createElement("div");
  right.className = "zright";

  const statsHdr = document.createElement("div");
  statsHdr.className = "zsec-h";
  statsHdr.textContent = "Stats";
  const statsRow = document.createElement("div");
  statsRow.className = "zrow zstats";
  // Each tile shows the stat's 0–100 bar with EVERY always-on bonus folded in
  // (mutation + veterancy + the zombie's own passive stat abilities); hovering opens
  // the per-modifier breakdown. See zombie/statDisplay.statBreakdown.
  const abilityUnlocked = (k: string) => hud.state.abilityUnlocked(k);
  // Which stats a mutation is boosting — those tiles render green (permanent species bonus).
  const mutBonus = mutationBonus(info.mutation);
  for (const s of STATS) {
    const bd = statBreakdown(info, s.key, abilityUnlocked);
    const boosted = ((mutBonus as Record<string, number>)[s.key] ?? 0) > 0;
    const cell = document.createElement("button");
    cell.className = "zstat";
    cell.innerHTML =
      `<span class="zstat-tile" style="background-image:url(${STAT_TILE})">` +
      `<img src="${s.icon}" alt=""></span>` +
      `<span class="zstat-val${boosted ? " boosted" : ""}" style="background-image:url(${VALUE_END}),url(${VALUE_FILL})">` +
      `${bd.total}</span>`;
    cell.onclick = (e) => {
      e.stopPropagation();
      // desc, then Base → each modifier (dim if +0) → Total, as aligned rows.
      const rows = [`<span class="zbd-row"><span>Base</span><span>${bd.base}</span></span>`]
        .concat(
          bd.lines.map(
            (l) =>
              `<span class="zbd-row${l.zero ? " zbd-zero" : ""}"><span>${l.label}</span><span>${l.amount}</span></span>`
          )
        )
        .concat(`<span class="zbd-row zbd-total"><span>Total</span><span>${bd.total}</span></span>`)
        .join("");
      showTip(cell, s.label, `${s.desc}<span class="zbd">${rows}</span>`);
    };
    statsRow.appendChild(cell);
  }

  // ---- mutations: one framed icon per mutation this zombie carries ----
  // Only the boosted (green) stat tiles used to hint at these, which never said WHICH
  // mutations they were — the thing you need before pairing the zombie in the Pot.
  // Unmutated zombies (most of them) show no section at all rather than an empty row.
  const mutations = mutationEntries(info);
  const mutHdr = document.createElement("div");
  mutHdr.className = "zsec-h";
  mutHdr.textContent = mutations.length > 1 ? `Mutations (${mutations.length}/5)` : "Mutation";
  const mutRow = document.createElement("div");
  mutRow.className = "zrow zmuts";
  for (const mutation of mutations) {
    const cell = document.createElement("button");
    cell.className = "zmut";
    cell.style.backgroundImage = `url(${MUTATION_FRAME})`;
    cell.title = mutation.name; // the name is a tap away, like the stat/ability tiles
    cell.innerHTML = `<img src="${mutation.icon}" alt="${mutation.name}">`;
    cell.onclick = (e) => {
      e.stopPropagation();
      showTip(cell, mutation.name, mutationTipText(mutation));
    };
    mutRow.appendChild(cell);
  }

  const abilHdr = document.createElement("div");
  abilHdr.className = "zsec-h";
  abilHdr.textContent = "Abilities";
  const abilRow = document.createElement("div");
  abilRow.className = "zrow zabils";
  // A zombie shows its GROUP's one ability per tier, for tiers 1..(colour-class
  // rank): Green=t1, Blue=t1-2, Red=t1-3, Silver+ = t1-4 (so never more than 4).
  // An ability that's been unlocked shows the real icon; still-locked ones show a
  // padlock naming the boss. Some groups (Small) have no ability at low tiers, so
  // their abilities only appear on higher-class units.
  const rank = Math.min(MAX_ABILITY_TIER, classTierRank(info.className));
  for (let t = 1; t <= rank; t++) {
    const key = unitAbilityAt(info.key, info.group, t);
    if (!key) continue; // no ability at this tier for this unit
    const meta = ABILITY_POOL[key];
    if (!meta) continue;
    const cell = document.createElement("button");
    cell.style.backgroundImage = `url(${ABILITY_FRAME})`;
    if (hud.state.abilityUnlocked(key)) {
      cell.className = "zabil";
      cell.innerHTML = `<img src="${meta.icon}" alt="">`;
      cell.onclick = (e) => {
        e.stopPropagation();
        // Skip the effect line when it just repeats the name (stat buffs).
        const body = meta.effect && meta.effect !== meta.label
          ? `<span class="zeff">${meta.effect}</span> ${meta.desc}`
          : meta.desc;
        showTip(cell, meta.label, body);
      };
    } else {
      cell.className = "zabil locked";
      cell.innerHTML = `<span class="zlock">🔒</span>`;
      const boss = TIER_BOSS[t];
      cell.onclick = (e) => {
        e.stopPropagation();
        showTip(cell, meta.label, `Defeat ${boss} to unlock this ability.`);
      };
    }
    abilRow.appendChild(cell);
  }
  if (!abilRow.childElementCount) {
    const none = document.createElement("div");
    none.className = "zabil-none";
    none.textContent = "No abilities at this rank.";
    abilRow.appendChild(none);
  }

  right.append(statsHdr, statsRow);
  if (mutations.length) right.append(mutHdr, mutRow);
  right.append(abilHdr, abilRow);
  wrap.append(card, right);
  return wrap;
}

export function openZombieInfo(hud: Hud, info: ZombieInfo, refresh?: () => void) {
  const { panel, close } = openModal({ host: hud.el, panelClass: "zpanel" });

  const wrap = buildZombieCard(hud, info, panel);
  panel.append(wrap);
  if (info.id) panel.appendChild(buildZombieActions(hud, info, close, refresh));
}

function buildZombieActions(hud: Hud, info: ZombieInfo, close: () => void, refresh?: () => void): HTMLElement {
  const btns = document.createElement("div");
  btns.className = "zbtns";
  const mk = (label: string, cls: string, enabled: boolean, fn: () => void | Promise<void>, reopen = true) => {
    const button = document.createElement("button");
    button.className = `zbtn ${cls}`;
    button.textContent = label;
    button.disabled = !enabled;
    button.onclick = async () => {
      button.disabled = true;
      close();
      await fn();
      if (reopen) refresh?.();
    };
    return button;
  };
  if (info.stored) {
    const canDeploy = hud.canDeployZombie ? hud.canDeployZombie() : true;
    btns.appendChild(mk(canDeploy ? "Deploy to farm" : "Farm full", "deploy", canDeploy,
      () => hud.onZombieDeploy?.(info.id!)));
  } else {
    const canStore = hud.canStoreZombies ? hud.canStoreZombies() : true;
    btns.appendChild(mk("Locate", "locate", true, () => hud.onZombieLocate?.(info.id!), false));
    btns.appendChild(mk(canStore ? "Store" : "Need Mausoleum", "store", canStore,
      () => hud.onZombieStore?.(info.id!)));
  }
  const value = zombieSellValue(
    hud.zombieBaseCost?.(info.key) ?? 0,
    hud.zombieCostsBrains?.(info.key) ?? false
  );
  const sell = document.createElement("button");
  sell.className = "zbtn sell";
  sell.textContent = "Sell";
  sell.onclick = () => {
    close();
    openZombieSellChoices(hud, info, value, refresh);
  };
  btns.appendChild(sell);
  return btns;
}

function openZombieSellChoices(hud: Hud, info: ZombieInfo, value: number, refresh?: () => void) {
  if (!hud.socialOnline?.()) { confirmSellZombie(hud, info, value, refresh); return; }
  const { panel, close } = openModal({ host: hud.el, panelClass: "confirm-panel", title: "Sell this zombie" });
  const message = document.createElement("p");
  message.className = "confirm-msg";
  message.textContent = "Sell immediately for gold, or create a Black Market post for brains.";
  const actions = document.createElement("div");
  actions.className = "zbtns";
  const gold = document.createElement("button");
  gold.className = "zbtn sell";
  gold.textContent = `Sell now +${value}g`;
  gold.onclick = () => { close(); confirmSellZombie(hud, info, value, refresh); };
  const market = document.createElement("button");
  market.className = "zbtn deploy";
  market.textContent = "Sell on Black Market";
  market.onclick = () => { close(); hud.openBlackMarket("SELL_ZOMBIE", info.id); };
  actions.append(gold, market);
  panel.append(message, actions);
}

// Confirmation window for selling a zombie. Names the unit, shows the gold it
// fetches, and warns that the sale is permanent — so a valuable zombie is not
// sold by a single stray tap. Confirm sells; Cancel backs out to the roster.
function confirmSellZombie(hud: Hud, info: ZombieInfo, value: number, refresh?: () => void) {
  const { panel, close } = openModal({ host: hud.el, panelClass: "confirm-panel", title: "Sell this zombie?" });

  const por = document.createElement("div");
  por.className = "obj-por";
  if (info.portrait) por.style.backgroundImage = `url(${info.portrait})`;
  const msg = document.createElement("p");
  msg.className = "confirm-msg";
  msg.append("Sell ");
  const zombieName = document.createElement("b"); zombieName.textContent = info.name;
  const valueText = document.createElement("b"); valueText.textContent = `+${value}g`;
  msg.append(zombieName, ` (${info.typeName}) for `, valueText, "?", document.createElement("br"));
  const warning = document.createElement("span");
  warning.className = "confirm-warn";
  warning.textContent = "This is permanent — the zombie is gone for good.";
  msg.appendChild(warning);

  const btns = document.createElement("div");
  btns.className = "zbtns";
  const cancel = document.createElement("button");
  cancel.className = "zbtn locate";
  cancel.textContent = "Cancel";
  cancel.onclick = () => close();
  const confirm = document.createElement("button");
  confirm.className = "zbtn sell";
  confirm.textContent = `Sell +${value}g`;
  confirm.onclick = async () => {
    confirm.disabled = true;
    close();
    await hud.onZombieSell?.(info.id!);
    refresh?.();
  };
  btns.append(cancel, confirm);

  panel.append(por, msg, btns);
}

/** Convert a roster entry into the inspectable ZombieInfo shape. */
export function rosterInfo(hud: Hud, z: RosterEntry): ZombieInfo {
  return {
    name: z.name, typeName: z.typeName, key: z.key, group: z.group,
    className: z.className, classColor: z.classColor,
    str: z.str * hud.state.farmerZombieStrengthMult(), dex: z.dex,
    con: z.con * hud.state.farmerZombieLifeMult(), focus: z.focus, mutation: z.mutation,
    invasions: z.invasions,
    portrait: hud.zombiePortraitOf ? hud.zombiePortraitOf(z.key) : "",
    color: z.color,
    id: z.id, stored: z.stored,
  };
}

/** A compact framed roster tile (portrait + name + class pill). Used by the
 *  Mausoleum grid and the Almanac collection. */
export function buildRosterCard(hud: Hud, z: RosterEntry, onClick: () => void): HTMLElement {
  const card = document.createElement("div");
  card.className = "zr-card";
  const por = document.createElement("div");
  por.className = "zr-por"; // framed slot (matches the storage-shed item tiles)
  const portrait = hud.zombiePortraitOf ? hud.zombiePortraitOf(z.key) : "";
  const pim = document.createElement("img");
  pim.className = "zr-por-img";
  if (portrait) pim.src = portrait;
  por.appendChild(pim);
  // Show the SAME rig the inspect card shows: the static species portrait first,
  // replaced by this individual's mutation-aware render once it is available. The
  // Mausoleum grid used to keep the species art, so a stored mutant looked plain.
  if (hud.zombieMutationPortraitOf) {
    void hud.zombieMutationPortraitOf(z.key, z.mutation, z.color)
      .then((mutated) => { if (pim.isConnected) pim.src = mutated; })
      .catch(() => { /* retain the static species portrait */ });
  }
  const name = document.createElement("div");
  name.className = "zr-name";
  name.textContent = z.name;
  const cls = document.createElement("span");
  cls.className = "zr-cls";
  cls.textContent = z.className;
  cls.style.background = z.classColor;
  card.append(por, name, cls);
  card.onclick = onClick;
  return card;
}

export type ZombiesPanelTab = "roster" | "almanac" | "epic";

// The "Zombies" tab (right bar): "My Zombies" lists every owned zombie as its
// full inspect card (the same one shown when tapping a zombie); the "Zombie
// Almanac" is the species collection, and "Epic Zombies" is the same collection
// for the Epic Boss exclusives — they live in one tab of their own, under the boss
// that awards them, instead of being scattered through the Special section.
export function openZombiesPanel(hud: Hud, initialTab: ZombiesPanelTab = "roster") {
  // position:relative host (zl-panel) for card tooltips
  const { panel, close } = openModal({
    host: hud.el, bgClass: "zl-bg", panelClass: "zl-panel", replaceSelector: ".zl-bg",
  });

  const head = document.createElement("div");
  head.className = "zr-head";
  // Reuse the Market's screen-toggle look for the two tabs.
  const tabs = document.createElement("div");
  tabs.className = "pm-screens zl-tabs";
  const body = document.createElement("div");
  body.className = "zl-list";
  panel.append(head, tabs, body);

  const tabButtons: Record<ZombiesPanelTab, HTMLButtonElement> = {} as never;
  const show = (tab: ZombiesPanelTab) => {
    (Object.keys(tabButtons) as ZombiesPanelTab[]).forEach((key) =>
      tabButtons[key].classList.toggle("sel", key === tab));
    body.innerHTML = "";
    body.scrollTop = 0;
    if (tab === "roster") renderRoster();
    else renderAlmanac(tab === "epic");
  };
  const mkTab = (tab: ZombiesPanelTab, label: string) => {
    const b = document.createElement("button");
    b.className = "pm-screen";
    b.textContent = label;
    b.onclick = () => show(tab);
    tabButtons[tab] = b;
    tabs.appendChild(b);
  };
  mkTab("roster", "My Zombies");
  mkTab("almanac", "Zombie Almanac");
  mkTab("epic", "Epic Zombies");

  let rosterSort: ZombieSort = getZombieSort();

  const renderRoster = () => {
    // Show the complete owned roster here as a safety net for earned zombies. A boss
    // reward sent to storage remains visible and deployable even before the player
    // opens (or has room in) the physical Mausoleum panel.
    const roster = hud.getRoster ? hud.getRoster() : [];
    const onFarm = roster.filter((r) => !r.stored).length;
    const stored = roster.length - onFarm;
    head.innerHTML = "";
    const title = document.createElement("h2");
    title.textContent = "Your Zombies";
    const cnt = document.createElement("span");
    cnt.className = "zr-total";
    cnt.textContent = `${onFarm} on farm${stored ? ` · ${stored} stored` : ""}`;
    head.append(title, cnt);

    if (!roster.length) {
      const e = document.createElement("div");
      e.className = "zr-empty";
      e.textContent = "You do not own any zombies yet.";
      body.appendChild(e);
      return;
    }

    // Ordering picker — only worth showing once there is something to order.
    if (roster.length > 1) {
      const label = document.createElement("label");
      label.className = "zl-sort";
      label.append("Sort");
      const select = document.createElement("select");
      select.className = "prof-input zl-sort-select";
      select.setAttribute("aria-label", "Sort zombies");
      for (const option of ZOMBIE_SORTS) {
        const item = new Option(option.label, option.id);
        item.selected = option.id === rosterSort;
        select.appendChild(item);
      }
      select.onchange = () => {
        if (!isZombieSort(select.value)) return;
        rosterSort = select.value;
        setZombieSort(rosterSort);
        body.innerHTML = "";
        body.scrollTop = 0;
        renderRoster();
      };
      label.appendChild(select);
      head.appendChild(label);
    }

    // Sort the INSPECT views, not the raw roster: those carry the farmer's
    // strength/life multipliers, so the list ranks by the number each card shows.
    const infos = roster.map((z) => rosterInfo(hud, z));
    for (const info of sortZombies(infos, rosterSort, (k) => hud.state.abilityUnlocked(k))) {
      const row = document.createElement("div");
      // Use the exact same panel/card composition as the single-zombie modal;
      // the Zombies menu only adds the vertically scrolling list around it.
      row.className = "panel zpanel zl-row";
      row.appendChild(buildZombieCard(hud, info, panel));
      row.appendChild(buildZombieActions(hud, info, close, () => openZombiesPanel(hud, "roster")));
      body.appendChild(row);
    }
  };

  // Both collection tabs render the same grid of tiles; they differ in which half of
  // the Almanac they take and how the tiles are sectioned. Each keeps its OWN
  // discovered count — a species belongs to exactly one tab, so the two totals add up
  // to the whole Almanac instead of double-counting the epic exclusives.
  const renderAlmanac = (epicOnly: boolean) => {
    const all = hud.getAlmanac ? hud.getAlmanac() : [];
    const entries = epicOnly
      ? all.filter((entry) => entry.epicBoss)
          .sort((a, b) => (a.epicBoss?.order ?? 0) - (b.epicBoss?.order ?? 0))
      : all.filter((entry) => !entry.epicBoss);
    const found = entries.filter((entry) => entry.obtained > 0).length;
    head.innerHTML = "";
    const title = document.createElement("h2");
    title.textContent = epicOnly ? "Epic Zombies" : "Zombie Almanac";
    const cnt = document.createElement("span");
    cnt.className = "zr-total";
    cnt.textContent = `${found} / ${entries.length} discovered`;
    head.append(title, cnt);

    const grid = document.createElement("div");
    grid.className = "zr-grid alm-grid";
    body.appendChild(grid);
    // Sections: the boss that awards them on the epic tab, the species category on the
    // main one. Entries arrive pre-sorted by that key, so a change of value opens a
    // new section.
    let lastSection = "";
    for (const entry of entries) {
      const section = epicOnly
        ? entry.epicBoss?.name ?? "Epic Boss"
        : entry.category === "normal" ? "Normal" : entry.category === "mutant" ? "Mutant" : "Special";
      if (section !== lastSection) {
        lastSection = section;
        const header = document.createElement("div");
        header.className = "alm-section";
        header.textContent = section;
        grid.appendChild(header);
      }
      grid.appendChild(buildAlmanacCard(hud, entry));
    }
  };

  show(initialTab);
}

// Undiscovered portraits must not expose the real art: a CSS filter only blacks
// out the on-screen pixels, so "Save image" / long-press would still save the
// full-colour PNG. Instead we bake a genuinely black copy through a canvas and
// use that data-URL as the img src — the silhouette IS the image.
const silhouetteCache = new Map<string, Promise<string>>();
function silhouetteOf(url: string): Promise<string> {
  let p = silhouetteCache.get(url);
  if (!p) {
    p = new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        ctx.globalCompositeOperation = "source-in";
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, c.width, c.height);
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error(`portrait load failed: ${url}`));
      img.src = url;
    });
    silhouetteCache.set(url, p);
  }
  return p;
}

/** An <img> showing only the black silhouette of the portrait at `url`. The
 *  real art is never assigned as src, so saving the image saves the shadow. */
function silhouetteImg(url: string): HTMLImageElement {
  const pim = document.createElement("img");
  pim.className = "zr-por-img alm-sil";
  pim.draggable = false;
  if (url) silhouetteOf(url).then((src) => { pim.src = src; }).catch(() => {});
  return pim;
}

/** One Almanac tile: the species portrait (a black silhouette until obtained),
 *  its name, and the lifetime count. Tapping opens the entry detail. */
function buildAlmanacCard(hud: Hud, entry: AlmanacEntryView): HTMLElement {
  const card = document.createElement("div");
  card.className = "zr-card alm-card";
  const por = document.createElement("div");
  por.className = "zr-por";
  let pim: HTMLImageElement;
  if (entry.obtained) {
    pim = document.createElement("img");
    pim.className = "zr-por-img";
    if (entry.portrait) pim.src = entry.portrait;
  } else {
    pim = silhouetteImg(entry.portrait);
  }
  por.appendChild(pim);
  if (entry.obtained) {
    const count = document.createElement("span");
    count.className = "alm-count";
    count.textContent = `×${entry.obtained}`;
    por.appendChild(count);
  }
  const name = document.createElement("div");
  name.className = "zr-name";
  name.textContent = entry.name;
  card.append(por, name);
  if (entry.obtained) {
    const cls = document.createElement("span");
    cls.className = "zr-cls";
    cls.textContent = entry.className;
    cls.style.background = entry.classColor;
    card.appendChild(cls);
  } else {
    const unknown = document.createElement("span");
    unknown.className = "zr-cls alm-unknown";
    unknown.textContent = "Not found";
    card.appendChild(unknown);
  }
  card.onclick = () => openAlmanacEntry(hud, entry);
  return card;
}

/** The Almanac detail modal. Discovered: the full trading card with BASE stats
 *  (no modifiers) + lifetime count. Undiscovered: only how to obtain it. */
function openAlmanacEntry(hud: Hud, entry: AlmanacEntryView) {
  const { panel } = openModal({ host: hud.el, panelClass: "zpanel", bgClass: "alm-bg", replaceSelector: ".alm-bg" });

  if (entry.obtained > 0) {
    const info: ZombieInfo = {
      name: entry.name, typeName: entry.name, key: entry.key, group: entry.group,
      className: entry.className, classColor: entry.classColor,
      str: entry.str, dex: entry.dex, con: entry.con, focus: entry.focus,
      mutation: 0, invasions: 0, portrait: entry.portrait,
    };
    panel.appendChild(buildZombieCard(hud, info, panel));
    const meta = document.createElement("div");
    meta.className = "alm-meta";
    meta.innerHTML = `<b>Lifetime obtained: ${entry.obtained}</b>`;
    panel.appendChild(meta);
    const hint = document.createElement("p");
    hint.className = "alm-hint";
    hint.textContent = entry.hint;
    panel.appendChild(hint);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "alm-detail";
  const por = document.createElement("div");
  por.className = "zr-por alm-detail-por";
  por.appendChild(silhouetteImg(entry.portrait));
  const title = document.createElement("h2");
  title.textContent = entry.name;
  const status = document.createElement("div");
  status.className = "alm-meta";
  status.textContent = "Not yet obtained";
  const hint = document.createElement("p");
  hint.className = "alm-hint";
  hint.textContent = entry.hint;
  wrap.append(por, title, status, hint);
  panel.appendChild(wrap);
}
