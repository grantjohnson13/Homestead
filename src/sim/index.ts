/**
 * Public surface of the simulation engine.
 *
 * Everything below this line is pure: no I/O, no wall-clock reads, no
 * randomness that isn't seeded from the state. Tools and the Durable Object
 * import from here and nowhere deeper.
 */

export * from "./types.ts";
export * from "./constants.ts";
export { createFarm, addAnimal, animalCapacityLeft, countItem, addItem, takeItem, hasItems, logEvent, eventsSince, findPlot, findAnimal, nextId, WATER_CAN_CAPACITY, DEFAULT_WREN_NAME } from "./farm.ts";
export { advance, catchUp, msUntilNextTick, type CatchUpResult } from "./tick.ts";
export { tickPlots, waterPlot, isHarvestable, plotStage, plotProgressFraction, harvestPlot } from "./crops.ts";
export { tickAnimals, isFed, feedAnimal, petAnimal, moodLabel, minutesToProduce } from "./livestock.ts";
export {
  tickCustomers,
  spawnCustomer,
  sellToCustomer,
  findCustomer,
  removeCustomer,
  patienceRemaining,
  fulfillment,
  adjustReputation,
  arrivalIntervalMean,
  toleranceMultiplier,
  type SaleOutcome,
} from "./market.ts";
export { tickWren, wrenLine, standTotal, CARRY_CAPACITY } from "./wren.ts";
export {
  validateBatch,
  compileLegs,
  normalizePlotId,
  TASK_TYPES,
  ANIMAL_GROUPS,
  isAnimalGroup,
  type TaskInput,
  type TaskVerdict,
} from "./tasks.ts";
export { buySupplies, quote, type PurchaseOutcome } from "./economy.ts";
export { findPath, manhattan, facingFor } from "./pathfind.ts";
export { rand, randInt, chance, pick, poissonInterval, makeSeed } from "./rng.ts";
