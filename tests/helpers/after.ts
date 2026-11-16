// Next's after() needs a live request, which a handler called directly does not
// have. The suite swaps it for this queue (see tests/setup.ts): work waits here
// until a test asks for it, as the real one waits for the response to be sent.
type Task = () => unknown;

const queue: Task[] = [];

/** Stands in for after(): holds the work instead of running it. */
export function queueAfter(task: Task): void {
  queue.push(task);
}

/** Run what the handlers queued behind their responses, and wait for it. */
export async function afterResponse(): Promise<void> {
  await Promise.all(queue.splice(0).map((task) => task()));
}

/** Forget queued work a test never asked for, so it cannot run in a later test. */
export function dropAfter(): void {
  queue.length = 0;
}
