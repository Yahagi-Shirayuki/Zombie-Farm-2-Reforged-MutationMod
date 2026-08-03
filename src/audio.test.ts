import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_KEY } from "./save/schema";
import { AudioManager } from "./audio";

class MockAudio extends EventTarget {
  static instances: MockAudio[] = [];
  static rejectPlay = false;
  loop = false;
  volume = 1;
  preload = "";
  paused = true;
  src: string;
  playCalls = 0;
  pauseCalls = 0;

  constructor(src: string) {
    super();
    this.src = src;
    MockAudio.instances.push(this);
  }

  play() {
    this.playCalls++;
    if (MockAudio.rejectPlay) return Promise.reject(new Error("autoplay blocked"));
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
    this.pauseCalls++;
  }
}

describe("AudioManager focus muting", () => {
  let focused: boolean;
  let hidden: boolean;
  let windowTarget: EventTarget;
  let storage: Map<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    MockAudio.instances = [];
    MockAudio.rejectPlay = false;
    focused = true;
    hidden = false;
    storage = new Map();
    windowTarget = new EventTarget();
    const documentTarget = new EventTarget();
    Object.defineProperties(documentTarget, {
      hidden: { get: () => hidden },
      hasFocus: { value: () => focused },
    });
    vi.stubGlobal("window", windowTarget);
    vi.stubGlobal("document", documentTarget);
    vi.stubGlobal("Audio", MockAudio);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("pauses every channel on blur, suppresses effects, and resumes loops", () => {
    storage.set(SETTINGS_KEY, JSON.stringify({
      music: true, sfx: true, ambience: true, muteWhenUnfocused: true,
    }));
    const audio = new AudioManager();
    const [music, ambience] = MockAudio.instances;

    expect(music.playCalls).toBe(1);
    expect(ambience.playCalls).toBe(1);

    focused = false;
    windowTarget.dispatchEvent(new Event("blur"));
    expect(music.paused).toBe(true);
    expect(ambience.paused).toBe(true);

    audio.play("buy");
    expect(MockAudio.instances).toHaveLength(2);

    focused = true;
    windowTarget.dispatchEvent(new Event("focus"));
    expect(music.playCalls).toBe(2);
    expect(ambience.playCalls).toBe(2);
  });

  it("persists the option and mutes immediately when enabled in the background", () => {
    focused = false;
    const audio = new AudioManager();
    const [music, ambience] = MockAudio.instances;

    audio.setMuteWhenUnfocused(true);

    expect(music.paused).toBe(true);
    expect(ambience.paused).toBe(true);
    expect(JSON.parse(storage.get(SETTINGS_KEY)!)).toMatchObject({
      music: true, sfx: true, ambience: true, muteWhenUnfocused: true,
    });
  });

  it("also reacts when a still-focused tab becomes hidden", () => {
    storage.set(SETTINGS_KEY, JSON.stringify({ muteWhenUnfocused: true }));
    new AudioManager();
    const [music, ambience] = MockAudio.instances;

    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));

    expect(music.paused).toBe(true);
    expect(ambience.paused).toBe(true);
  });

  it("always pauses a hidden mobile page even when focus muting is disabled", () => {
    storage.set(SETTINGS_KEY, JSON.stringify({ muteWhenUnfocused: false }));
    new AudioManager();
    const [music, ambience] = MockAudio.instances;

    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));

    expect(music.paused).toBe(true);
    expect(ambience.paused).toBe(true);
  });

  it("stops audio on mobile pagehide even before hidden state updates", () => {
    storage.set(SETTINGS_KEY, JSON.stringify({ muteWhenUnfocused: false }));
    new AudioManager();
    const [music, ambience] = MockAudio.instances;

    windowTarget.dispatchEvent(new Event("pagehide"));

    expect(music.paused).toBe(true);
    expect(ambience.paused).toBe(true);
  });

  it("restores and applies independent channel volumes", () => {
    storage.set(SETTINGS_KEY, JSON.stringify({
      musicVolume: 0.5, sfxVolume: 0.25, ambienceVolume: 0.4,
    }));
    const audio = new AudioManager();
    const [music, ambience] = MockAudio.instances;

    expect(music.volume).toBeCloseTo(0.2);
    expect(ambience.volume).toBeCloseTo(0.1);

    audio.play("buy");
    expect(MockAudio.instances[MockAudio.instances.length - 1].volume).toBeCloseTo(0.55 * 0.25);

    audio.setMusicVolume(0.75);
    audio.setSfxVolume(0.6);
    audio.setAmbienceVolume(0.8);
    expect(music.volume).toBeCloseTo(0.3);
    expect(ambience.volume).toBeCloseTo(0.2);
    expect(JSON.parse(storage.get(SETTINGS_KEY)!)).toMatchObject({
      musicVolume: 0.75, sfxVolume: 0.6, ambienceVolume: 0.8,
    });
  });

  it("scales every channel by the master volume", () => {
    storage.set(SETTINGS_KEY, JSON.stringify({
      masterVolume: 0.5, musicVolume: 0.5, sfxVolume: 0.25, ambienceVolume: 0.4,
    }));
    const audio = new AudioManager();
    const [music, ambience] = MockAudio.instances;

    expect(music.volume).toBeCloseTo(0.4 * 0.5 * 0.5);
    expect(ambience.volume).toBeCloseTo(0.25 * 0.4 * 0.5);

    audio.play("buy");
    expect(MockAudio.instances[MockAudio.instances.length - 1].volume)
      .toBeCloseTo(0.55 * 0.25 * 0.5);

    audio.setMasterVolume(1);
    expect(music.volume).toBeCloseTo(0.2);
    expect(ambience.volume).toBeCloseTo(0.1);
    expect(JSON.parse(storage.get(SETTINGS_KEY)!)).toMatchObject({ masterVolume: 1 });
  });

  it("silences everything when the master toggle is off and resumes when re-enabled", () => {
    const audio = new AudioManager();
    const [music, ambience] = MockAudio.instances;
    expect(music.paused).toBe(false);

    audio.setMaster(false);
    expect(music.paused).toBe(true);
    expect(ambience.paused).toBe(true);

    const count = MockAudio.instances.length;
    audio.play("buy");
    expect(MockAudio.instances).toHaveLength(count);

    audio.setMaster(true);
    expect(music.paused).toBe(false);
    expect(ambience.paused).toBe(false);
    expect(JSON.parse(storage.get(SETTINGS_KEY)!)).toMatchObject({ master: true });
  });

  it("stays silent on boot when the master toggle was saved off", () => {
    storage.set(SETTINGS_KEY, JSON.stringify({ master: false }));
    new AudioManager();
    const [music, ambience] = MockAudio.instances;

    expect(music.playCalls).toBe(0);
    expect(ambience.playCalls).toBe(0);
  });

  it("resumes enabled loops from the explicit start gesture after autoplay is blocked", async () => {
    MockAudio.rejectPlay = true;
    const audio = new AudioManager();
    const [music, ambience] = MockAudio.instances;
    await Promise.resolve();

    expect(music.paused).toBe(true);
    expect(ambience.paused).toBe(true);

    MockAudio.rejectPlay = false;
    audio.resumeFromGesture();

    expect(music.paused).toBe(false);
    expect(ambience.paused).toBe(false);
    expect(music.playCalls).toBe(2);
    expect(ambience.playCalls).toBe(2);
  });

  it("uses the recovered zombie bite and authored enemy attack cues", () => {
    const audio = new AudioManager();

    audio.fightStrike({ team: "player", attackName: "ZombieBite" });
    expect(MockAudio.instances[MockAudio.instances.length - 1]?.src).toContain("assets/audio/bite.wav");
    expect(MockAudio.instances[MockAudio.instances.length - 1]?.volume).toBeCloseTo(0.55);

    audio.fightStrike({ team: "player", attackName: "ZombieScratch" });
    expect(MockAudio.instances[MockAudio.instances.length - 1]?.src).toContain("assets/audio/flail.wav");

    audio.fightStrike({ team: "enemy", attackName: "FarmhandPoke" });
    expect(MockAudio.instances[MockAudio.instances.length - 1]?.src).toContain("assets/audio/poke.wav");

    audio.fightStrike({ team: "enemy", attackName: "MidgetStackAttack" });
    expect(MockAudio.instances[MockAudio.instances.length - 1]?.src).toContain("assets/audio/poke.wav");

    audio.fightStrike({ team: "enemy", attackName: "LumberjackSlice" });
    expect(MockAudio.instances[MockAudio.instances.length - 1]?.src).toContain("assets/audio/swipe.wav");

    audio.fightStrike({ team: "enemy", impact: "projectile" });
    expect(MockAudio.instances[MockAudio.instances.length - 1]?.src).toContain("assets/audio/splat.wav");
  });

  it("uses the recovered non-looping invasion theme for raid victories", () => {
    const audio = new AudioManager();

    audio.enterRaid("farmStageBGM.mp3");
    audio.playRaidVictory();

    const victory = MockAudio.instances[MockAudio.instances.length - 1];
    expect(victory.src).toContain("assets/audio/winBGM.mp3");
    expect(victory.loop).toBe(false);
    expect(victory.playCalls).toBe(1);
  });

  it("keeps the winner cue assigned to level-ups", () => {
    const audio = new AudioManager();

    audio.play("levelUp");

    expect(MockAudio.instances[MockAudio.instances.length - 1]?.src).toContain("assets/audio/winner.mp3");
  });

  it("uses the farm interaction bark for a raid zombie actor key", () => {
    const audio = new AudioManager();

    audio.brainForZombie("ZombieActorGardenTier1");
    expect(MockAudio.instances[MockAudio.instances.length - 1]?.src).toContain("assets/audio/brainGarden.mp3");

    audio.brainForZombie("ZombieActorRegularTier3");
    expect(MockAudio.instances[MockAudio.instances.length - 1]?.src).toContain("assets/audio/brainRobot.mp3");
  });

  it("reclaims a stalled fallback element instead of allocating a new one", () => {
    const audio = new AudioManager();
    const before = MockAudio.instances.length;

    // A browser that never reports `ended` (iOS evicting a stalled element) must
    // not strand the pool: the timed reclaim returns the element for reuse.
    audio.play("buy");
    expect(MockAudio.instances).toHaveLength(before + 1);
    vi.advanceTimersByTime(10_000);

    audio.play("buy");
    expect(MockAudio.instances).toHaveLength(before + 1);
  });

  it("uses girl audio for the catalog's Female group and keeps headless silent", () => {
    const audio = new AudioManager();

    audio.brain("Female", "ZombieActorGirlTier1");
    expect(MockAudio.instances[MockAudio.instances.length - 1]?.src).toContain("assets/audio/brainGirl.mp3");

    const count = MockAudio.instances.length;
    audio.brain("Headless", "ZombieActorHeadlessTier1");
    expect(MockAudio.instances).toHaveLength(count);

    audio.brainForZombie("ZombieActorHeadlessTier1");
    expect(MockAudio.instances).toHaveLength(count);
  });
});

// Raid combat fires an attack cue on nearly every 50 ms simulation tick. Each
// HTMLAudioElement.play() costs several milliseconds of main-thread time on iOS,
// so those cues must reach the speaker through Web Audio instead.
describe("AudioManager one-shot effects", () => {
  class MockSource {
    static started: MockSource[] = [];
    buffer: unknown = null;
    onended: (() => void) | null = null;
    connect = (destination: unknown) => destination;
    disconnect = () => {};
    start = () => { MockSource.started.push(this); };
  }

  class MockContext {
    state = "running";
    destination = {};
    decodeCalls = 0;
    createBufferSource = () => new MockSource();
    createGain = () => ({
      gain: { value: 0 },
      connect: (destination: unknown) => destination,
      disconnect: () => {},
    });
    decodeAudioData = () => { this.decodeCalls++; return Promise.resolve({} as AudioBuffer); };
    resume = () => { this.state = "running"; return Promise.resolve(); };
    suspend = () => { this.state = "suspended"; return Promise.resolve(); };
  }

  let context: MockContext;
  let storage: Map<string, string>;

  /** Let the fetch -> arrayBuffer -> decodeAudioData chain settle. */
  const settleDecode = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

  beforeEach(() => {
    MockAudio.instances = [];
    MockAudio.rejectPlay = false;
    MockSource.started = [];
    storage = new Map();
    context = new MockContext();
    const windowTarget = new EventTarget() as EventTarget & { AudioContext: unknown };
    windowTarget.AudioContext = function () { return context; } as unknown;
    const documentTarget = new EventTarget();
    Object.defineProperties(documentTarget, {
      hidden: { get: () => false },
      hasFocus: { value: () => true },
    });
    vi.stubGlobal("window", windowTarget);
    vi.stubGlobal("document", documentTarget);
    vi.stubGlobal("Audio", MockAudio);
    vi.stubGlobal("fetch", () =>
      Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }));
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("plays a decoded cue through Web Audio without allocating a media element", async () => {
    const audio = new AudioManager();

    // First cue: still decoding, so it falls back to a media element.
    audio.fightStrike({ team: "player", attackName: "ZombieBite" });
    const afterFallback = MockAudio.instances.length;
    expect(MockSource.started).toHaveLength(0);

    await settleDecode();

    // Every later cue is a throwaway buffer source — no new media element.
    for (let i = 0; i < 20; i++) {
      audio.fightStrike({ team: "player", attackName: "ZombieBite" });
    }
    expect(MockSource.started).toHaveLength(20);
    expect(MockAudio.instances).toHaveLength(afterFallback);
  });

  it("applies the sfx and master volumes to the buffered voice", async () => {
    storage.set(SETTINGS_KEY, JSON.stringify({ masterVolume: 0.5, sfxVolume: 0.4 }));
    const audio = new AudioManager();
    const gains: { gain: { value: number } }[] = [];
    context.createGain = () => {
      const node = {
        gain: { value: 0 },
        connect: (destination: unknown) => destination,
        disconnect: () => {},
      };
      gains.push(node);
      return node;
    };

    audio.fightStrike({ team: "player", attackName: "ZombieBite" });
    await settleDecode();
    audio.fightStrike({ team: "player", attackName: "ZombieBite" });

    expect(gains[gains.length - 1].gain.value).toBeCloseTo(0.55 * 0.4 * 0.5);
  });

  it("caps concurrent voices so a busy fight cannot pile them up", async () => {
    const audio = new AudioManager();
    audio.fightStrike({ team: "player", attackName: "ZombieBite" });
    await settleDecode();

    // Nothing reports `ended`, so every voice stays live.
    for (let i = 0; i < 60; i++) {
      audio.fightStrike({ team: "player", attackName: "ZombieBite" });
    }

    expect(MockSource.started).toHaveLength(24);
  });

  it("frees a voice slot once the clip ends", async () => {
    const audio = new AudioManager();
    audio.fightStrike({ team: "player", attackName: "ZombieBite" });
    await settleDecode();

    for (let i = 0; i < 60; i++) {
      audio.fightStrike({ team: "player", attackName: "ZombieBite" });
    }
    for (const source of MockSource.started) source.onended?.();
    audio.fightStrike({ team: "player", attackName: "ZombieBite" });

    expect(MockSource.started).toHaveLength(25);
  });

  it("decodes every attack cue when a raid starts", async () => {
    const audio = new AudioManager();

    audio.enterRaid("farmStageBGM.mp3");
    await settleDecode();

    // bite / flail / poke / swipe / punch / splat.
    expect(context.decodeCalls).toBe(6);
    audio.fightStrike({ team: "enemy", impact: "projectile" });
    expect(MockSource.started).toHaveLength(1);
  });

  it("stays on the media element while the context is gesture-locked", async () => {
    const audio = new AudioManager();
    audio.fightStrike({ team: "player", attackName: "ZombieBite" });
    await settleDecode();
    context.state = "suspended";

    const before = MockAudio.instances.length;
    audio.fightStrike({ team: "player", attackName: "ZombieBite" });

    expect(MockSource.started).toHaveLength(0);
    expect(MockAudio.instances).toHaveLength(before + 1);
    // The attempted resume leaves it running for the next cue.
    audio.fightStrike({ team: "player", attackName: "ZombieBite" });
    expect(MockSource.started).toHaveLength(1);
  });
});
