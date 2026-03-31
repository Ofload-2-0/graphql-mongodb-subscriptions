import { setFlagsFromString } from "v8";
import { runInNewContext } from "vm";
import { withFilter, FilterFn } from "../src/with-filter";

setFlagsFromString("--expose_gc");
const gc: () => void = runInNewContext("gc");

function createMockAsyncIterator<T>(
  getNext: () => { done: boolean; value: T }
): AsyncIterableIterator<T> {
  return {
    next() {
      return new Promise<IteratorResult<T>>((resolve) =>
        setImmediate(() => resolve(getNext()))
      );
    },
    return() {
      return Promise.resolve({
        done: true,
        value: undefined,
      } as IteratorResult<T>);
    },
    throw(error: any) {
      return Promise.reject(error);
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

describe("withFilter", () => {
  it("passes matching values through the filter", async () => {
    const values = [1, 2, 3];
    let index = 0;

    const iterator = createMockAsyncIterator(() => {
      if (index < values.length) {
        return { done: false, value: values[index++] };
      }
      return { done: true, value: undefined };
    });

    const filterFn: FilterFn = (rootValue) => rootValue > 1;

    const filteredIterator = withFilter(() => iterator, filterFn)(
      undefined,
      {},
      {},
      {}
    );

    const result1 = await filteredIterator.next();
    expect(result1).toEqual({ done: false, value: 2 });

    const result2 = await filteredIterator.next();
    expect(result2).toEqual({ done: false, value: 3 });
  });

  it("skips values that do not match the filter", async () => {
    const values = [1, 2, 3, 4, 5];
    let index = 0;

    const iterator = createMockAsyncIterator(() => {
      if (index < values.length) {
        return { done: false, value: values[index++] };
      }
      return { done: true, value: undefined };
    });

    const filterFn: FilterFn = (rootValue) => rootValue % 2 === 0;

    const filteredIterator = withFilter(() => iterator, filterFn)(
      undefined,
      {},
      {},
      {}
    );

    const result1 = await filteredIterator.next();
    expect(result1.value).toBe(2);

    const result2 = await filteredIterator.next();
    expect(result2.value).toBe(4);
  });

  it("propagates done when the underlying iterator is exhausted", async () => {
    let called = false;
    const iterator = createMockAsyncIterator(() => {
      if (!called) {
        called = true;
        return { done: false, value: "hello" };
      }
      return { done: true, value: undefined };
    });

    const filteredIterator = withFilter(
      () => iterator,
      () => true
    )(undefined, {}, {}, {});

    const result1 = await filteredIterator.next();
    expect(result1).toEqual({ done: false, value: "hello" });

    const result2 = await filteredIterator.next();
    expect(result2.done).toBe(true);
  });

  it("passes args, context, and info to the filter function", async () => {
    const mockArgs = { id: "123" };
    const mockContext = { user: "test" };
    const mockInfo = { fieldName: "onEvent" };

    let capturedArgs: any;
    let capturedContext: any;
    let capturedInfo: any;

    let emitted = false;
    const iterator = createMockAsyncIterator(() => {
      if (!emitted) {
        emitted = true;
        return { done: false, value: "payload" };
      }
      return { done: true, value: undefined };
    });

    const filterFn: FilterFn = (_rootValue, args, context, info) => {
      capturedArgs = args;
      capturedContext = context;
      capturedInfo = info;
      return true;
    };

    const filteredIterator = withFilter(() => iterator, filterFn)(
      undefined,
      mockArgs,
      mockContext,
      mockInfo
    );

    await filteredIterator.next();

    expect(capturedArgs).toBe(mockArgs);
    expect(capturedContext).toBe(mockContext);
    expect(capturedInfo).toBe(mockInfo);
  });

  it("handles async filter functions", async () => {
    const values = [1, 2, 3];
    let index = 0;

    const iterator = createMockAsyncIterator(() => {
      if (index < values.length) {
        return { done: false, value: values[index++] };
      }
      return { done: true, value: undefined };
    });

    const filterFn = async (rootValue: any) => {
      await new Promise((r) => setImmediate(r));
      return rootValue === 2;
    };

    const filteredIterator = withFilter(
      () => iterator,
      filterFn as unknown as FilterFn
    )(undefined, {}, {}, {});

    const result = await filteredIterator.next();
    expect(result.value).toBe(2);
  });

  it("treats async filter rejections as false and skips the value", async () => {
    const values = ["bad", "good"];
    let index = 0;

    const iterator = createMockAsyncIterator(() => {
      if (index < values.length) {
        return { done: false, value: values[index++] };
      }
      return { done: true, value: undefined };
    });

    const filterFn = ((rootValue: any) => {
      if (rootValue === "bad")
        return Promise.reject(new Error("async filter error"));
      return true;
    }) as unknown as FilterFn;

    const filteredIterator = withFilter(() => iterator, filterFn)(
      undefined,
      {},
      {},
      {}
    );

    const result = await filteredIterator.next();
    expect(result.value).toBe("good");
  });

  it("does not catch synchronous throws from filterFn", async () => {
    const values = ["bad", "good"];
    let index = 0;

    const iterator = createMockAsyncIterator(() => {
      if (index < values.length) {
        return { done: false, value: values[index++] };
      }
      return { done: true, value: undefined };
    });

    const filterFn: FilterFn = (rootValue) => {
      if (rootValue === "bad") throw new Error("sync filter error");
      return true;
    };

    const filteredIterator = withFilter(() => iterator, filterFn)(
      undefined,
      {},
      {},
      {}
    );

    await expect(filteredIterator.next()).rejects.toThrow("sync filter error");
  });

  it("delegates return() to the underlying iterator", async () => {
    const returnMock = jest
      .fn()
      .mockResolvedValue({ done: true, value: undefined });
    const iterator: AsyncIterableIterator<any> = {
      next: () => Promise.resolve({ done: true, value: undefined }),
      return: returnMock,
      throw: (e: any) => Promise.reject(e),
      [Symbol.asyncIterator]() {
        return this;
      },
    };

    const filteredIterator = withFilter(
      () => iterator,
      () => true
    )(undefined, {}, {}, {});

    await filteredIterator.return!();
    expect(returnMock).toHaveBeenCalledTimes(1);
  });

  it("delegates throw() to the underlying iterator", async () => {
    const testError = new Error("test");
    const throwMock = jest.fn().mockRejectedValue(testError);
    const iterator: AsyncIterableIterator<any> = {
      next: () => Promise.resolve({ done: true, value: undefined }),
      return: () => Promise.resolve({ done: true, value: undefined }),
      throw: throwMock,
      [Symbol.asyncIterator]() {
        return this;
      },
    };

    const filteredIterator = withFilter(
      () => iterator,
      () => true
    )(undefined, {}, {}, {});

    await expect(filteredIterator.throw!(testError)).rejects.toThrow("test");
    expect(throwMock).toHaveBeenCalledWith(testError);
  });

  it("is a valid async iterator (Symbol.asyncIterator)", () => {
    const iterator = createMockAsyncIterator(() => ({
      done: true,
      value: undefined,
    }));

    const filteredIterator = withFilter(
      () => iterator,
      () => true
    )(undefined, {}, {}, {});

    expect(filteredIterator[Symbol.asyncIterator]).toBeDefined();
    expect(filteredIterator[Symbol.asyncIterator]()).toBe(filteredIterator);
  });
});

// https://github.com/apollographql/graphql-subscriptions/issues/212
// https://github.com/nestjs/graphql/pull/2605
describe("withFilter memory leak", () => {
  it("does not leak memory when filter rejects most values", async () => {
    jest.setTimeout(10_000);

    let stopped = false;
    let index = 0;

    const iterator = createMockAsyncIterator(() => {
      if (stopped) {
        return { done: true, value: undefined };
      }
      return { done: false, value: ++index };
    });

    const filterFn: FilterFn = () => stopped;

    const filteredIterator = withFilter(() => iterator, filterFn)(
      undefined,
      {},
      {},
      {}
    );

    gc();
    const heapBefore = process.memoryUsage().heapUsed;

    const nextPromise = filteredIterator.next();

    await new Promise((resolve) => setTimeout(resolve, 3_000));

    gc();
    const heapAfter = process.memoryUsage().heapUsed;

    stopped = true;
    await nextPromise;

    const heapGrowthRatio = Math.max(0, heapAfter - heapBefore) / heapBefore;
    expect(heapGrowthRatio).toBeLessThan(0.01);
  }, 10_000);
});
