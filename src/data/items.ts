/**
 * Goods — anything that can sit in barn storage, be carried to the stand, and be
 * sold to a customer. Seeds and feed are supplies, not goods: they are consumed,
 * never sold.
 */

import { CROPS, CROP_IDS, type CropId } from "./crops.ts";

export const ANIMAL_GOOD_IDS = ["egg", "milk"] as const;
export type AnimalGoodId = (typeof ANIMAL_GOOD_IDS)[number];

export type GoodId = CropId | AnimalGoodId;

export const GOOD_IDS: readonly GoodId[] = [...CROP_IDS, ...ANIMAL_GOOD_IDS];

export interface GoodDef {
  id: GoodId;
  name: string;
  /** Plural form, for narration ("3 eggs"). */
  plural: string;
  /** Reference price one unit fetches before customer/reputation modifiers. */
  basePrice: number;
}

const ANIMAL_GOODS: Record<AnimalGoodId, GoodDef> = {
  egg: { id: "egg", name: "Egg", plural: "eggs", basePrice: 20 },
  milk: { id: "milk", name: "Milk", plural: "milk", basePrice: 45 },
};

export const GOODS: Record<GoodId, GoodDef> = {
  ...(Object.fromEntries(
    CROP_IDS.map((id) => [
      id,
      {
        id,
        name: CROPS[id].name,
        plural: `${CROPS[id].name.toLowerCase()}s`,
        basePrice: CROPS[id].sellPrice,
      } satisfies GoodDef,
    ]),
  ) as Record<CropId, GoodDef>),
  ...ANIMAL_GOODS,
};

export function isGoodId(value: string): value is GoodId {
  return (GOOD_IDS as readonly string[]).includes(value);
}

/** "3 eggs", "1 pumpkin" — used throughout narration and the events ticker. */
export function describeGood(id: GoodId, qty: number): string {
  const def = GOODS[id];
  return `${qty} ${qty === 1 ? def.name.toLowerCase() : def.plural}`;
}

/** Seeds and feed: the consumable side of the inventory. */
export type SeedId = `${CropId}_seed`;

export function seedIdFor(crop: CropId): SeedId {
  return `${crop}_seed`;
}

export function cropForSeedId(seedId: string): CropId | undefined {
  const base = seedId.endsWith("_seed") ? seedId.slice(0, -"_seed".length) : seedId;
  return (CROP_IDS as readonly string[]).includes(base) ? (base as CropId) : undefined;
}

export const FEED_ITEM_ID = "feed";
