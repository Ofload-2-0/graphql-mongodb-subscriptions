export type FilterFn = (rootValue?: any, args?: any, context?: any, info?: any) => boolean;

export const withFilter = (asyncIteratorFn: () => AsyncIterableIterator<any>, filterFn: FilterFn) => {
  return (rootValue: any, args: any, context: any, info: any): AsyncIterator<any> => {
    const asyncIterator = asyncIteratorFn();

    const getNextPromise = (): Promise<IteratorResult<any>> => {
      return new Promise((resolve, reject) => {
        const inner = () => {
          asyncIterator
            .next()
            .then((payload) => {
              if (payload.done === true) {
                resolve(payload);
                return;
              }
              Promise.resolve(filterFn(payload.value, args, context, info))
                .catch(() => false)
                .then((filterResult) => {
                  if (filterResult === true) {
                    resolve(payload);
                    return;
                  }
                  inner();
                });
            })
            .catch(reject);
        };

        inner();
      });
    };

    return {
      next() {
        return getNextPromise();
      },
      return() {
        return asyncIterator.return();
      },
      throw(error) {
        return asyncIterator.throw(error);
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    } as any;
  };
};
