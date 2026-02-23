import { MongodbPubSub } from '../src';
import { Db } from 'mongodb';

let listeners: Function[] = [];

const unsubscribeMock = jest.fn().mockImplementation(() => {
  console.log(`unsubscribeMock()`);
  listeners.shift();
});
const publishMock = jest
  .fn()
  .mockImplementation((channel, message) =>
    listeners.forEach((listener) => listener(channel, message))
  );
const subscribeMock = jest.fn().mockImplementation(({ event, callback }) => {
  console.log(`subscribeMock`, { event });
  listeners.push(callback);
  return {
    unsubscribe: unsubscribeMock,
  };
});

const mockEventEmitter = {
  publish: publishMock,
  subscribe: subscribeMock,
};

jest.mock("@ofload/mongopubsub", () => {
  return {
    MubSub: jest.fn().mockImplementation(() => {
      return mockEventEmitter;
    }),
  };
});

const mockMongoDb: Db = jest.fn() as unknown as Db;
const mockOptions = {
  connectionDb: mockMongoDb,
};

const timeout = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

describe("MongodbPubSub", () => {
  it("can subscribe to a specific trigger and receive messages published to it", async () => {
    const pubSub = new MongodbPubSub(mockOptions);
    const triggerName = `Posts`;
    const payload = {
      timestamp: new Date().toISOString(),
    };
    const onMessage = jest.fn().mockImplementation((message) => {
      console.log(`onMessage()`, { message });
      expect(message?.message?.timestamp).toEqual(payload.timestamp);
    });
    const subId = await pubSub.subscribe(triggerName, onMessage);
    expect(typeof subId).toBe("number");
    expect(subscribeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: triggerName,
      })
    );
    await pubSub.publish(triggerName, payload);
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: triggerName,
        message: payload,
      })
    );
    expect(onMessage).toHaveBeenCalled();
    pubSub.unsubscribe(subId);
    expect(unsubscribeMock).toHaveBeenCalled();
  });

  it("cleans up correctly the memory when unsubscribing", async () => {
    const pubSub = new MongodbPubSub(mockOptions);
    const triggerName = `Posts`;
    const subscriptionPromises = [
      pubSub.subscribe(triggerName, () => null),
      pubSub.subscribe(triggerName, () => null),
    ];
    const subIds = await Promise.all(subscriptionPromises);
    pubSub.unsubscribe(subIds[0]);
    expect(() => pubSub.unsubscribe(subIds[0])).toThrow(
      `There is no subscription of id "${subIds[0]}"`
    );
    pubSub.unsubscribe(subIds[1]);
  });

  it("will unsubscribe individual subscriptions", async () => {
    const pubSub = new MongodbPubSub(mockOptions);
    const triggerName = `Posts`;
    const payload = {
      timestamp: new Date().toISOString(),
    };
    const onMessage1 = jest.fn().mockImplementation((_message) => {
      console.log(`Expect to not be called`);
    });
    const onMessage2 = jest.fn().mockImplementation((message) => {
      expect(message?.message?.timestamp).toEqual(payload.timestamp);
    });
    const subscriptionPromises = [
      pubSub.subscribe(triggerName, onMessage1),
      pubSub.subscribe(triggerName, onMessage2),
    ];

    const subIds = await Promise.all(subscriptionPromises);
    expect(subIds.length).toEqual(2);
    pubSub.unsubscribe(subIds[0]);
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);

    await pubSub.publish(triggerName, payload);
    pubSub.unsubscribe(subIds[1]);
    expect(unsubscribeMock).toHaveBeenCalledTimes(2);

    expect(onMessage1).toHaveBeenCalledTimes(0);
    expect(onMessage2).toHaveBeenCalledTimes(1);
  });

  it("can have multiple subscribers and all will be called when a message is published to this channel", async () => {
    const pubSub = new MongodbPubSub(mockOptions);
    const triggerName = `Posts`;
    const payload = {
      timestamp: new Date().toISOString(),
    };
    const onMessage1 = jest.fn().mockImplementation((message) => {
      expect(message?.message?.timestamp).toEqual(payload.timestamp);
    });
    const onMessage2 = jest.fn().mockImplementation((message) => {
      expect(message?.message?.timestamp).toEqual(payload.timestamp);
    });
    const subscriptionPromises = [
      pubSub.subscribe(triggerName, onMessage1),
      pubSub.subscribe(triggerName, onMessage2),
    ];

    const subIds = await Promise.all(subscriptionPromises);
    expect(subIds.length).toEqual(2);
    await pubSub.publish(triggerName, payload);
    await timeout(50);
    expect(onMessage1).toHaveBeenCalledTimes(1);
    expect(onMessage2).toHaveBeenCalledTimes(1);

    pubSub.unsubscribe(subIds[0]);
    pubSub.unsubscribe(subIds[1]);
  });

  it("can publish objects as well", async () => {
    const pubSub = new MongodbPubSub(mockOptions);
    const triggerName = `Posts`;
    const payload = {
      timestamp: new Date().toISOString(),
    };
    const onMessage = jest.fn().mockImplementation((message) => {
      expect(message?.message?.timestamp).toEqual(payload.timestamp);
    });
    const subId = await pubSub.subscribe(triggerName, onMessage);
    await pubSub.publish(triggerName, payload);
    expect(publishMock).toHaveBeenCalledTimes(1);
    pubSub.unsubscribe(subId);
  });

  afterEach(() => {
    publishMock.mockClear();
    subscribeMock.mockClear();
    unsubscribeMock.mockClear();
    listeners = [];
  });

  afterAll(() => {
    // restore();
  });
});

describe("PubSubAsyncIterator", () => {
  it("should expose valid asyncIterator for a specific event", () => {
    const pubSub = new MongodbPubSub(mockOptions);
    const eventName = "test";
    const iterator = pubSub.asyncIterator(eventName);
    expect(iterator).toBeDefined();
    expect(iterator[Symbol.asyncIterator]).toBeDefined();
  });

  it("should trigger event on asyncIterator when published", (done) => {
    const pubSub = new MongodbPubSub(mockOptions);
    const eventName = "test";
    const iterator = pubSub.asyncIterator(eventName);

    iterator.next().then((result) => {
      expect(result).toBeDefined();
      expect(result.value).toBeDefined();
      expect(result.done).toBeDefined();
      done();
    });

    pubSub.publish(eventName, { test: true });
  });

  it("should not trigger event on asyncIterator when publishing other event", async () => {
    const pubSub = new MongodbPubSub(mockOptions);
    const eventName = "test2";
    const iterator = pubSub.asyncIterator("test");
    const triggerMock = jest.fn();
    iterator.next().then(triggerMock);
    await pubSub.publish(eventName, { test: true });
    expect(triggerMock).toHaveBeenCalledTimes(0);
  });

  it("register to multiple events", async () => {
    const pubSub = new MongodbPubSub(mockOptions);
    const event1 = `test1`;
    const event2 = `test2`;
    const payload = {
      timestamp: new Date().toISOString(),
    };
    const iterator = pubSub.asyncIterator([event1, event2]);
    const onNext = jest.fn();
    iterator.next().then(onNext);
    await pubSub.publish(event1, payload);
    await timeout(50);
    iterator.next().then(onNext);
    await pubSub.publish(event2, payload);
    await timeout(50);
    expect(onNext).toHaveBeenCalledTimes(2);
  });

  it("should not trigger event on asyncIterator already returned", (done) => {
    const pubSub = new MongodbPubSub(mockOptions);
    const eventName = "test";
    const iterator = pubSub.asyncIterator<any>(eventName);

    iterator.next().then((result) => {
      console.log(`iterator.next()`, { result });
      expect(result).toBeDefined();
      expect(result.value).toBeDefined();
      expect(result.value.message.test).toEqual("word");
      expect(result.done).toBe(false);
    });

    pubSub.publish(eventName, { test: "word" }).then(() => {
      iterator.next().then((result) => {
        console.log(`iterator.next()`, { result });
        expect(result).toBeDefined();
        expect(result.value).toBeUndefined();
        expect(result.done).toBe(true);
        done();
      });

      iterator.return!();
      pubSub.publish(eventName, { test: true });
    });
  });
});
