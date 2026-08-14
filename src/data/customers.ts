/**
 * The regulars. Each has a portrait variant and a buying personality that shapes
 * what they ask for and how hard they haggle.
 *
 * `generosity` scales the opening offer (1.0 = pays list price).
 * `flexibility` scales how far above that offer they can still be pushed.
 * `basketSize` biases how much they want in one visit.
 */

import type { GoodId } from "./items.ts";

export interface CustomerProfile {
  name: string;
  portrait: number;
  generosity: number;
  flexibility: number;
  basketSize: "small" | "medium" | "large";
  /** Goods this customer disproportionately asks for. */
  favours: readonly GoodId[];
  blurb: string;
}

export const CUSTOMER_PROFILES: readonly CustomerProfile[] = [
  {
    name: "Marta",
    portrait: 0,
    generosity: 1.0,
    flexibility: 1.0,
    basketSize: "medium",
    favours: ["tomato", "lettuce"],
    blurb: "Runs the inn. Buys steadily and remembers who treated her well.",
  },
  {
    name: "Old Bram",
    portrait: 1,
    generosity: 0.85,
    flexibility: 0.7,
    basketSize: "large",
    favours: ["corn", "pumpkin"],
    blurb: "Buys in bulk and expects a bulk price. Will absolutely walk.",
  },
  {
    name: "Sunni",
    portrait: 2,
    generosity: 1.2,
    flexibility: 1.3,
    basketSize: "small",
    favours: ["strawberry", "egg"],
    blurb: "Bakes for the whole valley and never quibbles over a few coins.",
  },
  {
    name: "Odgen",
    portrait: 3,
    generosity: 0.95,
    flexibility: 0.9,
    basketSize: "medium",
    favours: ["milk", "egg"],
    blurb: "Makes cheese. Comes for milk, leaves with whatever looks good.",
  },
  {
    name: "Fen",
    portrait: 4,
    generosity: 1.1,
    flexibility: 1.15,
    basketSize: "small",
    favours: ["radish", "lettuce"],
    blurb: "Packs a lunch every day and likes it crisp.",
  },
  {
    name: "Hollis",
    portrait: 5,
    generosity: 0.9,
    flexibility: 1.25,
    basketSize: "large",
    favours: ["pumpkin", "corn"],
    blurb: "Opens low, but can be talked round if you are patient.",
  },
  {
    name: "Perrin",
    portrait: 6,
    generosity: 1.05,
    flexibility: 0.8,
    basketSize: "medium",
    favours: ["tomato", "strawberry"],
    blurb: "Fair opener, firm ceiling. Ask once and take the deal.",
  },
  {
    name: "Wilhelmina",
    portrait: 7,
    generosity: 1.3,
    flexibility: 1.2,
    basketSize: "small",
    favours: ["strawberry", "milk"],
    blurb: "Buys the prettiest thing on the stand and pays happily.",
  },
  {
    name: "Toft",
    portrait: 8,
    generosity: 0.8,
    flexibility: 0.75,
    basketSize: "medium",
    favours: ["radish", "corn"],
    blurb: "Counts his coppers twice. A sale to Toft is a sale earned.",
  },
  {
    name: "Nessa",
    portrait: 9,
    generosity: 1.15,
    flexibility: 1.1,
    basketSize: "large",
    favours: ["egg", "tomato"],
    blurb: "Cooks for a crowd every weekend and buys accordingly.",
  },
  {
    name: "Rooke",
    portrait: 10,
    generosity: 1.0,
    flexibility: 1.4,
    basketSize: "small",
    favours: ["pumpkin", "strawberry"],
    blurb: "A collector of unusual produce. Money is not really the point.",
  },
  {
    name: "Della",
    portrait: 11,
    generosity: 0.92,
    flexibility: 0.95,
    basketSize: "medium",
    favours: ["lettuce", "milk"],
    blurb: "Sensible, punctual, and slightly disappointed by an empty stand.",
  },
];

export const CUSTOMER_PORTRAIT_COUNT = CUSTOMER_PROFILES.length;

/** How many distinct goods, and how many units, each basket size asks for. */
export const BASKET_SHAPES = {
  small: { lines: [1, 1], perLine: [1, 2] },
  medium: { lines: [1, 2], perLine: [1, 3] },
  large: { lines: [2, 3], perLine: [2, 4] },
} as const satisfies Record<
  CustomerProfile["basketSize"],
  { lines: readonly [number, number]; perLine: readonly [number, number] }
>;
