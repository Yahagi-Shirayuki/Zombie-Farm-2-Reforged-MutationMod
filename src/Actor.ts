// A modular skeletal actor (the farmer). Parts are assembled from the rig layout
// (offset/pivot/z per part) and animated PROCEDURALLY — rotation + a walk bob, plus
// a "work" animation (hoeing) used for tilling / planting / harvesting.
//
// GROUND TRUTH: `-[PlayerActor startAnimForState:]` drives the farmer entirely with
// armWalkFront/BackRotatePlayer, footWalkFrontRotatePlayer, bodyWalkMove and
// headWalkRotate — it never swaps an arm TEXTURE. Each body owns exactly two arm
// images (PlayerDictionary's kActorPartTagArmB/ArmF); male_arm3/4 and female_arm3/4
// are BODY 2's arms, not a second pose of body 1. Swapping to them mid-walk is what
// made Female Body 1 grow Female Body 2's (darker) sleeves on every other step.
//
// Coordinate conversion, rig (cocos2d, Y-up) -> Pixi (Y-down):
//   position: (offsetX, -offsetY)      offsetY is height above the feet origin
//   anchor:   (pivotX, 1 - pivotY)     cocos anchorY is bottom-up
// The container origin (0,0) is the character's ground point; we place that on a
// tile center. sortableChildren + zIndex reproduce the game's part layering.
import { Container, Sprite } from "pixi.js";
import { GameAssets } from "./assets";

const STEP_PERIOD = 0.26; // seconds per arm-swing half-cycle while walking
const ARM_SWING = 0.5; // radians the arms rock fore/aft while walking
const LEG_SWING = 0.32; // radians the legs rock while walking
const WORK_SPEED = 8.5; // hoe-chop angular speed while working
const LANTERN_HAND_DX = -5;
const LANTERN_HAND_DY = 8;
// Tap box around the standing farmer, measured up from his feet at (0,0). The art is
// ~95px tall natively (see the sizing notes in docs/) and roughly half that wide.
const ACTOR_HIT_HALF_W = 26;
const ACTOR_HIT_H = 92;

export class Actor {
  readonly container = new Container();
  private body!: Sprite;
  private head!: Sprite;
  private backArm!: Sprite;
  private frontArm!: Sprite;
  private bootBack!: Sprite;
  private bootFront!: Sprite;
  private lantern!: Sprite;
  private plough!: Sprite;

  private bodyBaseY = 0;
  private headBaseY = 0;
  private bootBackBaseY = 0;
  private bootFrontBaseY = 0;
  private ploughBaseX = 0;
  private ploughBaseY = 0;

  private moving = false;
  private working = false;
  private lanternEnabled = false;
  private workSpeed = 1; // multiplier on the hoe-chop rate (2 = twice as fast)
  private facing = 1; // +1 right, -1 left
  private phase = 0; // walk clock
  private workPhase = 0; // work clock

  constructor(private assets: GameAssets) {
    this.container.sortableChildren = true;
    // ZF2 renders no ground shadow for characters (verified in the binary — actors
    // are just body-part attachments); the farmer casts none, matching the original.
    this.backArm = this.part("male_arm1.png");
    this.frontArm = this.part("male_arm2.png");
    this.body = this.part("malebody1.png");
    this.bootBack = this.part("boot_back.png");
    this.bootFront = this.part("boot_front.png");
    this.head = this.part("malehead1.png");
    // The source lantern asset has no useful attachment transform in the rig.
    // Hang a reduced copy from the farmer's opposite hand and render it over the
    // hand, matching the original game's bold, readable attachment layering.
    this.lantern = new Sprite(this.assets.player["lamp.png"]);
    this.lantern.anchor.set(0.5, 0);
    this.lantern.scale.set(0.65);
    this.lantern.zIndex = 8;
    this.lantern.visible = false;
    this.container.addChild(this.lantern);
    this.positionLanternOnHand();
    // The hoe sits in the front hand (z between body and front arm), hidden until
    // the farmer works a plot.
    this.plough = this.part("plough.png");
    this.plough.position.set(15, -22);
    this.plough.zIndex = 5;
    this.plough.visible = false;

    this.bodyBaseY = this.body.y;
    this.headBaseY = this.head.y;
    this.bootBackBaseY = this.bootBack.y;
    this.bootFrontBaseY = this.bootFront.y;
    this.ploughBaseX = this.plough.x;
    this.ploughBaseY = this.plough.y;
    const defaultHead = this.assets.farmer.heads.find((head) => head.part === "malehead1.png") ?? this.assets.farmer.heads[0];
    const defaultBody = this.assets.farmer.bodies.find((body) => body.id === defaultHead.bodyId) ?? this.assets.farmer.bodies[0];
    this.setAppearance(defaultHead.part, defaultBody.id);
  }

  private part(file: string): Sprite {
    const layout = this.assets.rig[file];
    const sp = new Sprite(this.assets.player[file]);
    sp.anchor.set(layout.pivotX, 1 - layout.pivotY);
    sp.position.set(layout.offsetX, -layout.offsetY);
    sp.zIndex = layout.z;
    this.container.addChild(sp);
    return sp;
  }

  private setPart(sp: Sprite, file: string) {
    const layout = this.assets.rig[file];
    sp.texture = this.assets.player[file];
    sp.anchor.set(layout.pivotX, 1 - layout.pivotY);
    sp.position.set(layout.offsetX, -layout.offsetY);
    sp.zIndex = layout.z;
  }

  /** Swap the modular head and body/arm set without disturbing movement state. */
  setAppearance(headPart: string, bodyId: number) {
    const body = this.assets.farmer.bodies.find((candidate) => candidate.id === bodyId);
    if (!body || !this.assets.player[headPart]) return;
    this.setPart(this.head, headPart);
    this.setPart(this.body, body.body);
    this.setPart(this.backArm, body.arm1);
    this.setPart(this.frontArm, body.arm2);
    this.bodyBaseY = this.body.y;
    this.headBaseY = this.head.y;
    this.resetPose();
  }

  setMoving(m: boolean) {
    if (m) this.working = false;
    this.moving = m;
    this.updateLanternVisibility();
    if (!m) this.resetPose();
  }

  /** The carried lantern is visible at night except while both hands use the hoe. */
  setLanternVisible(visible: boolean) {
    this.lanternEnabled = visible;
    this.updateLanternVisibility();
  }

  private updateLanternVisibility() {
    this.lantern.visible = this.lanternEnabled && !this.working;
  }

  /** Follow the animated back-arm hand while letting the lantern hang naturally. */
  private positionLanternOnHand() {
    const rotation = this.backArm.rotation;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    this.lantern.position.set(
      this.backArm.x + LANTERN_HAND_DX * cos - LANTERN_HAND_DY * sin,
      this.backArm.y + LANTERN_HAND_DX * sin + LANTERN_HAND_DY * cos,
    );
    this.lantern.rotation = rotation * 0.35;
  }

  /** Is this world-space point on the farmer?
   *
   *  A box around the standing figure rather than the sprite's own bounds: the parts
   *  swing as he walks and hoes, and a hit box that breathed with the animation would
   *  make him harder to tap the moment he is doing anything. Matched to ZombieUnit's
   *  `containsPoint` — measured up from the feet, with a little slack below them. */
  containsPoint(wx: number, wy: number): boolean {
    const dx = wx - this.container.x;
    const dy = wy - this.container.y;
    return dx >= -ACTOR_HIT_HALF_W && dx <= ACTOR_HIT_HALF_W && dy <= 6 && dy >= -ACTOR_HIT_H;
  }

  /** World-space center of the lantern, used to center its night-light bubble. */
  lanternWorldPosition() {
    return {
      x: this.container.x + this.lantern.x * this.facing,
      y: this.container.y + this.lantern.y + this.lantern.height * 0.5,
    };
  }

  // Enter/leave the hoeing animation (used at the end of a walk-to-plot job).
  // `speed` scales the chop rate (2 = twice as fast, for fruit-tree harvesting).
  setWorking(w: boolean, speed = 1) {
    if (w) this.moving = false;
    this.working = w;
    this.workSpeed = speed;
    this.workPhase = 0;
    this.plough.visible = w;
    this.updateLanternVisibility();
    if (!w) this.resetPose();
  }

  // Face toward a world-space movement delta (dx from iso projection).
  // The source art faces LEFT at scale.x = +1, so moving right (dx > 0) must
  // mirror it (scale.x = -1) to face right.
  setFacingFromDelta(dx: number) {
    if (dx > 0.01) this.facing = -1;
    else if (dx < -0.01) this.facing = 1;
    this.container.scale.x = this.facing;
  }

  private resetPose() {
    this.body.y = this.bodyBaseY;
    this.body.rotation = 0;
    this.head.y = this.headBaseY;
    this.head.rotation = 0;
    this.backArm.rotation = 0;
    this.frontArm.rotation = 0;
    this.bootBack.y = this.bootBackBaseY;
    this.bootBack.rotation = 0;
    this.bootFront.y = this.bootFrontBaseY;
    this.bootFront.rotation = 0;
    this.positionLanternOnHand();
    this.plough.position.set(this.ploughBaseX, this.ploughBaseY);
    this.plough.rotation = 0;
  }

  update(dt: number) {
    if (this.working) return this.workAnim(dt);
    if (this.moving) return this.walkAnim(dt);
  }

  private walkAnim(dt: number) {
    this.phase += dt;
    // A continuous fore/aft swing on arms and legs (the "rotaty" motion) — the body
    // keeps its own two arm images throughout, exactly as the source rig does.
    const t = (this.phase / STEP_PERIOD) * Math.PI;
    const swing = Math.sin(t);
    const bob = swing * 1.5;
    this.body.y = this.bodyBaseY - Math.abs(bob);
    this.head.y = this.headBaseY - Math.abs(bob);
    this.backArm.rotation = swing * ARM_SWING;
    this.frontArm.rotation = -swing * ARM_SWING;
    // Legs counter-swing + lift on the forward stroke.
    this.bootBack.rotation = -swing * LEG_SWING;
    this.bootFront.rotation = swing * LEG_SWING;
    this.bootBack.y = this.bootBackBaseY - Math.max(0, bob);
    this.bootFront.y = this.bootFrontBaseY - Math.max(0, -bob);
    this.positionLanternOnHand();
  }

  // Hoeing: head tilted forward, BOTH arms held out FORWARD roughly parallel to the
  // ground (~4 degrees below horizontal), gripping the hoe which hangs from the
  // hands and only bobs a little. Same cycle for till / plant / harvest.
  private workAnim(dt: number) {
    this.workPhase += dt;
    const chop = Math.sin(this.workPhase * WORK_SPEED * this.workSpeed); // -1..1
    // Head leans forward (toward the facing/work direction; negative = toward the
    // art's front, which the container scale mirrors correctly) with a slight nod.
    this.head.rotation = -0.18 - Math.abs(chop) * 0.04;
    this.head.y = this.headBaseY + 1;
    // Both arms reach forward, ~parallel to the ground (rest pose points down, so
    // +pi/2 swings them to horizontal-forward; 1.5 rad leaves them ~4deg below).
    const arm = 1.5 + chop * 0.05;
    this.frontArm.rotation = arm;
    this.backArm.rotation = arm;
    // Hoe gripped between the two forward hands (~x -17..-35), angled down to the
    // dirt ahead; small movement only.
    this.plough.x = -22;
    this.plough.y = -8 + Math.max(0, chop) * 1.5;
    this.plough.rotation = 0.28 - chop * 0.1;
    // Body bobs a touch so he "moves a bit".
    this.body.rotation = chop * 0.02;
    this.body.y = this.bodyBaseY + Math.abs(chop) * 1.2;
  }
}
