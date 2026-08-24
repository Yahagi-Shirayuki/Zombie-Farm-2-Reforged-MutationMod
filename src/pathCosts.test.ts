import { describe, expect, it } from "vitest";
import placeables from "../public/assets/placeables.json";
import type { PlaceableDef } from "./assets";
import {
  COST_AVOID, COST_BARRIER, COST_GATE_CLOSED, COST_GATE_OPEN, COST_GROUND, COST_PATH,
  COST_POND, isFencePanel, isGate, objectWalkCost, wormholeSide,
} from "./pathCosts";

const catalog = placeables as PlaceableDef[];
const def = (key: string): PlaceableDef => {
  const row = catalog.find((entry) => entry.key === key);
  expect(row, `catalog lost ${key}`).toBeDefined();
  return row!;
};

describe("the terrain price list", () => {
  it("orders barriers above everything a walker would willingly cross", () => {
    // The ordering IS the design: a route prefers a path to grass, will wade a pond
    // rather than go a long way round, and only ever crosses a fence when there is
    // no alternative at all — through the gate, if the fence run has one.
    expect(COST_PATH).toBeLessThan(COST_GROUND);
    expect(COST_GROUND).toBeLessThan(COST_POND);
    expect(COST_POND).toBeLessThan(COST_AVOID);
    expect(COST_AVOID).toBeLessThan(COST_GATE_CLOSED);
    expect(COST_GATE_CLOSED).toBeLessThan(COST_BARRIER);
    // An open gate is just a doorway — no cheaper and no dearer than the gap.
    expect(COST_GATE_OPEN).toBe(COST_GROUND);
  });

  it("prices every fence, hedge and gate in the catalog", () => {
    // Gate keys carry "fence" too, so the classification order matters; this pins
    // the whole family rather than one representative of it.
    expect(objectWalkCost(def("pen_01"))).toBe(COST_BARRIER);
    expect(objectWalkCost(def("pen_01_black"))).toBe(COST_BARRIER);
    expect(objectWalkCost(def("hedge_01"))).toBe(COST_BARRIER);
    expect(objectWalkCost(def("snowHedge_01"))).toBe(COST_BARRIER);
    expect(objectWalkCost(def("heartHedge"))).toBe(COST_BARRIER);
    expect(objectWalkCost(def("barbWireFence_01"))).toBe(COST_BARRIER);
    expect(objectWalkCost(def("cemeteryFence_01"))).toBe(COST_BARRIER);
    expect(objectWalkCost(def("hazardFence"))).toBe(COST_BARRIER);
    expect(objectWalkCost(def("festiveFence"))).toBe(COST_BARRIER);

    expect(objectWalkCost(def("fenceGate_01_closed"))).toBe(COST_GATE_CLOSED);
    expect(objectWalkCost(def("ironGate_01_closed_pink"))).toBe(COST_GATE_CLOSED);
    expect(objectWalkCost(def("fenceGate_01_open"))).toBe(COST_GATE_OPEN);
    expect(objectWalkCost(def("ironGate_01_open"))).toBe(COST_GATE_OPEN);
  });

  it("prices paths, ponds and the zombie patch as ground you can be on", () => {
    expect(objectWalkCost(def("roadStraight"))).toBe(COST_PATH);
    expect(objectWalkCost(def("cobblestoneRoadIntersection"))).toBe(COST_PATH);
    expect(objectWalkCost(def("pond1"))).toBe(COST_POND);
    expect(objectWalkCost(def("koiPond"))).toBe(COST_POND);
    expect(objectWalkCost(def("soil_zombiePatch"))).toBe(COST_GROUND);
  });

  it("leaves ordinary objects solid", () => {
    expect(objectWalkCost(def("mausoleum3"))).toBe(Infinity);
    expect(objectWalkCost(def("zombieCombiner"))).toBe(Infinity);
    // A key with "worm" in it is not a wormhole.
    expect(objectWalkCost(def("squirmyWorms"))).toBe(Infinity);
    expect(wormholeSide(def("squirmyWorms"))).toBeNull();
  });

  it("knows both halves of a wormhole pair, and that they are stood on", () => {
    expect(wormholeSide(def("spaceWormHoleA"))).toBe("A");
    expect(wormholeSide(def("spaceWormHoleB"))).toBe("B");
    expect(objectWalkCost(def("spaceWormHoleA"))).toBe(COST_GROUND);
    expect(objectWalkCost(def("spaceWormHoleB"))).toBe(COST_GROUND);
  });

  it("counts gates, and only gates, as the hole in a fence run", () => {
    // Field.tileCost hangs the fence-overhang exemption off this, so a fence
    // wrongly answering yes would open a hole in every run.
    const gates = catalog.filter((d) => isGate(d)).map((d) => d.key);
    expect(gates.length).toBeGreaterThan(0);
    for (const key of gates) expect(key).toMatch(/Gate/);
    expect(isGate(def("pen_01"))).toBe(false);
    expect(isGate(def("hedge_01"))).toBe(false);
  });

  it("gives the overhang to every one-tile barrier, and only those", () => {
    // The whole point of deriving the set: a fence that blocks one tile while drawing
    // a two-tile rail leaks, and the leak is invisible because the run still LOOKS
    // solid. Listing the keys by hand shipped exactly that — four families were named
    // and their six colour variants, identical art, were not. This pins the answer
    // against the real catalog so the next Teal Fence cannot arrive quietly.
    const panels = catalog.filter((d) => isFencePanel(d)).map((d) => d.key).sort();
    expect(panels).toEqual([
      "barbWireFence_01",
      "cemeteryFence_01", "cemeteryFence_01_pink",
      "hazardFence",
      "pen_01", "pen_01_black", "pen_01_blue", "pen_01_pink", "pen_01_red",
      "xmasFence",
    ]);

    // A multi-tile barrier already owns every tile it is drawn across, so bridging it
    // into a further one would be a phantom wall beside the fence, not a seal.
    for (const key of ["hedge_01", "snowHedge_01", "heartHedge", "festiveFence"]) {
      expect(objectWalkCost(def(key)), key).toBe(COST_BARRIER);
      expect(isFencePanel(def(key)), key).toBe(false);
    }
    // And nothing a walker is meant to cross ever gets one, however small it is.
    for (const key of ["roadStraight", "soil_zombiePatch", "fenceGate_01_open"]) {
      expect(isFencePanel(def(key)), key).toBe(false);
    }
  });

  it("never prices a tile below the pathfinder's cheapest step", () => {
    // pathfind scales its heuristic by COST_PATH, which is only admissible while
    // nothing in the catalog undercuts it.
    for (const d of catalog) expect(objectWalkCost(d)).toBeGreaterThanOrEqual(COST_PATH);
  });
});
