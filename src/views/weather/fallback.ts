import { getQueryDates, parseFrames } from "./time";
import type { TimeZone } from "./time";

export async function getFramesWithFallback(
  getFrames: (time: Date) => Promise<string[]>,
  timeZone: TimeZone,
  now: number,
): Promise<string[]> {
  const { currentDates, previousDate } = getQueryDates(new Date(now), timeZone);
  const results = await Promise.allSettled(currentDates.map(getFrames));
  const current = [...new Set(results.flatMap(result => result.status === "fulfilled" ? result.value : []))];
  if (parseFrames(current, timeZone).some(frame => frame.time <= now)) return current;

  try {
    return await getFrames(previousDate);
  } catch (error) {
    if (results.every(result => result.status === "rejected")) throw error;
    return current;
  }
}
