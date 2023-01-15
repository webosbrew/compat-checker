import EventEmitter from "events";

export declare interface YieldedEntry<E> {
    entry: E;
    next: () => void;
}

export async function* toGenerator<R extends EventEmitter, E>(src: R): AsyncGenerator<YieldedEntry<E>> {
    let resolve: (value: YieldedEntry<E>) => void;
    let reject: (reason?: Error) => void;
    let promise: Promise<YieldedEntry<E>> | undefined = new Promise<YieldedEntry<E>>((_resolve, _reject) => {
        resolve = _resolve;
        reject = _reject;
    });
    src
        .on('entry', (entry: E, next: () => void) => {
            resolve({entry, next});
            promise = new Promise<YieldedEntry<E>>((_resolve, _reject) => {
                resolve = _resolve;
                reject = _reject;
            });
        })
        .on('error', (err) => {
            reject(err);
        })
        .on('end', () => {
            promise = undefined;
        });
    while (promise) {
        yield await promise;
    }
}