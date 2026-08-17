// Dev test setup for the Zombies vs Video Games invasion: builds an army, parks the game
// on the launch screen, and optionally charges a Brain Ticket so the fight runs ELITE.
// For exercising Zedzox's pixelFire burn and turnZombie conversion by hand (see
// src/raid/videoGameStage.ts).
//
// USE: run the `zombiefarm-dev` server, open http://localhost:5173, paste this whole file
// into the browser console, then call one of:
//
//   zfSetup()                  // 20 fully-mutated Silvers, ordinary invasion
//   zfSetup({ elite: true })   // 20 Master-rank mutated SPECIALS + a Brain Ticket
//
// DEV BUILDS ONLY - it drives the `window.ZF` debug handle, which Vite tree-shakes out of
// a production bundle. Local/offline play mode only: it grants gold, levels and boosts
// directly, all of which an online farm's server would reject.
//
// IDEMPOTENT: it sells anything outside the chosen roster and tops the rest up to count,
// so running it twice - or over the other variant, or on a half-wiped save - lands in the
// same state rather than giving you forty zombies.
(() => {
  /** The ordinary run: every one of these is className "Silver". A spread of BODY types,
   *  because the formation stands them by body and the fight reads completely differently
   *  depending on who ends up at the front. */
  const SILVERS = [
    ["ZombieActorLargeTier4", 3],             // Zombarian  - brutes, Bash/Smash
    ["ZombieActorGardenTier4", 2],            // Zombee     - heals + Resurrect
    ["ZombieActorSmallTier4", 3],             // Imp Zombie - exploders
    ["ZombieActorRegularTier4", 4],           // Robo Zombie
    ["ZombieActorGirlTier4", 2],              // Zombielocks
    ["ZombieActorHeadlessTier4", 2],          // Party Zombie - pushes to the front
    ["ZombieActorRegularTier4Eyebiscus", 2],
    ["ZombieActorRegularTier3DragonFruit", 1],
    ["ZombieActorRegularTier3VenusFlytrap", 1],
  ];

  /** The elite run: className "Special", which is the top of the ladder (CLASS_RANK 4, so
   *  the full ability tree for its group) and holds the heaviest stat lines in the game.
   *  Deliberately not all glass cannons - this is a real line-up, with tanks in front,
   *  healers behind, exploders, and a Large to carry a Mini Buddy.
   *
   *  EVERY KEY HERE IS NON-EPIC, and that is a hard constraint rather than a preference:
   *  EPIC zombies (Epic Boss event prizes - Brock Coley, Admiral, Vagabond, Madame, Diva,
   *  Scrooge, Zombug…) CANNOT CARRY MUTATIONS. The game already enforces it at the only
   *  place mutations are gained - the Zombie Pot refuses a special as a parent - so an
   *  epic wearing a mutation mask is a state real play cannot produce. This script spawns
   *  straight into the roster and would happily fabricate one, so the roster avoids them
   *  and `assertNoEpics` below fails loudly if anyone adds one later.
   *
   *  The tanks the epics used to fill are Deputy/Sheriff, who are within a hair of the
   *  Admiral's line (21 / 2.65 / 38.5 against 21 / 2.9 / 40.5) and are not epic. */
  const SPECIALS = [
    ["ZombieActorGeorgeWashington", 2],       // 30 / 2 / 12      - glass cannon
    ["ZombieActorOmegaZombieBot", 2],         // 28 / 5 / 30
    ["ZombieActorDeputy", 2],                 // 21 / 2.65 / 38.5 - the wall
    ["ZombieActorSheriff", 2],                // 21 / 2.65 / 38.5 - the wall
    ["ZombieActorZombieBot", 1],              // 24 / 5 / 25      - fastest heavy
    ["ZombieActorDapper", 2],                 // Large - Bash/Smash + Mini Buddy
    ["ZombieActorLargeTier5", 1],             // Large
    ["ZombieActorSmallTier5", 3],             // Small - Explode
    ["ZombieActorGardenTier5", 3],            // Garden - heals + Resurrect
    ["ZombieActorBombie", 2],                 // Headless - 11 / 1 / 29.7, pushes forward
  ];

  /** Survived invasions needed for Master rank (+25% to every stat). VET_THRESHOLDS tops
   *  out at 5, one per battle - see src/zombie/traits.ts. */
  const MASTER_INVASIONS = 5;

  async function zfSetup(opts = {}) {
    const elite = !!opts.elite;
    const Z = window.ZF;
    if (!Z) throw new Error("window.ZF is missing - is this a dev build, and has the game finished loading?");

    const mut = await import("/src/zombie/mutations.ts");
    const mm = await import("/src/zombie/mutationMask.ts");

    // Best mutation per slot by total stat bonus; one per slot = a fully mutated zombie.
    // Derived rather than hard-coded so it survives the catalog being widened again - the
    // mask is key-addressed and append-only, so never build one with raw bit arithmetic.
    const bySlot = {};
    for (const def of mut.MUTATION_LIST) {
      const total = mut.statEffectsOf(def).reduce((s, e) => s + e.amount, 0);
      if (!bySlot[def.slot] || total > bySlot[def.slot].total) bySlot[def.slot] = { def, total };
    }
    const MASK = Object.values(bySlot).reduce((m, x) => mm.maskUnion(m, x.def.bit), 0);

    const ROSTER = elite ? SPECIALS : SILVERS;
    const WANTED = new Map(ROSTER);

    // Guard the epic rule rather than trusting the comment above to be read. An epic that
    // slipped into a roster would be spawned wearing a mutation mask no real save can hold.
    const alm = await import("/src/zombie/almanac.ts");
    const defs = (await import("/public/assets/zombies.json")).default;
    const defByKey = Object.fromEntries(defs.map((d) => [d.key, d]));
    const epics = [...WANTED.keys()].filter((k) => defByKey[k] && alm.isEpicZombie(defByKey[k]));
    if (epics.length) {
      throw new Error(
        `epic zombies cannot carry mutations, so they do not belong in this roster: ${epics.join(", ")}`
      );
    }
    const unknown = [...WANTED.keys()].filter((k) => !defByKey[k]);
    if (unknown.length) throw new Error(`no such zombie: ${unknown.join(", ")}`);

    // The tutorial owns the whole UI on a fresh save and would sit in front of the raid
    // screens. Nothing here needs it.
    try { Z.tutorial?.finish?.(); } catch { /* already finished */ }

    Z.state.setLevel(45);                     // Video Games unlocks at 43
    if (Z.state.gold < 1_000_000) Z.state.addGold(1_000_000 - Z.state.gold);
    // The cap is derived from placed objects (armyCapacity.ts), so this override holds
    // only until something is placed — which this capture setup never does.
    Z.state.syncArmyCapacity(Z.state.zombieMax + 40);
    // Unlock the ability tiers so the army fights with its real kit rather than bare swings.
    for (let tier = 1; tier <= 11; tier++) for (let i = 0; i < 8; i++) Z.winRaid(tier);

    // Sell anything outside the chosen roster (leftovers, or the other variant's army),
    // then top each entry up to its count. Both halves are what make this re-runnable.
    const have = () => Z.raids.partyView().eligible;
    for (const z of have()) if (!WANTED.has(z.key)) Z.zombies.sell(z.id);
    for (const [key, count] of ROSTER) {
      const short = count - have().filter((z) => z.key === key).length;
      for (let i = 0; i < short; i++) Z.spawnMutant(key, MASK);
    }

    // Veterancy: the elite run fights at Master (+25% to every stat), which is what makes
    // it a genuinely strong army rather than just a rare one. Pushed through the roster's
    // own counter, so the rank, the portrait badge and the combat maths all agree.
    if (elite) {
      const ids = have().map((z) => z.id);
      for (let i = 0; i < MASTER_INVASIONS; i++) Z.zombies.recordInvasion(ids);
      // Top UP to a few of each rather than granting more every run - this script is meant
      // to be re-runnable, and blindly adding would leave you on x24 after a few goes.
      const topUp = (key, want) => {
        const held = Z.state.boostCount?.(key) ?? 0;
        if (held < want) Z.giveBoost(key, want - held);
      };
      topUp("brain_ticket", 3);                // the ticket is what makes the invasion elite
      // CONCENTRATION IS NOT OPTIONAL ON THE ELITE FIGHT. Measured with this exact army:
      // without it the run loses at the four-minute cap and can only beat about 0.69 of
      // the shipped elite profile; with it, the same army wins. The whole difficulty
      // ladder is calibrated with it on (eliteInvasion.balance.test.ts builds every
      // measuring-stick army with `concentration: true`), because the focus minigame
      // decides how fast the army reaches the field and the fight is on a hard timer.
      topUp("concentration", 3);
    }

    Z.state.lastRaidAt = 0;                   // clear the between-invasions cooldown
    Z.save.flushCritical?.();

    // Park it on the Video Games army screen with the full party picked. Each panel is
    // waited FOR rather than slept past — these open on an animation whose length is not
    // ours to predict, and a fixed delay silently leaves you on the wrong screen when the
    // machine is busy (observed: the army panel not up after 1200 ms).
    const until = async (find, what, ms = 8000) => {
      for (let waited = 0; waited < ms; waited += 100) {
        const hit = find();
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`timed out waiting for ${what}`);
    };
    // Always RE-QUERY the card. `openRaids` re-renders the list, so a node captured once
    // is detached a moment later - clicking it does nothing and nothing ever selects.
    const cardNow = () => [...document.querySelectorAll(".raid-list > *")]
      .find((c) => /Video Games/.test(c.textContent || ""));
    // Start from a clean UI. Re-running this with the army screen already up (which is
    // exactly where the previous run left you) otherwise drives the flow from halfway
    // through it and never reaches a picked party.
    for (let i = 0; i < 6 && document.querySelector("[class*=panelbg]"); i++) {
      Z.hud.closeTopOverlay?.();
      await new Promise((r) => setTimeout(r, 150));
    }
    Z.hud.openRaids();
    await until(cardNow, "the Video Games card");
    // Click until it takes: the selection lands a tick after the click, and the go button
    // acts on the SELECTED raid, so pressing it too early opens nothing at all.
    await until(() => {
      const c = cardNow();
      if (!c) return false;
      if (c.className.includes("sel")) return true;
      c.click();
      return false;
    }, "the card to select");
    document.querySelector(".raid-go").click();
    await until(() => document.querySelector(".raid-quick"), "the army screen");
    // Same re-click loop, and the success condition is the button reading "Invade with N"
    // - NOT merely containing a digit, which "Need 8 more" also does.
    await until(() => {
      const go = document.querySelector(".raid-go");
      if (/invade with/i.test(go?.textContent || "")) return true;
      document.querySelector(".raid-quick")?.click();
      return false;
    }, "the party to be picked");

    const party = have();
    const summary = {
      mode: elite ? "ELITE (Brain Ticket)" : "ordinary",
      level: Z.state.level,
      army: party.length,
      fullyMutated: party.filter((z) => mut.isFullyMutated(z.mutation)).length,
      button: (document.querySelector(".raid-go")?.textContent || "").trim(),
    };
    if (elite) {
      summary.brainTickets = Z.state.boostCount?.("brain_ticket") ?? "granted";
      summary.concentration = Z.state.boostCount?.("concentration") ?? "granted";
      summary.note = "on the army screen, turn on BOTH Brain Ticket and Concentration " +
        "before invading - without Concentration this army loses the elite fight";
    }
    console.log("[dev setup]", summary);
    return summary;
  }

  window.zfSetup = zfSetup;
  console.log("zfSetup() ready - call zfSetup() or zfSetup({ elite: true })");
  return zfSetup;
})();
