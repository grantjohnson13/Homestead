/**
 * The supply shop. Fixed prices, instant delivery, no Wren task required —
 * v1 keeps buying friction at zero so the player spends their attention on the
 * farm rather than on logistics.
 */

import { ANIMALS, type AnimalKind } from "./animals.ts";
import { CROPS, CROP_IDS, type CropId } from "./crops.ts";

export type ShopItemKind = "seed" | "feed" | "animal";

export interface ShopItem {
  /** The id you pass to buy_supplies. */
  id: string;
  kind: ShopItemKind;
  name: string;
  unitPrice: number;
  description: string;
  /** For seeds: the crop it grows. For animals: the kind purchased. */
  crop?: CropId;
  animal?: AnimalKind;
}

/** Feed is sold in bulk; one unit feeds one chicken once. */
export const FEED_UNIT_PRICE = 4;
export const FEED_BULK_SIZE = 10;
export const FEED_BULK_PRICE = 35;

function seedItems(): ShopItem[] {
  return CROP_IDS.map((id) => {
    const crop = CROPS[id];
    return {
      id: `${id}_seed`,
      kind: "seed" as const,
      name: `${crop.name} seed`,
      unitPrice: crop.seedCost,
      crop: id,
      description: `Grows in ${crop.growMinutes} watered minutes over ${crop.waterNeeds} watering(s). Sells for ${crop.sellPrice}g per unit.`,
    };
  });
}

function animalItems(): ShopItem[] {
  return (Object.keys(ANIMALS) as AnimalKind[]).map((kind) => {
    const def = ANIMALS[kind];
    return {
      id: kind,
      kind: "animal" as const,
      name: def.name,
      unitPrice: def.cost,
      animal: kind,
      description: `${def.blurb} Farm can house ${def.capacity}.`,
    };
  });
}

export const SHOP_ITEMS: readonly ShopItem[] = [
  ...seedItems(),
  {
    id: "feed",
    kind: "feed",
    name: "Animal feed",
    unitPrice: FEED_UNIT_PRICE,
    description: `Feeds one chicken once (a cow eats ${ANIMALS.cow.feedPerServing}). Buy ${FEED_BULK_SIZE} for ${FEED_BULK_PRICE}g and save.`,
  },
  ...animalItems(),
];

export function shopItem(id: string): ShopItem | undefined {
  return SHOP_ITEMS.find((item) => item.id === id);
}

/** Bulk discount: every full lot of FEED_BULK_SIZE feed costs FEED_BULK_PRICE. */
export function feedPrice(qty: number): number {
  const lots = Math.floor(qty / FEED_BULK_SIZE);
  const remainder = qty % FEED_BULK_SIZE;
  return lots * FEED_BULK_PRICE + remainder * FEED_UNIT_PRICE;
}

export function priceFor(item: ShopItem, qty: number): number {
  if (item.kind === "feed") return feedPrice(qty);
  return item.unitPrice * qty;
}
