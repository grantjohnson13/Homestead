/**
 * Wren's voice. A fixed pool of pre-written lines, tagged by context and drawn
 * deterministically from the farm's RNG — the server never calls an LLM.
 *
 * Keep them short, warm, and a little dry. Wren likes the work and likes the
 * boss, but she is not a pushover.
 */

export type WrenContext =
  | "assigned"
  | "queueCleared"
  | "harvest"
  | "planted"
  | "watered"
  | "tired"
  | "rested"
  | "animals"
  | "sale"
  | "customerLeft"
  | "idle"
  | "broke"
  | "milestone";

export const WREN_LINES: Record<WrenContext, readonly string[]> = {
  assigned: [
    "\"On it, boss.\"",
    "\"Consider it done — well, consider it started.\"",
    "\"Right. Boots on.\"",
    "\"I'll work top to bottom, same as always.\"",
    "\"Good a plan as any. Off I go.\"",
  ],
  queueCleared: [
    "\"Wiping the slate. What are we doing instead?\"",
    "\"Dropped it all. Say the word.\"",
    "\"Fine by me — that list was getting ambitious.\"",
  ],
  harvest: [
    "\"Look at that. Worth every bucket.\"",
    "\"That's the good stuff. Straight to the barn.\"",
    "\"Heavier than it looks, this basket.\"",
    "\"I do love a full crate.\"",
  ],
  planted: [
    "\"In the ground. Now we wait and water.\"",
    "\"Tucked in. Don't let me forget to water these.\"",
    "\"Seeds down. The rest is up to the weather and us.\"",
  ],
  watered: [
    "\"Watered. They'll perk up within the hour.\"",
    "\"Can's getting light — I'll swing by the well.\"",
    "\"That'll hold them for a while.\"",
  ],
  tired: [
    "\"Boss, I need ten minutes.\"",
    "\"I've got nothing left in the legs. Ten minutes.\"",
    "\"Wren wipes her brow — 'Give me a moment and I'm yours.'\"",
    "\"I'd rather rest now than drop a crate later.\"",
  ],
  rested: [
    "\"Right — much better. What's next?\"",
    "\"Back on my feet. Point me somewhere.\"",
    "\"That did it. Ready when you are.\"",
  ],
  animals: [
    "\"They were pleased to see me. Or pleased to see the bucket.\"",
    "\"Fed and watered and thoroughly unbothered.\"",
    "\"The hens have opinions. I let them have them.\"",
    "\"That one likes having her ears scratched.\"",
  ],
  sale: [
    "\"Sold. That's the seed money back and then some.\"",
    "\"Coin in the tin. Good morning's work.\"",
    "\"They'll be back — they always come back for the good stuff.\"",
  ],
  customerLeft: [
    "\"They waited as long as they could, boss.\"",
    "\"Empty stand, empty hands. Next time we'll be ready.\"",
    "\"That one walked. Word gets round, you know.\"",
  ],
  idle: [
    "\"Nothing on the list. I'll be by the house.\"",
    "\"All caught up. Feels strange.\"",
    "\"I'll tidy the yard until you need me.\"",
  ],
  broke: [
    "\"Tin's empty, boss. Best sell something first.\"",
    "\"We can't buy what we can't pay for.\"",
    "\"Short by a bit. Anything ready to harvest?\"",
  ],
  milestone: [
    "\"Best farm in the valley. Told you.\"",
    "\"People are talking about us. The good kind of talking.\"",
    "\"Not bad for a place that started with four radish seeds.\"",
  ],
};

/** Total line count, asserted by the balance test (the brief asks for ~40). */
export const WREN_LINE_COUNT = Object.values(WREN_LINES).reduce(
  (total, lines) => total + lines.length,
  0,
);
