import { describe, expect, it } from "vitest";
import placeables from "../../public/assets/placeables.json";
import { objectEcon } from "../src/objectCatalog";

describe("fruit-tree balance", () => {
  const tree = (key: string) => placeables.find((entry) => entry.key === key);

  it("keeps the authored harvest values used by client and server", () => {
    expect(tree("oliveTreeOlive")).toMatchObject({ level: 5, harvestValue: 15 });
    expect(tree("fruitTreeLemon")).toMatchObject({ harvestValue: 35 });
    expect(tree("fruitTreeOrange")).toMatchObject({ harvestValue: 18 });
  });

  it("keeps the authoritative Olive Tree purchase level in sync", () => {
    expect(objectEcon("oliveTreeOlive")?.level).toBe(5);
  });
});
