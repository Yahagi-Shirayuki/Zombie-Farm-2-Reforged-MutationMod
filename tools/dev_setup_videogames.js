// Dev test setup: a full army of fully-mutated Silvers, parked on the Zombies vs Video
// Games launch screen. For exercising Zedzox's pixelFire burn and turnZombie conversion
// by hand (see src/raid/videoGameStage.ts).
//
// USE: run the `zombiefarm-dev` server, open http://localhost:5173, and paste this whole
// file into the browser console. DEV BUILDS ONLY — it drives the `window.ZF` debug handle,
// which Vite tree-shakes out of a production bundle.
//
// It is IDEMPOTENT: it tops the army up to ARMY_CAP rather than spawning another twenty,
// and sells off anything that is not part of the intended roster, so running it twice (or
// after a partial wipe) leaves the same state. Local/offline play mode only — this grants
// gold and levels directly, which an online farm's server would reject.
(async () => {
  const Z = window.ZF;
  if (!Z) throw new Error("window.ZF is missing - is this a dev build, and has the game finished loading?");

  const mut = await import("/src/zombie/mutations.ts");
  const mm = await import("/src/zombie/mutationMask.ts");

  // Best mutation per slot by total stat bonus; one per slot = a fully mutated zombie.
  // Derived rather than hard-coded, so it survives the catalog being widened again (the
  // mask is key-addressed and append-only - never build one with raw bit arithmetic).
  const bySlot = {};
  for (const def of mut.MUTATION_LIST) {
    const total = mut.statEffectsOf(def).reduce((s, e) => s + e.amount, 0);
    if (!bySlot[def.slot] || total > bySlot[def.slot].total) bySlot[def.slot] = { def, total };
  }
  const MASK = Object.values(bySlot).reduce((m, x) => mm.maskUnion(m, x.def.bit), 0);

  // Every one of these is className "Silver". A spread of BODY types, because the
  // formation stands them by body and the fight reads completely differently depending on
  // who is at the front: Headless push forward, Gardens hang back and heal, Smalls carry
  // the one-use Explode.
  const ROSTER = [
    ["ZombieActorLargeTier4", 3],            // Zombarian  - brutes, Bash/Smash
    ["ZombieActorGardenTier4", 2],           // Zombee     - heals + Resurrect
    ["ZombieActorSmallTier4", 3],            // Imp Zombie - exploders
    ["ZombieActorRegularTier4", 4],          // Robo Zombie
    ["ZombieActorGirlTier4", 2],             // Zombielocks
    ["ZombieActorHeadlessTier4", 2],         // Party Zombie - pushes to the front
    ["ZombieActorRegularTier4Eyebiscus", 2],
    ["ZombieActorRegularTier3DragonFruit", 1],
    ["ZombieActorRegularTier3VenusFlytrap", 1],
  ];
  const WANTED = new Map(ROSTER);

  // The tutorial owns the whole UI on a fresh save and would sit in front of the raid
  // screens. Nothing here needs it.
  try { Z.tutorial?.finish?.(); } catch { /* already finished */ }

  Z.state.setLevel(45);                       // Video Games unlocks at 43
  if (Z.state.gold < 1_000_000) Z.state.addGold(1_000_000 - Z.state.gold); // Brain Tickets are 2,000
  Z.state.addZombieMax(40);
  // Unlock the ability tiers so the army fights with its real kit rather than bare swings.
  for (let tier = 1; tier <= 11; tier++) for (let i = 0; i < 8; i++) Z.winRaid(tier);

  // Sell anything that is not in the intended roster (leftovers from an earlier session),
  // then top each entry up to its count. Both halves are what make this re-runnable.
  const have = () => Z.raids.partyView().eligible;
  for (const z of have()) if (!WANTED.has(z.key)) Z.zombies.sell(z.id);
  for (const [key, count] of ROSTER) {
    const short = count - have().filter((z) => z.key === key).length;
    for (let i = 0; i < short; i++) Z.spawnMutant(key, MASK);
  }

  Z.state.lastRaidAt = 0;                     // clear the between-invasions cooldown
  Z.save.flushCritical?.();

  // Park it on the Video Games army screen with the full party picked.
  Z.hud.openRaids();
  const card = [...document.querySelectorAll(".raid-list > *")]
    .find((c) => /Video Games/.test(c.textContent || ""));
  card.click();
  document.querySelector(".raid-go").click();
  await new Promise((r) => setTimeout(r, 1200));
  document.querySelector(".raid-quick")?.click();

  const party = have();
  const summary = {
    level: Z.state.level,
    gold: Z.state.gold,
    army: party.length,
    fullyMutated: party.filter((z) => mut.isFullyMutated(z.mutation)).length,
    // A Headless body has no head slot, so it legitimately carries one fewer.
    headlessWithoutHead: party.filter((z) => z.key.includes("Headless")).length,
    button: (document.querySelector(".raid-go")?.textContent || "").trim(),
  };
  console.log("[dev setup]", summary);
  return summary;
})();
