export interface ScreenProbeWaiter {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  cancel: () => void;
}

export function createObservedProbeWaiter(label: string, timeoutMs: number): ScreenProbeWaiter {
  let settled = false;
  let resolvePromise!: () => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  // Keep the rejection observed even if a caller enters cleanup before awaiting it.
  void promise.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const finish = (action: () => void) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    timer = null;
    action();
  };
  const resolveWaiter = () => finish(resolvePromise);
  const rejectWaiter = (error: Error) => finish(() => rejectPromise(error));
  const cancel = () => finish(resolvePromise);
  timer = setTimeout(() => rejectWaiter(new Error(`${label} timed out`)), timeoutMs);
  return { promise, resolve: resolveWaiter, reject: rejectWaiter, cancel };
}

export async function waitForProbeSubscription(
  subscribe: (onStatus: (status: string) => void) => void,
  subscriptionTimeoutMs: number,
  changeTimeoutMs: number,
): Promise<ScreenProbeWaiter> {
  const subscription = createObservedProbeWaiter('Realtime subscription', subscriptionTimeoutMs);
  try {
    subscribe((status) => {
      if (status === 'SUBSCRIBED') subscription.resolve();
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        subscription.reject(new Error(`Realtime subscription failed: ${status}`));
      }
    });
    await subscription.promise;
    // The update timeout starts only after Realtime has confirmed the subscription.
    return createObservedProbeWaiter('Realtime screen update', changeTimeoutMs);
  } finally {
    subscription.cancel();
  }
}
