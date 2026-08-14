/**
 * get_almanac — static reference data.
 *
 * Written for an LLM reader: everything Claude needs to answer "what should I
 * plant?", "is a cow worth it?", or "why isn't my corn growing?" without making
 * another tool call or guessing at numbers.
 */

import { ANIMALS, MOOD_BANDS, type AnimalKind } from "../data/animals.ts";
import { CROPS, CROP_IDS } from "../data/crops.ts";
import { FEED_BULK_PRICE, FEED_BULK_SIZE, FEED_UNIT_PRICE, SHOP_ITEMS } from "../data/shop.ts";
import { MAP_HEIGHT, MAP_WIDTH, PLOT_IDS } from "../data/map.ts";
import { STAMINA } from "../sim/constants.ts";

export interface AlmanacCropRow {
  crop: string;
  seedCost: number;
  growMinutes: number;
  waterings: number;
  sellPrice: number;
  yieldPerHarvest: string;
  harvests: number;
  /** Gold earned per seed across the plant's whole life, minus the seed. */
  netProfitPerSeed: number;
  /** Net profit divided by grow minutes — the "is it worth the plot?" number. */
  goldPerMinute: number;
  blurb: string;
}

function cropRows(): AlmanacCropRow[] {
  return CROP_IDS.map((id) => {
    const c = CROPS[id];
    const avgYield = (c.yield[0] + c.yield[1]) / 2;
    const totalUnits = avgYield * c.harvests;
    const revenue = totalUnits * c.sellPrice;
    const net = revenue - c.seedCost;
    // Regrows cost extra time but not extra seed.
    const totalMinutes = c.growMinutes * (1 + (c.harvests - 1) * c.regrowFraction);
    return {
      crop: c.name,
      seedCost: c.seedCost,
      growMinutes: c.growMinutes,
      waterings: c.waterNeeds,
      sellPrice: c.sellPrice,
      yieldPerHarvest: c.yield[0] === c.yield[1] ? `${c.yield[0]}` : `${c.yield[0]}-${c.yield[1]}`,
      harvests: c.harvests,
      netProfitPerSeed: Math.round(net),
      goldPerMinute: Math.round((net / totalMinutes) * 100) / 100,
      blurb: c.blurb,
    };
  });
}

function animalRows() {
  return (Object.keys(ANIMALS) as AnimalKind[]).map((kind) => {
    const a = ANIMALS[kind];
    return {
      animal: a.name,
      cost: a.cost,
      produces: a.produces,
      everyMinutes: a.produceEveryMinutes,
      housing: a.capacity,
      feedPerServing: a.feedPerServing,
      feedLastsMinutes: a.feedLastsMinutes,
      blurb: a.blurb,
    };
  });
}

export const MECHANICS = {
  time: "1 real second = 1 game-minute. The world keeps ticking between your messages, so crops finish and customers arrive while you talk.",
  growth:
    "A crop needs its full grow time in *watered* minutes. Each watering tops the plot's moisture up to one segment (grow time / waterings). When moisture runs out, growth stalls until someone waters again. Crops never die from neglect — they just wait.",
  plots: `The field has ${PLOT_IDS.length} plots (plot_1..plot_${PLOT_IDS.length}) on a ${MAP_WIDTH}x${MAP_HEIGHT} farm. A plot must be tilled before planting. Harvesting a single-harvest crop returns the plot to tilled; multi-harvest crops regrow in place until their last harvest.`,
  water:
    "Watering is a Wren task. She walks to the well only if she is out of water; assume watering a plot costs a couple of minutes.",
  animals: `Animals produce only while fed. Feeding costs feed from your inventory and lasts ${ANIMALS.chicken.feedLastsMinutes} game-minutes. Unfed animals stop producing and their mood slides: ${MOOD_BANDS.map((b) => b.mood).join(" -> ")}. A grumpy animal sometimes skips a production cycle entirely. Feeding and petting restore mood. Animals never die.`,
  wren: `Wren works one task at a time from a FIFO queue, walking there first. She has ${STAMINA.max} stamina; tasks drain it and she recovers by idling at the farmhouse. Below ${STAMINA.refuseBelow} she refuses new work until she has rested back to ${STAMINA.resumeAt}.`,
  standingOrders:
    "By default Wren runs the farm herself: whenever her queue is empty she plans her own next jobs — harvest, collect, restock, feed and cheer the animals, water anything stalled, sow empty beds, then break new ground. Tasks you assign always come first. set_standing_orders changes what she sows, whether she may spend, and the gold reserve she will never dip below.",
  selling:
    "Customers buy from the FARM STAND, not from barn storage. Harvested goods land in the barn, so queue a 'restock' task to carry them out front. Nobody needs to be standing at the counter: the stand sells itself.",
  pricing:
    "You set a price per good with set_prices; it applies to everyone and keeps working between conversations. Each customer arrives with a private ceiling for their basket and buys on their own the moment your price is at or under it and the goods are in stock. Price high for margin and watch people walk; price low to move volume.",
  learningPrices:
    "Anyone who leaves over price is recorded in the lost-sales log along with what they WOULD have paid. That is how you find the ceiling — bump into it, then read the log and adjust. get_farm_state and list_waiting_customers both return it.",
  reputation:
    "Reputation runs 0-100 and starts at 50. Sales raise it. Losing someone because the shelf was empty costs more than losing them over a high price — charging a premium is a strategy, having nothing to sell is a failure. Higher reputation means customers arrive more often AND will pay more, so it raises your price ceiling.",
} as const;

export interface AlmanacPayload {
  crops: AlmanacCropRow[];
  animals: ReturnType<typeof animalRows>;
  shop: { id: string; name: string; price: number; description: string }[];
  feedPricing: { unitPrice: number; bulkSize: number; bulkPrice: number };
  mechanics: typeof MECHANICS;
}

export function buildAlmanac(): AlmanacPayload {
  return {
    crops: cropRows(),
    animals: animalRows(),
    shop: SHOP_ITEMS.map((i) => ({
      id: i.id,
      name: i.name,
      price: i.unitPrice,
      description: i.description,
    })),
    feedPricing: {
      unitPrice: FEED_UNIT_PRICE,
      bulkSize: FEED_BULK_SIZE,
      bulkPrice: FEED_BULK_PRICE,
    },
    mechanics: MECHANICS,
  };
}

/** A compact text rendering, so the almanac is useful even without the JSON. */
export function almanacText(payload: AlmanacPayload): string {
  const lines: string[] = ["HOMESTEAD ALMANAC", "", "CROPS (sorted by gold per minute)"];
  const sorted = [...payload.crops].sort((a, b) => b.goldPerMinute - a.goldPerMinute);
  for (const c of sorted) {
    lines.push(
      `  ${c.crop}: seed ${c.seedCost}g, ${c.growMinutes}min, ${c.waterings} watering(s), ` +
        `yields ${c.yieldPerHarvest} x${c.harvests} at ${c.sellPrice}g -> ~${c.netProfitPerSeed}g net (${c.goldPerMinute}g/min). ${c.blurb}`,
    );
  }
  lines.push("", "ANIMALS");
  for (const a of payload.animals) {
    lines.push(
      `  ${a.animal}: ${a.cost}g, produces 1 ${a.produces} per ${a.everyMinutes}min while fed, housing for ${a.housing}. ${a.blurb}`,
    );
  }
  lines.push("", "SHOP");
  for (const s of payload.shop) {
    lines.push(`  ${s.id} — ${s.name}, ${s.price}g. ${s.description}`);
  }
  lines.push(
    `  (feed: ${payload.feedPricing.bulkSize} for ${payload.feedPricing.bulkPrice}g in bulk)`,
  );
  lines.push("", "HOW IT WORKS");
  for (const [key, value] of Object.entries(payload.mechanics)) {
    lines.push(`  ${key}: ${value}`);
  }
  return lines.join("\n");
}
