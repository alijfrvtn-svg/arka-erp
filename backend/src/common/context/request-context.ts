import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request identity, propagated so DB writes can stamp the audit trail. */
export interface RequestContext {
  userId?: string;
  role?: string;
  ip?: string;
  requestId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const RequestContextStore = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
  get(): RequestContext {
    return storage.getStore() ?? {};
  },
  set(patch: Partial<RequestContext>): void {
    const cur = storage.getStore();
    if (cur) Object.assign(cur, patch);
  },
};
