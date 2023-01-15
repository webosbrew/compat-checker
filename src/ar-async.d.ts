declare module 'ar-async' {
    import EventEmitter from "events";
    import {ReadStream} from "fs";

    declare class ArReader extends EventEmitter {
        constructor(file);

        on(event: 'open', listener: () => void): this;
        on(event: 'entry', listener: (entry:ArEntry, next) => void): this;
        on(event: 'error', listener: (err) => void): this;
        on(event: 'end', listener: (err) => void): this;
        on(event: 'close', listener: (err) => void): this;

        isGNU(): boolean;

        resolveNameGNU(shortName: string): string | undefined;
    }

    declare class ArEntry {
        name(): string;

        fileName(): string;

        fileData(): ReadStream;
    }
}