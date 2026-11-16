// Stand-in for Next's after(), which needs a live request: work waits in this queue until a test asks for it.
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
