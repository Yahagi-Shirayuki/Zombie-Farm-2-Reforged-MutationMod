import { Application, Assets, Container, FederatedPointerEvent, Graphics, Point, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { snapPlowOrigin } from "./plowSelection";
// Patch Pixi's renderer to use no-eval polyfills for its shader/UBO/uniform/particle
// codegen (it otherwise uses `new Function`, which the production CSP's script-src
// blocks — no 'unsafe-eval'). Side-effect import; must run before `new Application()`.
// pixi.js lists ./lib/unsafe-eval/init.* under "sideEffects", so it survives bundling.
import "pixi.js/unsafe-eval";
import { loadAssets, ensureBackgroundTexture, ensureObjectTexture, ensureObjectTextures, objectSpriteFiles, PlaceableDef, BoostDef, SEED_FILE, ZombieDef, zombiePortrait, ZOMBIE_STAGES, raidRewardImage, purchasableZombies, placeablePurchaseLimit, objectTint } from "./assets";
import { pickPiece, type SceneryPiece, surroundingsTheme, themeObjectFiles } from "./surroundings";
import { MAX_ZOMBIE_POTS, noRoomForAnother } from "./placementLimit";
import { Field, CARROT, CropConfig, PLOT } from "./Field";
import { Actor } from "./Actor";
import { PetActor } from "./PetActor";
import { WalkController } from "./WalkController";
import { ZombieField } from "./zombie/ZombieField";
import { makeOwned, type OwnedZombie } from "./zombie/types";
import { encodeReceivedZombie, parseReceivedZombie } from "./zombie/receivedReward";
import { almanacEntries, isEpicZombie, obtainHint } from "./zombie/almanac";
import { fallenToInfo, snapshotFallen } from "./zombie/memorial";
import { POT_DURATION_MS } from "./zombie/ZombiePot";
import { isCombinePromotion } from "./zombie/combineSpecies";
import { GameState } from "./GameState";
import { ensureLocalStoredIds, takeStoredObject } from "./storedObjectOwnership";
import { Hud, graveNeededFor, LevelUpUnlock, ReceivedView, QuestCompleteView, QuestReward, type Mode } from "./hud";
import { JobSystem } from "./JobSystem";
import { AudioManager } from "./audio";
import { SaveManager } from "./save/SaveManager";
import * as profiles from "./save/profiles";
import * as api from "./net/api";
import * as auth from "./net/auth";
import { requireAuth } from "./net/gate";
import { getVisitTarget, enterVisit, exitVisit, clearVisitTarget } from "./net/visit";
import { EconomyClient } from "./net/economy";
import { epicBossRunToClient, serverTimestampToClient } from "./net/clock";
import { QuestBus, QuestEvent } from "./quest/events";
import { objectQuestAliases } from "./quest/objectVariants";
import { QuestSystem } from "./quest/QuestSystem";
import { PeriodicQuestSystem } from "./quest/periodic/PeriodicQuestSystem";
import { QuestDef, questBonusRewardInfo, questRewardInfo } from "./quest/types";
import { RaidManager, RaidResultView, type LootDrop } from "./raid/RaidManager";
import { RaidScene } from "./raid/RaidScene";
import { RAID_COOLDOWN_MS } from "./raid/RaidCatalog";
import { reconcilePartySelection } from "./raid/partySelection";
import { planTeamAssembly, sanitizeTeams, settleTeamMembers } from "./zombie/teams";
import { postRaidWinQuests } from "./raid/questEvents";
import { invasionSettlementNotice } from "./raid/settlementNotice";
import {
  invasionExpiryMessage,
  invasionExpiryState,
  type InvasionExpiryState,
} from "./raid/sessionExpiry";
import { screenToGrid, tileCenter, TILE_H, TILE_W, HW, HH } from "./iso";
import { setFootprint } from "./depthSort";
import { NightLayer, makeLight } from "./lighting";
import { buyXp, sellBack, zombieSellValue } from "./economy";
import { farmerHeadXp } from "./farmer";
import { purchaseXpFeedback } from "./purchaseFeedback";
import { harvestXp, plowXp } from "./farmRewards";
import {
  DEFAULT_FARM_BACKGROUND, getFarmBackground, isFarmBackground, setFarmBackground,
  FARM_BG_DENSITY, type FarmBackground, getDayNightMode, setDayNightMode,
  isLocalNight, type DayNightMode, hasSeenHazardTip, markHazardTipSeen,
  hasSeenRaidTip, markRaidTipSeen, hasSeenEliteTip, markEliteTipSeen,
  zombieAppearancePrefs, setZombieBodyColorMode, setShowZombieMutations,
} from "./prefs";
import { raidTip } from "./raid/raidTips";
import { BASE } from "./base";
import { TutorialController } from "./tutorial/TutorialController";
import { reconcileTutorialCompletion, TutStep, TUTORIAL_ZOMBIE_KEY } from "./tutorial/steps";
import { initPlatform, isMobile, isTouch } from "./platform";
import { initPwa, promptReload, checkForUpdate } from "./pwa";
import { initDiagnostics } from "./diagnostics";
import {
  captureTouchPointer, gestureMoved, isDeferredTouchMode, isOutsideFarmPanGesture, isTouchPointer,
  isSelectTapGesture, isZombieHold, plotOwnsObjectTap, shouldRecoverTouchPointerUp, TOUCH_ZOMBIE_HOLD_MS,
} from "./touchInput";
import {
  appendHarvestTarget, harvestTargetKey, sampleStrokeSegment, type HarvestTarget,
} from "./harvestStroke";
import { mutationMarketDescription } from "./zombie/statDisplay";
import {
  combineSubject, combineSubjectAliases, mutantSubjectIndex, unitQuestSubjects,
  unitSubjectAliases,
} from "./quest/mutantSubjects";
import { resolveCropMutations } from "./zombie/cropMutations";
import { MutationPortraits } from "./zombie/mutationPortrait";
import {
  DR_GROUNDHOG,
  EPIC_BOSSES,
  epicBossById,
  epicBossUnlockLevel,
} from "./epicBoss/catalog";
import { EpicBossManager } from "./epicBoss/EpicBossManager";
import { buildEpicBossSetup, rollEpicBossLoot } from "./epicBoss/combat";
import { epicBossCurrencyReward } from "./epicBoss/rewards";
import { epicZombieRewardNotes, visibleEpicBosses } from "./epicBoss/market";
import { dropsEpicBossToken, EPIC_BOSS_FIGHT_BRAIN_COST } from "./epicBoss/tokens";
import { offerFullscreenPrompt } from "./ui/panels/fullscreenPrompt";
import { openToolWheel, type ToolWheelHandle, type ToolWheelItem } from "./ui/toolWheel";
import {
  choosePlayMode, getPreferredPlayMode, setPreferredPlayMode, showOnlineUnavailable,
  showLocalUnavailable, usesOnlineGameplay, type PlayMode,
} from "./playMode";
import { fetchServiceStatus, isExportOnly, OPEN_STATUS } from "./net/serviceStatus";
import { showExportOnly } from "./exportOnly";

// The boot / start screen lives in index.html and paints on the first frame (no
// empty-farm flash). We report load milestones to it and, once the game is fully
// built, tell it to finish — it then shows "Click to Start" and a tap dismisses it.
const boot = (window as unknown as {
  __ZFBoot?: {
    progress(p: number): void;
    ready(onDismiss?: () => void): void;
    /** Retire the overlay because a full-screen flow other than the game takes over. */
    close(): void;
    fail(): void;
  };
}).__ZFBoot;

// Export writes the same kind of file from either farm — a plain SaveGame — and only
// Local Farm's Import reads one, so an export never travels back online. Module scope
// because the closedown export screen runs long before the Settings wiring exists.
function downloadSaveFile(raw: string, name: string): void {
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `zombie-farm-${name}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function main() {
  // Capture crashes before anything else runs, so a failure during boot (asset load,
  // save decode, mode chooser) still lands in the diagnostics buffer. Local-only.
  initDiagnostics();
  // Detect device up front so <html data-platform> is set before the HUD's CSS
  // renders (drives the compact/desktop layout; re-evaluates on resize/rotate).
  initPlatform();
  // Local Farm and Online Farm are deliberately independent save domains. Choose
  // before touching auth so Local Farm never makes account/gameplay server calls,
  // even when this browser still has a valid Online Farm session.
  //
  // Ask the server what it currently permits BEFORE offering the choice. During the
  // beta→release closedown this is what lets the chooser say "Online Farm is closed,
  // export it" instead of sending the player through a sign-in that ends in an error.
  // It fails open, so a flaky connection never fakes a closure.
  //
  // Skipped outright for a player who has already chosen Local Farm: no service mode
  // can change anything for them, and making them wait on a network round trip — or
  // on its timeout, offline — before their own device's farm opens would be a
  // regression for the one group the closedown is meant not to touch.
  const service = getPreferredPlayMode() === "local" ? OPEN_STATUS : await fetchServiceStatus();
  const playMode: PlayMode = await choosePlayMode(auth.isOnlineAvailable(), service);
  const onlineFarm = usesOnlineGameplay(playMode);
  // Online Farm chosen while the service is read-only: sign in and load the farm, then
  // hand it over instead of entering the game (see the export handoff below).
  const exportOnlyFarm = onlineFarm && isExportOnly(service);
  initPwa(playMode);
  if (onlineFarm) {
    await auth.refreshIfSignedIn();
    await requireAuth();
  }
  // Remote revocation (including another device taking over) is surfaced by the
  // API auth bridge. Reloading re-enters requireAuth before any game state is built.
  auth.onAuthChange(() => {
    if (onlineFarm && !auth.isSignedIn()) location.reload();
  });
  // Read-only visit: don't claim the exclusive writer lease. Nothing will be written,
  // and taking it would show the player's other device a spurious "Farm active
  // elsewhere" takeover prompt for a session that is only here to export.
  if (onlineFarm && !exportOnlyFarm) await api.prepareWriterAccess();
  boot?.progress(0.35); // signed in — start filling the plate bar
  const app = new Application();
  await app.init({
    // Viewport filler beyond the backdrop: the grass-green of the default hills.
    // Re-set per ground skin by applySurroundings (see surroundings.ts).
    background: "#67bb4e",
    resizeTo: window,
    antialias: false,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  // The game is designed around a 60 Hz cadence; without a cap Pixi redraws the
  // whole scene at the monitor's refresh rate (165+ Hz on gaming displays), which
  // saturates the GPU and starves other applications even while the farm idles.
  app.ticker.maxFPS = 60;
  document.getElementById("app")!.appendChild(app.canvas);

  const assets = await loadAssets();
  boot?.progress(0.8); // heaviest step done — art is in
  const state = new GameState();
  let epicBoss = new EpicBossManager(DR_GROUNDHOG);
  state.seedFarmerCatalog(assets.farmer);
  const audio = new AudioManager(); // music/SFX default off (toggled in Settings)
  const hud = new Hud(state, audio, playMode);
  hud.setPlayStatus(playMode, playMode === "online" ? "reconnecting" : "synced");
  const mutationPortraits = new MutationPortraits(app.renderer, assets);
  hud.zombieMutationPortraitOf = (key, mutation, color, wanted) =>
    mutationPortraits.get(key, mutation, color, wanted);
  hud.setFarmerCatalog(assets.farmer);
  hud.setPetCatalog(assets.pets);
  // Give Android/browser Back an in-app dismissal layer. One guard entry keeps the
  // URL unchanged; if the HUD has nothing to close, the second back continues to
  // the page that preceded the game instead of trapping the player here.
  if (isMobile()) {
    const armMobileBack = () => history.pushState(
      { ...(history.state ?? {}), zfMobileBackGuard: true }, "", location.href
    );
    let leavingViaBack = false;
    armMobileBack();
    window.addEventListener("popstate", () => {
      if (leavingViaBack) return;
      if (hud.handleMobileBack()) armMobileBack();
      else {
        leavingViaBack = true;
        history.back();
      }
    });
  }

  // Build the plant/zombie picker catalog from the market data. Cards show the
  // real grow time, but actual growth is scaled down so crops finish while playing.
  const fmtTime = (ms: number) => {
    const s = ms / 1000;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    if (s < 86400) return `${Math.round(s / 3600)}h`;
    return `${Math.round(s / 86400)}d`;
  };
  // Catalog: crop key -> config, shared by the picker (hud) and save/load (to
  // rebuild planted crops from their saved key). Seed it with the quick-plant CARROT.
  const catalog = new Map<string, CropConfig>();
  catalog.set(CARROT.key, CARROT);
  const plantCards = assets.plants.map((p) => {
    const cfg: CropConfig = {
      key: p.key, name: p.name, stages: [SEED_FILE, p.stage1, p.stage2],
      growMs: p.growMs, cost: p.cost, sell: p.sell, xp: p.xp,
      unlockLevel: p.level, harvestIcon: p.icon,
    };
    catalog.set(cfg.key, cfg);
    return {
      name: p.name, cost: p.cost, sell: p.sell, timeLabel: fmtTime(p.growMs),
      level: p.level, seasonal: p.seasonal,
      portrait: `${BASE}assets/crop-icons/${p.icon}`, cfg,
    };
  });
  // Zombie type catalog by key, so a harvested zombie crop can look up its full
  // def (stats + taxonomy) to spawn the matching owned unit.
  const zombieDefs = new Map<string, ZombieDef>();
  for (const z of assets.zombies) zombieDefs.set(z.key, z);
  // Mutation bit -> Market mutant species name. A zombie that grew its mutation next
  // to crops answers to the bought mutant's name for quest purposes (quest 55/56).
  const mutantSubjects = mutantSubjectIndex(assets.zombies);
  /** The extra quest subjects an owned unit's mutations make it equivalent to.
   *  Spawns hand back either the live actor or a stored record, so read whichever. */
  const unitSubjectAliasesOf = (
    unit: { getData(): { key: string; mutation: number } } | { key: string; mutation: number } | null | undefined
  ): readonly string[] => {
    if (!unit) return [];
    const data = "getData" in unit ? unit.getData() : unit;
    return unitSubjectAliases(
      zombieDefs.get(data.key)?.name ?? data.key, data.mutation ?? 0, mutantSubjects
    );
  };
  /** The Zombie Pot's "combined" subject plus every pairing the parents' mutations
   *  also stand for, so quest 56 accepts two field-mutated Regular Zombies. */
  const combinedPotSubjects = (pot: { keyA: string; keyB: string; maskA: number; maskB: number }) => {
    const subjectsOf = (key: string, mask: number) =>
      unitQuestSubjects(zombieDefs.get(key)?.name ?? "", mask, mutantSubjects).filter(Boolean);
    const a = subjectsOf(pot.keyA, pot.maskA);
    const b = subjectsOf(pot.keyB, pot.maskB);
    return { subject: combineSubject(a[0] ?? "", b[0] ?? ""), aliases: combineSubjectAliases(a, b) };
  };
  const offlineHarvestMutation = (key: string, context: { cropKeys: string[]; guaranteed: boolean }): number | undefined => {
    if (state.onFarm) return undefined; // online mutation rolls are server-owned
    const def = zombieDefs.get(key);
    if (!def) return undefined;
    return resolveCropMutations(def.mutation ?? 0, context.cropKeys, {
      guaranteed: context.guaranteed,
      headless: def.group === "Headless",
    });
  };
  const allZombieCards = assets.zombies.map((z) => {
    const cfg: CropConfig = {
      key: z.key, name: z.name,
      // Zombie crop growth: wooden cross -> hand -> clawing up -> risen (thumb up).
      stages: ZOMBIE_STAGES,
      growMs: z.growMs, cost: z.cost, brainsNeeded: z.brainsNeeded, sell: 0, xp: z.xp,
      unlockLevel: z.level, isZombie: true, isMutant: z.category === "mutant",
      unlockGrave: graveNeededFor(z.className) ?? undefined, // Blue/Red/Silver graves gate planting
    };
    catalog.set(cfg.key, cfg);
    return {
      name: z.name, cost: z.cost, brains: z.brainsNeeded, timeLabel: fmtTime(z.growMs), level: z.level,
      category: z.category,
      // Catalog stats are pre-mutation (makeOwned folds the bonus in), so this is the
      // exact displayed gain the grown unit's stat tile will show.
      description: mutationMarketDescription(z, z.mutation ?? 0),
      portrait: zombiePortrait(z.key), // per-type composited portrait
      zombie: {
        group: z.group, className: z.className, classColor: z.classColor,
        str: z.str, dex: z.dex, con: z.con, focus: z.focus, mutation: z.mutation ?? 0,
      },
      cfg,
    };
  });
  const purchasableZombieKeys = new Set(purchasableZombies(assets.zombies).map((zombie) => zombie.key));
  const zombieCards = allZombieCards.filter((card) => purchasableZombieKeys.has(card.cfg.key));
  hud.setCatalog(plantCards, zombieCards);
  hud.setBlackMarketCatalog(allZombieCards);

  // Placeable-object catalog: key -> def, for the buy menu and save/load. Apply
  // the same debug grow-scaling to fruit-tree regrow timers as crops use.
  const placeCatalog = new Map<string, PlaceableDef>();
  const placeByName = new Map<string, PlaceableDef>();
  for (const o of assets.placeables) {
    placeCatalog.set(o.key, o);
    // Loot/quest rewards are keyed by display name. A recolour family repeats a
    // name (both Fence Gate states are "Fence Gate"), so the FIRST row wins and a
    // variant never displaces the base a reward looks up.
    if (!placeByName.has(o.name)) placeByName.set(o.name, o);
  }
  // "Buy a Fence" counts the Blue Fence the player actually bought.
  const objectAliases = objectQuestAliases(assets.placeables);
  hud.setPlaceables(
    assets.placeables.map((o) => ({
      name: o.name, cost: o.cost, level: o.level, brainsNeeded: o.brainsNeeded,
      category: o.category, portrait: `${BASE}assets/objects/${o.sprite}`, def: o,
    }))
  );

  // Consumable boosts (Market Boosts tab + the boost inventory in Storage).
  const boostCatalog = new Map<string, BoostDef>();
  for (const b of assets.boosts) boostCatalog.set(b.key, b);
  hud.setBoosts(assets.boosts);

  // Level-up popup: gather everything the new level(s) opened up — invasions,
  // market items, boosts — and show the celebratory unlock screen.
  const raidImg = (f: string) => `${BASE}assets/raids/images/${f}`;
  state.onLevelUpCb = (from, to) => {
    const unlocks: LevelUpUnlock[] = [];
    for (const r of assets.raids) {
      if (r.unlockLevel > from && r.unlockLevel <= to) {
        const f = r.bossPortrait || r.enemyIcon;
        unlocks.push({ icon: f ? raidImg(f) : "", name: r.name, kind: "Invasion" });
      }
    }
    for (const o of assets.placeables) {
      if (o.level > from && o.level <= to)
        unlocks.push({
          icon: `${BASE}assets/objects/${o.sprite}`, tint: objectTint(o.color),
          name: o.name, kind: "Item",
        });
    }
    for (const b of assets.boosts) {
      if (b.level > from && b.level <= to)
        unlocks.push({ icon: `${BASE}assets/boosts/${b.icon}`, name: b.name, kind: "Boost" });
    }
    if (from < 20 && to >= 20) {
      unlocks.push({
        icon: zombiePortrait("ZombieActorZomBetty"),
        name: "Special zombies can now be purchased on the Black Market",
        kind: "Black Market",
      });
    }
    hud.openLevelUp({ level: to, unlocks });
    audio.play("levelUp");
  };

  // World container = camera. Field + entity layer live inside it.
  const world = new Container();
  app.stage.addChild(world);

  // Static hills-and-sky backdrop. The farm's top corner (tile 0,0) sits at world
  // y=0 and the land is centered on x=0, so anchor the backdrop bottom-center and
  // lift it a few tiles above y=0 — its hill bases stay just above the top tiles,
  // never overlapping the field. It lives at the back of the world so it pans and
  // zooms with the farm.
  const BG_GAP_TILES = 3; // hill bases stay this many tiles above the top tile
  const background = new Sprite(assets.background);
  background.anchor.set(0.5, 1);
  background.position.set(0, -BG_GAP_TILES * TILE_H);
  world.addChild(background);

  const field = new Field(assets);
  world.addChild(field.container);

  // Placed objects (trees) and the actors share Field.entityLayer so the farmer
  // depth-sorts correctly in front of / behind trees.
  world.addChild(field.entityLayer);

  // Plant/harvest job diamonds draw above entities so tall ripe crops do not clip
  // them. Plow markers live beside plotLayer inside Field, under actors/crops.
  world.addChild(field.highlightLayer);

  // Fertilize leaf FX draw above crops/actors (below night so they dim at dusk).
  world.addChild(field.fxLayer);

  // Decorative scenery on the land AROUND the farm — never on a farm tile. It's
  // added to the depth-sorted entity layer (zIndex = grid depth) so trees south of
  // the farm draw in front of it and northern ones behind, matching placed trees.
  // Purely visual: not registered in the tile grid, so it blocks nothing.
  //
  // Rebuildable: a Farm Size upgrade grows field.w/h, so the ring must move outward
  // (old foliage would otherwise end up sitting ON the newly-added farm tiles). We
  // track the sprites and regenerate them against the current bounds. The RNG is
  // seeded per field size so a given farm size always yields the same stable layout.
  //
  // WHAT gets scattered comes from the applied ground skin (see surroundings.ts):
  // grass keeps the temperate trees/shrubs, the sandy skin gets palms and a
  // shipwrecked pirate's cargo, and so on.
  let foliage: Sprite[] = [];
  // A visit may display the friend's selection, but must never overwrite this
  // device's own preference in localStorage.
  let displayedFarmBackground: FarmBackground = getFarmBackground();
  let surroundings = surroundingsTheme(field.climate);
  // Bumped by every build so a texture load that finishes after a later rebuild
  // (or a theme switch) resolves into a no-op instead of a duplicate ring.
  let foliageGeneration = 0;
  const buildFoliage = () => {
    const generation = ++foliageGeneration;
    for (const s of foliage) { s.parent?.removeChild(s); s.destroy(); }
    foliage = [];
    // Theme pieces are ordinary object art, which loads lazily. Draw with whatever
    // is already resident, and rebuild once the rest of this theme's art arrives.
    const missing = themeObjectFiles(surroundings).filter((f) => !assets.objects[f]);
    if (missing.length) {
      void Promise.all(missing.map((f) => ensureObjectTexture(assets, f).catch(() => null)))
        .then(() => { if (generation === foliageGeneration) buildFoliage(); });
    }
    const pieceTexture = (p: SceneryPiece): Texture | null =>
      (p.scenery ? assets.scenery[p.file] : assets.objects[p.file]) ?? null;
    const objScale = TILE_W / assets.field.tileW;
    let seed = 20240706 ^ (field.w << 8) ^ field.h;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    // How many tiles a point lies OUTSIDE the farm rectangle (0 = inside it).
    const distOutside = (c: number, r: number) =>
      Math.max(0, Math.max(-c, c - (field.w - 1)), Math.max(-r, r - (field.h - 1)));
    const MARGIN = 2.5; // clear grass between the farm edge and the nearest foliage

    // Fill the WORLD-SPACE rectangle the camera can reveal at max zoom-out
    // ([boundL..boundR] x [treeTop..boundB]) instead of a grid-space diamond ring —
    // that ring is why the far screen corners used to sit on bare grass when fully
    // zoomed out. We sweep the rotated (u,v) lattice (u = col-row, v = col+row),
    // which maps straight onto that rect:  worldX = u*HW,  worldY = v*HH + HH.
    const treeTop = background.position.y + 6; // grass just below the hill bases
    const uMin = Math.floor(boundL / HW) - 2, uMax = Math.ceil(boundR / HW) + 2;
    const vMin = Math.floor((treeTop - HH) / HH) - 2;
    const vMax = Math.ceil((boundB - HH) / HH) + 2;
    const STEP = 2;
    // Farm Background setting scales the tree count: Deep Forest = full, Woodland
    // ~half, Light Meadow ~a tenth. Same seed, so the sparser sets are subsets of
    // the denser ones and switching just thins/thickens the same forest. The theme
    // scales it again — a paved lot or an airless moon stays sparse at every
    // setting (surroundings.ts `density`).
    const accept = 0.34 * FARM_BG_DENSITY[displayedFarmBackground] *
      (surroundings.density ?? 1);
    const treeShare = surroundings.treeShare ?? 0.5;
    for (let v = vMin; v <= vMax; v += STEP) {
      for (let u = uMin; u <= uMax; u += STEP) {
        const ju = u + (rnd() - 0.5) * STEP * 1.3; // jitter off the lattice
        const jv = v + (rnd() - 0.5) * STEP * 1.3;
        const wx = ju * HW, wy = jv * HH + HH;
        const col = (ju + jv) / 2, row = (jv - ju) / 2;
        const d = distOutside(col, row);
        const r1 = rnd(), r2 = rnd(), r3 = rnd(); // consume RNG evenly (stable layout)
        // Gate: inside the reachable rect (slight overshoot so edges fully cover) and
        // off the farm + its clearing margin.
        if (wx < boundL - HW || wx > boundR + HW || wy < treeTop || wy > boundB + HH) continue;
        if (d < MARGIN) continue;
        // Woodland fill: the far band is `treeShare` trees and the rest props, and
        // everything nearer the clearing edge is a prop. `accept` sets how much of
        // the lattice is populated at all.
        if (r1 >= accept) continue;
        const isTree = d >= 4.5 && r2 < treeShare;
        // Piece choice is hashed off the lattice point, not drawn from `rnd`: the
        // draws left also set the SIZE, so sharing one would tie every big piece to
        // the same object. Sizes are multiples of the piece's NATIVE object scale,
        // so a scenery palm matches a placed one exactly.
        const piece = pickPiece(isTree ? surroundings.trees : surroundings.props, u, v);
        const tex = pieceTexture(piece);
        if (!tex) continue; // theme art still loading — the rebuild above fills it in
        const s = objScale * (piece.scale ?? 1) *
          (isTree ? 0.85 + r3 * 0.30 : 0.80 + r3 * 0.35);
        const sp = new Sprite(tex);
        sp.anchor.set(0.5, 1);
        sp.scale.set(s);
        sp.position.set(wx, wy);
        // Point footprint on its tile so it depth-sorts with trees/actors.
        const fc = Math.round(col), fr = Math.round(row);
        setFootprint(sp, fc, fr, fc, fr);
        field.entityLayer.addChild(sp);
        foliage.push(sp);
      }
    }
  };

  const actor = new Actor(assets);
  field.entityLayer.addChild(actor.container);
  let appliedHead = -1;
  let appliedBody = -1;
  const applyFarmerAppearance = () => {
    if (appliedHead === state.farmerHeadId && appliedBody === state.farmerBodyId) return;
    const head = assets.farmer.heads.find((part) => part.id === state.farmerHeadId);
    const body = assets.farmer.bodies.find((part) => part.id === state.farmerBodyId);
    if (!head || !body) return;
    actor.setAppearance(head.part, body.id);
    appliedHead = head.id;
    appliedBody = body.id;
  };
  state.onChange(applyFarmerAppearance);
  applyFarmerAppearance();

  let petActor: PetActor | null = null;
  let appliedPet: string | null | undefined;
  let petLoadGeneration = 0;
  const applyActivePet = () => {
    if (appliedPet === state.activePet) return;
    appliedPet = state.activePet;
    const generation = ++petLoadGeneration;
    petActor?.destroy();
    petActor = null;
    if (!state.activePet) return;
    const def = assets.pets.pets.find((pet) => pet.key === state.activePet);
    if (!def) return;
    void PetActor.load(def).then((loaded) => {
      if (generation !== petLoadGeneration || state.activePet !== def.key) {
        loaded.destroy();
        return;
      }
      petActor = loaded;
      field.entityLayer.addChild(loaded.container);
      loaded.update(0, actor.container.x, actor.container.y);
    }).catch((error) => console.warn(`[pet] failed to load ${def.key}`, error));
  };
  state.onChange(applyActivePet);
  applyActivePet();

  let penPetActors: PetActor[] = [];
  let appliedPenPets = "";
  let penPetLoadGeneration = 0;
  const applyPenPets = () => {
    const signature = state.penPets.join("\0");
    if (signature === appliedPenPets) return;
    appliedPenPets = signature;
    const generation = ++penPetLoadGeneration;
    penPetActors.forEach((pet) => pet.destroy());
    penPetActors = [];
    void Promise.all(state.penPets.flatMap((key) => {
      const def = assets.pets.pets.find((pet) => pet.key === key);
      return def ? [PetActor.load(def)] : [];
    })).then((loaded) => {
      if (generation !== penPetLoadGeneration || state.penPets.join("\0") !== signature) {
        loaded.forEach((pet) => pet.destroy());
        return;
      }
      penPetActors = loaded;
      for (const pet of loaded) field.entityLayer.addChild(pet.container);
    }).catch((error) => console.warn("[pet-pen] failed to load occupants", error));
  };
  state.onChange(applyPenPets);
  applyPenPets();

  const start = assets.field.start;
  const walk = new WalkController(actor, field, start.col, start.row);

  // Owned zombies (Phase 3): grown from harvested zombie crops, they wander the
  // farm (routing around objects) and can be selected to inspect their stats.
  const zombies = new ZombieField(
    assets, field, state, (key) => zombieDefs.get(key), () => audio.play("instaGrow"),
    () => walk.tile // where a unit with no saved position of its own arrives
  );
  audio.setZombieBarkSource(() => zombies.randomBrainBark());
  // The graveyard. Wired here (not in the online block) because both the offline
  // and the server-verified raid paths funnel their dead through removeCasualties,
  // and a Memorial Statue is a purely local, cosmetic keepsake either way.
  zombies.onFallen = (units) =>
    state.recordFallen(units.map((unit) => snapshotFallen(unit, Date.now())));
  zombies.onRevived = (ids) => state.forgetFallen(ids);
  // Selling or shelving a statue must not take its occupant with it.
  field.onMemorialReleased = (fallen) => state.releaseFallen(fallen);

  // Night lighting layer: a dark mask with the lights erased out of it (revealing
  // the daytime scene under each light — never a glare), above the farm/entities
  // but below the job labels & cursor (UI stays readable). Toggled from the HUD's
  // Developer menu for now (a real day/night cycle comes later).
  const night = new NightLayer();
  night.lights.addChild(field.objectLights); // glowing objects' lights
  // Farmer lantern: two point lights (ZF2 addPlayerLight: radius 200 & 350, white).
  // Alpha here = how strongly the light carves the darkness away (reveals daytime).
  const lanternInner = makeLight(200, 0xfff0c8, 1.0);
  const lanternOuter = makeLight(350, 0xffe6b0, 0.55);
  night.lights.addChild(lanternOuter, lanternInner);
  world.addChild(night);
  let isNight = false;
  const setNight = (on: boolean) => {
    // A browser may preserve the JS objects while discarding their GPU render
    // target in the background. Rebuild on an off->on transition so a cold night
    // load never inherits an empty light map.
    if (on && !isNight) night.resetRenderTarget();
    isNight = on;
    night.visible = on;
    actor.setLanternVisible(on);
    lanternInner.visible = on;
    lanternOuter.visible = on;
    // Leave the viewport FILLER (the area beyond the hills backdrop) at its daytime
    // colour in both modes — it's the exact mid-hill colour of the current skin's
    // backdrop (surroundings.ts `filler`). At night the NightLayer's dark overlay
    // covers the whole screen, so it darkens this filler by the SAME amount as the
    // hills; they read as one continuous surface instead of the hills floating over
    // a near-black void.
  };
  let dayNightMode: DayNightMode = getDayNightMode();
  const syncEnvironment = () => {
    setNight(dayNightMode === "night" || (dayNightMode === "auto" && isLocalNight()));
  };
  hud.getNight = () => isNight;
  hud.onSetNight = (on) => setNight(on); // retained for the developer menu
  hud.getDayNightMode = () => dayNightMode;
  hud.onSetDayNightMode = (mode) => {
    dayNightMode = mode;
    setDayNightMode(mode);
    syncEnvironment();
  };
  syncEnvironment();
  // Auto mode crosses the 7am/7pm boundary without requiring a reload.
  window.setInterval(() => {
    if (dayNightMode === "auto") syncEnvironment();
  }, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      if (isNight) night.resetRenderTarget();
      if (dayNightMode === "auto") syncEnvironment();
    }
  });
  app.canvas.addEventListener("webglcontextrestored", () => {
    night.resetRenderTarget();
    syncEnvironment();
  });

  // Job labels ("Plow/Plant/Harvest" pills) and the plot cursor render above the
  // field + entities so they're never hidden behind the farmer/zombie. The plow
  // selection itself is parented with the soil inside Field.
  world.addChild(field.labelLayer);
  world.addChild(field.cursor);

  // Center camera on the starting tile (pivot = that tile center) and render the
  // farm ~2.2x bigger by default. Wheel to zoom toward the cursor.
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 3;
  const DEFAULT_ZOOM = 1.0;
  const sc = tileCenter(start.col, start.row);
  world.pivot.set(sc.x, sc.y);
  world.scale.set(DEFAULT_ZOOM);
  const REACH = 10; // tiles of grass beyond the farm the camera may show (foliage band)
  const BG_BASE_HALF = assets.background.width / 2; // native half-width of the backdrop

  // Scale the hills/sky backdrop so it always spans the (possibly upgraded) farm. A
  // bigger farm reaches farther in world-x than the native 2800px art; without this
  // the camera clamp (bounded below by the backdrop width) would cut off the far
  // corners. Scaling keeps the horizon covering the whole field.
  const fitBackground = () => {
    const halfSpan = (field.w - 1 + 2 * REACH) * HW + 90;
    background.scale.set(Math.max(1, halfSpan / BG_BASE_HALF));
    background.position.set(0, -BG_GAP_TILES * TILE_H);
  };

  // Box the camera into the world: the view can pan/zoom to reveal the full sky
  // (top), the farm, and the decorated grass ring around it, but no further into
  // empty green void or above the sky. Recomputed whenever the farm grows; the reach
  // matches the foliage band so all scenery stays reachable.
  let boundL = 0, boundR = 0, boundT = 0, boundB = 0;
  const computeBounds = () => {
    const skyTopY = background.y - background.height; // world y of the sky's top edge
    const grassBoundL = -((field.w - 1 + 2 * REACH) * HW) - 90;
    boundL = Math.max(grassBoundL, -background.width / 2);
    boundR = Math.min(-grassBoundL, background.width / 2);
    boundT = skyTopY;
    boundB = (field.w - 1 + REACH + (field.h - 1 + REACH)) * HH + 60;
  };

  // Re-fit the backdrop, foliage ring, and camera bounds to the current farm size.
  // Called at startup, after a save loads (its size may be larger), and after a
  // Farm Size upgrade grows the field.
  const syncWorldToFarm = () => {
    fitBackground();
    computeBounds(); // foliage now fills the world-space camera rect, so bounds first
    buildFoliage();
  };
  syncWorldToFarm();

  // Re-dress everything OUTSIDE the farm to match the applied ground skin: the
  // scatter of trees/props, the hills-and-sky backdrop, and the viewport filler
  // beyond it. The filler must stay the backdrop's own mid-hill colour so the two
  // read as one surface — at night the darkness overlay dims both by the same
  // amount, and any mismatch shows up as the hills floating over a void.
  const applySurroundings = (terrain: string) => {
    const theme = surroundingsTheme(terrain);
    if (theme === surroundings) return;
    surroundings = theme;
    buildFoliage();
    app.renderer.background.color = theme.filler;
    void ensureBackgroundTexture(assets, theme.background).then((tex) => {
      if (surroundings !== theme) return; // skin changed again while loading
      background.texture = tex;
    }).catch((e) => console.warn(`[surroundings] backdrop ${theme.background} failed`, e));
  };
  // Fires for a Market purchase, re-applying an owned skin, AND a save load
  // restoring one. Wired after the first world sync so a callback can never run
  // before the backdrop/bounds/foliage it re-dresses exist.
  field.onClimateChange = applySurroundings;
  applySurroundings(field.climate);

  const minSceneZoom = () => Math.max(
    MIN_ZOOM,
    app.screen.width / (boundR - boundL),
    app.screen.height / (boundB - boundT)
  );
  const clampZoom = () => {
    const s = Math.max(minSceneZoom(), Math.min(MAX_ZOOM, world.scale.x));
    world.scale.set(s);
    return s;
  };
  // Clamp one axis so the visible span [pos-based] stays within [lo,hi]; if the
  // view is larger than the box on that axis, center the box instead.
  const clampAxis = (pos: number, pivot: number, screen: number, lo: number, hi: number) => {
    const s = world.scale.y; // uniform scale
    if (screen / s >= hi - lo) return screen / 2 - ((lo + hi) / 2 - pivot) * s;
    const upper = s * (pivot - lo); // keeps the near (left/top) edge >= lo
    const lower = screen - s * (hi - pivot); // keeps the far (right/bottom) edge <= hi
    return Math.min(upper, Math.max(lower, pos));
  };
  const clampCamera = () => {
    clampZoom();
    world.position.x = clampAxis(world.position.x, world.pivot.x, app.screen.width, boundL, boundR);
    world.position.y = clampAxis(world.position.y, world.pivot.y, app.screen.height, boundT, boundB);
  };
  const recenter = () => {
    world.position.set(app.screen.width / 2, app.screen.height / 2);
    clampCamera();
  };
  recenter();

  // Hold WASD to pan the farm camera. Movement is frame-rate independent and
  // screen-space based, so it feels consistent at every zoom level.
  const cameraKeys = new Set<string>();
  const isEditableTarget = (target: EventTarget | null) => {
    const el = target instanceof HTMLElement ? target : null;
    return !!el && (el.isContentEditable || el.matches("input, textarea, select"));
  };
  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (!"wasd".includes(key) || e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;
    if (hud.el.classList.contains("tutorial")) return;
    cameraKeys.add(key);
    e.preventDefault();
  });
  window.addEventListener("keyup", (e) => cameraKeys.delete(e.key.toLowerCase()));
  window.addEventListener("blur", () => cameraKeys.clear());

  // Zoom by `factor` while keeping the world point under (sx,sy) — a screen-space
  // pixel — fixed. Shared by mouse-wheel (desktop) and pinch (touch) so both zoom
  // toward the pointer/pinch-midpoint identically.
  const zoomAt = (sx: number, sy: number, factor: number) => {
    const cursor = new Point(sx, sy);
    const before = world.toLocal(cursor);
    const ns = Math.max(minSceneZoom(), Math.min(MAX_ZOOM, world.scale.x * factor));
    world.scale.set(ns);
    world.position.set(
      cursor.x - (before.x - world.pivot.x) * ns,
      cursor.y - (before.y - world.pivot.y) * ns
    );
    clampCamera(); // don't let zoom-out reveal above the sky
  };

  app.canvas.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    },
    { passive: false }
  );

  // ---- floating reward/cost popups (world-space) ----
  const feedbackIcons = {
    gold: await Assets.load<Texture>(`${BASE}assets/ui/topbar_money_icon.png`),
    brains: await Assets.load<Texture>(`${BASE}assets/ui/topbar_brain_icon.png`),
    xp: await Assets.load<Texture>(`${BASE}assets/ui/topbar_exp_icon.png`),
  };
  // One shared style rather than a fresh literal per popup: Pixi keys its rasterised
  // text cache on the style, so sharing one instance keeps every "+31g" hitting the
  // same cached texture. Never mutate it.
  const FLOAT_STYLE = new TextStyle({
    fontFamily: "system-ui, sans-serif", fontSize: 20, fontWeight: "700",
    fill: 0xffd24a, stroke: { color: 0x3a2400, width: 4 },
  });
  const FLOAT_ICON = 25; // px; re-applied on every reuse, since a texture swap resizes
  type Float = { view: Container; text: Text; icon: Sprite; ttl: number; delay: number };
  const floats: Float[] = [];
  // Retired popups are reused instead of destroyed. Insta-Harvest pops every plot's
  // OWN numbers in a single frame — up to three per plot, plus one per ripe tree — so
  // a full farm builds hundreds at once. Beyond the allocation churn, destroying a
  // Text drops its rasterised texture, which meant the next identical "+31g" had to be
  // measured and re-rendered from scratch. The pool is capped so one huge harvest
  // doesn't leave that many text textures resident afterwards.
  const FLOAT_POOL_MAX = 96;
  const floatPool: Float[] = [];
  const makeFloat = (): Float => {
    const text = new Text({ text: "", style: FLOAT_STYLE });
    text.anchor.set(0.5, 0.5);
    const icon = new Sprite();
    icon.anchor.set(0.5);
    const view = new Container();
    view.addChild(icon, text);
    return { view, text, icon, ttl: 0, delay: 0 };
  };
  const floatText = (x: number, y: number, msg: string, delay = 0) => {
    const currency = /[+-]\d+g\b/.test(msg) ? "gold"
      : /[+-]\d+b\b/.test(msg) ? "brains"
      : /[+-]\d+xp\b/.test(msg) ? "xp" : null;
    const readable = msg
      .replace(/([+-]\d+)g\b/g, "$1 gold")
      .replace(/([+-]\d+)b\b/g, "$1 brains")
      .replace(/([+-]\d+)xp\b/g, "$1 XP");
    const f = floatPool.pop() ?? makeFloat();
    f.text.text = readable;
    if (currency) {
      f.icon.texture = feedbackIcons[currency];
      f.icon.width = f.icon.height = FLOAT_ICON;
      f.icon.visible = true;
      const totalW = f.text.width + 31;
      f.icon.x = -totalW / 2 + 12;
      f.text.x = 15;
    } else {
      f.icon.visible = false;
      f.text.x = 0;
    }
    f.view.position.set(x, y);
    f.view.alpha = 1;
    f.view.visible = delay <= 0;
    f.ttl = 1.1;
    f.delay = delay;
    world.addChild(f.view);
    floats.push(f);
  };

  // Purchases made on the farm use the same delayed world-space XP reward as a
  // crop harvest. Instant purchases made inside a modal (currently pets) use a
  // visible HUD toast instead, since the modal obscures the world layer.
  const showPurchaseXp = (xp: number, at?: { x: number; y: number }) => {
    const feedback = purchaseXpFeedback(xp);
    if (!feedback) return;
    if (at) floatText(at.x, at.y, feedback.floating, 0.42);
    else hud.showToast(feedback.toast);
  };

  // The harvested crop itself pops free and flies upward, echoing the original
  // game's collection feedback. Zombie harvests already visibly produce the new
  // full-size unit, so this collection fly-up is reserved for vegetable crops.
  const harvestFx: {
    view: Sprite; age: number; x: number; y: number;
    dx: number; rise: number; spin: number; baseScale: number;
  }[] = [];
  const popHarvestIcon = (result: import("./Field").HarvestResult, x: number, y: number) => {
    if (result.zombieKey) return;
    const texture = assets.cropIcon[result.icon];
    if (!texture) return;
    const count = Math.random() < 0.5 ? 4 : 5;
    for (let i = 0; i < count; i++) {
      const view = new Sprite(texture);
      view.anchor.set(0.5);
      const maxSide = Math.max(texture.width, texture.height, 1);
      const baseScale = (34 + Math.random() * 6) / maxSide;
      view.scale.set(baseScale);
      const centered = i - (count - 1) / 2;
      const startX = x + centered * 5 + (Math.random() - 0.5) * 5;
      const startY = y + Math.abs(centered) * 2 + (Math.random() - 0.5) * 4;
      view.position.set(startX, startY);
      view.rotation = (Math.random() - 0.5) * 0.3;
      field.labelLayer.addChild(view);
      harvestFx.push({
        view, age: 0, x: startX, y: startY,
        dx: centered * 15 + (Math.random() - 0.5) * 10,
        rise: 105 + Math.random() * 25,
        spin: (Math.random() - 0.5) * 2.2,
        baseScale,
      });
    }
  };

  // Boss Tokens use the active boss's transparent face portrait. At 52px they are
  // effectively the same size as the farmer's 53x55 head art. They emerge from the
  // harvested plot with a small overshoot, then hover briefly over a soft gold glow.
  const bossTokenFx: { view: Container; glow: Graphics; age: number; x: number; y: number }[] = [];
  const popBossToken = (x: number, y: number, bossId: string, portrait: string) => {
    const url = `${BASE}assets/epic-bosses/${bossId}/${portrait}`;
    void Assets.load<Texture>(url).then((texture) => {
      const view = new Container();
      const glow = new Graphics()
        .circle(0, 0, 29)
        .fill({ color: 0xffdc55, alpha: 0.22 })
        .stroke({ color: 0xffef91, width: 2, alpha: 0.48 });
      const face = new Sprite(texture);
      face.anchor.set(0.5);
      face.width = 52;
      face.height = 52;
      view.addChild(glow, face);
      view.position.set(x, y + 10);
      view.scale.set(0.16);
      field.labelLayer.addChild(view);
      bossTokenFx.push({ view, glow, age: 0, x, y });
    }).catch(() => { /* a missing portrait should never interrupt harvesting */ });
  };

  // Quest event bus: plow/plant/harvest/buy post notifications that the QuestSystem
  // turns into quest progress. Created before the JobSystem so farm actions can post.
  const questBus = new QuestBus();
  let tutorial: TutorialController | null = null;

  let latestBossTokenHarvest: { x: number; y: number } | null = null;
  const awardOfflineEpicBossToken = (growMs: number, value: number, x: number, y: number): boolean => {
    if (state.onFarm) {
      latestBossTokenHarvest = { x, y };
      return false;
    }
    const run = state.epicBossRun;
    const def = epicBossById(run?.bossId);
    if (!run || !def || !new EpicBossManager(def).isActive(run) || !dropsEpicBossToken(growMs, value)) return false;
    state.setEpicBossRun({ ...run, tokenCount: (run.tokenCount ?? 0) + 1 });
    popBossToken(x, y, def.id, def.portrait);
    return true;
  };

  // The farmer's job queue (till / plant / harvest / walk). He walks to each target,
  // hoes, then the action applies; queued plots stay highlighted green until done.
  // Harvesting a zombie crop grows an owned zombie at the plot's center tile.
  const jobs = new JobSystem(
    field, actor, walk, state, floatText, (name) => audio.play(name),
    (key, oc, or, context) => {
      const unit = zombies.spawnVerified(key, oc + 1, or + 1, offlineHarvestMutation(key, context));
      return unit ? { id: unit.id, subjectAliases: unitSubjectAliasesOf(unit) } : null;
    },
    questBus,
    (oc, or) => zombies.tryFertilize(oc, or),
    (oc, or) => tutorial?.onPlotPlowed(oc, or),
    awardOfflineEpicBossToken,
    (currency, needed) => hud.showToast(
      currency === "gold" ? "Not enough coins." : `Not enough brains (need ${needed}).`
    ),
    popHarvestIcon,
    () => zombies.zombieHarvestRoom()
  );

  // `raidActive` is declared up here (ahead of both the celebration queue and the raid
  // block far below) so every closure that reads it — the tutorial's isRaidActive(),
  // celebrateQuest() — sees an already-initialised binding; the raid launch handlers
  // assign it.
  let raidActive = false;

  // Quest-complete celebration, styled like the level-up popup. Quests can finish in
  // bursts (several at once on a raid return), so completions QUEUE and show one at a
  // time; the HUD calls onQuestCompleteClosed when each is dismissed to feed the next.
  const uiIcon = (name: string) => `${BASE}assets/ui/${name}`;
  const questRewards = (def: QuestDef): QuestReward[] => {
    const reward = questRewardInfo(def);
    const bonus = questBonusRewardInfo(def);
    return [
      ...(reward ? [{ icon: uiIcon(reward.icon), label: reward.label }] : []),
      // The completion popup lists every line the quest actually paid, so an
      // achievement that hands over a brain as well as XP shows both.
      ...(bonus ? [{ icon: uiIcon(bonus.icon), label: bonus.label }] : []),
    ];
  };
  const questCompleteQueue: QuestCompleteView[] = [];
  let questCompleteShowing = false;
  const showNextQuestComplete = () => {
    const next = questCompleteQueue.shift();
    if (!next) { questCompleteShowing = false; return; }
    questCompleteShowing = true;
    hud.openQuestComplete(next);
  };
  hud.onQuestCompleteClosed = showNextQuestComplete;
  const celebrateQuest = (def: QuestDef) => {
    questCompleteQueue.push({
      icon: def.sprite,
      title: def.title,
      message: def.messageComplete,
      rewards: questRewards(def),
    });
    // A battle owns the screen (and online a raid quest completes the moment
    // /raid/finish answers, while the result panel is still up), so hold the
    // celebration until the player is back on the farm. Closing the raid result
    // flushes the queue.
    if (!questCompleteShowing && !raidActive) showNextQuestComplete();
  };
  const flushQuestCompletions = () => {
    if (!questCompleteShowing) showNextQuestComplete();
  };

  /**
   * Place a zombie earned outside the crop cycle (quest, voucher, rare raid drop).
   * A full active farm files it in Received instead of destroying it; claiming it
   * from there later costs a real Mausoleum slot.
   *
   * Returns the deployed unit, or null when the award went to Received.
   *
   * ONLINE the Received bucket is server-owned: the authoritative grant already
   * writes its own marker, and a locally minted one would be erased by the next
   * storage sync (and could not be claimed, since the server has never seen that
   * id). So the local marker is written only when this client owns storage.
   */
  const grantEarnedZombie = (key: string): OwnedZombie | null => {
    if (zombies.canAdd()) return zombies.grantReward(key, walk.tile.col, walk.tile.row);
    if (!onlineFarm) {
      // Earned is earned: the Almanac counts the species here rather than waiting for
      // the claim, so the collection never differentiates by which bucket holds a unit.
      state.recordZombieDiscovered(key);
      state.receiveItem(encodeReceivedZombie({
        id: crypto.randomUUID(), key, mutation: zombieDefs.get(key)?.mutation ?? 0, invasions: 0,
      }));
    }
    return null;
  };

  /** Put a server-awarded zombie on the results panel, where the player actually
   *  looks. A prize that could not go straight onto the farm used to be announced
   *  only by a toast fired the instant before the panel covered it — for an Epic
   *  Boss milestone that meant the event's signature zombie arrived unannounced.
   *  Also counts the species for the Almanac when it went to Received: nothing
   *  claims it into the roster, so no other path would. */
  const rewardZombieDrop = (
    unit: { key: string; stored: boolean; received?: boolean }
  ): LootDrop => {
    if (unit.received) state.recordZombieDiscovered(unit.key);
    return {
      name: zombieDefs.get(unit.key)?.name ?? "Reward zombie",
      icon: zombiePortrait(unit.key),
      qty: 1,
      note: unit.received ? "Waiting in Received" : unit.stored ? "Sent to the Mausoleum" : undefined,
    };
  };

  // The data-driven quest engine (all 96 quests from quests.json). Rewards route to
  // GameState / the roster; the HUD rail and the completion popup come from `hud`.
  const quests = new QuestSystem(
    new Map(Object.entries(assets.quests)), state, questBus,
    {
      // Signed-in quest progress follows accepted server commands. Advancing from
      // local notifications would permanently complete quests for actions the
      // server later rejected or rolled back.
      authoritative: onlineFarm,
      // Online: the server grants the quest's currency reward (and any level-up brains)
      // authoritatively and idempotently; return true so QuestSystem skips the local add
      // (which the spend-only economy endpoint would reject anyway). Offline: `economy`
      // is null → return false → currency is granted locally as before.
      grantReward: (def) => {
        if (!economy) return false;
        economy.submitQuest(def.id);
        return true;
      },
      grantItem: (key) => {
        if (key === "Invasion Voucher") state.addBoost("invasion_voucher");
        else if (key === "Golden Dice") state.addBoost("golden_dice");
        else state.receiveItem(key);
      },
      grantZombie: (key) => { grantEarnedZombie(key); },
      completed: (def) => celebrateQuest(def),
      requestAuthoritativeCompletionCheck: () => {
        // Some effects post their quest notification just before enqueueing their
        // semantic command. The microtask lets that stack finish, then drains both
        // pending and in-flight command lanes without treating the preview as truth.
        queueMicrotask(() => { void economy?.settleBeforeDependency().catch(() => {}); });
      },
      render: (views) => hud.setQuests(views),
    }
  );

  // Daily / weekly quests. The SAME generator runs on both sides of the build split:
  // offline this object is the authority (it generates the board, counts bus events
  // and pays the XP), online the server owns all three and this only draws what the
  // latest projection said. `authoritative` is what picks between the two.
  const periodicQuests = new PeriodicQuestSystem(
    state,
    // Seeds the roll. Online that is the account; offline the active profile's save
    // key, which is the only thing that is stable for the life of a local farm.
    () => (onlineFarm ? api.getSession()?.accountId ?? "anon" : profiles.activeSaveKey()),
    questBus,
    {
      authoritative: onlineFarm,
      submitClaim: (scope, questId, xp) => economy?.submitPeriodicQuestClaim(scope, questId, xp) ?? false,
      claimed: (text, xp) => hud.showToast(`${text} — +${xp} XP`),
      render: (views) => hud.setPeriodicQuests(views),
    }
  );
  hud.onPeriodicQuestClaim = (scope, questId) => periodicQuests.claim(scope, questId);
  // The panel's "Resets in …" is minute-resolution, and offline the day has to roll
  // over inside a long session rather than only at the next launch. One minute covers
  // both; nothing here is expensive enough to want a tighter or looser tick.
  setInterval(() => {
    periodicQuests.refresh();
    hud.setPeriodicQuests(periodicQuests.views());
  }, 60_000);

  // ---- consumable boosts: buy (into inventory) + use (apply farm effect) ----
  // Gift vouchers are "1 per farm": you can't buy/use one once you already own
  // that zombie OR already hold an (unused) voucher granting it. The check is keyed
  // by the RESULTING zombie, so ordinary and pink Cupid use independent one-copy
  // limits while duplicate vouchers for the same exact actor still share a limit.
  // A copy waiting in Received counts as owned (it just hasn't taken its Mausoleum
  // slot yet), so a full farm can't be used to redeem a second voucher for the same
  // unique. The server applies the same rule to `power.use`.
  const ownsGiftZombie = (giftKey: string) =>
    !!giftKey && (
      zombies.roster().some((z) => z.key === giftKey) ||
      state.received.some((entry) => parseReceivedZombie(entry)?.key === giftKey)
    );
  const holdsGiftVoucher = (giftKey: string) =>
    !!giftKey &&
    assets.boosts.some(
      (b) => b.effect === "gift" && b.giftZombieKey === giftKey && state.boostCount(b.key) > 0
    );
  const giftLimitReached = (boostKey: string) => {
    const gk = boostCatalog.get(boostKey)?.giftZombieKey ?? "";
    return !!gk && (ownsGiftZombie(gk) || holdsGiftVoucher(gk));
  };
  hud.giftLimitReached = giftLimitReached;

  function onlineGameplayBlocked(): boolean {
    return onlineFarm && !!economy && !economy.available;
  }

  hud.onBuyBoost = (def) => {
    if (onlineGameplayBlocked()) return false;
    if (tutorial && !tutorial.allowsBoostPurchase(def.key)) return false;
    if (def.effect === "gift" && giftLimitReached(def.key)) return false; // 1 per farm
    if (state.onInventory) {
      // ONLINE: the server prices the boost (exact catalog cost), debits currency, and
      // grants perPurchase — atomically. Affordability is checked against the
      // server-synced balance first for instant feedback; the server is the gate.
      const funds = def.brainsNeeded ? state.brains : state.gold;
      if (funds < def.cost) return false;
      const optimistic = def.brainsNeeded
        ? { count: def.perPurchase, brains: -def.cost }
        : { count: def.perPurchase, gold: -def.cost };
      state.onInventory({ type: "buy", key: def.key }, optimistic);
      audio.play("buy");
      return true;
    }
    const paid = def.brainsNeeded ? state.spendBrains(def.cost) : state.spendGold(def.cost);
    if (!paid) return false;
    state.addBoost(def.key, def.perPurchase); // a purchase grants `perPurchase` uses
    audio.play("buy");
    return true;
  };
  hud.onUseBoost = (def) => {
    if (onlineGameplayBlocked()) return;
    if (state.boostCount(def.key) <= 0) return;
    giftUnitId = null;
    powerGold = 0;
    powerXp = 0;
    if (!applyBoost(def)) return; // only consume if it did something
    // ONLINE: the server owns the count — decrement there (optimistic + reconcile).
    // A gift voucher redeems into a zombie, so it also carries the spawned unit's id:
    // the server consumes the voucher and files that unit in the roster atomically.
    if (state.onInventory) {
      const action = giftUnitId
        ? { type: "use" as const, key: def.key, unitId: giftUnitId }
        : powerUnitIds.length
          ? { type: "use" as const, key: def.key, localZombieHarvests: powerUnitIds }
        : growTarget
          ? { type: "use" as const, key: def.key, oc: growTarget.oc, or: growTarget.or }
          : { type: "use" as const, key: def.key };
      state.onInventory(action, { count: -1, gold: powerGold, xp: powerXp });
    } else state.useBoost(def.key);
    giftUnitId = null;
    powerUnitIds = [];
    growTarget = null;
    powerGold = 0;
    powerXp = 0;
  };
  hud.canUseBoost = (def) =>
    def.effect !== "plow" ||
    field.serialize().some((plot) => plot.state === "dirt" || plot.state === "hole");

  // The speed-grow (Insta-Grow) boost, exposed so the HUD can render the equippable
  // Grow tool (icon + live count) and the growing-crop info window can offer it.
  // Returns the boost def + a live count getter, or null if the catalog has no
  // grow boost.
  const GROW_BOOST_KEY = "insta_grow";
  const growBoostDef = () => boostCatalog.get(GROW_BOOST_KEY) ?? null;
  hud.getSpeedGrowBoost = () => {
    const def = growBoostDef();
    if (!def) return null;
    return { name: def.name, icon: `${BASE}assets/boosts/${def.icon}`, count: () => state.boostCount(def.key) };
  };

  // The Insta-Grow tool (mode "instagrow") ripens exactly the tapped crop or an
  // active Zombie Pot and spends one use. A stray tap is ignored (no wasted use).
  // When the last use is spent the tool auto-unequips back to the select tool.
  const tryInstaGrow = (col: number, row: number, wx: number, wy: number) => {
    const def = growBoostDef();
    if (!def) return;
    if (state.boostCount(def.key) <= 0) { hud.setMode("walk"); return; }
    const objectId = field.objectAtPoint(wx, wy);
    const objectDef = objectId ? field.objectDefOf(objectId) : null;
    if (objectDef?.zombiePot && objectId && zombies.finishCombineNow(objectId)) {
      if (state.onInventory) state.onInventory({ type: "use", key: def.key, target: "zombie_pot" }, { count: -1 });
      else state.useBoost(def.key);
      audio.play("instaGrow");
      const p = field.objectWorkPoint(objectId!);
      if (p) floatText(p.x, p.y - 48, "Ready!");
      saveManager.save();
      if (state.boostCount(def.key) <= 0) hud.setMode("walk");
      return;
    }
    const grown = field.growCropAt(col, row);
    if (!grown) return; // not a growing crop -> keep tool equipped
    if (state.onInventory) state.onInventory({ type: "use", key: def.key, oc: grown.oc, or: grown.or }, { count: -1 });
    else state.useBoost(def.key);
    audio.play("instaGrow");
    const c = tileCenter(col, row);
    floatText(c.x, c.y, "Grew!");
    if (state.boostCount(def.key) <= 0) hud.setMode("walk"); // used up -> unequip
  };

  // Set by applyBoost when a GIFT voucher spawns its zombie: the new unit's id, which
  // onUseBoost sends with the voucher `use` so the server can grant that same unit.
  // Null for every other boost effect.
  let giftUnitId: string | null = null;
  let powerUnitIds: { id: string; oc: number; or: number }[] = [];
  let growTarget: { oc: number; or: number } | null = null;
  // ONLINE: what a farm-wide power (Insta-Harvest / Insta-Plow) just paid out, summed
  // over every plot and tree it hit. The server owns these rewards, but sending them as
  // the power command's optimistic delta keeps the top-bar counters rising with the
  // per-plot popups instead of a beat later, on reconcile.
  let powerGold = 0;
  let powerXp = 0;

  // Apply a farm-usable boost's effect. Returns true if it actually did anything
  // (so a no-op — e.g. Insta-Harvest with nothing ripe — doesn't waste the boost).
  const applyBoost = (def: BoostDef): boolean => {
    const c = tileCenter(walk.tile.col, walk.tile.row); // float near the farmer
    if (def.effect === "grow") {
      const grown = field.growSomeCrops(def.amount || 1); // single-use: grows one crop
      growTarget = grown[0] ?? null;
      if (grown.length) { audio.play("instaGrow"); floatText(c.x, c.y, `Grew ${grown.length}!`); }
      return grown.length > 0;
    }
    if (def.effect === "harvest") {
      let harvested = 0;
      // Insta-Harvest is one atomic action: snapshot every zombie's neighbours so
      // harvesting a ripe adjacent vegetable earlier in this loop cannot erase it.
      const mutationContexts = new Map(field.ripePlots().filter((plot) => plot.isZombie)
        .map((plot) => [`${plot.oc}:${plot.or}`, field.zombieMutationContextAt(plot.oc, plot.or)]));
      for (const pl of field.ripePlots()) {
        if (pl.isZombie && !zombies.canHarvestZombie()) continue;
        const r = field.harvestAt(pl.oc, pl.or);
        if (!r) continue;
        const cropCenter = field.plotCenterOf(pl.oc, pl.or);
        popHarvestIcon(r, cropCenter.x, cropCenter.y);
        // Every plot pays exactly what harvesting it by hand would (see JobSystem):
        // farmer-adjusted gold for a vegetable, XP for both kinds.
        const gold = r.zombieKey ? 0 : state.farmerHarvestGold(r.sell);
        const xp = harvestXp(r.xp, field.hasPlowFree());
        let harvestAliases: readonly string[] = [];
        if (state.onFarm) {
          if (r.zombieKey) {
            const context = mutationContexts.get(`${pl.oc}:${pl.or}`) ?? r.mutationContext!;
            const unit = zombies.spawnVerified(r.zombieKey, pl.oc + 1, pl.or + 1,
              offlineHarvestMutation(r.zombieKey, context));
            if (!unit) continue;
            harvestAliases = unitSubjectAliasesOf(unit);
            powerUnitIds.push({ id: unit.id, oc: pl.oc, or: pl.or });
          }
          // The server receives one semantic power command from onUseBoost below;
          // individual optimistic harvests must not become commands. Their totals
          // ride along as that command's optimistic delta so the counters move now.
        } else {
          if (gold) state.addGold(gold);
          state.addXp(xp);
          if (r.zombieKey) {
            const context = mutationContexts.get(`${pl.oc}:${pl.or}`) ?? r.mutationContext!;
            // spawnVerified, not spawn: the army may be full with the Mausoleum still
            // open (canHarvestZombie above passes on either), and plain spawn would
            // return null there — silently deleting a zombie whose crop is now spent.
            harvestAliases = unitSubjectAliasesOf(
              zombies.spawnVerified(r.zombieKey, pl.oc + 1, pl.or + 1,
                offlineHarvestMutation(r.zombieKey, context))
            );
          }
        }
        powerGold += gold;
        powerXp += xp;
        questBus.post(
          r.isZombie ? QuestEvent.ZombieHarvested : QuestEvent.CropHarvested,
          r.name, 1, harvestAliases
        );
        const bossToken = !r.isZombie &&
          awardOfflineEpicBossToken(r.growMs, r.sell, cropCenter.x, cropCenter.y);
        // Each plot pops its OWN reward numbers, in this one frame, so the farm
        // reads as having been harvested all at once (as the original game did).
        if (r.zombieKey) {
          floatText(cropCenter.x, cropCenter.y, `+${xp}xp`);
        } else {
          floatText(cropCenter.x, cropCenter.y, `+${gold}g${r.fertilized ? " ×2" : ""}`);
          if (xp) floatText(cropCenter.x, cropCenter.y, `+${xp}xp`, 0.42);
          if (bossToken) floatText(cropCenter.x, cropCenter.y, "+1 Boss Token!", xp ? 0.84 : 0.42);
        }
        harvested++;
      }
      // Trees are part of the same immediate, farm-wide activation. Online, the
      // single power command below awards them authoritatively; locally we mirror
      // the normal tree harvest's gold, quest event, and regrow timer.
      for (const id of field.ripeTreeIds()) {
        const treeDef = field.objectDefOf(id);
        const treeAt = field.objectWorkPoint(id);
        const baseGold = field.harvestObject(id);
        if (!treeDef || baseGold === null) continue;
        const gold = state.farmerHarvestGold(baseGold);
        if (!state.onFarm) state.addGold(gold);
        powerGold += gold;
        questBus.post(QuestEvent.CropHarvested, treeDef.name);
        if (treeAt) floatText(treeAt.x, treeAt.y, `+${gold}g`);
        harvested++;
      }
      if (harvested) floatText(c.x, c.y, `Harvested ${harvested}!`);
      return harvested > 0;
    }
    if (def.effect === "plow") {
      const plowed = field.replowSpent();
      const xp = plowXp(field.hasPlowFree());
      // The boost replaces only the gold cost: its XP matches the same plots being
      // plowed manually. Online the server credits it authoritatively; the total
      // rides along as the power command's optimistic delta (see onUseBoost).
      if (plowed.length && !state.onInventory) state.addXp(xp * plowed.length);
      powerXp += xp * plowed.length;
      for (const pl of plowed) {
        questBus.post(QuestEvent.SoilPlowed, "Plow");
        questBus.post(QuestEvent.NewSoilPlowed, "Plow");
        // Same as harvest: every plot shows its own reward in this one frame.
        const at = field.plotCenterOf(pl.oc, pl.or);
        floatText(at.x, at.y, "Plowed!");
        if (xp) floatText(at.x, at.y, `+${xp}xp`, 0.42);
      }
      if (plowed.length) floatText(c.x, c.y, `Plowed ${plowed.length}!`);
      return plowed.length > 0;
    }
    if (def.effect === "gift") {
      if (!def.giftZombieKey) return false;
      // 1 per farm: don't spawn a duplicate of a gift zombie you already own.
      if (ownsGiftZombie(def.giftZombieKey)) { floatText(c.x, c.y, `Already have ${def.name}!`); return false; }
      if (!zombieDefs.has(def.giftZombieKey)) return false;
      // ONLINE, the voucher `use` grants this unit server-side, so spawn it verified
      // (no onGrant) and hand its id to onUseBoost to send. A full active farm files
      // the award in Received instead — the server does exactly the same, and reports
      // no created id for it, so `giftUnitId` must stay null on that path.
      // The server re-checks the catalog key, voucher count, and 1-per-farm rule.
      const unit = grantEarnedZombie(def.giftZombieKey);
      giftUnitId = unit?.id ?? null;
      floatText(c.x, c.y, unit ? `Got ${def.name}!` : `${def.name} sent to Received!`);
      return true;
    }
    // concentration / dice are spent on the Invade screens, not on the farm.
    floatText(c.x, c.y, "Used during invasions");
    return false;
  };

  // Restore a prior farm (currencies, XP, plots, crops-with-offline-growth, farmer
  // position) if one exists, then start autosaving. Load before the loop so the
  // restored farm shows on the first frame.
  const saveManager = new SaveManager(
    state, field, walk, zombies, quests, catalog, placeCatalog,
    (sprite) => ensureObjectTexture(assets, sprite),
    playMode,
    jobs,
  );
  saveManager.periodicQuests = periodicQuests;
  saveManager.onStorageError = (message) => hud.showToast(message);
  jobs.onQueueChanged = () => saveManager.checkpointJobs();

  // Pixi's ticker is requestAnimationFrame-driven and may stop completely when
  // the tab/window is backgrounded. Keep a separate monotonic clock for just the
  // queued farm-job pipeline. If frames are merely throttled, each sparse frame
  // advances the missing time; if they stop, the first focus/visible event does.
  // Nothing else (notably raids) receives this elapsed time.
  let lastJobAdvanceAt = Date.now();
  const advanceFarmJobsToNow = (forceSilent = false) => {
    const now = Date.now();
    const elapsed = (now - lastJobAdvanceAt) / 1000;
    // A throttled/hidden tab can complete several queued jobs in one catch-up.
    // Do that work silently so their independent one-shots do not all burst at once.
    jobs.advanceElapsed(elapsed, forceSilent || elapsed > 0.25);
    lastJobAdvanceAt = now;
  };

  // Battles suspend the farm queue and JobSystem replays the suspended span on the way
  // out (see JobSystem.setPaused), so the two clocks have to be handed off cleanly.
  // Re-baseline this one at each edge: while paused it accumulates a gap it will never
  // apply, and a tab frozen through the whole invasion would otherwise hand that same
  // span back a second time on the first frame after the result panel closes.
  const pauseFarmJobs = () => { advanceFarmJobsToNow(); jobs.setPaused(true); };
  const resumeFarmJobs = () => { advanceFarmJobsToNow(); jobs.setPaused(false); lastJobAdvanceAt = Date.now(); };

  // Visit mode: if a friend farm was requested (via enterVisit → reload), hydrate
  // THEIR read-only save into these fresh singletons and — crucially — never call
  // enableAutosave(). The player's own save is never loaded in this mode, so a
  // visit cannot read, write, or corrupt it. On any fetch failure we clear the
  // target and fall through to a normal load, so the player always lands on their
  // own farm.
  // A visit target stashed before the closedown began would otherwise send this load
  // into a friend's read-only farm instead of the export handoff — the player would
  // have to work out that "leave farm" is the way to reach their own export. Visiting
  // is meaningless during a closedown, so drop the target and go collect their farm.
  if (exportOnlyFarm) clearVisitTarget();
  const visitTarget = onlineFarm && !exportOnlyFarm ? getVisitTarget() : null;
  let visiting = false;
  let visitError = "";
  let restored = false;
  if (visitTarget) {
    try {
      const { save } = await api.getFriendSave(visitTarget.id);
      // Defense in depth: a friend's farm is server-validated on write, but the
      // visitor re-checks the dimensions before hydrating so a malformed/extreme
      // save can never drive an oversized field allocation here. (See SECURITY.md
      // finding #9 — malicious saves attacking visitors.)
      const w = save?.farm?.w, h = save?.farm?.h;
      const MAX_VISIT_DIM = 128;
      const okDim = (n: unknown) =>
        typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_VISIT_DIM;
      if (!okDim(w) || !okDim(h)) throw new api.ApiError(422, "bad_farm");
      displayedFarmBackground = isFarmBackground(save.farm.background)
        ? save.farm.background
        : DEFAULT_FARM_BACKGROUND;
      await saveManager.hydrateReadOnly(save);
      state.seedFarmerCatalog(assets.farmer);
      applyFarmerAppearance();
      visiting = true;
      console.log(`[visit] viewing ${visitTarget.name}'s farm (read-only)`);
    } catch (e) {
      clearVisitTarget();
      visitError = e instanceof api.ApiError ? e.code : "error";
      console.warn("[visit] could not open friend's farm:", visitError);
    }
  }
  if (!visiting) {
    let loadResult = await saveManager.load();
    if (loadResult.kind === "online-unavailable") {
      await showOnlineUnavailable(
        async () => {
          loadResult = await saveManager.load();
          return loadResult.kind !== "online-unavailable";
        },
        () => {
          setPreferredPlayMode("local");
          location.reload();
        },
      );
    }
    if (loadResult.kind === "local-unavailable") {
      await showLocalUnavailable(
        async () => {
          loadResult = await saveManager.load();
          return loadResult.kind !== "local-unavailable";
        },
        () => {
          saveManager.suspend();
          saveManager.clear();
          location.reload();
        },
      );
    }
    restored = loadResult.kind === "local-existing" ||
      loadResult.kind === "online-cached" ||
      (loadResult.kind === "online-authoritative" && loadResult.restored);
    if (loadResult.kind === "online-cached") hud.setPlayStatus("online", "cached");
    else if (loadResult.kind === "online-authoritative") hud.setPlayStatus("online", "synced");
    // The foliage was initially built before the signed-in presentation arrived.
    // Reapply its saved density to both the live scene and device preference.
    const restoredBackground = saveManager.loadedFarmBackground;
    if (isFarmBackground(restoredBackground)) {
      displayedFarmBackground = restoredBackground;
      setFarmBackground(restoredBackground);
      buildFoliage();
    }
    state.seedFarmerCatalog(assets.farmer);
    applyFarmerAppearance();
    if (!restored) quests.restore(); // fresh farm: activate the opening quests
    // Same for the daily/weekly board. A restored save installs its own through
    // SaveManager; a fresh farm has none, and without this the panel would stay empty
    // until the next event happened to roll it over.
    if (!restored) periodicQuests.restore();
    // Closedown handoff. The farm is now hydrated from the server — which is the only
    // way to serialise an Online Farm, since one keeps no full blob on the device — so
    // this is the earliest point the export can be produced, and the latest point that
    // is still before autosave, the economy client, and the game loop start. The screen
    // never resolves: every button downloads or reloads.
    if (exportOnlyFarm) {
      boot?.close();
      await showExportOnly({
        notice: service.notice,
        // `/bootstrap` failed and the load fell back to this device's cached snapshot.
        // Exporting that is still better than nothing, but it may be missing recent
        // progress, and a player must not find that out afterwards.
        cachedFrom: loadResult.kind === "online-cached" ? loadResult.savedAt : null,
        retryAuthoritative: async () => {
          const retry = await saveManager.load();
          return retry.kind === "online-authoritative";
        },
        exportRaw: async () => {
          saveManager.flushCritical();
          return saveManager.exportOnline();
        },
        // Byte-for-byte the file Settings' Export writes, and the only thing Local
        // Farm's Import accepts — one export format, one import path.
        download: (raw) => downloadSaveFile(raw, "online"),
        openLocal: () => {
          setPreferredPlayMode("local");
          location.reload();
        },
      });
    }
    saveManager.enableAutosave();
    // Backfill newly-added presentation fields (such as woodland density) even
    // when an existing player does not immediately change another farm value.
    saveManager.save();
    console.log(
      loadResult.kind === "online-cached"
        ? `[save] showing cached Online Farm from ${new Date(loadResult.savedAt).toISOString()}`
        : restored ? "[save] restored existing farm" : "[save] fresh farm"
    );
  }
  // Server-authoritative currency (online, own-farm only). Wire the money hook so
  // every gold/brains/xp change mirrors to the server ledger, then start() adopts
  // the authoritative balance (server wins over the just-loaded blob). Offline or
  // while visiting, `economy` stays null and currency is purely local as before.
  let economy: EconomyClient | null = null;
  hud.onEquipFarmerHead = (head) => {
    if (economy && !economy.submitFarmerEquip(head.id)) return;
    state.equipFarmerHead(head.id);
  };
  hud.onEquipFarmerBody = (body) => { state.equipFarmerBody(body.id); };
  hud.onEquipFarmerBonusHead = (headId) => {
    if (economy && !economy.submitFarmerBonus(headId)) return;
    state.equipFarmerBonusHead(headId);
  };
  hud.onBuyFarmerHead = (head) => {
    const cost = head.cost ?? 0;
    if (!cost) {
      state.unlockFarmerHead(head.id, head.bodyId);
      state.equipFarmerHead(head.id);
      return true;
    }
    const currency = head.brains ? "brains" : "gold";
    if ((currency === "brains" ? state.brains : state.gold) < cost) return false;
    // Buying a head pays out XP scaled off its price, exactly as buying a Market
    // object or a pet does. Online the server recomputes it from the same catalog
    // row; the optimistic amount here only decides what the bar shows meanwhile.
    const xp = farmerHeadXp(head);
    if (economy) {
      if (!economy.submitFarmerBuy(head.id, currency, cost, xp)) return false;
    } else {
      const paid = currency === "brains"
        ? state.spendBrains(cost, "purchase")
        : state.spendGold(cost, "purchase");
      if (!paid) return false;
      if (xp > 0) state.addXp(xp, "purchase");
    }
    state.unlockFarmerHead(head.id, head.bodyId);
    state.equipFarmerHead(head.id);
    economy?.submitFarmerEquip(head.id);
    // Bought from inside the Market modal, so the world-space float would be
    // hidden behind it — the toast is the visible half (see showPurchaseXp).
    showPurchaseXp(xp);
    return true;
  };
  hud.onEquipPet = (pet) => {
    const key = pet?.key ?? null;
    if (visiting) return;
    if (economy && !economy.submitPetEquip(key)) return;
    state.equipPet(key);
  };
  hud.onSetPenPets = (pets) => {
    const keys = pets.map((pet) => pet.key);
    if (economy && !economy.submitPenPets(keys)) return;
    state.setPenPets(keys);
  };
  hud.onBuyPet = (pet) => {
    if (visiting || state.level < pet.level || !pet.brains || state.brains < pet.cost) return false;
    if (economy) {
      if (!economy.submitPetBuy(pet.key, pet.cost, pet.xp)) return false;
    } else if (!state.spendBrains(pet.cost, "purchase")) {
      return false;
    } else if (pet.xp > 0) {
      state.addXp(pet.xp, "purchase");
    }
    state.unlockPet(pet.key);
    showPurchaseXp(pet.xp);
    return true;
  };
  const storedObjectIds = new Map<string, string[]>();
  const objectPurchases = new Map<string, { cost: number; currency: "gold" | "brains" }>();
  /** The instance id of one stored copy of `key` — what both the retrieve and sell
   *  paths act on. Online that identity is the server's and comes from the object
   *  reconcile below; offline the save carries counts only, so it is minted on first
   *  use (otherwise a reloaded local shed holds items that can't be placed or sold). */
  const storedInstanceId = (key: string): string | undefined =>
    economy
      ? storedObjectIds.get(key)?.[0]
      : ensureLocalStoredIds(state, storedObjectIds, key, () => `stored-${crypto.randomUUID()}`);
  if (!visiting && onlineFarm) {
    let authoritativeObjectIds = new Set<string>();
    const acct = api.getSession()?.accountId ?? "anon";
    economy = new EconomyClient(state, acct, { requireReady: true });
    economy.onAuthoritativeSettled = (serverTime) => {
      // Let synchronous projection listeners finish rebuilding Field/Zombie state
      // before serializing the read-only reconnect snapshot.
      queueMicrotask(() => {
        saveManager.reconcileObjectLayouts(authoritativeObjectIds);
        saveManager.save();
        saveManager.cacheAuthoritativeSnapshot(serverTime);
      });
    };
    economy.onPendingChange = (pending) =>
      hud.setPlayStatus("online", pending > 0 ? "saving" : "synced", pending);
    // This tab's JS and the deployed Worker disagree about the raid ruleset, so every
    // invasion would be refused at /raid/start. Tell the player up front — the fix is a
    // reload, and finding that out before committing an army is far better than after.
    economy.onRulesetSkew = (serverVersion, clientVersion) => {
      console.warn("[raid] ruleset skew", { serverVersion, clientVersion });
      promptReload("The game has updated. Reload to keep raiding.");
    };
    state.canMutateOnline = () => economy!.available;
    state.onMoney = (currency, delta, reason) => economy!.record(currency, delta, reason);
    // Veggie plant/harvest go through the server's EXACT economics engine instead of
    // mutating gold/xp locally (JobSystem checks state.onFarm).
    state.onFarm = (action, optimistic) => economy!.submitFarm(action, optimistic);
    // Boost buy/use/grant go through the server-owned inventory (the presence of this
    // hook is what tells the game "boosts are server-owned"); counts reconcile like
    // currency, so the blob's boost list becomes an ignored cache.
    state.onInventory = (action, optimistic) => economy!.submitInventory(action, optimistic);
    state.onTreeHarvest = (instanceId, gold) => economy!.submitTreeHarvest([instanceId], gold);
    // Reconciliation also adopts fertilization from another/restored client. A crop
    // rolled here is already marked, so markFertilized prevents duplicate FX.
    economy.onCropFertilized = (oc, or) => {
      if (field.markFertilized(oc, or)) {
        zombies.animateFertilize(oc, or);
        const c = tileCenter(oc, or);
        floatText(c.x, c.y - 18, "Fertilized!");
      }
    };
    economy.onFarmState = (farmState) => {
      const authoritative = [
        ...farmState.plowed.map((p) => ({ oc: p.oc, or: p.pr, state: "plowed" as const })),
        ...(farmState.spent ?? []).map((p) => ({
          oc: p.oc,
          or: p.pr,
          state: p.zombie ? "hole" as const : "dirt" as const,
        })),
        ...farmState.crops.map((p) => ({
          oc: p.oc,
          or: p.pr,
          state: "planted" as const,
          crop: {
            key: p.crop_key,
            isZombie: zombieDefs.has(p.crop_key),
            plantedAt: p.planted_at,
            growMs: p.grow_ms,
            fertilized: !!p.fertilized,
          },
        })),
      ];
      const occupied = new Set(authoritative.map((p) => `${p.oc}:${p.or}`));
      const presentation = field.serialize().filter(
        (p) => (p.state === "dirt" || p.state === "hole") && !occupied.has(`${p.oc}:${p.or}`)
      );
      field.reconcilePlots([...presentation, ...authoritative], (key) => catalog.get(key));
    };
    let objectReconcileGeneration = 0;
    /** Server objects the farm has no room to re-home — warned about once each, so a
     *  full farm does not repeat the same toast on every reconcile. */
    const rehomeWarned = new Set<string>();
    economy.onObjectState = async (objects, aliases, baseZombieMax, rejectedLocalIds) => {
      authoritativeObjectIds = new Set(objects.map((object) => object.instanceId));
      const generation = ++objectReconcileGeneration;
      for (const id of rejectedLocalIds) field.removeObject(id);

      // The purchase + shed projections read only `objects`, never the field, so run
      // them BEFORE the texture-loading loop below. Anything after that loop is skipped
      // whenever a newer reconcile supersedes this one, and the shed must not be left
      // reading empty just because an object swapped catalog keys (a shed upgrade).
      objectPurchases.clear();
      for (const object of objects) {
        if (object.purchaseCost === undefined || object.purchaseCurrency === undefined) continue;
        objectPurchases.set(object.instanceId, { cost: object.purchaseCost, currency: object.purchaseCurrency });
      }

      storedObjectIds.clear();
      for (const object of objects) {
        if (object.status !== "stored") continue;
        const ids = storedObjectIds.get(object.catalogKey) ?? [];
        ids.push(object.instanceId);
        storedObjectIds.set(object.catalogKey, ids);
      }
      state.syncObjectStorage(Object.fromEntries([...storedObjectIds].map(([key, ids]) => [key, ids.length])));

      // Load every texture this pass can need BEFORE touching the field. This loop used
      // to await mid-iteration, which let a newer pass supersede it half-applied and made
      // the alias map unusable at exactly the point it was still needed. With the awaits
      // hoisted, everything below is synchronous and cannot interleave.
      const sprites = new Set<string>();
      for (const object of objects) {
        if (object.status !== "placed") continue;
        const def = placeCatalog.get(object.catalogKey);
        if (!def) continue;
        for (const file of objectSpriteFiles(def)) sprites.add(file);
      }
      await Promise.allSettled([...sprites].map((sprite) => ensureObjectTexture(assets, sprite)));
      if (generation !== objectReconcileGeneration) return false; // superseded: keep the aliases
      // A sprite whose download failed would otherwise be placed as an EMPTY texture: an
      // invisible object still holding its tiles against every future placement. Skip it
      // and let the next reconcile retry the download.
      const textureReady = (def: PlaceableDef) =>
        objectSpriteFiles(def).every((file) => !!assets.objects[file]);

      const current = new Map(field.serializeObjects().map((object) => [object.id, object]));
      /** Local objects already adopted by a server object in this pass. */
      const claimedSources = new Set<string>();
      /** Placed server objects that no local object is holding a position for. */
      const orphans: { instanceId: string; def: PlaceableDef; readyAt?: number }[] = [];

      for (const object of objects) {
        const localId = aliases[object.instanceId];
        const source = current.get(object.instanceId) ?? (localId ? current.get(localId) : undefined);
        // `current` is a snapshot, so it keeps resolving a local object after that
        // object has been renamed to a server instance id. Two server objects aliased to
        // the SAME local id would therefore both be placed on its tile — stacking, and
        // displacing whatever legitimately stood there (this is how a Zombie Pot could
        // vanish from the farm while the server still owned it). One claim per local
        // object: a loser is skipped, and a reload rebuilds it from the server list.
        if (source && claimedSources.has(source.id)) continue;
        if (object.status !== "placed") {
          if (current.has(object.instanceId)) field.removeObject(object.instanceId);
          if (localId && current.has(localId)) field.removeObject(localId);
          continue;
        }
        const direct = current.get(object.instanceId);
        if (direct?.key === object.catalogKey) {
          claimedSources.add(direct.id); // already itself: no other object may adopt it
          if (object.readyAt !== undefined) field.syncObjectReadyAt(object.instanceId, object.readyAt);
          continue;
        }
        const def = placeCatalog.get(object.catalogKey);
        if (!def || !textureReady(def)) continue;
        if (!source) {
          orphans.push({ instanceId: object.instanceId, def, readyAt: object.readyAt });
          continue;
        }
        claimedSources.add(source.id);
        field.removeObject(source.id);
        if (!field.placeObject(def, source.oc, source.or, object.instanceId, object.readyAt, !!source.rotation)) {
          // Its remembered tile is taken (a stale layout entry can collide with a live
          // object). Re-home it below rather than let it fall off the farm.
          orphans.push({ instanceId: object.instanceId, def, readyAt: object.readyAt });
        }
      }

      // Anything the server still owns as placed but that nothing on the farm holds a
      // position for is otherwise unreachable forever: the presentation layout is written
      // from the field, so an object missing from the field is missing from the next save
      // too. Give it a real tile so it becomes visible, movable, and persisted again.
      //
      // This runs even when the farm is otherwise empty. Gameplay objects and the
      // presentation blob arrive in the SAME bootstrap response, so "no positions at all"
      // cannot mean a half-loaded save — it means those positions are genuinely gone, and
      // a real tile beats an invisible object the player has already paid for.
      for (const orphan of orphans) {
        const spot = field.findFreeOrigin(orphan.def);
        if (!spot) {
          if (!rehomeWarned.has(orphan.instanceId)) {
            rehomeWarned.add(orphan.instanceId);
            hud.showToast(`No room to put your ${orphan.def.name} back — clear a space and it will reappear.`);
          }
          continue;
        }
        field.placeObject(orphan.def, spot.oc, spot.or, orphan.instanceId, orphan.readyAt);
        rehomeWarned.delete(orphan.instanceId);
      }
      // Persist the recovered positions immediately: a reload before the next autosave
      // would drop them straight back into the state this just repaired.
      if (orphans.length) saveManager.flushCritical();

      const placed = field.serializeObjects();
      const armyBonus = placed.reduce((sum, object) => sum + (placeCatalog.get(object.key)?.armyMax ?? 0), 0);
      const itemCap = placed.reduce((cap, object) => Math.max(cap, placeCatalog.get(object.key)?.storageSlots ?? 0), 8);
      state.syncCapacities(baseZombieMax + armyBonus, itemCap);
      return true; // aliases consumed — EconomyClient may drop them
    };
    economy.onRosterState = (roster, aliases, settled) => {
      const pots = zombies.reconcileServerPots(roster, settled);
      for (const pot of pots.live) {
        economy!.restoreCombineParents(pot.potId, pot.parentAId, pot.parentBId, pot.playerLevel);
      }
      if (pots.retired.length) {
        // The job was a local fiction: the server holds no reservation for it, so its
        // parents are ordinary roster units again and the reconcile below will show
        // them. Persist immediately so a reload cannot resurrect the phantom Pot.
        hud.showToast(pots.retired.length > 1
          ? "Some Zombie Pot combines could not be confirmed — those zombies are back on your farm."
          : "That Zombie Pot combine could not be confirmed — your zombies are back on your farm.");
        saveManager.flushCritical();
      }
      const hidden = new Set(zombies.pendingPotParents().flatMap((pot) => [pot.parentAId, pot.parentBId]));
      zombies.reconcileServerRoster(roster.filter((unit) => !hidden.has(unit.id)), aliases);
    };
    economy.onRaidRevival = (offer, brains) => {
      const current = new Map(zombies.roster().map((zombie) => [zombie.id, zombie]));
      const casualties = offer.zombies.flatMap((snapshot) => {
        const cached = current.get(snapshot.id);
        if (cached) return [{ ...cached }];
        const def = zombieDefs.get(snapshot.key);
        return def ? [makeOwned(
          snapshot.id,
          def,
          walk.tile.col,
          walk.tile.row,
          snapshot.invasions,
          snapshot.mutation
        )] : [];
      });
      const views = casualties.map((zombie) => ({
        id: zombie.id,
        key: zombie.key,
        name: zombie.name,
        typeName: zombie.typeName,
        portrait: zombiePortrait(zombie.key),
        mutation: zombie.mutation,
        color: zombie.color,
      }));
      hud.openZombieRevival(views, brains, async (reviveIds) => {
        const revived = await economy!.resolveRaidRevival(offer.sessionId, reviveIds);
        const accepted = new Set(revived.revivedIds);
        zombies.reviveCasualties(casualties.filter((zombie) => accepted.has(zombie.id)));
        saveManager.save();
        return true;
      });
    };
    // Server-owned roster: seed the shadow from the current units, then report every
    // post-load create (grant) / casualty + combined parent (casualty), and route a
    // SELL through the server (it prices + credits it, rejecting a unit it doesn't own
    // — so a fabricated zombie can't be cashed out). Seed + go-live before wiring the
    // hooks so restoring the save doesn't re-emit grants.
    void economy.syncRoster(zombies.seedData());
    zombies.onGrant = (u) => economy!.submitRoster({ type: "grant", unitId: u.id, key: u.key, mutation: u.mutation, invasions: u.invasions });
    zombies.onCasualty = (ids) => economy!.submitRoster({ type: "casualty", unitIds: ids });
    // Combine goes through its own server ops so the result is validated against the two
    // parents (a combine can't fabricate an arbitrary expensive result).
    zombies.onCombineStart = (potId, parentAId, parentBId) =>
      economy!.submitRoster({ type: "combineStart", potId, parentAId, parentBId, playerLevel: state.level });
    zombies.onCombineCollect = (potId, unitId, key, mutation, stored) =>
      economy!.submitRoster({ type: "combineCollect", potId, unitId, key, mutation, stored });
    for (const pot of zombies.pendingPotParents()) {
      economy.restoreCombineParents(pot.potId, pot.parentAId, pot.parentBId, pot.playerLevel);
    }
    zombies.setRosterLive();
    state.onRosterSell = (unitId, value) => economy!.submitRoster({ type: "sell", unitId }, { gold: value });
    // Server-owned placeable objects: seed the ownership counts from the currently-placed
    // objects (one-time, so already-placed placeables stay refundable), then buy/refund
    // route through the server at their call sites (object buy + sellObject).
    void economy.syncObjects(field.objectKeyCounts());
    // Server-owned soil: import this save's already-plowed plots (one-time). Without it
    // the server would reject planting on soil this client shows as tilled — and won't
    // let the player re-till, since re-tilling only applies to harvested dirt/holes.
    void economy.syncFarm(field.plowedPlotOrigins());
    // Server-owned farm size + climate skins: adopt the authoritative values (a resize
    // reverts a rejected purchase; a save-edited larger farm shrinks to the server's).
    economy.onShopState = (size, climates) => {
      if (size !== field.w) {
        field.resizeAuthoritative(size, size);
        syncWorldToFarm();
        clampCamera();
      }
      state.ownedClimates = ["grass", ...climates.filter((t) => t !== "grass")];
    };
    economy.onFarmerState = (headIds, equippedHeadId, bonusHeadId) =>
      state.syncFarmerOwnership(headIds, assets.farmer, equippedHeadId, bonusHeadId);
    economy.onPetState = (ownedPets, activePet, penPets) => state.syncPetOwnership(ownedPets, activePet, penPets);
    economy.onQuestState = (serverState) => quests.restoreAuthoritative(serverState);
    economy.onQuestChanges = (changes) => quests.applyAuthoritativeChanges(changes);
    economy.onPeriodicQuestState = (serverState) => periodicQuests.adoptAuthoritative(serverState);
    economy.onTutorialState = (rewarded) => {
      if (!rewarded) return;
      state.setTutorial(reconcileTutorialCompletion(state.tutorial, true));
      tutorial?.completeFromAuthority();
    };
    // The reason is the only thing that distinguishes "the network blipped" from a
    // lease, protocol or envelope problem that will never clear on its own. It used
    // to be dropped on the floor, so a paused farm looked identical whatever caused
    // it and every player report read as "my internet is fine". Keep it in the toast
    // and on the console so a screenshot names the branch.
    economy.onGameplayUnavailable = (reason) => {
      hud.setPlayStatus("online", "reconnecting");
      hud.showToast(`Online gameplay paused (${reason}) — reconnecting to your farm.`);
      console.warn(`[zf] gameplay paused: ${reason} | ${economy?.unavailableReason}`);
    };
    const showWriterLock = () => {
      saveManager.setOnlineWritable(false);
      hud.showWriterLock(async () => {
        if (!await economy!.takeOver()) return false;
        window.location.reload();
        return true;
      });
    };
    economy.onWriterReplaced = showWriterLock;
    economy.onWriterOwned = () => {
      saveManager.setOnlineWritable(true);
      saveManager.restoreOnlineJobs();
    };
    economy.onWriterAvailable = () => {
      hud.setPlayStatus("online", "synced");
      hud.hideWriterLock();
    };
    economy.onCommandRejected = (command, error) => {
      if (command?.type === "roster.combine_start") {
        zombies.cancelCombine(command.potId);
        saveManager.flushCritical();
      }
      if (command?.type === "roster.combine" && command.potId &&
          zombies.rollbackCombineCollection(command.potId)) {
        economy!.restoreCombineParents(
          command.potId,
          command.parentAId,
          command.parentBId,
          command.playerLevel,
        );
        saveManager.flushCritical();
      }
      const subject = command?.type.startsWith("roster.") ? "Zombie action"
        : command?.type.startsWith("object.") ? "Object action"
        : command?.type.startsWith("storage.") ? "Reward action"
        : command?.type.startsWith("farm.") ? "Farm action"
        : command?.type.startsWith("power.") ? "Boost action" : "Action";
      const reason: Record<string, string> = {
        not_owned: "the item is no longer available", capacity_full: "capacity is full",
        none_owned: "the reward is no longer available", stack_full: "the inventory stack is full",
        army_full: "the farm is full", storage_full: "storage is full",
        not_grown: "the crop is not ready", nothing_planted: "the crop changed",
        not_plowed: "the soil is no longer plowed", plot_occupied: "the plot already contains a crop",
        insufficient: "there are not enough funds", no_effect: "the game state changed",
        prior_command_failed: "an earlier related action failed",
      };
      hud.showToast(`${subject} was rolled back: ${reason[error] ?? error.replace(/_/g, " ")}.`);
    };
    void economy.start();
    // Seed the shop state from the save, then adopt server truth (once, after load).
    void economy.syncShop(field.w, state.ownedClimates);
  }
  // A restored (or visited) farm may be a larger (upgraded) size than the 30x30
  // default the world was first built for: re-fit backdrop/foliage/bounds + re-clamp.
  syncWorldToFarm();
  clampCamera();

  // A brand-new farm starts EMPTY: the guided tutorial's whole first step is to
  // grow the player's very first zombie, so we no longer inject a starter unit.
  // (Restored farms rebuild their own roster; a visited farm shows the friend's.)
  if (!visiting && !restored) {
    state.setZombieCount(0); // no starter; sync the HUD count off the default 1
  }

  // Visit mode UI: hide the farm-editing chrome, show a "Visiting X — Exit" banner.
  // Autosave was never enabled above, so nothing here can persist.
  if (visiting && visitTarget) {
    hud.setMode("walk"); // no tool is ever active while visiting
    hud.setVisiting(true, visitTarget.name, () => exitVisit());
  } else if (visitError) {
    hud.showToast(
      visitError === "not_friends" ? "You're no longer friends with that player."
        : visitError === "no_save" ? "That player hasn't started a farm yet."
        : "Couldn't open that farm right now."
    );
  }

  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;

  let dragging = false;
  let moved = false;
  let lastPlot = "";
  const last = new Point();
  const pressStart = new Point();
  let hoveredCrop: { col: number; row: number; wx: number; wy: number; x: number; y: number } | null = null;
  let cropHoverRefresh = 0;
  let temporaryPanGesture = false;
  let pressPointerType = "mouse";
  let pressPointerId = -1;
  let pressMaxDistance = 0;
  let touchSelectStartTile: { col: number; row: number } | null = null;
  let touchToolStartTile: { col: number; row: number } | null = null;
  let touchOutsideFarmPan = false;
  let zombieLongPressTimer: ReturnType<typeof setTimeout> | null = null;
  let zombieLongPressActivated = false;
  let harvestStrokeCandidate: HarvestTarget | null = null;
  let harvestStrokeActive = false;
  const harvestStrokeLast = new Point();
  const harvestStrokeTargets: HarvestTarget[] = [];
  const harvestStrokeKeys = new Set<string>();
  const harvestStrokePreviews = new Map<string, Graphics>();
  // Plant tiles painted by the current finger gesture. Plowing uses the explicit
  // rectangle state below so a release can never also become a second plow tap.
  const touchGestureTiles: { col: number; row: number }[] = [];
  const touchGestureTileKeys = new Set<string>();
  const touchPlantPreviews = new Map<string, Graphics>();
  let plowStrokeAnchor: { oc: number; or: number } | null = null;
  const plowStrokeLast = new Point();
  const plowStrokeTargets: { oc: number; or: number }[] = [];
  const plowStrokeKeys = new Set<string>();
  const plowStrokePreviews = new Map<string, Graphics>();

  const cancelZombieLongPress = () => {
    if (zombieLongPressTimer !== null) clearTimeout(zombieLongPressTimer);
    zombieLongPressTimer = null;
  };

  const clearTouchPlantPreview = () => {
    for (const preview of touchPlantPreviews.values()) preview.destroy();
    touchPlantPreviews.clear();
  };
  const clearTouchToolStroke = () => {
    touchGestureTiles.length = 0;
    touchGestureTileKeys.clear();
    touchToolStartTile = null;
    clearTouchPlantPreview();
  };
  const clearHarvestStroke = () => {
    for (const preview of harvestStrokePreviews.values()) preview.destroy();
    harvestStrokePreviews.clear();
    harvestStrokeTargets.length = 0;
    harvestStrokeKeys.clear();
    harvestStrokeCandidate = null;
    harvestStrokeActive = false;
  };
  const clearPlowStroke = () => {
    for (const preview of plowStrokePreviews.values()) preview.destroy();
    plowStrokePreviews.clear();
    plowStrokeTargets.length = 0;
    plowStrokeKeys.clear();
    plowStrokeAnchor = null;
  };
  const recordTouchPlantTile = (col: number, row: number) => {
    const rawKey = tileKey(col, row);
    if (touchGestureTileKeys.has(rawKey)) return;
    touchGestureTileKeys.add(rawKey);
    touchGestureTiles.push({ col, row });
    if (hud.mode !== "plant" || !hud.planting || !field.canPlant(col, row)) return;
    const origin = field.plotOriginAt(col, row);
    if (!origin) return;
    const key = tileKey(origin.oc, origin.or);
    if (touchPlantPreviews.has(key)) return;
    const center = field.plotCenterOf(origin.oc, origin.or);
    const width = PLOT * HW;
    const height = PLOT * HH;
    const preview = new Graphics();
    preview.moveTo(0, -height).lineTo(width, 0).lineTo(0, height).lineTo(-width, 0).lineTo(0, -height)
      .fill({ color: 0x8df25a, alpha: 0.2 })
      .stroke({ width: 3, color: 0x8df25a, alpha: 0.8 });
    preview.position.set(center.x, center.y);
    field.highlightLayer.addChild(preview);
    touchPlantPreviews.set(key, preview);
  };
  const commitTouchToolStroke = () => {
    for (const tile of touchGestureTiles) enqueueTool(tile.col, tile.row);
    clearTouchToolStroke();
  };

  // ---- multi-touch pinch-to-zoom (mobile) ----
  // Handled with native touch events (not Pixi pointers): e.touches reliably
  // lists every finger with coordinates, which is exactly what a pinch needs.
  // While two fingers are down, `touchPinch` is set — the Pixi pan/tap path
  // early-returns on it — and the finger-spread ratio drives zoom (toward the
  // midpoint) while the midpoint's travel pans, i.e. one pinch-and-drag gesture.
  // Attached unconditionally: the handlers no-op unless exactly two fingers are
  // down, so a mouse device pays nothing and any touch-capable device works
  // without depending on feature detection.
  let touchPinch = false;
  let pinchDist = 0;
  const pinchMid = new Point();
  const cancelPointerGesture = () => {
    cancelZombieLongPress();
    zombieLongPressActivated = false;
    dragging = false;
    moved = false;
    lastPlot = "";
    pressPointerId = -1;
    touchOutsideFarmPan = false;
    clearTouchToolStroke();
    clearPlowStroke();
    field.clearTillSelection();
    touchPinch = false;
    pinchDist = 0;
    temporaryPanGesture = false;
    field.hideCursor();
    field.setObjectHighlight(null);
    clearHarvestStroke();
  };
  // Canvas-relative CSS pixels (same space wheel/zoomAt use).
  const canvasXY = (clientX: number, clientY: number) => {
    const r = app.canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };
  const pinchInfo = (t: TouchList) => {
    const a = canvasXY(t[0].clientX, t[0].clientY);
    const b = canvasXY(t[1].clientX, t[1].clientY);
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };
  {
    app.canvas.addEventListener("touchstart", (e: TouchEvent) => {
      if (e.touches.length !== 2 || raidActive) return;
      e.preventDefault();
      touchPinch = true;
      cancelZombieLongPress();
      dragging = false; // abandon any in-progress single-finger pan
      // Nothing has committed yet: discard the pending paint stroke and let the
      // two fingers control the camera instead.
      clearTouchToolStroke();
      clearHarvestStroke();
      lastPlot = "";
      clearPlowStroke();
      field.clearTillSelection();
      field.hideCursor();
      const g = pinchInfo(e.touches);
      pinchDist = g.dist;
      pinchMid.set(g.mx, g.my);
    }, { passive: false });

    app.canvas.addEventListener("touchmove", (e: TouchEvent) => {
      if (!touchPinch || e.touches.length < 2) return;
      e.preventDefault();
      const g = pinchInfo(e.touches);
      if (pinchDist > 0) zoomAt(pinchMid.x, pinchMid.y, g.dist / pinchDist); // zoom by spread
      world.position.x += g.mx - pinchMid.x; // and pan by the midpoint's travel
      world.position.y += g.my - pinchMid.y;
      clampCamera();
      pinchDist = g.dist;
      pinchMid.set(g.mx, g.my);
    }, { passive: false });

    const endPinch = (e: TouchEvent) => {
      if (e.type === "touchcancel") {
        cancelPointerGesture();
        return;
      }
      // Once fewer than two fingers remain the pinch is over. Stay out of pan mode
      // so the last finger doesn't jump the camera.
      if (e.touches.length < 2) { touchPinch = false; dragging = false; }
    };
    app.canvas.addEventListener("touchend", endPinch);
    app.canvas.addEventListener("touchcancel", endPinch);
  }
  const toWorld = (e: FederatedPointerEvent) => world.toLocal(e.global);
  const tileAt = (e: FederatedPointerEvent) => {
    const w = toWorld(e);
    const g = screenToGrid(w.x, w.y);
    return { col: Math.round(g.col), row: Math.round(g.row), wx: w.x, wy: w.y };
  };
  const tileKey = (col: number, row: number) => `${col},${row}`;

  const harvestTargetPending = (target: HarvestTarget): boolean => target.kind === "tree"
    ? jobs.isTreeHarvestPending(target.instanceId)
    : target.kind === "replow"
      ? jobs.isPlotTillPending(target.oc, target.or)
      : jobs.isPlotHarvestPending(target.oc, target.or);

  // A visible ripe tree owns the swipe point before the plot behind its canopy.
  // Else resolve to the canonical 4x4 plot origin so crossing one crop's tiles only
  // creates one target. Tutorial strokes remain constrained to the current beat.
  const harvestTargetAt = (globalX: number, globalY: number): HarvestTarget | null => {
    const worldPoint = world.toLocal(new Point(globalX, globalY));
    const grid = screenToGrid(worldPoint.x, worldPoint.y);
    const col = Math.round(grid.col), row = Math.round(grid.row);
    if (tutorial?.active && !tutorial.allowsTile(col, row)) return null;
    const objectId = field.objectAtPoint(worldPoint.x, worldPoint.y);
    if (objectId) {
      if (!field.isObjectReady(objectId)) return null;
      const target: HarvestTarget = { kind: "tree", instanceId: objectId };
      return harvestTargetPending(target) ? null : target;
    }
    const origin = field.plotOriginAt(col, row);
    if (!origin) return null; // bare ground never becomes a select-tool plow target
    const target: HarvestTarget | null = field.isRipe(col, row)
      ? {
          kind: "plot", oc: origin.oc, or: origin.or,
          isZombie: field.ripeZombieAt(col, row),
        }
      : field.isSpent(col, row)
        ? { kind: "replow", oc: origin.oc, or: origin.or }
        : null;
    if (!target) return null;
    return harvestTargetPending(target) ? null : target;
  };

  const enqueueHarvestTarget = (target: HarvestTarget): boolean => {
    if (target.kind === "tree") {
      if (!field.isObjectReady(target.instanceId)) return false;
      const point = field.objectWorkPoint(target.instanceId);
      return !!point && jobs.enqueueTreeHarvest(target.instanceId, point.x, point.y);
    }
    if (target.kind === "replow") {
      if (!field.isSpent(target.oc, target.or)) return false;
      return jobs.enqueue("till", target.oc, target.or);
    }
    if (!field.isRipe(target.oc, target.or)) return false;
    // The army/Mausoleum check lives in jobs.enqueue, which also debits the zombie
    // harvests already queued — a swipe across a field of ripe zombies must not queue
    // more than there is room for, and re-swiping a queued plot must not re-warn.
    return jobs.enqueue("harvest", target.oc, target.or);
  };

  const showHarvestStrokePreview = (target: HarvestTarget) => {
    const key = harvestTargetKey(target);
    if (harvestStrokePreviews.has(key)) return;
    const area = target.kind === "tree"
      ? field.objectHighlightArea(target.instanceId)
      : { ...field.plotCenterOf(target.oc, target.or), tiles: PLOT };
    if (!area) return;
    const w = area.tiles * HW, h = area.tiles * HH;
    const color = target.kind === "replow" ? 0x8df25a : 0xffd45a;
    const stroke = target.kind === "replow" ? 0x8df25a : 0xffe58a;
    const preview = new Graphics();
    preview.moveTo(0, -h).lineTo(w, 0).lineTo(0, h).lineTo(-w, 0).lineTo(0, -h)
      .fill({ color, alpha: 0.24 })
      .stroke({ width: 3, color: stroke, alpha: 0.95 });
    preview.position.set(area.x, area.y);
    field.highlightLayer.addChild(preview);
    harvestStrokePreviews.set(key, preview);
  };

  const recordHarvestStrokeTarget = (target: HarvestTarget) => {
    if (harvestTargetPending(target) ||
        !appendHarvestTarget(target, harvestStrokeTargets, harvestStrokeKeys)) return;
    if (isTouchPointer(pressPointerType)) showHarvestStrokePreview(target);
    else enqueueHarvestTarget(target);
  };

  const collectHarvestStrokeSegment = (x: number, y: number) => {
    for (const point of sampleStrokeSegment(harvestStrokeLast, { x, y })) {
      const target = harvestTargetAt(point.x, point.y);
      if (target) recordHarvestStrokeTarget(target);
    }
    harvestStrokeLast.set(x, y);
  };

  const beginHarvestStroke = (x: number, y: number) => {
    if (!harvestStrokeCandidate) return;
    harvestStrokeActive = true;
    recordHarvestStrokeTarget(harvestStrokeCandidate);
    collectHarvestStrokeSegment(x, y);
  };

  const commitTouchHarvestStroke = () => {
    const targets = [...harvestStrokeTargets];
    clearHarvestStroke();
    for (const target of targets) enqueueHarvestTarget(target);
  };

  // Queue the active tool on a plot: Plow places/re-tills a 4x4; Plant sows the
  // currently-selected crop. No-op for select/sell.
  const enqueueTool = (col: number, row: number): boolean => {
    if (hud.mode === "till") return jobs.enqueue("till", col, row);
    if (hud.mode === "plant" && hud.planting)
      return jobs.enqueue("plant", col, row, hud.planting);
    return false;
  };

  const originAtTile = (col: number, row: number): { oc: number; or: number } => {
    const target = field.resolveTill(col, row);
    return { oc: target.oc, or: target.or };
  };

  const showPlowStrokePreview = (target: { oc: number; or: number }) => {
    const key = tileKey(target.oc, target.or);
    if (plowStrokePreviews.has(key)) return;
    const center = field.plotCenterOf(target.oc, target.or);
    const w = PLOT * HW, h = PLOT * HH;
    const preview = new Graphics();
    preview.moveTo(0, -h).lineTo(w, 0).lineTo(0, h).lineTo(-w, 0).lineTo(0, -h)
      .fill({ color: 0x8df25a, alpha: 0.2 })
      .stroke({ width: 3, color: 0x8df25a, alpha: 0.8 });
    preview.position.set(center.x, center.y);
    field.plowHighlightLayer.addChild(preview);
    plowStrokePreviews.set(key, preview);
  };

  const recordPlowStrokeTarget = (target: { oc: number; or: number }) => {
    const key = tileKey(target.oc, target.or);
    if (plowStrokeKeys.has(key)) return;
    const current = field.resolveTill(target.oc + PLOT / 2, target.or + PLOT / 2);
    if (!current.valid || current.oc !== target.oc || current.or !== target.or) return;
    plowStrokeKeys.add(key);
    plowStrokeTargets.push(target);
    if (isTouchPointer(pressPointerType)) showPlowStrokePreview(target);
    else jobs.enqueue("till", target.oc + PLOT / 2, target.or + PLOT / 2);
  };

  const plowTargetAt = (globalX: number, globalY: number): { oc: number; or: number } | null => {
    if (!plowStrokeAnchor) return null;
    const worldPoint = world.toLocal(new Point(globalX, globalY));
    const grid = screenToGrid(worldPoint.x, worldPoint.y);
    const col = Math.round(grid.col), row = Math.round(grid.row);
    if (tutorial?.active && !tutorial.allowsTile(col, row)) return null;
    const existing = field.plotOriginAt(col, row);
    if (existing) {
      const target = field.resolveTill(col, row);
      return target.valid ? { oc: target.oc, or: target.or } : null;
    }
    const current = originAtTile(col, row);
    const snapped = snapPlowOrigin(plowStrokeAnchor, current);
    const target = field.resolveTill(snapped.oc + PLOT / 2, snapped.or + PLOT / 2);
    return target.valid && target.oc === snapped.oc && target.or === snapped.or ? snapped : null;
  };

  const collectPlowStrokeSegment = (x: number, y: number) => {
    for (const point of sampleStrokeSegment(plowStrokeLast, { x, y })) {
      const target = plowTargetAt(point.x, point.y);
      if (target) recordPlowStrokeTarget(target);
    }
    plowStrokeLast.set(x, y);
  };

  const beginPlowStroke = (col: number, row: number, x: number, y: number): boolean => {
    const target = field.resolveTill(col, row);
    if (!target.valid) return false;
    plowStrokeAnchor = { oc: target.oc, or: target.or };
    plowStrokeLast.set(x, y);
    recordPlowStrokeTarget(plowStrokeAnchor);
    return true;
  };

  const commitTouchPlowStroke = () => {
    const targets = [...plowStrokeTargets];
    clearPlowStroke();
    for (const target of targets)
      jobs.enqueue("till", target.oc + PLOT / 2, target.or + PLOT / 2);
  };

  // ---- object buy / place / move ----
  // The Market offers only the NEXT shed above the current tier; report the placed
  // shed's capacity (0 = none) so it can filter to that single card.
  hud.getShedSlots = () => {
    const id = field.shedId();
    return id ? field.objectDefOf(id)?.storageSlots ?? 0 : 0;
  };
  hud.objectLimitReached = (def) => {
    const limit = placeablePurchaseLimit(def);
    if (limit === undefined) return false;
    const placed = field.objectKeyCounts()[def.key] ?? 0;
    const stored = state.storedItems.find((item) => item.key === def.key)?.count ?? 0;
    return placed + stored >= limit;
  };
  // Colored graves gate planting their zombie class (Blue/Red/Silver).
  hud.hasGrave = (color) => field.hasGrave(color);
  // Lets crop cards quote the harvest XP the Plowing Monolith actually pays out.
  hud.hasPlowFree = () => field.hasPlowFree();

  // ---- Farm Size upgrade (Market → Upgrade tab) ----
  // Buying an expansion grows the field (origin stays at 0,0 so nothing on the farm
  // moves) and re-fits the backdrop/foliage/camera to the new size. Sizes are bought
  // in order (30 → 40 → 50 → 60 → 70). Each tier has a gold card and a brains card;
  // buying either grows the farm, so the other currency's card then reads as owned.
  hud.setUpgrades(assets.upgrades.mapSize);
  hud.getMapSize = () => field.w;
  hud.onBuyUpgrade = async (size, currency) => {
    if (onlineGameplayBlocked()) return false;
    const up = assets.upgrades.mapSize.find((u) => u.size === size);
    if (!up || size <= field.w || state.level < up.level) return false;
    // Enforce sequential purchase: only the immediate next tier is buyable.
    const nextSize = Math.min(
      ...assets.upgrades.mapSize.filter((u) => u.size > field.w).map((u) => u.size)
    );
    if (size !== nextSize) return false;
    const cost = currency === "brains" ? up.brains : up.gold;
    // ONLINE: the server owns the farm size — it prices + debits the upgrade (and can
    // reject it). Wait for settlement before changing the playable boundary.
    if (economy) {
      const funds = currency === "brains" ? state.brains : state.gold;
      if (funds < cost) return false;
      if (!economy.submitShopSize(size, currency, cost)) return false;
      try { await economy.settleBeforeDependency(); } catch { return false; }
      if (field.w !== size) return false;
    } else if (!(currency === "brains" ? state.spendBrains(up.brains) : state.spendGold(up.gold))) {
      return false; // offline: insufficient funds in the chosen currency
    } else {
      field.resize(size, size);
      syncWorldToFarm();
      clampCamera();
    }
    audio.play("buy");
    saveManager.save(); // persist the new size (server owns it; blob is an offline cache)
    hud.showToast(`Farm expanded to ${size}×${size}!`);
    questBus.post(QuestEvent.ItemBought, up.name);
    return true;
  };

  // ---- Ground/climate skins (Market → Upgrade → Ground) ----
  // Buying a skin charges gold, repaints the farm, and records ownership so it can
  // be re-applied for free later. Grassy is the free default (always owned).
  hud.setClimates(assets.upgrades.climate);
  hud.getClimate = () => field.climate;
  hud.ownsClimate = (terrain) => state.ownsClimate(terrain);
  hud.onBuyClimate = async (c) => {
    if (onlineGameplayBlocked()) return false;
    if (state.ownsClimate(c.terrain) || c.terrain === "grass") return false;
    if (state.level < c.level) return false;
    // ONLINE: the server owns the climate set — it prices + debits the skin (and can
    // reject it). Wait for settlement before applying or saving the presentation.
    if (economy) {
      if (state.gold < c.gold) return false;
      if (!economy.submitShopClimate(c.terrain, c.gold)) return false;
      try { await economy.settleBeforeDependency(); } catch { return false; }
      if (!state.ownsClimate(c.terrain)) return false;
    } else if (!state.spendGold(c.gold)) {
      return false;
    } else {
      state.addOwnedClimate(c.terrain);
    }
    field.setClimate(c.terrain);
    saveManager.save();
    hud.showToast(`${c.name} applied!`);
    questBus.post(QuestEvent.ItemBought, c.name);
    audio.play("buy");
    return true;
  };
  hud.onApplyClimate = (c) => {
    if (!state.ownsClimate(c.terrain) && c.terrain !== "grass") return;
    field.setClimate(c.terrain);
    saveManager.save();
    audio.play("menuClick");
  };

  // Upgrade an already-placed building (storage shed / Mausoleum) to a bigger tier
  // IN PLACE (no re-placement): charge, swap its type/sprite, and raise its capacity.
  const upgradeBuilding = (def: PlaceableDef, id: string | null) => {
    if (onlineGameplayBlocked()) return;
    if (!id) return;
    if (state.level < def.level) return;
    const xp = buyXp(def.cost, def.xp, !!def.brainsNeeded, def.category);
    // Server-owned upgrade (online, priced): the server charges the new shed's full
    // price, swaps the ownership record, and grants the xp. The old shed is given up
    // with no refund — same as the local path. A legacy shed the server doesn't know
    // is rejected, and the optimistic debit reconciles away.
    const from = field.objectDefOf(id);
    const serverObject = !!economy && !!from && def.cost > 0;
    if (serverObject) {
      const have = def.brainsNeeded ? state.brains : state.gold;
      if (have < def.cost) return; // optimistic affordability; server re-checks
      economy!.submitObject(
        { type: "upgrade", fromKey: from!.key, toKey: def.key, instanceId: id },
        def.brainsNeeded ? { brains: -def.cost, xp } : { gold: -def.cost, xp }
      );
    } else {
      const paid = def.brainsNeeded ? state.spendBrains(def.cost) : state.spendGold(def.cost);
      if (!paid) return;
      state.addXp(xp);
    }
    audio.play("buy");
    field.replaceObjectDef(id, def);
    if (def.storageSlots) state.upgradeStorage(def.storageSlots);
    saveManager.save();
    const o = field.objectOriginOf(id);
    if (o) {
      const c = tileCenter(o.oc, o.or);
      floatText(c.x, c.y, `-${def.cost}${def.brainsNeeded ? "b" : "g"}`);
      showPurchaseXp(xp, c);
    }
    questBus.post(QuestEvent.ItemBought, def.name, 1, objectAliases.get(def.key) ?? []);
  };

  // Buying an object from the market: load its sprite(s) (lazy). A shed or Mausoleum
  // with one already placed UPGRADES it in place; otherwise enter placement. Fruit
  // trees have a second (growing) frame to preload.
  hud.onBuy = async (def) => {
    if (onlineGameplayBlocked()) return;
    if (hud.objectLimitReached?.(def)) return;
    await ensureObjectTextures(assets, def);
    if (def.storageSlots && field.shedId()) upgradeBuilding(def, field.shedId()); // upgrade, don't place
    // A placed Mausoleum upgrades in place too; a lower/equal tier is a no-op.
    else if (def.zombieStorage && field.mausoleumId()) {
      if ((def.zombieSlots ?? 0) > zombies.mausoleumCap) upgradeBuilding(def, field.mausoleumId());
    }
    else if (def.zombiePatch && field.patchId()) return; // only one Zombie Patch
    else if (def.graveColor && field.hasGrave(def.graveColor)) return; // already own this grave
    else hud.setPlacing(def);
  };

  // Center the camera on a world point (used to locate a zombie from the roster).
  const centerOn = (x: number, y: number) => {
    world.pivot.set(x, y);
    recenter();
  };

  // ---- zombie roster (the Zombies menu) ----
  // Zombies are stored in the Mausoleum (capped at mausoleumCap slots); the army
  // cap limits only the count deployed on the farm.
  hud.getRoster = () => zombies.roster();
  // Zombie Almanac: every obtainable species with its lifetime-obtained count.
  // Base catalog stats only — deliberately no farmer/veterancy/mutation modifiers.
  const almanacSources = {
    raidNameById: (raidId: number) => assets.raids.find((raid) => raid.id === raidId)?.name,
    epicBossNameByQuestId: (questId: string) =>
      EPIC_BOSSES.find((boss) => boss.questIds.includes(questId))?.name,
  };
  hud.getAlmanac = () =>
    almanacEntries(assets.zombies, state.zombieDiscovered).map((def) => {
      // Epic Boss exclusives are flagged here; the panel groups them under "Epic".
      const epic = isEpicZombie(def);
      return {
        key: def.key,
        name: def.name,
        portrait: zombiePortrait(def.key),
        group: def.group,
        className: def.className,
        classColor: def.classColor,
        category: def.category,
        str: def.str, dex: def.dex, con: def.con, focus: def.focus,
        obtained: state.zombieDiscovered[def.key] ?? 0,
        hint: obtainHint(def, almanacSources),
        ...(epic ? { epic } : {}),
      };
    });
  hud.zombiePortraitOf = (key) => zombiePortrait(key);
  hud.getMausoleumCap = () => zombies.mausoleumCap;
  // The Mausoleum upgrade ladder: each tier is an ordinary catalog placeable that
  // replaces the placed one (see upgradeBuilding), so the next tier is simply the
  // cheapest authored Mausoleum with more slots than the one standing on the farm.
  const nextMausoleumTier = (): PlaceableDef | null => {
    if (!field.mausoleumId()) return null;
    const cap = zombies.mausoleumCap;
    return [...placeCatalog.values()]
      .filter((def) => def.zombieStorage && (def.zombieSlots ?? 0) > cap)
      .sort((a, b) => (a.zombieSlots ?? 0) - (b.zombieSlots ?? 0))[0] ?? null;
  };
  hud.getMausoleumUpgrade = () => {
    const def = nextMausoleumTier();
    return def
      ? { name: def.name, cost: def.cost, brains: !!def.brainsNeeded, slots: def.zombieSlots ?? 0 }
      : null;
  };
  hud.onMausoleumUpgrade = async () => {
    const def = nextMausoleumTier();
    if (!def) return;
    await ensureObjectTextures(assets, def);
    upgradeBuilding(def, field.mausoleumId());
  };
  hud.canStoreZombies = () => !!field.mausoleumId() && !zombies.mausoleumFull;
  hud.canDeployZombie = () => zombies.canAdd();
  hud.canTakeZombieDelivery = () => zombies.canHarvestZombie();
  hud.onZombieRename = (id, requested) => {
    const name = zombies.rename(id, requested);
    if (name) saveManager.flushCritical();
    return name;
  };
  hud.onZombieStore = async (id) => {
    if (onlineGameplayBlocked()) return;
    try { if (economy) [id] = await economy.settleUnitIds([id]); }
    catch { hud.showToast("Could not confirm that zombie. Please reconnect."); return; }
    if (field.mausoleumId() && !zombies.mausoleumFull && zombies.store(id)) economy?.submitRosterStatus(id, true);
  };
  hud.onZombieDeploy = async (id) => {
    if (onlineGameplayBlocked()) return;
    try { if (economy) [id] = await economy.settleUnitIds([id]); }
    catch { hud.showToast("Could not confirm that zombie. Please reconnect."); return; }
    if (zombies.deploy(id)) economy?.submitRosterStatus(id, false);
  };
  hud.onZombieLocate = (id) => {
    const p = zombies.selectById(id);
    if (p) centerOn(p.x, p.y);
  };
  // ---- saved line-ups ("Zombie Teams", opened from the Mausoleum) ----
  hud.getArmyCap = () => state.zombieMax;
  hud.getTeams = () => state.zombieTeams;
  hud.onTeamsChange = (teams) => {
    state.zombieTeams = sanitizeTeams(teams);
    saveManager.flushCritical(); // same path a rename takes: teams are presentation data
  };
  // Assemble a team: deploy its members, store everyone else. Deliberately built
  // out of the SAME two moves the Mausoleum's own buttons make (zombies.store /
  // zombies.deploy + submitRosterStatus), so a team can never move a zombie in a
  // way a player could not by hand — the server sees an ordinary sequence of
  // roster.status commands and validates each one itself.
  hud.onTeamAssemble = async (memberIds) => {
    if (onlineGameplayBlocked()) return null;
    let members = memberIds;
    let settledTeams = false;
    try {
      if (economy) {
        // A harvest settled since the team was saved may have exchanged an
        // optimistic local id for the server's; rewrite the saved team too, or it
        // loses that zombie for good the moment the id it remembers stops existing.
        members = await economy.settleUnitIds(memberIds);
        const settled = settleTeamMembers(state.zombieTeams, (id) => economy!.authoritativeUnitId(id));
        settledTeams = settled.some((team, i) => team !== state.zombieTeams[i]);
        if (settledTeams) state.zombieTeams = settled;
      }
    } catch {
      hud.showToast("Could not confirm your zombies. Please reconnect.");
      return null;
    }
    const plan = planTeamAssembly(members, zombies.roster(), state.zombieMax, zombies.mausoleumCap);
    let stored = 0;
    let deployed = 0;
    // Preserve the planner's interleaving: with a full Mausoleum, a deploy may be the
    // move that opens the storage slot needed by the following store.
    for (const operation of plan.operations) {
      if (operation.type === "store") {
        if (zombies.store(operation.id)) {
          economy?.submitRosterStatus(operation.id, true);
          stored++;
        }
      } else if (zombies.deploy(operation.id)) {
        economy?.submitRosterStatus(operation.id, false);
        deployed++;
      }
    }
    // The team's order IS an attack order: adopt it for the Army screen so a team
    // built for one invasion also reopens with its line-up in the right sequence.
    // Only members that made it onto the farm — the screen shows deployed units.
    const onFarm = new Set(zombies.roster().filter((unit) => !unit.stored).map((unit) => unit.id));
    const order = members.filter((id) => onFarm.has(id));
    if (order.length) state.raidAttackOrder = order;
    // Rewritten member ids are worth a write of their own: an assembly that moved
    // nothing (the team is already standing there) still learned the real ids.
    if (stored || deployed || settledTeams) saveManager.flush();
    // A move the plan asked for that the field refused (the roster shifted under
    // us — a crop finished growing mid-assembly) counts as blocked/left too, so
    // the toast can never claim more than actually happened.
    return {
      deployed, stored,
      missing: plan.missing.length,
      blocked: plan.blocked.length + (plan.deploy.length - deployed),
      left: plan.left.length + (plan.store.length - stored),
      present: plan.present.length,
      shortfall: plan.shortfall,
    };
  };
  hud.zombieBaseCost = (key) => zombieDefs.get(key)?.cost ?? 0;
  hud.zombieCostsBrains = (key) => !!zombieDefs.get(key)?.brainsNeeded;
  hud.onZombieSell = async (id) => {
    if (onlineGameplayBlocked()) return;
    try { if (economy) [id] = await economy.settleUnitIds([id]); }
    catch { hud.showToast("Could not confirm that zombie. Please reconnect."); return; }
    const z = zombies.roster().find((r) => r.id === id);
    if (!z) { hud.showToast("That zombie is no longer available."); return; }
    const def = zombieDefs.get(z.key);
    const value = zombieSellValue(def?.cost ?? 0, !!def?.brainsNeeded);
    const p = zombies.selectById(id); // deployed unit's world pos (null if stored)
    if (!zombies.sell(id)) return; // gone already; don't credit gold
    audio.play("sell");
    // ONLINE: the server owns the roster — it prices + credits the sell (and rejects a
    // unit it doesn't own, so a fabricated zombie can't be cashed out). OFFLINE: credit
    // locally as before.
    if (state.onRosterSell) state.onRosterSell(id, value);
    else state.addGold(value);
    if (p) floatText(p.x, p.y, `+${value}g`);
  };

  // ---- Zombie Pot (combiner) ----
  const potBaseMs = () => POT_DURATION_MS;
  let activePotId: string | null = null;
  hud.getPotStatus = () => {
    const pot = activePotId ? zombies.potFor(activePotId) : zombies.combinePot;
    return {
      busy: pot.busy,
      ready: pot.ready,
      remainingMs: pot.remainingMs(),
      totalMs: pot.totalMs(),
      monolith: field.hasCombineMonolith(), // Clay Monolith speeds the pot timer
      canCollect: zombies.canAdd(),
      // The Pot can hand the child straight to the Mausoleum, so a full farm no
      // longer strands a finished combine.
      canStore: zombies.canStoreCombine(),
      pending: pot.pending
        ? {
            keyA: pot.pending.keyA, keyB: pot.pending.keyB,
            maskA: pot.pending.maskA, maskB: pot.pending.maskB,
            colorA: pot.pending.colorA, colorB: pot.pending.colorB,
          }
        : null,
      // Only set once the combine is done: the panel then shows the finished
      // zombie in place of the two parents until it is collected.
      result: zombies.combinePreview(activePotId ?? undefined),
    };
  };
  hud.canCombineZombie = (key, slot) => {
    const def = zombieDefs.get(key);
    return !def?.rewardOnly && !(slot === "B" && def?.category === "special");
  };
  hud.onCombine = async (idA, idB) => {
    if (onlineGameplayBlocked()) return false;
    if (!activePotId) return false;
    try { if (economy) [idA, idB] = await economy.settleUnitIds([idA, idB]); }
    catch { hud.showToast("Could not confirm those zombies. Please reconnect."); return false; }
    const ok = zombies.combine(idA, idB, potBaseMs(), activePotId);
    if (ok) {
      saveManager.flushCritical();
    }
    return ok;
  };
  hud.onCollectCombine = async (stored) => {
    if (onlineGameplayBlocked()) return null;
    if (!activePotId) return null;
    const targetPotId = activePotId;
    const pending = zombies.potFor(targetPotId).pending;
    const combined = pending ? combinedPotSubjects(pending) : null;
    const z = zombies.collectCombine(walk.tile.col, walk.tile.row, targetPotId, { stored });
    if (z) {
      if (combined?.subject) {
        questBus.post(QuestEvent.CombinerCombined, combined.subject, 1, combined.aliases);
      }
      // Only a species neither parent was counts as "combined for" — see
      // isCombinePromotion. A job with no snapshot to compare against keeps the
      // old unconditional behavior rather than silently losing quest progress.
      if (!pending || isCombinePromotion(z.key, pending.keyA, pending.keyB)) {
        questBus.post(QuestEvent.CombinerHarvested, z.typeName, 1, unitSubjectAliasesOf(z));
      }
      const c = tileCenter(z.col, z.row);
      floatText(c.x, c.y, z.mutation ? `${z.name}!` : z.name);
      // No toast naming the result: the Pot's ready view already shows the finished
      // zombie — portrait, name and inherited mutations — before it is collected.
      try { await economy?.settleBeforeDependency(); }
      catch { hud.showToast("The combine result is waiting for the server to reconnect."); }
      zombies.confirmCombineCollection(targetPotId);
      saveManager.flushCritical();
    } else if (zombies.combineReadyFor(targetPotId) &&
               (stored ? zombies.canStoreCombine() : zombies.canAdd())) {
      // The job is still ready and the chosen destination has room, so this was not the
      // ordinary "wait for a slot" refusal — the collection could not be handed to the
      // server (or its species no longer resolves). collectCombine has already put the
      // job back; say so rather than letting the button appear dead.
      hud.showToast("That combine could not be confirmed just now — it is still in the Pot. Try again in a moment.");
    }
    return z ? z.name : null;
  };

  // ---- raids / invasions ----
  const raidCooldownMs = RAID_COOLDOWN_MS;
  // Raid completion is a critical boundary (rewards/casualties/cooldown): flush()
  // persists the save immediately, and flush the economy so the raid's gold/brains/xp
  // ledger events land now rather than behind the debounce.
  const raids = new RaidManager(
    assets,
    state,
    zombies,
    // Raid settlement is the authoritative write. A synchronous presentation flush
    // here used to race /raid/finish for the writer-operation lock; schedule the
    // visual save normally and let the durable finish go first.
    {
      save: () => { saveManager.save(); void economy?.flush(); },
      grantZombie: (key) => {
        const name = zombieDefs.get(key)?.name ?? "Rare zombie";
        hud.showToast(grantEarnedZombie(key)
          ? `${name} joined your farm!`
          : `${name} was sent to Received.`);
      },
      placedCount: (key) => field.placedCount(key),
    },
    raidCooldownMs
  );
  hud.getRaidCards = () => raids.raidCards();
  hud.getRaidParty = () => raids.partyView();
  hud.getRaidStatus = () => ({
    cooldownMs: raids.cooldownRemaining(),
    voucherCount: raids.voucherCount(),
    brainTicketCount: raids.brainTicketCount(),
  });
  const selectEpicBoss = (bossId: string | null | undefined) => {
    const def = epicBossById(bossId) ?? DR_GROUNDHOG;
    if (epicBoss.def.id !== def.id) epicBoss = new EpicBossManager(def);
    return def;
  };
  const epicAsset = (def: typeof DR_GROUNDHOG, file: string) => `${BASE}assets/epic-bosses/${def.id}/${file}`;
  const epicRun = () => {
    selectEpicBoss(state.epicBossRun?.bossId);
    return epicBoss.normalize(state.epicBossRun);
  };
  hud.getEpicBossView = () => {
    const run = epicRun();
    const now = Date.now();
    const active = epicBoss.isActive(run);
    const shownBosses = visibleEpicBosses(EPIC_BOSSES, active && run ? run.bossId : null);
    return shownBosses.map((def) => {
      const ownRun = run?.bossId === def.id ? run : null;
      const ownActive = active && ownRun !== null;
      return {
        id: def.id, name: def.name,
        portrait: epicAsset(def, def.portrait), questIcon: epicAsset(def, def.questIcon),
        costBrains: def.costBrains, unlockLevel: epicBossUnlockLevel(def),
        levelLocked: state.level < epicBossUnlockLevel(def), maxLevel: def.maxLevel,
        reconstructed: !!def.reconstructed, blocked: active && !ownActive,
        run: ownRun, active: ownActive,
        expired: !!ownRun && !ownRun.completedAt && now >= ownRun.expiresAt,
        completed: !!ownRun?.completedAt,
        eventRemainingMs: ownActive && ownRun ? Math.max(0, ownRun.expiresAt - now) : 0,
        encounterRemainingMs: ownActive && ownRun?.encounterStartedAt
          ? Math.max(0, ownRun.encounterStartedAt + def.encounterMs - now) : 0,
        rewards: def.loot.map((loot) => loot.name),
        zombieRewards: epicZombieRewardNotes(def, assets.quests),
      };
    });
  };
  const syncEpicBossUi = () => {
    const run = epicRun();
    const active = epicBoss.isActive(run);
    quests.setEpicBossActive(active, active ? epicBoss.def.questIds : []);
    const days = active && run ? Math.max(1, Math.ceil((run.expiresAt - Date.now()) / 86_400_000)) : 0;
    hud.setBossShortcut(active, days ? `Boss · ${days}d` : "Boss");
  };
  if (economy) economy.onEpicBossState = (run) => {
    const previous = state.epicBossRun;
    state.setEpicBossRun(run ?? null);
    if (run && previous?.runId === run.runId && run.tokenCount > (previous.tokenCount ?? 0)) {
      const def = epicBossById(run.bossId);
      const spot = latestBossTokenHarvest ?? { x: actor.container.x, y: actor.container.y };
      if (def) popBossToken(spot.x, spot.y, def.id, def.portrait);
      latestBossTokenHarvest = null;
      hud.showToast("You found a Boss Token!");
      audio.play("xp");
    }
    syncEpicBossUi();
  };
  hud.onActivateEpicBoss = async (bossId) => {
    if (epicBoss.isActive(state.epicBossRun)) return false;
    const def = selectEpicBoss(bossId);
    const unlockLevel = epicBossUnlockLevel(def);
    if (state.level < unlockLevel) {
      hud.showToast(`${def.name} unlocks at level ${unlockLevel}.`);
      return false;
    }
    if (onlineFarm) {
      try {
        await economy?.settleBeforeDependency();
        const activated = await api.epicBossActivate(crypto.randomUUID(), def.id);
        const activatedRun = epicBossRunToClient(activated.event, activated.serverTime ?? Date.now());
        economy?.adoptEpicBossActivation(activated.event, activated.balance, activated.serverTime);
        state.setEpicBossRun(activatedRun);
        syncEpicBossUi();
        saveManager.flush();
        audio.play("buy");
        return true;
      } catch (error) {
        const code = errCode(error);
        hud.showToast(code === "locked" ? `${def.name} unlocks at level ${unlockLevel}.`
          : code === "insufficient_brains" ? `You need ${def.costBrains} brains.`
          : code === "gameplay_unavailable" || code === "offline" ? "Reconnecting to the farm serverâ€¦"
          : "The Epic Boss event could not be started.");
        return false;
      }
    }
    if (!state.spendBrains(def.costBrains, "epic_boss_activate")) return false;
    state.setEpicBossRun(epicBoss.activate(crypto.randomUUID()));
    syncEpicBossUi();
    saveManager.flush();
    audio.play("buy");
    return true;
  };
  hud.onEndEpicBoss = async () => {
    const run = epicRun();
    if (!run || !epicBoss.isActive(run)) return false;
    if (onlineFarm) {
      try {
        await economy?.settleBeforeDependency();
        const ended = await api.epicBossEnd(run.runId);
        state.setEpicBossRun(epicBossRunToClient(ended.event, ended.serverTime ?? Date.now()));
      } catch (error) {
        const code = errCode(error);
        hud.showToast(code === "inactive" ? "That Epic Boss event has already ended."
          : "The Epic Boss event could not be ended.");
        return false;
      }
    } else {
      const ended = epicBoss.end(run);
      if (!ended) return false;
      state.setEpicBossRun(ended);
    }
    syncEpicBossUi();
    saveManager.flush();
    return true;
  };
  syncEpicBossUi();
  window.setInterval(syncEpicBossUi, 60_000);
  // ---- Tim Buckwheat guided tutorial (first-run) ----
  // A DOM overlay layer that leads the player through the core farm loop. It
  // coexists with the quest rail (subscribes to the same questBus, polls live
  // state) and mutates no gameplay systems. See src/tutorial/.
  // Quietly absorb rapid relaunch taps during the server's minimum invasion window.
  // This mainly covers an immediate retreat to correct the selected army order while
  // the result request is still releasing the shared raid/Epic-Boss session lock.
  let raidLaunchLockedUntil = 0;
  tutorial = new TutorialController({
    hud, state, field, zombies, questBus,
    // Screen-pixel center of a plot origin (world → global for the arrow).
    plotScreenPos: (col, row) => {
      const c = field.plotCenterOf(col, row);
      const g = world.toGlobal(new Point(c.x, c.y));
      return { x: g.x, y: g.y };
    },
    // Reuse the tutorial zombie's plot when restoring an older in-progress save;
    // otherwise find empty ground near the farmer. This only selects a target —
    // the tutorial's Plow step creates the soil through the real job/backend path.
    findTutorialPlot: (preferExisting = false) => {
      const plots = field.serialize();
      if (preferExisting) {
        const existing = plots.find((p) => p.crop?.key === TUTORIAL_ZOMBIE_KEY)
          ?? plots.find((p) => p.state === "plowed" && !p.crop);
        if (existing) return { col: existing.oc, row: existing.or };
      }
      const anchors: [number, number][] = [
        [start.col + 4, start.row + 1], [start.col + 4, start.row - 3],
        [start.col - 5, start.row + 1], [start.col + 1, start.row + 5],
        [start.col + 1, start.row - 5], [start.col - 5, start.row - 3],
      ];
      for (const [c, r] of anchors) {
        const t = field.resolveTill(c, r);
        if (t.valid) return { col: t.oc, row: t.or };
      }
      return null;
    },
    isRaidActive: () => raidActive,
    // Plant and Insta-Grow are causally dependent server mutations. Confirm the
    // tutorial crop before the boost beat so an older plant projection cannot
    // overwrite the optimistic ripe timestamp from the first power use.
    settlePlant: () => economy?.settleBeforeDependency() ?? Promise.resolve(),
    grantCompletionBonus: () => {
      state.addGold(200);
      economy?.submitTutorialCompletion();
    },
  });
  // Kick off on a brand-new farm (never while visiting a friend); restore mid-run
  // otherwise. The fresh-farm detection (restored/visiting) happened at load above.
  if (!visiting) {
    if (!restored) tutorial.start();
    else tutorial.restore(state.tutorial);
  }

  // ---- save profiles: switch/create flush + reload so the whole game reloads
  // cleanly from the target profile; rename/delete just update the index. ----
  hud.getProfiles = playMode === "local" ? () => profiles.listProfiles() : null;
  // Flush the current game to its (still-active) profile, then STOP saving before
  // moving the active pointer — otherwise this page's beforeunload/autosave would
  // write the outgoing game into the profile we're switching into. The reload
  // then loads the target profile cleanly (fresh, for a brand-new one).
  hud.onSwitchProfile = playMode === "local" ? (id) => {
    saveManager.save();
    saveManager.suspend();
    profiles.setActive(id);
    location.reload();
  } : null;
  hud.onCreateProfile = playMode === "local" ? (name) => {
    saveManager.save();
    saveManager.suspend();
    profiles.setActive(profiles.createProfile(name)); // fresh (no save) → new game on reload
    location.reload();
  } : null;
  hud.onRenameProfile = playMode === "local" ? (id, name) => profiles.renameProfile(id, name) : null;
  hud.onDeleteProfile = playMode === "local" ? (id) => profiles.deleteProfile(id) : null;
  hud.onSwitchFarm = (destination) => {
    saveManager.flush();
    void economy?.flush().catch(() => {});
    saveManager.suspend();
    setPreferredPlayMode(destination);
    location.reload();
  };
  // Online has no full blob on this device (only presentation), so the file is
  // serialised from the live server-hydrated game. Settle the outbox first, or a
  // just-spent balance / just-harvested zombie would be missing from the copy.
  const exportOnlineFarm = async () => {
    try { await economy?.flush(); } catch { /* the durable outbox retries on its own */ }
    saveManager.flushCritical();
    const raw = saveManager.exportOnline();
    if (!raw) {
      hud.showToast("Online Farm could not be exported.");
      return;
    }
    downloadSaveFile(raw, "online");
    hud.showToast("Online Farm exported. Load it with Local Farm's Import.");
  };
  hud.onExportSave = playMode === "local" ? () => {
    saveManager.flushCritical();
    const raw = saveManager.exportLocal();
    if (!raw) {
      hud.showToast("Local Farm could not be exported.");
      return;
    }
    downloadSaveFile(raw, "local");
    hud.showToast("Local Farm backup exported.");
  } : () => { void exportOnlineFarm(); };
  hud.onImportLocal = playMode === "local" ? (raw) => {
    if (!saveManager.importLocal(raw)) return false;
    saveManager.suspend();
    location.reload();
    return true;
  } : null;
  hud.onResetLocal = playMode === "local" ? () => {
    saveManager.suspend();
    saveManager.clear();
    location.reload();
  } : null;
  // Available in both farm modes — the service worker serves the app shell either way.
  hud.onCheckForUpdate = () => checkForUpdate();

  // ---- friends: OFFLINE path (local stub, autosaved via GameState.onChange).
  // Used when no server is configured or the player is signed out. ----
  hud.getFriends = () => state.friends;
  hud.onAddFriend = (name) => state.addFriend(name);
  hud.onRemoveFriend = (id) => { state.removeFriend(id); };
  hud.onGiftBrain = (id) => state.giftBrain(id);

  // ---- friends: ONLINE path (server ground truth via net/api + net/auth).
  // The whole block is inert when no server is configured; every hook falls back
  // to the offline path above. state.friends doubles as the display cache. ----
  const errCode = (e: unknown) => e instanceof api.ApiError ? e.code
    : e instanceof Error && e.message ? e.message : "error";
  const finishEpicBossOnline = async (sessionId: string, finalTick: number, inputs: api.RaidReplayInput[]) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await api.epicBossFinish(sessionId, finalTick, inputs);
      } catch (error) {
        lastError = error;
        // Deterministic validation/client errors will not improve on retry. Network
        // failures and 5xx responses may have committed server-side but lost the
        // response; finish is idempotent, so retrying safely recovers that result and
        // prevents a live session from looking like "another battle" afterward.
        if (error instanceof api.ApiError && error.status > 0 && error.status < 500) throw error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
      }
    }
    throw lastError;
  };
  let inboxCache: { id: string; fromName: string }[] = [];
  let requestsCache: { fromAccountId: string; name: string }[] = [];

  hud.onlineAvailable = () => playMode === "online" && auth.isOnlineAvailable();
  hud.socialOnline = () => onlineFarm && auth.isSignedIn();
  hud.myAccount = () => {
    const s = api.getSession();
    return s ? { name: api.displayName(s), friendCode: s.friendCode } : null;
  };
  hud.refreshAccount(); // now that myAccount is wired, show the real name in the nameplate
  hud.renderAuthButton = (el) => void auth.renderSignInButton(el);
  hud.onSignOut = async () => {
    saveManager.save(); // flush latest to the server first
    try { await economy?.flush(); } catch { /* the durable outbox will retry next sign-in */ }
    saveManager.suspend();
    await auth.signOut();
    location.reload(); // back to the sign-in gate
  };
  hud.onSetUsername = async (name) => {
    try {
      await api.setUsername(name);
      hud.refreshAccount();
      return null;
    } catch (e) {
      return errCode(e);
    }
  };
  hud.getBlackMarketOrders = (query) => api.blackMarketOrders(query);
  hud.onCreateBlackMarketOrder = async (input) => {
    if (!economy) throw new Error("online_gameplay_unavailable");
    const expectedAccountVersion = await economy.prepareExternalMutation();
    const operationId = crypto.randomUUID();
    const result = input.kind === "SELL_ZOMBIE"
      ? await api.createBlackMarketOrder({ ...input, unitId: economy.authoritativeUnitId(input.unitId), operationId, expectedAccountVersion })
      : await api.createBlackMarketOrder({ ...input, operationId, expectedAccountVersion });
    await economy.refreshAuthoritative();
    saveManager.flushCritical();
    return result;
  };
  hud.onCancelBlackMarketOrder = async (orderId) => {
    if (!economy) throw new Error("online_gameplay_unavailable");
    const expectedAccountVersion = await economy.prepareExternalMutation();
    const result = await api.cancelBlackMarketOrder(orderId, crypto.randomUUID(), expectedAccountVersion);
    await economy.refreshAuthoritative();
    saveManager.flushCritical();
    return result;
  };
  hud.onFulfillBlackMarketOrder = async (order, unitId) => {
    if (!economy) throw new Error("online_gameplay_unavailable");
    const expectedAccountVersion = await economy.prepareExternalMutation();
    const operationId = crypto.randomUUID();
    let result: Awaited<ReturnType<typeof api.fulfillBlackMarketOrder>> | undefined;
    // The seller may be completing a command batch at the exact instant the buyer
    // accepts the listing. That lock is transient; retry the same idempotent market
    // operation instead of making an affordable listing look unpurchasable.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await api.fulfillBlackMarketOrder(order.id, operationId, expectedAccountVersion,
          unitId ? economy.authoritativeUnitId(unitId) : undefined);
        break;
      } catch (error) {
        if (!(error instanceof api.ApiError) || error.code !== "counterparty_busy" || attempt === 2) throw error;
        await new Promise<void>((resolve) => window.setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
    if (!result) throw new Error("market_fulfillment_failed");
    await economy.refreshAuthoritative();
    saveManager.flushCritical();
    return result;
  };
  hud.getBlackMarketFulfillments = async () => (await api.blackMarketFulfillments()).fulfillments;
  hud.onCollectBlackMarketOrder = async (orderId, awaitingClaim) => {
    // A card that owes this account a zombie mints it here, so that side needs the
    // same writer preparation as any other external mutation. A pure acknowledgment
    // (the payment-earned card) still does not.
    if (awaitingClaim) await economy?.prepareExternalMutation();
    // The BALANCE has to move on screen either way: a sale's payment is PAID OUT by
    // this call (the market held it until now), and a filled request's was credited
    // at settlement — an event this client never observed. Without adopting a fresh
    // balance neither shows up until the next bootstrap or command batch.
    const result = await api.collectBlackMarketOrder(orderId);
    // Exactly one of these is set, by the post's own currency; the panel already knows
    // which coin the card was priced in, so it only needs the amount.
    const paid = result.brainsPaid ?? result.goldPaid ?? 0;
    // A claimed zombie arrives as a roster row this client has never seen, and a payout
    // bumps the account version server-side (it moves real currency). Both need the
    // authoritative refresh rather than the cheap balance adopt: adopting a balance
    // alone would leave this client's expectedAccountVersion one behind, so its very
    // next command batch would 409 into a conflict rebase.
    if (result.claimed || paid) await economy?.refreshAuthoritative();
    // Remain compatible while the manually deployed Worker rolls forward: an older
    // one omits the balance, so pay for a second round-trip only in that case.
    else if (result.balance) economy?.adoptExternalBalance(result.balance);
    else await economy?.refreshAuthoritative();
    return { claimed: result.claimed ?? null, paid };
  };
  hud.getBlackMarketHistory = () => api.blackMarketHistory();
  hud.refreshFriends = async () => {
    const list = await api.getFriends();
    state.friends = list.map(api.toFriend); // server list becomes the cache
  };
  hud.onAddFriendCode = async (code) => {
    try {
      await api.addFriend(code);
      await hud.refreshFriends?.();
      return null;
    } catch (e) {
      return errCode(e);
    }
  };
  hud.onGiftBrainOnline = async (friendId) => {
    try {
      const result = await api.sendGift(friendId);
      // Remain compatible while the manually deployed Worker rolls forward.
      if (result.balance) economy?.adoptExternalBalance(result.balance, result.accountVersion);
      if (result.lastRaidAt != null) state.syncRaidCooldown(serverTimestampToClient(
        result.lastRaidAt,
        result.serverTime ?? Date.now(),
      ));
      return null;
    } catch (e) {
      return errCode(e);
    }
  };
  // ---- friend requests (consent flow) ----
  hud.refreshRequests = async () => {
    const reqs = await api.getFriendRequests();
    requestsCache = reqs.map((r) => ({ fromAccountId: r.fromAccountId, name: r.name }));
  };
  hud.getRequests = () => requestsCache;
  hud.onAcceptRequest = async (fromAccountId) => {
    try {
      await api.acceptFriend(fromAccountId);
      await hud.refreshFriends?.();
      return null;
    } catch (e) {
      return errCode(e);
    }
  };
  hud.onRejectRequest = async (accountId) => {
    try { await api.rejectFriend(accountId); } catch { /* best-effort */ }
  };
  hud.onRemoveFriend = async (id) => {
    // Online: unfriend server-side then refresh. Offline path handled above.
    if (onlineFarm) await api.removeFriendOnline(id);
    else state.removeFriend(id);
  };
  hud.onBlockFriend = async (accountId) => {
    await api.blockFriend(accountId);
  };
  hud.onRotateCode = async () => {
    try { return await api.rotateFriendCode(); } catch { return null; }
  };
  hud.onListSessions = () => api.listSessions();
  hud.onRevokeSession = async (id) => {
    try { await api.revokeSession(id); return true; } catch { return false; }
  };
  // Visit a friend's farm: stash the target and reload into read-only visit mode
  // (see net/visit.ts + the visit branch at load time above).
  hud.onVisitFriend = (friendId, name) => enterVisit({ id: friendId, name });
  hud.refreshInbox = async () => {
    const gifts = await api.getInbox();
    inboxCache = gifts.map((g) => ({ id: g.id, fromName: g.fromName }));
  };
  hud.getInbox = () => inboxCache;
  hud.onClaimGift = async (id, opts) => {
    try {
      // Gift claims are server-fenced independently of the gameplay writer. Do not
      // let a paused queue or a writer lease held by another tab block acceptance.
      const claimed = economy ? await economy.claimGift(id) : await api.claimGift(id);
      // "Open all" suppresses this and refreshes once at the end: one pull per gift
      // would double the request count of a bulk open for no benefit.
      if (opts?.refreshInbox !== false) {
        try { await hud.refreshInbox?.(); }
        catch (refreshError) { console.warn("[gift] inbox refresh failed", errCode(refreshError)); }
      }
      // The server decides (and reports) the contents. A claim that credited nothing
      // (already opened on another device) has no reward to reveal — say so rather
      // than guessing at a payout the player never received.
      if (!claimed.credited) return null;
      return claimed.reward ?? { kind: "brain" as const, amount: 1 };
    } catch (e) {
      const code = errCode(e);
      console.warn("[gift] claim failed", code);
      const reason: Record<string, string> = {
        operation_in_progress: "your farm is still saving; try again in a moment",
        rate_limited: "too many requests; wait a minute and try again",
        offline: "the game server could not be reached",
        unauthorized: "your session expired; sign in again",
        no_session: "you need to sign in again",
        client_upgrade_required: "reload the page to update the game",
      };
      return `Couldn't claim gift: ${reason[code] ?? code}.`;
    }
  };

  // (Sign-in is handled by the pre-game gate; sign-out reloads via onSignOut.)

  // On boot, if signed in, renew the access token (keeps a long-lived tab fresh
  // against the shorter session TTL) and surface any waiting gifts / friend
  // requests with a gentle toast.
  if (onlineFarm) {
    // Bootstrap already supplied session gameplay/social summaries. Full friend
    // and inbox data remains on-demand when those menus open.
    void hud.refreshInbox?.().then(() => {
      const n = hud.getInbox?.().length ?? 0;
      if (n) hud.showToast(`You have ${n} gift${n === 1 ? "" : "s"} waiting! 🎁`);
    }).catch(() => { /* best-effort toast; offline boot must not surface an error */ });
    void hud.refreshRequests?.().then(() => {
      const n = hud.getRequests?.().length ?? 0;
      if (n) hud.showToast(`You have ${n} friend request${n === 1 ? "" : "s"}! 👋`);
    }).catch(() => { /* best-effort toast; offline boot must not surface an error */ });
    void hud.getBlackMarketFulfillments?.().then((rows) => {
      const n = rows.length;
      if (!n) return;
      // A zombie waiting to be claimed is the more urgent of the two — it is not on the
      // farm yet — so it names the toast whenever the batch contains one.
      const zombies = rows.filter((row) => row.awaitingClaim).length;
      if (zombies) hud.showToast(zombies === 1
        ? "A Black Market zombie is waiting for you! Visit the market to collect. 🧟"
        : `${zombies} Black Market zombies are waiting for you! Visit the market to collect. 🧟`);
      else {
        // Name the money when the market is holding some: this toast used to promise a
        // "collect" that only dismissed a notice, because the payment had already landed.
        // Sales can be priced in either currency, so both are named when both are owed.
        const owed = (["GOLD", "BRAINS"] as const)
          .map((currency) => ({
            currency,
            amount: rows.reduce((total, row) =>
              total + (row.awaitingPayout && row.currency === currency ? row.price : 0), 0),
          }))
          .filter((entry) => entry.amount > 0)
          .map((entry) => entry.currency === "GOLD"
            ? `${entry.amount.toLocaleString()} gold`
            : `${entry.amount.toLocaleString()} brain${entry.amount === 1 ? "" : "s"}`);
        hud.showToast(owed.length
          ? `${owed.join(" and ")} from your Black Market sales are waiting! Visit the market to collect. 💰`
          : n === 1
            ? "One of your Black Market posts was fulfilled! Visit the market to collect. 💰"
            : `${n} of your Black Market posts were fulfilled! Visit the market to collect. 💰`);
      }
    }).catch(() => { /* best-effort toast; a market-disabled server must not surface an error */ });
  }

  // Night lighting toggle (Developer menu). Was the N key; now driven from the HUD.
  hud.getNight = () => isNight;
  hud.onSetNight = (on) => setNight(on);

  // Farm Background picker (Settings): re-seed & rebuild the foliage ring live at
  // the new density — no reload, same spirit as the night toggle.
  hud.getFarmBackground = () => displayedFarmBackground;
  hud.onSetFarmBackground = (bg) => {
    displayedFarmBackground = bg;
    setFarmBackground(bg);
    buildFoliage();
    saveManager.save();
  };

  // Zombie appearance (Settings): both toggles are device-local display choices, so
  // they are persisted to prefs and applied live. The farm's standing zombies are
  // reassembled here; portraits re-render on demand because MutationPortraits keys its
  // cache by the appearance it draws, and raid actors are built fresh on entry.
  hud.getZombieAppearance = () => zombieAppearancePrefs();
  hud.onSetZombieAppearance = (prefs) => {
    setZombieBodyColorMode(prefs.bodyColor);
    setShowZombieMutations(prefs.showMutations);
    zombies.refreshAppearance();
  };

  hud.getRaidBoosts = (raidId) => ({
    concentration: raids.concentrationCount(),
    dice: raids.diceCount(),
    maxDice: raids.maxDiceFor(raidId),
    brainTickets: raids.brainTicketCount(),
  });

  // Live battle scene — the ONLY way a raid is played out (no instant/auto-resolve in
  // the game; `raids.start` remains only for the `ZF.runRaid` dev hook + headless tests).
  // `raidActive` gates farm input synchronously (the scene loads its textures async);
  // `raidScene` is the running scene once ready.
  let raidScene: RaidScene | null = null;
  hud.onLaunchEpicBoss = async (partyIds, payment) => {
    if (raidActive || Date.now() < raidLaunchLockedUntil) return false;
    const def = selectEpicBoss(state.epicBossRun?.bossId);
    const gate = epicBoss.start(state.epicBossRun, partyIds);
    if (!gate.ok) {
      hud.showToast("That Epic Boss event is no longer active.");
      syncEpicBossUi();
      return false;
    }
    const cap = raids.partyView().cap;
    const selectedNames = new Map(zombies.roster().map((z) => [z.id, z.name]));
    let party: ReturnType<typeof zombies.roster> = [];
    let epicSessionId: string | null = null;
    if (onlineFarm) {
      try {
        await economy?.settleBeforeDependency();
        // Settlement may replace an optimistic harvest id, or remove that unit if
        // the server rejected its creation. Rebuild from the reconciled roster so a
        // stale army card can never reach the server as an opaque `bad_roster`.
        const settled = reconcilePartySelection(
          partyIds,
          zombies.roster().filter((z) => !z.stored),
          (id) => economy?.authoritativeUnitId(id) ?? id,
          cap
        );
        if (settled.missingIds.length) {
          const names = settled.missingIds.map((id) => selectedNames.get(id) ?? "A selected zombie");
          hud.showToast(`${names.join(", ")} ${names.length === 1 ? "is" : "are"} no longer available. Your army was refreshed.`);
          hud.refreshEpicBossArmy();
          return false;
        }
        partyIds = settled.ids;
        party = settled.party;
        if (!party.length) return false;
        const opened = await api.epicBossStart(partyIds, payment);
        epicSessionId = opened.sessionId;
        economy?.adoptEpicBossActivation(opened.event, opened.balance, opened.serverTime);
        state.setEpicBossRun(epicBossRunToClient(opened.event, opened.serverTime ?? Date.now()));
      } catch (error) {
        const code = errCode(error);
        if (code === "insufficient_tokens") hud.showToast("You need a Boss Token.");
        else if (code === "insufficient_brains") hud.showToast(`You need ${EPIC_BOSS_FIGHT_BRAIN_COST} brains.`);
        else if (code === "battle_in_progress") hud.showToast("Another battle is already in progress.");
        else if (code === "bad_roster") hud.showToast("One of those zombies is unavailable. Please choose your army again.");
        else hud.showToast("The Epic Boss fight could not be started. Please reconnect and try again.");
        return false;
      }
    } else {
      const settled = reconcilePartySelection(
        partyIds, zombies.roster().filter((z) => !z.stored), (id) => id, cap
      );
      partyIds = settled.ids;
      party = settled.party;
      if (!party.length) return false;
      if (payment === "token") {
        if ((gate.run.tokenCount ?? 0) < 1) { hud.showToast("You need a Boss Token."); return false; }
        state.setEpicBossRun({ ...gate.run, tokenCount: gate.run.tokenCount - 1 });
      } else {
        if (!state.spendBrains(EPIC_BOSS_FIGHT_BRAIN_COST, "epic_boss_fight")) {
          hud.showToast(`You need ${EPIC_BOSS_FIGHT_BRAIN_COST} brains.`);
          return false;
        }
        state.setEpicBossRun(gate.run);
      }
    }
    const paidRun = state.epicBossRun ?? gate.run;
    const setup = buildEpicBossSetup(def, paidRun, party, assets, state);
    pauseFarmJobs();
    raidActive = true;
    world.visible = false;
    hud.setRaiding(true);
    audio.enterRaid(setup.raid.music);
    RaidScene.create(app, {
      raid: setup.raid,
      assets,
      playerUnits: setup.playerUnits,
      enemyUnits: setup.enemyUnits,
      bossThrow: null,
      roundMs: def.fightMs,
      escapeOnRoundEnd: true,
      noDistractions: true,
      imageBase: epicAsset(def, ""),
      bossTexture: epicAsset(def, def.bossTexture),
      bossPortrait: epicAsset(def, def.portrait),
      bossAnimations: def.animations,
      bossFallsFromSky: true,
      bossEngageDistance: 150,
      // Loco Locust sits low inside his generously padded animation cells. Lift his
      // whole token slightly so the visible character shares the other bosses' line.
      bossGroundOffset: { x: 32, y: def.id === "loco-locust" ? 8 : 24 },
      onStrike: (strike) => audio.fightStrike(strike),
      onBrainRelease: (sourceKey) => audio.brainForZombie(sourceKey),
      confirmRetreat: () => hud.confirmInGame(
        "Retreat from battle?", `This attempt will end and ${def.name} will escape.`, "Retreat"
      ),
      onFinish: (outcome, finalTick, inputs) => {
        const presentResult = (result: ReturnType<EpicBossManager["finish"]>, drops: LootDrop[]) => {
        state.setEpicBossRun(result.run);
        const currency = result.defeatedLevel === null
          ? { brains: 0, gold: 0 }
          : epicBossCurrencyReward(result.defeatedLevel, def.maxLevel);
        if (result.defeatedLevel !== null && !onlineFarm) {
          state.addBrains(currency.brains, "epic_boss_victory");
          state.addGold(currency.gold, "epic_boss_victory");
          questBus.post(QuestEvent.EpicStageEnemyDefeated, String(result.defeatedLevel), 1);
          // Collected spans every place a prize can end up — unclaimed, in the shed, or
          // already standing on the farm — plus tamed pets. Received alone would treat a
          // claimed prize as never-won and keep re-offering it ahead of unseen ones.
          const collected = new Set([
            ...state.received,
            ...state.storedItems.filter((item) => item.count > 0).map((item) => item.key),
            ...def.loot.filter((loot) => loot.tile && field.placedCount(loot.tile) > 0).map((loot) => loot.name),
            ...state.ownedPets.map((key) =>
              def.loot.find((loot) => loot.stageActor === key)?.name ?? key),
          ]);
          const loot = rollEpicBossLoot(def, result.defeatedLevel, collected);
          if (loot) {
            if (loot.stageActor) state.unlockPet(loot.stageActor);
            else state.receiveItem(loot.name);
            questBus.post(QuestEvent.EpicBossEpicItemWon, loot.name, 1);
            drops.push({ name: loot.name, icon: epicAsset(def, def.lootIcon) });
          }
        }
        saveManager.flush();
        syncEpicBossUi();
        const view: RaidResultView = {
          win: result.defeatedLevel !== null,
          title: result.completed ? "EPIC BOSS DEFEATED" : result.defeatedLevel !== null ? "LEVEL CLEARED" : "BOSS ESCAPED",
          enemiesBeaten: result.defeatedLevel !== null ? 1 : 0,
          zombiesLost: outcome.losses.length,
          gold: currency.gold, brains: currency.brains, xp: 0, loot: drops, abilityUnlock: "",
        };
        hud.openRaidResult(view, () => {
          if (raidScene) { app.stage.removeChild(raidScene.container); raidScene.destroy(); raidScene = null; }
          raidActive = false;
          resumeFarmJobs();
          world.visible = true;
          hud.setRaiding(false);
          audio.exitRaid();
          flushQuestCompletions(); // celebrate on the farm, not over the result panel
        });
        };
        if (onlineFarm && epicSessionId) {
          void finishEpicBossOnline(epicSessionId, finalTick, inputs).then((server) => {
            zombies.recordInvasion(server.survivors);
            zombies.removeCasualties(server.losses);
            const rewardDrops: LootDrop[] = [];
            for (const unit of server.newZombies) {
              if (!unit.received) zombies.grantReward(unit.key, walk.tile.col, walk.tile.row, unit.id, unit.stored);
              rewardDrops.push(rewardZombieDrop(unit));
              hud.showToast(`${zombieDefs.get(unit.key)?.name ?? "Epic reward zombie"} joined your ${unit.received ? "Received storage" : unit.stored ? "Mausoleum" : "farm"}!`);
            }
            economy?.adoptEpicBossResult(server);
            void economy?.refreshAuthoritative().catch(() => { /* reconcile again on next settle */ });
            state.setEpicBossRun(server.event);
            const result = {
              run: server.event,
              defeatedLevel: server.defeatedLevel,
              completed: !!server.event.completedAt,
              escaped: server.escaped,
            };
            presentResult(result, [
              ...(server.loot ? [{ name: server.loot.name, icon: epicAsset(def, def.lootIcon) }] : []),
              ...rewardDrops,
            ]);
          }).catch(() => {
            hud.showToast("The fight result could not be verified. Reconnecting will recover it.");
            if (raidScene) { app.stage.removeChild(raidScene.container); raidScene.destroy(); raidScene = null; }
            raidActive = false; resumeFarmJobs(); world.visible = true; hud.setRaiding(false); audio.exitRaid();
            flushQuestCompletions();
          });
          return;
        }
        zombies.recordInvasion(outcome.survivors);
        zombies.removeCasualties(outcome.losses);
        const result = epicBoss.finish(paidRun, outcome.playerDamage, outcome.win);
        presentResult(result, []);
      },
    }).then((scene) => {
      if (!raidActive) return scene.destroy();
      raidScene = scene;
      app.stage.addChild(scene.container);
      // Debug handle — dev builds only, mirroring the online launch path below.
      if (import.meta.env.DEV) {
        (window as unknown as { ZF?: Record<string, unknown> }).ZF!.raidScene = scene;
      }
    });
    return true;
  };
  // Server-owned raid cooldown: the session id from /raid/start, carried to
  // /raid/finish so the server starts the cooldown once the raid is done.
  let raidSessionId: string | null = null;
  // The live session's TTL, in this browser's clock domain, plus the last state the
  // player was told about so the ticker check below speaks only on a transition. The
  // server zeroes anything settled past this instant, and the fight cannot notice on
  // its own: it runs on the ticker, which stops dead while the page is hidden.
  let raidExpiresAt: number | null = null;
  let raidExpiryAnnounced: InvasionExpiryState = "ok";
  const clearRaidExpiry = () => { raidExpiresAt = null; raidExpiryAnnounced = "ok"; };
  hud.onLaunchRaid = async (raidId, partyIds, opts) => {
    if (raidActive || Date.now() < raidLaunchLockedUntil) return false;
    raidSessionId = null;
    clearRaidExpiry();
    economy?.setLiveRaid(null);
    // ONLINE: the server owns the between-raids cooldown. Ask it to authorize the
    // launch; if it's still on cooldown (and no voucher bypass), decline so the army
    // screen stays up. On success beginRaid runs with serverAuthorized so it doesn't
    // re-gate the (now server-owned) cooldown.
    if (onlineFarm) {
      try {
        const selectedNames = new Map(zombies.roster().map((z) => [z.id, z.name]));
        await economy?.settleBeforeDependency();
        const settled = reconcilePartySelection(
          partyIds,
          zombies.roster().filter((z) => !z.stored),
          (id) => economy?.authoritativeUnitId(id) ?? id,
          raids.partyView().cap
        );
        if (settled.missingIds.length) {
          const names = settled.missingIds.map((id) => selectedNames.get(id) ?? "A selected zombie");
          hud.showToast(`${names.join(", ")} ${names.length === 1 ? "is" : "are"} no longer available. Please choose your army again.`);
          return false;
        }
        partyIds = settled.ids;
        // Golden Dice are consumed SERVER-side here (the loot roll's luck is pinned to
        // the session), so send how many the player asked for and adopt what it charged.
        const gate = await api.raidStart(
          !!opts.useVoucher,
          raidId,
          partyIds,
          !!opts.concentration,
          Math.max(0, Math.floor(opts.dice ?? 0)),
          !!opts.brainTicket
        );
        if (!gate.ok) {
          // Distinguish the server's refusals: the client already hides locked raids and
          // blocks a second launch, so `locked` / `raid_in_progress` mean the client and
          // server disagree — say so plainly rather than blaming the cooldown.
          if (gate.error === "locked") {
            hud.showToast(`That invasion unlocks at level ${gate.unlockLevel ?? "?"}.`);
          } else if (gate.error === "raid_in_progress") {
            hud.showToast("Another invasion is already in progress.");
          } else if (gate.error === "no_voucher") {
            hud.showToast("No Invasion Voucher to skip the cooldown.");
          } else if (gate.error === "no_brain_ticket") {
            hud.showToast("No Brain Ticket for an elite invasion.");
          } else {
            const mins = Math.ceil((gate.cooldownRemaining ?? 0) / 60000);
            hud.showToast(`Invasion on cooldown — about ${mins} min left.`);
          }
          return false;
        }
        raidSessionId = gate.sessionId ?? null;
        // Fence the live session against the abandoned-raid recovery: from here until
        // its finish is submitted, no bootstrap may retreat it out from under the
        // player (see EconomyClient.recoverResumableRaid).
        economy?.setLiveRaid(raidSessionId);
        // Adopt the session's deadline. /raid/start has always returned it and the
        // client has always ignored it, which is why a fight frozen in a background
        // tab could sail past the TTL and settle for nothing with no warning at all.
        raidExpiresAt = gate.expiresAt == null
          ? null
          : serverTimestampToClient(gate.expiresAt, gate.serverTime ?? Date.now());
        raidExpiryAnnounced = "ok";
        raidLaunchLockedUntil = Math.max(
          raidLaunchLockedUntil,
          gate.earliestFinishAt == null
            ? Date.now() + 15_000
            : serverTimestampToClient(gate.earliestFinishAt, gate.serverTime ?? Date.now())
        );
        if (gate.inventory) economy?.adoptRaidStartInventory(gate.inventory);
        if (gate.lastRaidAt != null) state.syncRaidCooldown(serverTimestampToClient(
          gate.lastRaidAt,
          gate.serverTime ?? Date.now(),
        ));
        opts = {
          ...opts,
          serverAuthorized: true,
          bypassed: !!gate.bypassed,
          serverDice: gate.dice ?? 0,
          serverBrainDrop: gate.brainDrop ?? 0,
          serverElite: !!gate.elite,
          // The server pinned its wave from this same id, so a raid with per-fight
          // randomness (the Robots' random boss) resolves identically on both sides.
          waveSeed: raidSessionId ?? undefined,
        };
      } catch (error) {
        if (error instanceof api.ApiError) {
          const body = (error.body ?? {}) as { cooldownRemaining?: number; unlockLevel?: number };
          if (error.code === "cooldown") {
            hud.showToast(`Invasion on cooldown — about ${Math.ceil((body.cooldownRemaining ?? 0) / 60000)} min left.`);
          } else if (error.code === "locked") hud.showToast(`That invasion unlocks at level ${body.unlockLevel ?? "?"}.`);
          else if (error.code === "raid_in_progress") hud.showToast("Another invasion is already in progress.");
          else if (error.code === "no_voucher") hud.showToast("No Invasion Voucher to skip the cooldown.");
          else if (error.code === "no_brain_ticket") hud.showToast("No Brain Ticket for an elite invasion.");
          else if (error.code === "stale_ruleset") {
            // This tab predates the deployed Worker, so the server refuses to pin a fight
            // it and the client would simulate differently. Nothing is consumed and no
            // cooldown starts — but without this branch the player just sees "could not
            // start that invasion" and has no way to know a reload fixes it.
            hud.showToast("The game has updated. Reload to keep raiding.", 6000);
            promptReload("The game has updated. Reload to keep raiding.");
          }
          else hud.showToast("The server could not start that invasion.");
        } else hud.showToast("Gameplay is paused until the server reconnects.");
        return false;
      }
    }
    const setup = raids.beginRaid(raidId, partyIds, opts);
    // Offline play has no server timestamp, but uses the same gentle relaunch delay.
    if (setup && !onlineFarm) raidLaunchLockedUntil = Date.now() + 15_000;
    if (!setup) {
      // The server already opened a session but no battle will run, so drop the fence:
      // this one really IS abandoned and recovery should be free to close it.
      economy?.setLiveRaid(null);
      return false; // gated (cooldown/army) — the army screen stays up
    }
    // First Brain Ticket ever spent. Buying one advertises brains; nothing about it
    // says the invasion it starts is several rungs harder than the one on the card, and
    // by the time the player finds out their army is already on the field and its
    // casualties are permanent. Tim says it plainly, once — `setup.elite` rather than
    // the request, so this only fires when a ticket was really charged.
    if (setup.elite && !hasSeenEliteTip()) {
      markEliteTipSeen();
      await hud.timSays(
        "Whoa there — that's a BRAIN TICKET. It'll pay out four times the brains,\n" +
        "sure, but it turns the invasion ELITE. They hit a whole lot harder than\n" +
        "anything you've faced here. Bring your best, and don't say I didn't warn you!"
      );
    }
    // First invasion that actually fields a hazard: hazards are the one part of a
    // fight the player has to handle by hand, and nothing on screen says so. Ask the
    // resolved setup rather than the raid's data flags — raids 2/10/11 declare a grab
    // or an obstacle they have no implementation for, and the wall is per-STAGE, so
    // only this tells us a hazard will really show up.
    if (!hasSeenHazardTip() && (setup.grabber || setup.crab || setup.wallTemplate)) {
      markHazardTipSeen();
      const verb = isTouch() ? "Tap" : "Click";
      await hud.timSays(
        "Careful now — this invasion's got HAZARDS. They'll grab your zombies\n" +
        `right off the field, or block the way forward.\n${verb} one to damage it — ` +
        "keep at it and it'll go away!"
      );
    }
    // Some invasions run on a rule nothing on the battlefield states — the Pirates'
    // Scallywag mirrors whatever attack speed you bring it. Tim gives that warning
    // once, before the first attempt, instead of the game only admitting it in the
    // defeat text after the fight has already been paid for.
    const tip = raidTip(raidId);
    if (tip && !hasSeenRaidTip(raidId)) {
      markRaidTipSeen(raidId);
      await hud.timSays(tip);
    }
    pauseFarmJobs();
    raidActive = true;
    world.visible = false;
    hud.setRaiding(true); // battle scene takes over the screen
    audio.enterRaid(setup.raid.music); // swap farm bed for this stage's battle BGM
    RaidScene.create(app, {
      raid: setup.raid,
      assets,
      playerUnits: setup.playerUnits,
      enemyUnits: setup.enemyUnits,
      bossThrow: setup.bossThrow,
      bossSpecials: setup.bossSpecials,
      grabber: setup.grabber,
      crab: setup.crab,
      summonTemplate: setup.summonTemplate,
      wallTemplate: setup.wallTemplate,
      brainDrop: setup.brainDrop,
      concentration: setup.concentration,
      onStrike: (strike) => audio.fightStrike(strike),
      onBrainRelease: (sourceKey) => audio.brainForZombie(sourceKey),
      onVictory: () => audio.playRaidVictory(),
      confirmRetreat: () => hud.confirmInGame(
        "Retreat from invasion?", "This invasion will count as a loss.", "Retreat"
      ),
      onCheckpoint: undefined,
      onFinish: (outcome, finalTick, inputs) => {
        // The fight is over, so the TTL has nothing left to warn about: whatever the
        // settlement below returns is now the story, told by invasionSettlementNotice.
        clearRaidExpiry();
        // ONLINE: the server prices the base win gold + first-clear XP AND rolls the
        // loot. finishRaid() credits none of it locally — it hands the reward back as
        // `serverReward`, which we submit through the balance client (POST /raid/finish).
        // That call also starts the server-owned cooldown and returns the authoritative
        // balance + lastRaidAt + the rolled drop, which the client reconciles.
        const online = onlineFarm && !!raidSessionId && !!economy;
        const view = raids.finishRaid(
          setup.raid, setup.party, outcome, setup.dice, online,
          setup.brainDrop, setup.brainEligible, setup.elite
        );
        const casualtyParty = setup.party.filter((zombie) => outcome.losses.includes(zombie.id));
        let settlementPromise: Promise<api.RaidFinishResult> | null = null;
        if (online) {
          const sid = raidSessionId!;
          raidSessionId = null;
          const sr = view.serverReward;
          // The server's drop arrives after the result panel has opened, so patch it in
          // when it lands (the panel shows an empty Loot row until then).
          economy!.onRaidSettled = (res) => {
            economy!.onRaidSettled = null;
            // A session can be settled by something OTHER than the fight just played:
            // a boot-time abandon from another device that took the writer, or a raid
            // that outlived its 15-minute server TTL. /raid/finish then answers 200
            // with the ALREADY-STORED result, and patching those zeros in silently is
            // what let a won invasion read "0 gold, 0 brains, no loot" with nothing to
            // report. Say what happened instead of quietly overwriting the victory.
            // Pass the WHOLE result: the TTL branch is recognisable only by `expired`,
            // since its stored body carries no outcome for a rule to compare against.
            const settlement = invasionSettlementNotice(outcome, res);
            if (settlement) {
              hud.setRaidResultNotice(settlement.notice);
              hud.showToast(settlement.toast, 8000);
            }
            if (res.outcome) zombies.applyServerRaidOutcome(res.outcome.survivors, res.outcome.losses);
            // Online the tutorial's invade beat no longer rides the local quest event,
            // so advance it from the verified outcome as soon as it lands (closing the
            // result panel is the other, later, chance).
            tutorial?.onRaidResolved();
            const drops: LootDrop[] = res.loot
              ? [{ name: res.loot.name, icon: raids.lootIconFor(res.loot.name), qty: res.loot.qty ?? 1 }]
              : [];
            if (res.newZombie) {
              if (!res.newZombie.received) {
                zombies.grantReward(
                  res.newZombie.key,
                  walk.tile.col,
                  walk.tile.row,
                  res.newZombie.id,
                  res.newZombie.stored
                );
              }
              drops.push(rewardZombieDrop(res.newZombie));
              hud.showToast(
                `${zombieDefs.get(res.newZombie.key)?.name ?? "Rare zombie"} joined your ${res.newZombie.received ? "Received storage" : res.newZombie.stored ? "Mausoleum" : "farm"}!`
              );
            }
            hud.setRaidResultLoot(drops, res.gold);
            hud.setRaidResultBrains(res.brains ?? 0);
          };
          // Submit win OR loss: a loss still finishes the session to start the cooldown.
          settlementPromise = economy!.submitRaid(sid, finalTick, inputs, outcome, {
            gold: sr?.gold ?? 0,
            xp: sr?.xp ?? 0,
          });
          // submitRaid persists this transcript before its first await, so recovery now
          // resends the REAL fight rather than needing the fence.
          economy!.setLiveRaid(null);
          // Always observe settlement, even when there were no casualties or the
          // player has not closed the result panel yet. If every idempotent retry
          // fails, a bootstrap still recovers any commit whose response was lost.
          void settlementPromise.catch(async (error) => {
            economy!.onRaidSettled = null;
            const code = error instanceof api.ApiError ? error.code : "unknown_error";
            const verificationMessage = code === "truncated_transcript"
              ? "The invasion result could not be verified. No rewards were granted, and the normal invasion cooldown still applies."
              : code === "stale_ruleset"
                ? "The game was updated during this invasion. Its result could not be settled, and the normal invasion cooldown still applies."
                : null;
            try {
              await economy!.refreshAuthoritative();
              hud.showToast(verificationMessage ?? `Invasion settlement failed (${code}). Your farm was resynced.`, 6000);
            } catch {
              hud.showToast(
                verificationMessage
                  ? `${verificationMessage} Reconnecting will resync your farm.`
                  : `Invasion settlement failed (${code}). Reconnecting will resync your farm.`,
                6000
              );
            }
          });
        } else if (onlineFarm && raidSessionId) {
          // Signed in but no balance client (shouldn't happen): report finish for the
          // cooldown only; rewards were credited locally by finishRaid above.
          const sid = raidSessionId;
          raidSessionId = null;
          void api
            .raidFinish(sid, finalTick, inputs, outcome)
            .then((r) => {
              // An expired settlement starts no cooldown and sends no stamp to adopt.
              if (r.lastRaidAt == null) return;
              state.syncRaidCooldown(serverTimestampToClient(
                r.lastRaidAt,
                r.serverTime ?? Date.now(),
              ));
            })
            .catch(() => {});
        }
        hud.openRaidResult(view, () => {
          if (raidScene) {
            app.stage.removeChild(raidScene.container);
            raidScene.destroy();
            raidScene = null;
          }
          raidActive = false;
          resumeFarmJobs();
          world.visible = true;
          hud.setRaiding(false);
          audio.exitRaid(); // battle over — hand the farm bed back
          // OFFLINE, advance raid quests only now that we're back on the farm. Online
          // the server already counted this win and its questChanges have been applied,
          // so posting again would count it twice (see src/raid/questEvents.ts).
          // `elite` and the fight's technique record ride along from the setup and the
          // sim outcome rather than through RaidResultView — the result PANEL has no use
          // for either, and widening its view type to carry quest plumbing would be the
          // wrong seam.
          postRaidWinQuests(
            questBus,
            { ...view, elite: setup.elite, feats: outcome.feats },
            setup.raid.name,
            onlineFarm
          );
          tutorial?.onRaidResolved(); // finish post-win if the quest event did not
          // Any quest that completed during the battle celebrates now, on the farm.
          flushQuestCompletions();

          if (!casualtyParty.length) return;
          const revivalViews = casualtyParty.map((zombie) => ({
            id: zombie.id,
            key: zombie.key,
            name: zombie.name,
            typeName: zombie.typeName,
            portrait: zombiePortrait(zombie.key),
            mutation: zombie.mutation,
            color: zombie.color,
          }));
          if (settlementPromise && economy) {
            // The battle is gone and the farm is visible before this event opens.
            // Settlement captured each casualty server-side, so resolving the offer
            // remains safe even if the finish response arrived after the player tapped.
            void settlementPromise.then((settled) => {
              // Both come from a settlement that actually replayed the fight: an
              // expired one offers no revival and reports no balance to spend from.
              if (!settled.revival || !settled.balance) return;
              hud.openZombieRevival(revivalViews, settled.balance.brains, async (reviveIds) => {
                const revived = await economy!.resolveRaidRevival(settled.revival!.sessionId, reviveIds);
                const accepted = new Set(revived.revivedIds);
                zombies.reviveCasualties(casualtyParty.filter((zombie) => accepted.has(zombie.id)));
                saveManager.save();
                return true;
              });
            }).catch(() => { /* the settlement observer above already recovered/reported */ });
          } else if (!onlineFarm) {
            hud.openZombieRevival(revivalViews, state.brains, (reviveIds) => {
              if (!state.spendBrains(reviveIds.length, "zombie_revive")) return false;
              const accepted = new Set(reviveIds);
              zombies.reviveCasualties(casualtyParty.filter((zombie) => accepted.has(zombie.id)));
              saveManager.save();
              return true;
            });
          }
        });
      },
    }).then((scene) => {
      if (!raidActive) return scene.destroy(); // finished/aborted before load done
      raidScene = scene;
      app.stage.addChild(scene.container);
      // Debug handle — dev builds only (window.ZF doesn't exist in prod). Guarded
      // so the missing global can't throw in production.
      if (import.meta.env.DEV) {
        (window as unknown as { ZF?: Record<string, unknown> }).ZF!.raidScene = scene;
      }
    });
    return true;
  };

  // ---- item storage: retrieve a stored decoration back to a free placement ----
  // `retrieving` holds the stored item key being re-placed; while set, the next
  // valid placement consumes it (free) and exits placement mode.
  let retrieving: { key: string; instanceId: string } | null = null;
  hud.onRetrieveItem = async (key) => {
    if (onlineGameplayBlocked()) return;
    const def = placeCatalog.get(key);
    if (!def) return;
    // Resolve the copy being taken out BEFORE entering placement: a shed slot with
    // no identity behind it would otherwise flick placement mode on and straight
    // back off, which reads as the panel closing and nothing happening.
    const instanceId = storedInstanceId(key);
    if (!instanceId) {
      hud.showToast("That item is no longer in your shed.");
      return;
    }
    await ensureObjectTextures(assets, def);
    hud.setPlacing(def); // enter placement mode (fires onModeChange first)
    retrieving = { key, instanceId }; // ...then arm retrieval so onModeChange doesn't clear it
  };

  // ---- Received rewards: resolve the raw key list into displayable cards ----
  // Entries are heterogeneous strings: boost names, a brains-currency drop, and
  // decorations. A decoration resolves to a placeable by display name, or (when
  // the placeable's name differs from the reward's) via the drop's `tile` key —
  // so nearly every loot/reward decor can now be placed. Anything that still
  // resolves to no placeable (e.g. the Rusty Fragment key-piece) is a trophy.
  const receivedDef = (entry: string): PlaceableDef | undefined =>
    placeByName.get(entry) ?? placeCatalog.get(assets.drops[entry]?.tile ?? "");
  const receivedViews = (): ReceivedView[] =>
    state.received.map((entry, index): ReceivedView => {
      const zombie = parseReceivedZombie(entry);
      if (zombie) {
        const def = zombieDefs.get(zombie.key);
        return {
          index, name: def?.name ?? "Zombie reward", icon: zombiePortrait(zombie.key),
          kind: "zombie",
          // Names the destination the claim will actually pick (see onClaimReceived).
          actionLabel: zombies.canAdd() ? "Deploy to farm" : "Store in Mausoleum",
        };
      }
      const boost = assets.boosts.find((b) => b.name === entry);
      if (boost)
        return { index, name: entry, icon: `${BASE}assets/boosts/${boost.icon}`, kind: "boost", actionLabel: "Claim" };
      const drop = assets.drops[entry];
      if (drop?.brains)
        return { index, name: entry, icon: BASE + "assets/ui/topbar_brain_icon.png", kind: "brains", actionLabel: "Claim" };
      const pdef = receivedDef(entry);
      const dropArt = raidRewardImage(assets, entry);
      if (pdef)
        return {
          index, name: entry, icon: dropArt || `${BASE}assets/objects/${pdef.sprite}`,
          // Only the catalog sprite carries the def's tint; a loot atlas image is
          // already coloured and must not be multiplied again.
          tint: dropArt ? undefined : objectTint(pdef.color),
          kind: "placeable", actionLabel: "Place", sellable: pdef.category !== "functional",
        };
      return { index, name: entry, icon: dropArt, kind: "trophy", actionLabel: "" };
    });
  hud.getReceived = receivedViews;

  // Claim a boost/currency reward: apply its effect, then remove it from Received.
  hud.onClaimReceived = (index) => {
    if (onlineGameplayBlocked()) return;
    const entry = state.received[index];
    if (entry == null) return;
    const zombie = parseReceivedZombie(entry);
    if (zombie) {
      // Deploy onto the farm whenever the army has room, and fall back to the
      // Mausoleum only when it does not — mirrors the Worker's storage.claim, so both
      // sides agree on where the unit lands (client zombieMax already carries the
      // placed army bonus online). A full crypt must not strand an earned reward
      // while there is a free army slot standing empty.
      const deploy = zombies.canAdd();
      if (!deploy && !field.mausoleumId()) { hud.showToast("Place a Mausoleum before claiming this zombie."); return; }
      if (!deploy && zombies.mausoleumFull) { hud.showToast("Make room in the Mausoleum first."); return; }
      if (economy && !economy.submitStorageClaim(entry, {})) return;
      // The Almanac counted this species when the reward was EARNED; claiming only
      // moves it, so counting again here would inflate the lifetime tally.
      zombies.grantReward(zombie.key, walk.tile.col, walk.tile.row, zombie.id, !deploy,
        { recordDiscovery: false });
      state.takeReceivedAt(index);
      saveManager.flushCritical();
      return;
    }
    const boost = assets.boosts.find((b) => b.name === entry);
    if (boost) {
      // ONLINE: atomically consume Received into the server-owned boost inventory.
      // OFFLINE: the local save owns both buckets.
      if (economy) {
        if (!economy.submitStorageClaim(entry, { inventoryKey: boost.key })) return;
      } else state.addBoost(boost.key);
      state.takeReceivedAt(index);
      return;
    }
    const drop = assets.drops[entry];
    if (drop?.brains) {
      const amt = parseInt(entry, 10);
      if (economy) {
        // The v3 server deliberately refuses legacy premium-currency entries.
        if (!economy.submitStorageClaim(entry, {})) return;
      } else if (amt > 0) state.addBrains(amt);
      state.takeReceivedAt(index);
    }
  };

  // Place a decoration reward: enter placement mode; the placement below consumes
  // it from Received once dropped on a valid tile. Mirrors the storage-retrieve arm.
  let receiving: number | null = null;
  hud.onPlaceReceived = async (index) => {
    if (onlineGameplayBlocked()) return;
    const entry = state.received[index];
    const def = entry ? receivedDef(entry) : undefined;
    if (!def) return;
    await ensureObjectTextures(assets, def);
    hud.setPlacing(def);
    receiving = index; // arm after setPlacing so onModeChange doesn't clear it
  };

  // The object currently being relocated by the Move tool (null = none). `flipped`
  // tracks its orientation so rotating mid-carry survives the drop.
  let carrying: { id: string; def: PlaceableDef; flipped: boolean } | null = null;
  // The farm plot currently in hand (Move tool). Objects and plots are both carried
  // one at a time and never together, so picking one up always drops the other.
  let carryingPlot: { oc: number; or: number } | null = null;
  const cancelCarry = () => {
    carrying = null;
    carryingPlot = null;
    field.hideObjectCursor();
    field.hideCursor();
  };

  // Orientation for the placement ghost (Rotate tool flips it on the vertical axis),
  // remembered across taps so a whole fence run can be laid facing the same way.
  let placeFlipped = false;

  // The Rotate tool is context-sensitive: while placing it spins the ghost, while
  // carrying (Move) it spins the carried object, and otherwise it toggles a
  // standalone rotate mode (tap any placed object to flip it). This keeps a single
  // button meaning "rotate whatever I'm working with" in every situation.
  const rotateCurrent = () => {
    if (hud.mode === "place" && hud.placing) {
      placeFlipped = !placeFlipped;
      field.setGhostFlip(placeFlipped);
    } else if (hud.mode === "move" && carrying) {
      carrying.flipped = !carrying.flipped;
      field.setGhostFlip(carrying.flipped);
    } else {
      hud.setMode("rotate");
    }
  };
  hud.onRotateTool = rotateCurrent;

  // Place the selected object at the pointer tile if the footprint is valid,
  // unlocked, and affordable. Stays in placement mode to place several — except
  // for an item whose last allowed copy this was (see the exit below).
  const tryPlaceObject = (col: number, row: number) => {
    const def = hud.placing;
    if (!def) return;
    if (!retrieving && receiving === null && hud.objectLimitReached?.(def)) return;
    if (def.zombiePot && field.zombiePotCount() >= MAX_ZOMBIE_POTS) {
      hud.showToast(`You can place at most ${MAX_ZOMBIE_POTS} Zombie Pots.`);
      return;
    }
    if (noRoomForAnother(def, field)) return;
    const { oc, or } = field.resolveObjectOrigin(def, col, row);
    if (!field.canPlaceObject(oc, or, def)) return;
    // Retrieving a stored item: already owned, so it's free and places just one.
    if (retrieving) {
      const selected = retrieving;
      if (!takeStoredObject(state, storedObjectIds, selected)) {
        retrieving = null;
        hud.setPlacing(null);
        return;
      }
      field.placeObject(def, oc, or, selected.instanceId, undefined, placeFlipped);
      audio.play("place");
      if (def.armyMax) state.addZombieMax(def.armyMax); // re-apply functional effect
      economy?.submitObjectStatus(selected.instanceId, "placed");
      retrieving = null;
      hud.setPlacing(null); // one at a time
      return;
    }
    // Placing a Received reward: also free, consumed from the Received bucket.
    if (receiving !== null) {
      const receivedIndex = receiving;
      const itemName = state.received[receivedIndex];
      const placedId = field.placeObject(def, oc, or, undefined, undefined, placeFlipped);
      if (!placedId || !itemName) return;
      if (economy && !economy.submitStorageClaim(itemName, { localObjectId: placedId })) {
        field.removeObject(placedId);
        return;
      }
      audio.play("place");
      if (def.armyMax) state.addZombieMax(def.armyMax);
      state.takeReceivedAt(receivedIndex);
      receiving = null;
      hud.setPlacing(null); // one at a time
      return;
    }
    if (state.level < def.level) return;
    // The Zombie Pot costs 500 GOLD for the first, then a flat 3 BRAINS for every
    // one after — permanently, even if the player sells it (see zombiePotBought).
    const potBought = !!def.zombiePot && state.zombiePotBought;
    const cost = def.zombiePot ? (potBought ? 3 : 500) : def.cost;
    const useBrains = def.zombiePot ? potBought : def.brainsNeeded;
    const xp = buyXp(cost, def.xp, useBrains, def.category);
    // Server-owned object buy: the server debits the exact price, records ownership,
    // and persists the dynamic first/subsequent Zombie Pot pricing flag.
    const serverObject = !!economy && cost > 0;
    if (serverObject) {
      const have = useBrains ? state.brains : state.gold;
      if (have < cost) return; // optimistic affordability; server re-checks
    } else {
      const paid = useBrains ? state.spendBrains(cost) : state.spendGold(cost);
      if (!paid) return;
      state.addXp(xp);
    }
    if (def.zombiePot) state.markZombiePotBought(); // next pot is 3 brains forever
    const placedId = field.placeObject(def, oc, or, undefined, undefined, placeFlipped);
    if (def.zombiePot && placedId) {
      objectPurchases.set(placedId, { cost, currency: useBrains ? "brains" : "gold" });
    }
    if (serverObject && placedId) {
      economy!.submitObject(
        { type: "buy", key: def.key, instanceId: placedId },
        useBrains ? { brains: -cost, xp } : { gold: -cost, xp }
      );
      // Persist its layout immediately and promptly settle ownership so a reload
      // cannot strand a newly placed functional object between the two projections.
      saveManager.flushCritical();
      void economy!.settleBeforeDependency().then(() => saveManager.flushCritical()).catch(() => {});
    }
    audio.play("place");
    if (def.armyMax) state.addZombieMax(def.armyMax); // functional effect
    if (def.storageSlots) state.upgradeStorage(def.storageSlots); // shed capacity
    const c = tileCenter(col, row);
    floatText(c.x, c.y, `-${cost}${useBrains ? "b" : "g"}`);
    showPurchaseXp(xp, c);
    questBus.post(QuestEvent.ItemBought, def.name, 1, objectAliases.get(def.key) ?? []);
    // That may have been the last copy the player is allowed: a Blue Grave, a
    // monolith, the third Zombie Pot. Leave placement mode rather than trail a
    // ghost of something no further tap could ever put down.
    if (hud.objectLimitReached?.(def) || noRoomForAnother(def, field)) hud.setPlacing(null);
  };

  // Move tool: first tap lifts the object under the pointer; next valid tap drops
  // it. Invalid drop keeps it carried; right-click / tool-switch cancels.
  const handleMoveTap = (col: number, row: number, wx: number, wy: number) => {
    if (carrying) {
      const { oc, or } = field.resolveObjectOrigin(carrying.def, col, row);
      if (field.moveObject(carrying.id, oc, or, carrying.flipped)) cancelCarry();
      return;
    }
    if (carryingPlot) {
      const from = carryingPlot;
      const { oc, or } = field.plotOriginFor(col, row);
      if (!field.movePlot(from.oc, from.or, oc, or)) return; // blocked: keep holding it
      // The farmer may be walking to the tile this plot just left.
      jobs.cancelAtTile(from.oc, from.or);
      // Layout is client-owned, but WHICH plot exists where is not: without this the
      // next reconcile would put the plot back where the server still thinks it is.
      if (state.onFarm) state.onFarm({ type: "move", oc: from.oc, or: from.or, toOc: oc, toOr: or }, {});
      audio.play("place");
      saveManager.save();
      cancelCarry();
      return;
    }
    // Nothing in hand: pick up whatever is under the tap. An object wins over the
    // plot beneath it, matching every other tool's hit order.
    const id = field.objectAtPoint(wx, wy);
    const def = id ? field.objectDefOf(id) : null;
    if (id && def) {
      carrying = { id, def, flipped: field.objectFlipOf(id) };
      field.setObjectCursor(def, col, row, id, carrying.flipped);
      return;
    }
    const plot = field.plotOriginAt(col, row);
    if (!plot) return;
    if (!field.canMovePlot(plot.oc, plot.or)) {
      // Say why rather than silently ignoring the tap — an unresponsive plot reads
      // as a broken tool.
      hud.showToast("Only bare tilled plots can be moved.");
      return;
    }
    carryingPlot = plot;
    field.setPlotMoveCursor(col, row, plot.oc, plot.or);
  };

  // Gold paid when selling a placed object. Brain prices convert at 1,000g each.
  const sellRefund = (def: PlaceableDef) => sellBack(def.cost, !!def.brainsNeeded);

  /** Functional items are permanent — except the Memorial Statue, which is bought
   *  in quantity and has to be reversible: a player who buys ten and wants two back
   *  otherwise has no way out. Its occupant is handed back to the graveyard by
   *  Field.onMemorialReleased, so a sale costs the plinth and nothing else. */
  const canSellObject = (def: PlaceableDef) => def.category !== "functional" || !!def.memorial;

  // Sell a placed object for a refund (used by the Remove tool + object popup).
  const sellObject = (id: string) => {
    if (onlineGameplayBlocked()) return;
    const def = field.objectDefOf(id);
    if (def && !canSellObject(def)) return;
    const o = field.objectOriginOf(id);
    field.removeObject(id);
    if (!def || !o) return;
    audio.play("sell");
    if (def.armyMax) state.addZombieMax(-def.armyMax); // reverse functional effect
    const purchase = objectPurchases.get(id);
    const boughtWithBrains = purchase ? purchase.currency === "brains" : !!def.brainsNeeded;
    const refund = purchase ? sellBack(purchase.cost, boughtWithBrains) : sellRefund(def);
    // Every online object sale must reach the ownership service, including free
    // raid/quest rewards claimed from Received. Otherwise the client removes the
    // object only from its layout and reconciliation restores the still-owned copy.
    // A legacy object the server doesn't know is rejected and its optimistic credit
    // is dropped, while its local layout removal remains saved.
    const serverObject = !!economy;
    if (serverObject) {
      economy!.submitObject({ type: "refund", key: def.key, instanceId: id }, { gold: refund });
    } else {
      state.addGold(refund);
    }
    const c = tileCenter(o.oc, o.or);
    objectPurchases.delete(id);
    floatText(c.x, c.y, `+${refund}g`);
  };

  hud.onSellStoredItem = async (key) => {
    if (onlineGameplayBlocked()) return false;
    const def = placeCatalog.get(key);
    const instanceId = storedInstanceId(key);
    // A shelved Memorial Statue is always a bare plinth (its occupant went back to
    // the graveyard when it was stored), so selling it from here frees nothing.
    if (!def || !canSellObject(def)) return false;
    if (!instanceId) {
      hud.showToast("That item is no longer in your shed.");
      return false;
    }
    const purchase = objectPurchases.get(instanceId);
    const boughtWithBrains = purchase ? purchase.currency === "brains" : !!def.brainsNeeded;
    const refund = purchase ? sellBack(purchase.cost, boughtWithBrains) : sellRefund(def);
    if (!await hud.confirmInGame(
      `Sell ${def.name}?`,
      `Sell this stored item for ${refund} gold? This cannot be undone.`,
      `Sell +${refund}g`,
    )) return false;
    if (!takeStoredObject(state, storedObjectIds, { key, instanceId })) return false;
    if (retrieving?.instanceId === instanceId) {
      retrieving = null;
      hud.setPlacing(null);
    }
    objectPurchases.delete(instanceId);
    if (economy) {
      economy.submitObject({ type: "refund", key, instanceId }, { gold: refund });
    } else state.addGold(refund);
    audio.play("sell");
    return true;
  };

  hud.onSellReceived = async (index) => {
    if (onlineGameplayBlocked()) return false;
    const entry = state.received[index];
    const def = entry ? receivedDef(entry) : undefined;
    if (!entry || !def || def.category === "functional") return false;
    const refund = sellRefund(def);
    if (!await hud.confirmInGame(
      `Sell ${def.name}?`,
      `Sell this reward directly from Received for ${refund} gold? This cannot be undone.`,
      `Sell +${refund}g`,
    )) return false;
    if (economy) {
      // Claim into a short-lived authoritative object, then refund it in the same
      // ordered command batch. The requested id links the two operations without
      // ever placing a client-side object on the farm.
      const instanceId = `reward-sale-${crypto.randomUUID()}`;
      if (!economy.submitStorageClaim(entry, { localObjectId: instanceId })) return false;
      economy.submitObject({ type: "refund", key: def.key, instanceId }, { gold: refund });
    } else state.addGold(refund);
    state.takeReceivedAt(index);
    audio.play("sell");
    return true;
  };

  // Store a placed object in the shed (returns it to inventory for free re-placing
  // later). Reverses any functional effect; the shed must have a free slot.
  const storeObject = (id: string) => {
    if (onlineGameplayBlocked()) return;
    const def = field.objectDefOf(id);
    if (!def) return;
    if (!state.storeItem(def.key)) return; // shed full
    if (def.armyMax) state.addZombieMax(-def.armyMax); // reverse functional effect
    field.removeObject(id);
    const storedIds = storedObjectIds.get(def.key) ?? [];
    storedIds.push(id);
    storedObjectIds.set(def.key, storedIds);
    economy?.submitObjectStatus(id, "stored");
  };

  // Can this object be stored in the shed? Storage buildings can't; the shed
  // must have a free slot. A Memorial Statue can — the shed holds only a key and a
  // count, so it goes in as a bare plinth and its occupant returns to the graveyard
  // (Field.onMemorialReleased) rather than being shelved with it.
  const canStore = (def: PlaceableDef) =>
    !def.storageSlots && !def.zombieStorage &&
    state.storedItemTotal() < state.storageItemCap;


  // The Move / Rotate / Store / Sell sheet for a placed object. Both entry points
  // (desktop tap and touch long-press) go through here so every object reachable
  // from one is reachable from the other.
  const openObjectActionsFor = (oid: string, def: PlaceableDef) => {
    hud.openObjectActions({
      name: def.name,
      portrait: `${BASE}assets/objects/${def.sprite}`,
      tint: objectTint(def.color), // monoliths share one sprite, coloured per def
      canStore: canStore(def),
      canSell: canSellObject(def),
      sellRefund: sellRefund(def),
      sellBrains: false,
      // The pen's own collection, which used to be all a tap on it could reach.
      ...(def.petPen
        ? { manageLabel: "Pets", onManage: () => hud.openStorage("Pets", true) }
        : {}),
      onMove: () => {
        hud.setMode("move"); // fires onModeChange (clears carry) FIRST...
        carrying = { id: oid, def, flipped: field.objectFlipOf(oid) }; // ...then pick up this object
        const o = field.objectOriginOf(oid);
        if (o) field.setObjectCursor(def, o.oc + Math.floor((def.tileW - 1) / 2),
          o.or + Math.floor((def.tileH - 1) / 2), oid, carrying.flipped);
      },
      onRotate: () => { field.flipObject(oid); saveManager.save(); },
      onStore: () => storeObject(oid),
      // The sheet sells decor on one tap, which is fine for a 50-gold daisy. A
      // Memorial Statue is a 3,000-gold object that may be carrying somebody, so it
      // asks first — and says where that somebody goes.
      onSell: def.memorial ? () => void confirmSellMemorial(oid, def) : () => sellObject(oid),
    });
  };

  /** Confirm-then-sell for a Memorial Statue. The occupant is not destroyed: it goes
   *  back to the graveyard (Field.onMemorialReleased), so this only costs the plinth. */
  const confirmSellMemorial = async (oid: string, def: PlaceableDef) => {
    const occupant = field.memorialOccupant(oid);
    const refund = sellRefund(def);
    const confirmed = await hud.confirmInGame(
      `Sell ${def.name}?`,
      `Sell this statue for ${refund} gold?`
      + (occupant
        ? ` ${occupant.name} is not lost with it — they return to the graveyard and can be enshrined on another statue.`
        : ""),
      `Sell +${refund}g`,
    );
    // The farm may have changed while the confirmation was open.
    if (confirmed && field.objectDefOf(oid) === def) sellObject(oid);
  };

  // Remove tool: a placed OBJECT sells back for a 50% refund; any plot is cleared
  // to bare ground for no money. A planted crop forfeits its cost and reward.
  const tryRemove = async (col: number, row: number, wx: number, wy: number) => {
    const id = field.objectAtPoint(wx, wy);
    if (id) {
      const d = field.objectDefOf(id);
      if (!d || !canSellObject(d)) return;
      const purchase = objectPurchases.get(id);
      const boughtWithBrains = purchase ? purchase.currency === "brains" : !!d.brainsNeeded;
      const refund = purchase ? sellBack(purchase.cost, boughtWithBrains) : sellRefund(d);
      // Selling a memorial does not destroy who it remembered — say so, or the
      // warning reads as "this deletes your dead zombie" and nobody ever taps it.
      const occupant = d.memorial ? field.memorialOccupant(id) : null;
      const confirmed = await hud.confirmInGame(
        `Sell ${d.name}?`,
        `The Remove tool will permanently sell this item for ${refund} gold. This cannot be undone.`
        + (occupant ? ` ${occupant.name} returns to the graveyard and can be enshrined again.` : ""),
        `Sell +${refund}g`
      );
      // The farm may have changed while the confirmation was open.
      if (!confirmed || field.objectDefOf(id) !== d) return;
      sellObject(id);
      return;
    }
    const origin = field.plotOriginAt(col, row);
    if (origin) {
      const crop = field.cropInfoAt(col, row);
      // Bare plowed soil holds nothing of value (the seed is only paid for when the
      // farmer actually plants), so removing it is a plain tap — no confirmation.
      if (crop) {
        const confirmed = await hud.confirmInGame(
          "Remove this plot?",
          `Remove this plot and discard the ${crop.name} growing on it? You will receive no refund.`,
          "Remove Plot"
        );
        const current = field.plotOriginAt(col, row);
        if (!confirmed || !current || current.oc !== origin.oc || current.or !== origin.or) return;
      }
      jobs.cancelAtTile(col, row); // drop any queued job on this plot first
      field.removePlot(col, row); // plot (and any crop) -> bare ground, no refund
      if (state.onFarm) state.onFarm({ type: "remove", oc: origin.oc, or: origin.or }, {});
      audio.play("sell");
      saveManager.save();
    }
  };

  // These edit actions are immediate for a mouse, but touch calls this only after
  // finger-up confirms the gesture was a tap (rather than the start of a pinch).
  const performEditTap = (mode: Mode, col: number, row: number, wx: number, wy: number) => {
    if (mode === "place") tryPlaceObject(col, row);
    else if (mode === "move") handleMoveTap(col, row, wx, wy);
    else if (mode === "remove") void tryRemove(col, row, wx, wy);
    else if (mode === "instagrow") tryInstaGrow(col, row, wx, wy);
    else if (mode === "rotate") {
      const id = field.objectAtPoint(wx, wy);
      if (id) { field.flipObject(id); audio.play("place"); saveManager.save(); }
    }
  };

  /** Tap a Memorial Statue: show who it remembers, or pick someone to remember.
   *  Enshrining moves the snapshot out of the graveyard and onto the statue, so the
   *  same zombie can never stand on two plinths. */
  const openMemorialFor = (objId: string, objDef: PlaceableDef) => {
    hud.openMemorial({
      occupant: field.memorialOccupant(objId),
      fallen: state.fallenZombies,
      cardOf: (fallen) => fallenToInfo(fallen, zombieDefs.get(fallen.key), zombiePortrait(fallen.key)),
      onObjectOptions: () => openObjectActionsFor(objId, objDef),
      onEnshrine: (fallenId) => {
        const claimed = state.claimFallen(fallenId);
        if (!claimed) return false;
        if (!field.setMemorialOccupant(objId, claimed)) {
          state.releaseFallen(claimed); // the statue vanished under the open panel
          return false;
        }
        // ONLINE the graveyard and every statue's occupant are server-owned, because
        // a friend visiting this farm renders the memorial from the authoritative
        // object projection. The name rides along: it is the one client-authored
        // field, exactly as it is for a living unit.
        economy?.submitMemorial({ type: "memorial.enshrine", instanceId: objId,
          unitId: claimed.id, ...(claimed.name ? { name: claimed.name } : {}) });
        audio.play("place");
        saveManager.save();
        return true;
      },
      onClear: () => {
        const occupant = field.memorialOccupant(objId);
        if (!occupant) return;
        field.setMemorialOccupant(objId, null);
        state.releaseFallen(occupant);
        economy?.submitMemorial({ type: "memorial.clear", instanceId: objId });
        saveManager.save();
      },
    });
  };

  const interactWithObject = (objId: string, objDef: PlaceableDef): boolean => {
    if (objDef.tapSound) audio.tap(objDef.tapSound);
    if (objDef.storageSlots) hud.openStorage();
    else if (objDef.memorial) openMemorialFor(objId, objDef);
    else if (objDef.zombieStorage) hud.openMausoleum();
    else if (objDef.zombiePatch) {
      const napping = zombies.toggleGather(field.patchRestTiles());
      const wp = field.objectWorkPoint(objId);
      saveManager.flushCritical();
      if (wp) floatText(wp.x, wp.y - 24, napping ? "Zzzâ€¦" : "Awake!");
    } else if (objDef.zombiePot) {
      activePotId = objId;
      hud.openCombiner();
    } else if (field.isObjectReady(objId)) {
      enqueueHarvestTarget({ kind: "tree", instanceId: objId });
    } else {
      openObjectActionsFor(objId, objDef);
    }
    return true;
  };

  const inspectZombie = (zu: NonNullable<ReturnType<typeof zombies.pick>>) => {
    zombies.select(zu);
    const d = zu.getData();
    const wp = zu.worldPos;
    floatText(wp.x, wp.y - 44, "Brains…");
    audio.brain(d.group, d.key);
    hud.openZombieInfo({
      name: d.name, typeName: d.typeName, key: d.key, group: d.group,
      className: d.className, classColor: d.classColor,
      str: d.str * state.farmerZombieStrengthMult(), dex: d.dex,
      con: d.con * state.farmerZombieLifeMult(), focus: d.focus, mutation: d.mutation,
      invasions: d.invasions,
      portrait: zombiePortrait(d.key), color: d.color,
      // Friend-farm visits are inspect-only, so omit action-bearing unit IDs.
      id: visiting ? undefined : d.id, stored: false,
    });
  };

  const beginWorldLongPress = (wx: number, wy: number, pointerId: number) => {
    cancelZombieLongPress();
    zombieLongPressActivated = false;
    const zombieCandidate = zombies.pick(wx, wy);
    const objectId = zombieCandidate || visiting ? null : field.objectAtPoint(wx, wy);
    const objectCandidate = objectId ? field.objectDefOf(objectId) : null;
    if (!zombieCandidate && (!objectId || !objectCandidate)) return;
    zombieLongPressTimer = setTimeout(() => {
      zombieLongPressTimer = null;
      if (pointerId !== pressPointerId || touchPinch || !dragging ||
          !isZombieHold(pressPointerType, TOUCH_ZOMBIE_HOLD_MS, moved)) return;
      zombieLongPressActivated = true;
      dragging = false;
      lastPlot = "";
      if (zombieCandidate) inspectZombie(zombieCandidate);
      else if (objectId && objectCandidate && field.objectDefOf(objectId) === objectCandidate)
        interactWithObject(objectId, objectCandidate);
    }, TOUCH_ZOMBIE_HOLD_MS);
  };

  app.stage.on("pointerdown", (e: FederatedPointerEvent) => {
    if (raidActive) return; // farm input is inert during a live raid
    if (economy && !economy.available) {
      // Name the cause. "reconnect to continue" on its own sends players chasing a
      // network problem they don't have.
      const why = economy.unavailableReason;
      hud.showToast(`Gameplay paused (${why}) — reconnect to continue.`);
      console.warn(`[zf] tap while paused: ${why}`);
      return;
    }
    if (touchPinch) return; // a pinch is in progress; ignore extra finger-downs
    if (isTouchPointer(e.pointerType) && !e.isPrimary) return;
    const touch = isTouchPointer(e.pointerType);
    // The tap immediately collapses the mobile HUD, which changes the DOM under
    // the finger. Keep Android's release routed to the canvas so endDrag can open
    // the plot's plant/crop panel instead of silently losing pointer-up.
    captureTouchPointer(app.canvas, e.pointerId, e.pointerType);
    pressPointerType = e.pointerType;
    pressPointerId = e.pointerId;
    pressMaxDistance = 0;
    touchSelectStartTile = null;
    touchToolStartTile = null;
    touchOutsideFarmPan = false;
    cancelZombieLongPress();
    zombieLongPressActivated = false;
    clearHarvestStroke();
    clearPlowStroke();
    pressStart.copyFrom(e.global);
    clearTouchToolStroke();
    if (visiting) {
      // Read-only visit: no tools, no editing. Only start a camera pan; a tap
      // (pan that doesn't move) resolves to walk / inspect in endDrag below.
      if (e.button === 2) return;
      dragging = true;
      moved = false;
      last.copyFrom(e.global);
      if (touch) {
        const w = toWorld(e);
        beginWorldLongPress(w.x, w.y, e.pointerId);
      }
      return;
    }
    if (e.button === 2) {
      // Right-click opens the tool menu (see the contextmenu handler below, which
      // fires after this one and knows the client coordinates). Here it only has
      // to make sure the press never starts a pan or a tool stroke.
      dragging = false;
      return;
    }
    if (hud.isTemporaryPanning) {
      temporaryPanGesture = true;
      dragging = true;
      moved = false;
      last.copyFrom(e.global);
      return;
    }
    const { col, row, wx, wy } = tileAt(e);
    if (touch && hud.mode === "plant") touchToolStartTile = { col, row };
    touchOutsideFarmPan = isOutsideFarmPanGesture(
      e.pointerType,
      hud.mode,
      field.inBounds(col, row),
    );
    // Tutorial world gate: while the guided tutorial is active, freeze every farm
    // tap except the current beat's target plot (so nothing collapses the menu or
    // acts out of turn). Menu/narrative beats freeze the farm entirely.
    if (tutorial.active && !tutorial.allowsTile(col, row)) return;
    hud.collapse(); // any tap on the field collapses the bars into the corner fab
    // Plow remains equipped after making a plot. On touch, tapping that newly
    // plantable soil is selection intent: return to the Multi-tool so pointer-up
    // opens the same left-side Plants/Zombies picker as a desktop click.
    if (touch && hud.mode === "till" && field.canPlant(col, row)) hud.setMode("walk");
    if (touch && hud.mode === "walk") touchSelectStartTile = { col, row };
    if (hud.mode === "walk") {
      harvestStrokeCandidate = harvestTargetAt(e.global.x, e.global.y);
      harvestStrokeLast.copyFrom(e.global);
    }
    if (touch && hud.mode === "walk") beginWorldLongPress(wx, wy, e.pointerId);
    if (isDeferredTouchMode(hud.mode)) {
      if (touch) {
        // Wait for pointer-up. A second finger may still convert this tap into a
        // pinch, and none of these actions are safely reversible.
        dragging = true;
        moved = false;
        last.copyFrom(e.global);
      } else {
        performEditTap(hud.mode, col, row, wx, wy);
        dragging = false;
      }
      return;
    }
    if (!touch && jobs.cancelAtTile(col, row)) { // tapped a queued action -> un-queue it
      dragging = false;
      return;
    }
    const queuedObjId = field.objectAtPoint(wx, wy);
    if (!touch && queuedObjId && jobs.cancelObject(queuedObjId)) {
      dragging = false;
      return;
    }
    if (hud.mode === "till") {
      dragging = true;
      moved = false;
      last.copyFrom(e.global);
      if (!touchOutsideFarmPan) beginPlowStroke(col, row, e.global.x, e.global.y);
      return;
    }
    dragging = true;
    moved = false;
    last.copyFrom(e.global);
    if (hud.mode !== "walk") {
      // Plant preserves immediate mouse click/drag painting. Touch waits for either a
      // confirmed tap or movement beyond its larger finger-jitter threshold.
      if (!touch) enqueueTool(col, row);
      lastPlot = touch ? "" : tileKey(col, row);
    }
  });
  app.stage.on("pointermove", (e: FederatedPointerEvent) => {
    if (raidActive) { hoveredCrop = null; hud.showCropHover(null); return; }
    if (touchPinch) return; // pinch owns the gesture; skip pan/cursor updates
    if (dragging && e.pointerId === pressPointerId) {
      pressMaxDistance = Math.max(
        pressMaxDistance,
        Math.hypot(e.global.x - pressStart.x, e.global.y - pressStart.y),
      );
      if (!moved) moved = gestureMoved(pressStart.x, pressStart.y, e.global.x, e.global.y, pressPointerType);
      if (moved) cancelZombieLongPress();
      if (moved && !harvestStrokeActive && harvestStrokeCandidate && hud.mode === "walk" &&
          !temporaryPanGesture) beginHarvestStroke(e.global.x, e.global.y);
    }
    if (harvestStrokeActive) {
      collectHarvestStrokeSegment(e.global.x, e.global.y);
      hoveredCrop = null;
      hud.showCropHover(null);
      field.hideCursor();
      return;
    }
    if (visiting) {
      hoveredCrop = null;
      hud.showCropHover(null);
      // Read-only visit: drag pans the camera; no tool cursors are ever shown.
      if (dragging) {
        const dx = e.global.x - last.x;
        const dy = e.global.y - last.y;
        if (moved) {
          world.position.x += dx;
          world.position.y += dy;
          clampCamera();
        }
        last.copyFrom(e.global);
      }
      return;
    }
    const { col, row, wx, wy } = tileAt(e);
    if (!dragging && hud.mode === "walk" && !isTouchPointer(e.pointerType)) {
      hoveredCrop = { col, row, wx, wy, x: e.global.x, y: e.global.y };
      hud.showCropHover(
        field.cropInfoAt(col, row) ?? field.treeInfoAtPoint(wx, wy),
        e.global.x,
        e.global.y,
      );
    } else {
      hoveredCrop = null;
      hud.showCropHover(null);
    }
    if (hud.mode === "place" && hud.placing) {
      field.setObjectCursor(hud.placing, col, row, undefined, placeFlipped); // ghost follows the cursor
      return;
    }
    if (hud.mode === "move") {
      if (carrying) field.setObjectCursor(carrying.def, col, row, carrying.id, carrying.flipped);
      else if (carryingPlot) field.setPlotMoveCursor(col, row, carryingPlot.oc, carryingPlot.or);
      return;
    }
    if (hud.mode === "remove") {
      // Highlight the object under the pointer; else show the red plot cursor.
      const id = field.objectAtPoint(wx, wy);
      field.setObjectHighlight(id);
      if (id) field.hideCursor();
      else field.setCursor(col, row, "remove");
      return;
    }
    if (hud.mode === "instagrow") {
      const id = field.objectAtPoint(wx, wy);
      const selectedPot = id && field.objectDefOf(id)?.zombiePot ? zombies.potFor(id) : null;
      const isActivePot = !!selectedPot?.busy && !selectedPot.ready;
      field.setObjectHighlight(isActivePot ? id : null);
      if (isActivePot) {
        field.hideCursor();
        return;
      }
      field.setCursor(col, row, "grow"); // green over a growing crop, red otherwise
      return;
    }
    if (dragging) {
      if (hud.mode === "walk" || touchOutsideFarmPan) {
        const dx = e.global.x - last.x;
        const dy = e.global.y - last.y;
        if (moved) {
          world.position.x += dx;
          world.position.y += dy;
          clampCamera(); // block panning above the sky
        }
        last.copyFrom(e.global);
      } else if (hud.mode === "till" && plowStrokeAnchor) {
        collectPlowStrokeSegment(e.global.x, e.global.y);
        field.setCursor(col, row, "till");
        return;
      } else if (hud.mode === "plant" && moved) {
        // Drag-paint plants across the field. Touch records the stroke and commits
        // on finger-up; mouse queues each new tile immediately.
        const tk = tileKey(col, row);
        if (tk !== lastPlot) {
          if (isTouchPointer(pressPointerType)) {
            if (!touchGestureTiles.length && touchToolStartTile)
              recordTouchPlantTile(touchToolStartTile.col, touchToolStartTile.row);
            recordTouchPlantTile(col, row);
          }
          else enqueueTool(col, row);
          lastPlot = tk;
        }
      }
    }
    const tool = hud.mode === "till" || hud.mode === "plant" ? hud.mode : null;
    field.setCursor(col, row, tool);
  });
  app.canvas.addEventListener("pointerleave", () => {
    hoveredCrop = null;
    hud.showCropHover(null);
  });
  const endDrag = (e: FederatedPointerEvent) => {
    const selectTap = hud.mode === "walk" &&
      isSelectTapGesture(pressPointerType, moved, pressMaxDistance);
    if (dragging && (!moved || selectTap)) {
      const released = tileAt(e);
      // A touch tap targets the plot beneath initial contact. This prevents normal
      // finger wobble from resolving the release just beyond an isometric edge.
      const startPlot = touchSelectStartTile
        ? field.plotOriginAt(touchSelectStartTile.col, touchSelectStartTile.row)
        : null;
      const col = startPlot ? touchSelectStartTile!.col : released.col;
      const row = startPlot ? touchSelectStartTile!.row : released.row;
      const { wx, wy } = released;
      if (isTouchPointer(pressPointerType)) {
        // Match desktop's queued-action toggle, but only after this is known to be
        // a tap so the first finger of a pinch cannot cancel unrelated work.
        if (jobs.cancelAtTile(col, row)) {
          dragging = false;
          lastPlot = "";
          return;
        }
        const queuedObjId = field.objectAtPoint(wx, wy);
        if (queuedObjId && jobs.cancelObject(queuedObjId)) {
          dragging = false;
          lastPlot = "";
          return;
        }
        if (isDeferredTouchMode(hud.mode)) {
          performEditTap(hud.mode, col, row, wx, wy);
          dragging = false;
          lastPlot = "";
          return;
        }
        if (hud.mode === "till" || hud.mode === "plant") {
          const mode = hud.mode;
          if (enqueueTool(col, row)) {
            dragging = false;
            lastPlot = "";
            return;
          }
          // A finger tap on already-plowed soil used to disappear while Plow was
          // equipped (especially noticeable immediately after the tutorial). A
          // failed Plow tap on plantable soil is selection intent: return to the
          // Multi-tool and fall through to the normal crop picker below.
          if (mode === "till" && field.canPlant(col, row)) hud.setMode("walk");
          else {
            dragging = false;
            lastPlot = "";
            return;
          }
        }
      }
      if (hud.mode === "walk") {
        // Select tool: clicking an owned zombie inspects it; the storage shed opens
        // Storage; a ripe fruit tree harvests for gold; else it's tile-based (same
        // clickbox as Plow) — ripe plot -> harvest; tilled plot -> plant picker;
        // spent plot -> re-till; else free-roam when idle.
        // A mouse resolves the zombie first; a finger cannot. A zombie's sprite
        // covers the plots drawn behind it, so on touch the tile keeps the tap and
        // the zombie is reached by press-and-hold instead. That only applies where
        // the tile actually wants the tap: when nothing beneath claims it, the
        // cascade below falls through to the zombie so open ground needs no hold.
        const zu = isTouchPointer(pressPointerType) ? null : zombies.pick(wx, wy);
        if (zu) {
          inspectZombie(zu);
          dragging = false;
          lastPlot = "";
          return;
        }
        zombies.clearSelection();
        if (visiting) {
          // Read-only visit: a tap on non-zombie ground just free-roams the
          // visitor's avatar. No harvest/plant/store/object actions on their farm.
          if (!jobs.busy) walk.goToPoint(wx, wy);
          dragging = false;
          lastPlot = "";
          return;
        }
        // A plot owns a normal touch tap even when an item's sprite covers it.
        // Holding still targets that item through beginWorldLongPress().
        const touchPlot = plotOwnsObjectTap(pressPointerType, !!field.plotOriginAt(col, row));
        const objId = touchPlot ? null : field.objectAtPoint(wx, wy);
        const objDef = objId ? field.objectDefOf(objId) : null;
        // Signature decor (Liberty Bell, Gnome King, …) plays its own tap sound.
        if (objDef?.tapSound) audio.tap(objDef.tapSound);
        if (objId && objDef && objDef.storageSlots) {
          hud.openStorage();
        } else if (objId && objDef && objDef.memorial) {
          openMemorialFor(objId, objDef); // who this statue remembers, or the graveyard
        } else if (objId && objDef && objDef.zombieStorage) {
          hud.openMausoleum(); // the Mausoleum's storage slots
        } else if (objId && objDef && objDef.zombiePatch) {
          // Tap the Zombie Patch: call all zombies to nap, or wake them.
          const napping = zombies.toggleGather(field.patchRestTiles());
          const wp = field.objectWorkPoint(objId);
          saveManager.flushCritical();
          if (wp) floatText(wp.x, wp.y - 24, napping ? "Zzz…" : "Awake!");
        } else if (objId && objDef && objDef.zombiePot) {
          activePotId = objId;
          hud.openCombiner(); // pick two zombies to combine, or collect a finished one
        } else if (objId && field.isObjectReady(objId)) {
          enqueueHarvestTarget({ kind: "tree", instanceId: objId });
        } else if (objId && objDef) {
          // A placed decoration/tree/Pet Pen: Move / Rotate / Store / Sell popup.
          openObjectActionsFor(objId, objDef);
        } else if (field.isRipe(col, row)) {
          const origin = field.plotOriginAt(col, row);
          if (origin) enqueueHarvestTarget({
            kind: "plot", oc: origin.oc, or: origin.or,
            isZombie: field.ripeZombieAt(col, row),
          });
        } else if (field.hasCrop(col, row)) {
          // Still-growing crop/zombie (not ripe yet): show its type + time left
          // (re-read on the popup's timer so the countdown ticks live) plus a button
          // to equip the Insta-Grow tool (or buy it when none are owned).
          hud.openCropInfo(() => field.cropInfoAt(col, row));
        } else if (field.canPlant(col, row)) {
          const onPick = (cfg: CropConfig) => {
            hud.setPlanting(cfg); // keep planting this crop on further taps
            jobs.enqueue("plant", col, row, cfg);
          };
          // During the tutorial's plant beat, constrain the menu to the base Zombie.
          if (tutorial.wantsLockedPlant(col, row))
            hud.openPlantMenu(onPick, { onlyKey: TUTORIAL_ZOMBIE_KEY });
          else hud.openPlantMenu(onPick);
        } else if (field.isSpent(col, row)) {
          const origin = field.plotOriginAt(col, row);
          if (origin) enqueueHarvestTarget({ kind: "replow", oc: origin.oc, or: origin.or });
        } else {
          // Nothing on this tile claimed the tap. On touch that makes an
          // overlapping zombie the obvious target, so away from plots it takes a
          // plain tap and the hold gesture is never needed.
          const bare = isTouchPointer(pressPointerType) ? zombies.pick(wx, wy) : null;
          if (bare) inspectZombie(bare);
          else if (!jobs.busy) walk.goToPoint(wx, wy); // free-roam only when idle
        }
      } else if (hud.mode === "plant" && !field.canPlant(col, row)) {
        hud.setPlanting(null); // tapped anything but plantable ground -> back to select
      }
    }
    dragging = false;
    lastPlot = "";
  };
  const onPointerUp = (e: FederatedPointerEvent) => {
    // During/after a pinch, dragging was cleared so endDrag fires no stray tap.
    if (touchPinch) return;
    if (pressPointerId !== -1 && e.pointerId !== pressPointerId) return;
    cancelZombieLongPress();
    if (zombieLongPressActivated) {
      zombieLongPressActivated = false;
      dragging = false;
      moved = false;
      lastPlot = "";
      pressPointerId = -1;
      clearTouchToolStroke();
      clearHarvestStroke();
      clearPlowStroke();
      return;
    }
    if (temporaryPanGesture) {
      temporaryPanGesture = false;
      dragging = false;
      moved = false;
      lastPlot = "";
      pressPointerId = -1;
      clearHarvestStroke();
      clearPlowStroke();
      return;
    }
    if (dragging && hud.mode === "till" && plowStrokeTargets.length) {
      collectPlowStrokeSegment(e.global.x, e.global.y);
      if (isTouchPointer(pressPointerType)) commitTouchPlowStroke();
      else clearPlowStroke();
      dragging = false;
      moved = false;
      lastPlot = "";
      pressPointerId = -1;
      touchOutsideFarmPan = false;
      clearTouchToolStroke();
      clearHarvestStroke();
      return;
    }
    if (harvestStrokeActive) {
      collectHarvestStrokeSegment(e.global.x, e.global.y);
      if (isTouchPointer(pressPointerType)) commitTouchHarvestStroke();
      else clearHarvestStroke();
      dragging = false;
      moved = false;
      lastPlot = "";
      pressPointerId = -1;
      touchOutsideFarmPan = false;
      touchSelectStartTile = null;
      clearTouchToolStroke();
      return;
    }
    if (dragging && moved && !touchOutsideFarmPan && isTouchPointer(pressPointerType) &&
        hud.mode === "plant") {
      commitTouchToolStroke();
    }
    endDrag(e);
    pressPointerId = -1;
    touchOutsideFarmPan = false;
    touchSelectStartTile = null;
    clearTouchToolStroke();
    clearHarvestStroke();
    clearPlowStroke();
  };
  app.stage.on("pointerup", onPointerUp);
  app.stage.on("pointerupoutside", onPointerUp);
  // Some Android browsers emit the native release but lose Pixi's federated
  // pointer-up when collapsing the HUD changes the DOM beneath the finger. Wait
  // until native propagation is complete, then finish any touch gesture Pixi did
  // not already finish. Select taps intentionally resolve from pressStart: that
  // is the stable plowed plot the player actually touched.
  window.addEventListener("pointerup", (e: PointerEvent) => {
    if (!shouldRecoverTouchPointerUp(pressPointerId, e.pointerId, e.pointerType)) return;
    const pointerId = e.pointerId;
    setTimeout(() => {
      if (!shouldRecoverTouchPointerUp(pressPointerId, pointerId, "touch")) return;
      onPointerUp({ pointerId, global: pressStart } as FederatedPointerEvent);
    }, 0);
  });
  app.stage.on("pointercancel", cancelPointerGesture);
  window.addEventListener("blur", () => {
    if (dragging && moved && isTouchPointer(pressPointerType) && hud.mode === "plant")
      commitTouchToolStroke();
    cancelPointerGesture();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (dragging && moved && isTouchPointer(pressPointerType) && hud.mode === "plant")
        commitTouchToolStroke();
      cancelPointerGesture();
    }
  });

  // Right-click anywhere on the farm opens the tool menu (and suppresses the
  // browser menu). It opens on Select, so the old right-click-to-cancel reflex is
  // still one Enter away; the wheel scrolls to anything else.
  let toolWheel: ToolWheelHandle | null = null;
  const closeToolWheel = () => { toolWheel?.close(); toolWheel = null; };
  // Equip a tool without the toolbar's toggle behaviour: choosing the tool you are
  // already holding, from a menu, must keep it — not silently unequip it.
  const equipTool = (m: Mode) => { if (hud.mode !== m) hud.setMode(m); };
  const toolWheelItems = (): ToolWheelItem[] => [
    { id: "walk", label: "Select", icon: "button_multitool.png", hint: "1",
      active: hud.mode === "walk", onPick: () => equipTool("walk") },
    { id: "move", label: "Move", icon: "button_move.png", hint: "2",
      active: hud.mode === "move", onPick: () => equipTool("move") },
    { id: "rotate", label: "Rotate", icon: "button_rotate.png", hint: "3",
      active: hud.mode === "rotate", onPick: () => rotateCurrent() },
    { id: "till", label: "Plow", icon: "button_plow.png", hint: "4",
      active: hud.mode === "till", onPick: () => equipTool("till") },
    { id: "remove", label: "Remove", icon: "button_sell.png", hint: "5",
      active: hud.mode === "remove", onPick: () => equipTool("remove") },
    { id: "plant", label: "Plant…", icon: "button_plant.png", hint: "P",
      active: hud.mode === "plant",
      onPick: () => hud.openPlantMenu((cfg) => hud.setPlanting(cfg)) },
  ];
  app.canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (tutorial.active || visiting || raidActive) return;
    // Touch long-press already means "inspect"; a phone gets the × cancel button
    // instead, so never let a synthesized contextmenu open the menu there.
    if (isTouchPointer(pressPointerType)) return;
    if (toolWheel) { closeToolWheel(); return; }
    toolWheel = openToolWheel(hud.el, {
      x: e.clientX, y: e.clientY, items: toolWheelItems(),
      onSound: () => audio.play("menuClick"),
      onClose: () => { toolWheel = null; },
    });
  });

  // Hide the tool cursor when switching tools (and drop any carried object);
  // next pointer move re-shows the right cursor.
  hud.onModeChange = () => {
    clearPlowStroke();
    field.clearTillSelection();
    field.hideCursor();
    field.setObjectHighlight(null);
    zombies.clearSelection();
    cancelCarry();
    if (hud.mode !== "place") retrieving = null; // leaving placement drops a pending retrieve
    if (hud.mode !== "place") receiving = null; // ...and a pending Received placement
    if (hud.mode !== "place") placeFlipped = false; // and reset the ghost orientation
  };
  hud.onTemporaryPanChange = () => {
    clearPlowStroke();
    field.clearTillSelection();
    field.hideCursor();
    field.setObjectHighlight(null);
    hoveredCrop = null;
    hud.showCropHover(null);
  };

  window.addEventListener("resize", recenter);

  // ---- game loop ----
  // Persistent combine-timer bar that floats over the placed Zombie Pot while a
  // combine runs (offline-safe: it reflects the pot's absolute finish time).
  type PotBarView = { bar: Container; fill: Graphics; label: Text };
  const potBars = new Map<string, PotBarView>();
  const makePotBar = (): PotBarView => {
    const bar = new Container();
    bar.visible = false;
    const fill = new Graphics();
    const label = new Text({
      text: "",
      style: {
        fontFamily: "system-ui, sans-serif", fontSize: 12, fontWeight: "700",
        fill: 0xffffff, stroke: { color: 0x0a1406, width: 3 },
      },
    });
    const W = 88, H = 16, PAD = 2;
    const bg = new Graphics();
    bg.roundRect(-W / 2, -H / 2, W, H, 4)
      .fill({ color: 0x1a1a24, alpha: 0.9 })
      .stroke({ width: 2, color: 0x05050a });
    fill.roundRect(0, 0, W - 2 * PAD, H - 2 * PAD, 3).fill({ color: 0x8ad14a });
    fill.position.set(-W / 2 + PAD, -H / 2 + PAD);
    fill.scale.x = 0;
    label.anchor.set(0.5, 0.5);
    bar.addChild(bg, fill, label);
    field.labelLayer.addChild(bar);
    return { bar, fill, label };
  };

  // requestAnimationFrame normally stops in a hidden tab. Keep the small farm-job
  // pipeline alive on a coarse timer so plant commands reach the authoritative
  // server near their logical completion time instead of being held until the tab
  // is visible again. Browsers may throttle this timer (which is fine because the
  // elapsed-time replay closes the gap), and fully suspended tabs still catch up
  // through the visibility handler below.
  window.setInterval(() => {
    if (document.hidden) advanceFarmJobsToNow(true);
  }, 1000);

  // Watch the live session's TTL on WALL clock, which is the one thing the fight
  // itself cannot see (its dt is clamped per frame and stops entirely while hidden).
  // Checked from the ticker on purpose: the first frame after the player comes back
  // is exactly the moment they need to hear that the session ran out while away.
  const checkRaidExpiry = () => {
    if (!raidActive || raidExpiresAt == null) return;
    const expiry = invasionExpiryState(raidExpiresAt, Date.now());
    if (expiry === raidExpiryAnnounced) return;
    raidExpiryAnnounced = expiry;
    const message = invasionExpiryMessage(expiry, raidExpiresAt - Date.now());
    if (message) hud.showToast(message, 8000);
  };

  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS / 1000, 0.05);
    if (raidScene) raidScene.update(dt); // live battle drives itself
    checkRaidExpiry();
    advanceFarmJobsToNow(); // wall-clock-safe queued work + farmer movement
    // While a battle owns the screen the farm world is fully hidden, so every
    // visual update below (depth sorts, rig posing, occlusion masks, the night
    // light-map render) would be discarded work. Crop growth is wall-clock based,
    // so the first frame after the raid snaps everything to its true state.
    if (raidActive) return;
    const modalOpen = !!hud.el.querySelector(".panelbg, .mkt-bg, .st-bg, .pm-bg");
    if (modalOpen && hoveredCrop) {
      hoveredCrop = null;
      hud.showCropHover(null);
    }
    if (!modalOpen && cameraKeys.size) {
      const speed = 520 * dt;
      const dx = (cameraKeys.has("a") ? speed : 0) - (cameraKeys.has("d") ? speed : 0);
      const dy = (cameraKeys.has("w") ? speed : 0) - (cameraKeys.has("s") ? speed : 0);
      if (dx || dy) {
        world.position.x += dx;
        world.position.y += dy;
        clampCamera();
      }
    }
    cropHoverRefresh -= dt;
    if (hoveredCrop && cropHoverRefresh <= 0) {
      hud.showCropHover(
        field.cropInfoAt(hoveredCrop.col, hoveredCrop.row) ??
          field.treeInfoAtPoint(hoveredCrop.wx, hoveredCrop.wy),
        hoveredCrop.x,
        hoveredCrop.y,
      );
      cropHoverRefresh = 0.25;
    }
    for (let i = bossTokenFx.length - 1; i >= 0; i--) {
      const fx = bossTokenFx[i];
      fx.age += dt;
      const rise = Math.min(1, fx.age / 0.42);
      const easedRise = 1 - Math.pow(1 - rise, 3);
      // Back-ease scale supplies the slight "harvested zombie" pop/settle.
      const back = 1.70158;
      const scale = rise < 1
        ? 1 + (back + 1) * Math.pow(rise - 1, 3) + back * Math.pow(rise - 1, 2)
        : 1;
      fx.view.scale.set(Math.max(0.16, scale));
      fx.view.position.set(fx.x, fx.y + 10 - 62 * easedRise - (rise === 1 ? Math.sin((fx.age - 0.42) * 7) * 2 : 0));
      const pulse = 1 + Math.sin(fx.age * 10) * 0.06;
      fx.glow.scale.set(pulse);
      fx.glow.alpha = 0.82 + Math.sin(fx.age * 10) * 0.12;
      if (fx.age > 1.25) fx.view.alpha = Math.max(0, 1 - (fx.age - 1.25) / 0.4);
      if (fx.age < 1.65) continue;
      fx.view.destroy({ children: true });
      bossTokenFx.splice(i, 1);
    }
    petActor?.update(dt, actor.container.x, actor.container.y);
    const penBounds = field.petPenBounds();
    for (const pet of penPetActors) {
      pet.container.visible = !!penBounds;
      if (penBounds) pet.updateInPen(dt, penBounds);
    }
    zombies.update(dt);
    zombies.setInvasionReady(!raidActive && raids.cooldownRemaining() <= 0);
    field.updatePetPenOcclusion(penPetActors.map((pet) => pet.container));
    field.update(dt);
    // Farmer's lantern light follows the lamp carried in his hand, only at night.
    if (isNight) {
      const { x: lx, y: ly } = actor.lanternWorldPosition();
      lanternInner.position.set(lx, ly);
      lanternOuter.position.set(lx, ly);
      // Rebuild the light-map (dark mask with the lights erased into it) and lay it
      // over the farm. Runs before the automatic stage render (lower ticker priority),
      // so the map the display sprite shows is this frame's.
      night.update(app.renderer, world);
    }
    // Each physical Zombie Pot owns its own job and progress bar.
    const placedPotIds = new Set(field.zombiePotIds());
    for (const [id, view] of potBars) {
      if (placedPotIds.has(id)) continue;
      field.labelLayer.removeChild(view.bar);
      view.bar.destroy({ children: true });
      potBars.delete(id);
    }
    for (const potId of placedPotIds) {
      const pot = zombies.potFor(potId);
      // The pot itself shows what it is doing: lid clamped on while the combine
      // cooks, the new zombie's arm out once it is done (source art, one tile per
      // state). Cheap to call every frame — it only repaints on a state change.
      field.setObjectWork(potId, pot.busy ? (pot.ready ? "ready" : "busy") : null);
      let view = potBars.get(potId);
      if (!view) { view = makePotBar(); potBars.set(potId, view); }
      const wp = field.objectWorkPoint(potId);
      view.bar.visible = !!wp && pot.busy;
      if (!wp || !pot.busy) continue;
      view.bar.position.set(wp.x, wp.y - 92);
      view.fill.scale.x = pot.ready ? 1 : pot.progress();
      const secs = Math.ceil(pot.remainingMs() / 1000);
      view.label.text = pot.ready ? "Ready!" : secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m`;
    }
    // animate floating popups (rise + fade)
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      if (f.delay > 0) {
        f.delay -= dt;
        if (f.delay > 0) continue;
        f.view.visible = true;
      }
      f.ttl -= dt;
      f.view.y -= 26 * dt;
      f.view.alpha = Math.min(1, f.ttl);
      if (f.ttl <= 0) {
        world.removeChild(f.view);
        floats.splice(i, 1);
        // Back to the pool for the next popup; only the overflow is really destroyed.
        if (floatPool.length < FLOAT_POOL_MAX) floatPool.push(f);
        else f.view.destroy({ children: true });
      }
    }
    for (let i = harvestFx.length - 1; i >= 0; i--) {
      const fx = harvestFx[i];
      fx.age += dt;
      const p = Math.min(1, fx.age / 1.05);
      const eased = 1 - Math.pow(1 - p, 3);
      fx.view.position.set(
        fx.x + fx.dx * p + Math.sin(p * Math.PI) * Math.sign(fx.dx || 1) * 5,
        fx.y - fx.rise * eased,
      );
      fx.view.rotation += fx.spin * dt;
      fx.view.scale.set(fx.baseScale * (1 + p * 0.32));
      fx.view.alpha = p < 0.68 ? 1 : 1 - (p - 0.68) / 0.32;
      if (p < 1) continue;
      fx.view.destroy();
      harvestFx.splice(i, 1);
    }
  });

  // When the tab returns to the foreground after being backgrounded, the render loop
  // has been throttled/paused so on-screen crop growth is stale until the next frame.
  // Growth itself is wall-clock based (Field derives crop age from plantedAt), so a
  // single update(0) snaps every crop to its true current stage right away instead of
  // waiting on the first (possibly delayed) rAF tick, then we persist the fresh state.
  document.addEventListener("visibilitychange", () => {
    // Settle the job clock on both edges. On hide this captures the final sliver
    // after the last frame; on show it consumes the entire suspended interval.
    advanceFarmJobsToNow(true);
    if (document.hidden) {
      // Save after catch-up, not before it. Mobile browsers may freeze the page
      // before a debounced state-change timer gets another chance to run.
      saveManager.flushCritical();
      return;
    }
    field.update(0);
    saveManager.save();
  });
  window.addEventListener("pagehide", () => {
    advanceFarmJobsToNow(true);
    field.update(0);
    saveManager.flushCritical();
  });
  window.addEventListener("focus", () => advanceFarmJobsToNow(true));

  // Live game-state handle + mutation helpers for local testing (instant raids,
  // boost grants, zombie spawning, placement, combine, raid wins). DEV BUILDS
  // ONLY: `import.meta.env.DEV` is statically false in production, so Vite
  // tree-shakes this entire object — and the helpers it closes over — out of the
  // shipped bundle. It was never a security boundary (a determined player can edit
  // browser state regardless), but it must not be handed to every player. Real
  // integrity comes from server-side validation/authority.
  if (import.meta.env.DEV) (window as any).ZF = { app, world, field, actor, walk, zombies, state, hud, jobs, audio, save: saveManager, quests, questBus, periodicQuests, raids, screenToGrid, CARROT,
    placeables: placeCatalog,
    boosts: boostCatalog,
    // Seed/zombie-crop configs by key, so a test can plant one without the menu.
    crops: catalog,
    // Instantly resolve a raid for testing (e.g. ZF.runRaid(1) with 8+ zombies).
    runRaid: (id: number) => raids.start(id, raids.partyView().defaultSelectedIds),
    // Grant a boost for testing (e.g. ZF.giveBoost("instaGrow", 3)).
    giveBoost: (key: string, n = 1) => state.addBoost(key, n),
    // Mark a tier boss beaten so its abilities unlock across the roster.
    winRaid: (tier: number) => state.completeRaid(String(tier)),
    // Debug: place a catalog object by key (loads its texture first).
    place: async (key: string, oc: number, or: number) => {
      const def = placeCatalog.get(key);
      if (!def) return null;
      await ensureObjectTextures(assets, def);
      return field.placeObject(def, oc, or);
    },
    // Debug: spawn a zombie of `key` carrying mutation mask `mask` (bit OR), for
    // testing mutation rendering. e.g. ZF.spawnMutant("ZombieActorRegularTier1", 2|64).
    spawnMutant: (key: string, mask: number) =>
      zombies.spawn(key, walk.tile.col, walk.tile.row, mask),
    // Zombie Pot: start combining two owned zombies by id (needs a placed Zombie
    // Pot). e.g. ZF.combine("z1","z2"). Returns whether it started.
    combine: (idA: string, idB: string) => {
      return zombies.combine(idA, idB);
    },
    // Collect a finished combine onto the farmer's tile (or storage if capped).
    collectCombine: () => {
      const pending = zombies.combinePot.pending;
      const combined = pending ? combinedPotSubjects(pending) : null;
      const z = zombies.collectCombine(walk.tile.col, walk.tile.row);
      if (z) {
        if (combined?.subject) {
          questBus.post(QuestEvent.CombinerCombined, combined.subject, 1, combined.aliases);
        }
        if (!pending || isCombinePromotion(z.key, pending.keyA, pending.keyB)) {
          questBus.post(QuestEvent.CombinerHarvested, z.typeName, 1, unitSubjectAliasesOf(z));
        }
      }
      return z;
    },
    // Inspect the running combine: { busy, ready, remainingMs, pending }.
    potStatus: () => ({
      busy: zombies.combinePot.busy,
      ready: zombies.combineReady,
      remainingMs: zombies.combinePot.remainingMs(),
      pending: zombies.combinePot.pending,
    }),
    // Guided tutorial: the controller + dev controls.
    tutorial,
    tut: {
      start: () => tutorial.restart(),
      goto: (n: number) => tutorial.jumpTo(n as TutStep),
      reset: () => tutorial.clearPersisted(),
      steps: TutStep,
    } };
  // eslint-disable-next-line no-console
  console.log(`field ${field.w}x${field.h} ready`);

  // Game is fully built behind the boot overlay — fill the bar and flip it to
  // "Click to Start". Once that signed-in player dismisses the overlay, offer
  // fullscreen on supported mobile browsers. This callback timing prevents the
  // prompt from covering the loading art, while its dedicated top layer keeps it
  // above the tutorial and any writer/device-lock dialog already on the HUD.
  const offerMobileFullscreen = () =>
    offerFullscreenPrompt(hud, isMobile(), onlineFarm);
  if (boot) boot.ready(() => {
    // Use the explicit "Click to Start" gesture to satisfy browser/PWA media
    // policies. Constructor autoplay is only a best-effort early attempt.
    audio.resumeFromGesture();
    offerMobileFullscreen();
  });
  else offerMobileFullscreen();
}

main().catch((err) => {
  console.error(err);
  boot?.fail(); // drop the start screen so the error below is visible
  const hud = document.getElementById("hud");
  if (hud) hud.innerHTML = `<b style="color:#ffb0b0">Error:</b> ${err}`;
});
