export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomAmount(min, max) {
  return (Math.random() * (max - min) + min).toFixed(2);
}

export function pick(list) {
  return list[randomInt(0, list.length - 1)];
}

/** Picks `count` distinct indices from [0, poolSize) — used to pick a
 * narration/caption template variant without repeating one within the
 * same day's plan. */
export function pickDistinct(poolSize, count) {
  const indices = new Set();
  const upper = Math.max(poolSize - 1, 0);
  while (indices.size < Math.min(count, poolSize)) {
    indices.add(randomInt(0, upper));
  }
  return [...indices];
}
