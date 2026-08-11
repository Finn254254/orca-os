import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Minimal, dependency-light durable JSON store.
 * Writes are atomic (write to temp file, then rename) to avoid corrupting
 * state if the process is killed mid-write.
 */
export class JsonStore<T> {
  private cache: T | undefined;
  // All reads-then-writes are chained through this queue so concurrent
  // mutate() calls see each other's effects instead of racing on a stale cache.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly defaultValue: T,
  ) {}

  async load(): Promise<T> {
    if (this.cache !== undefined) return this.cache;
    try {
      const raw = await readFile(this.filePath, "utf-8");
      this.cache = JSON.parse(raw) as T;
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === "ENOENT") {
        this.cache = this.defaultValue;
        await this.save(this.cache);
      } else {
        throw err;
      }
    }
    return this.cache as T;
  }

  get(): T {
    if (this.cache === undefined) {
      throw new Error(`JsonStore(${this.filePath}) accessed before load()`);
    }
    return this.cache;
  }

  async save(value: T): Promise<void> {
    await this.load();
    const task = this.queue.then(async () => {
      this.cache = value;
      await this.writeAtomic(value);
    });
    this.queue = task.catch(() => undefined);
    await task;
  }

  private async writeAtomic(value: T): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmpPath, JSON.stringify(value, null, 2), "utf-8");
    await rename(tmpPath, this.filePath);
  }

  async mutate(fn: (value: T) => T): Promise<T> {
    await this.load();
    const task = this.queue.then(async () => {
      const next = fn(this.cache as T);
      this.cache = next;
      await this.writeAtomic(next);
      return next;
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  /** Resolves once every write enqueued so far has been durably written to disk. */
  async flush(): Promise<void> {
    await this.queue;
  }
}
