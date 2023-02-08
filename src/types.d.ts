export declare interface AppInfo {
    id: string;
    type: 'native' | string;
    version: string;
    main: string;
}

export declare interface ServiceInfo {
    id: string;
    engine?: 'native' | string;
    executable?: string;
}
