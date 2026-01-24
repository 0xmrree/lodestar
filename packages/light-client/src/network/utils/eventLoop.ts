import {sleep} from "@lodestar/utils";

/**
 * Schedules in 1ms a Promise to be resolved during the `timers` phase.
 * Awaiting this Promise will force the whole event queue to be executed.
 */
export function nextEventLoop(): Promise<void> {
  return sleep(0);
}

/**
 * Schedules in 1ms a callback for execution during the next `timers` phase.
 */
export function callInNextEventLoop(callback: () => void): void {
  setTimeout(callback, 0);
}
