function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function retryOperation(
  operation,
  {
    delays = [0, 500, 1_500],
    wait = delay,
  } = {},
) {
  let lastError;
  for (const waitMs of delays) {
    if (waitMs > 0) await wait(waitMs);
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
