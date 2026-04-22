import {
  MAX_TOKEN_EXECUTION_QUEUE_LENGTH,
} from "./taskControlSchedulerHelpers.js";

export const createTokenExecutionQueue = ({
  maxLength = MAX_TOKEN_EXECUTION_QUEUE_LENGTH,
} = {}) => {
  let chain = Promise.resolve();
  let queueLength = 0;

  return {
    enqueue({ job, onQueued, onStarted }) {
      if (queueLength >= maxLength) {
        throw new Error(`执行队列已满（上限 ${maxLength}），请稍后重试`);
      }
      const ahead = queueLength;
      queueLength += 1;
      if (typeof onQueued === "function") {
        onQueued(ahead);
      }
      const previous = chain;
      const current = (async () => {
        try {
          await previous;
        } catch {
          // Keep queue moving even if previous token execution failed.
        }
        if (typeof onStarted === "function") {
          onStarted(ahead);
        }
        return job();
      })();
      chain = current
        .catch(() => undefined)
        .finally(() => {
          queueLength = Math.max(0, queueLength - 1);
        });
      return current;
    },
    getLength() {
      return queueLength;
    },
  };
};

export const tokenExecutionQueue = createTokenExecutionQueue();
