declare module 'ali-oss' {
    export default class OSS {
        constructor(options: {
            accessKeyId: string;
            accessKeySecret: string;
            stsToken?: string;
            region?: string;
            endpoint?: string;
            bucket?: string;
            secure?: boolean;
            [key: string]: DynamicValue;
        });

        put(name: string, file: DynamicValue): Promise<{
            name: string;
            url: string;
            res: DynamicValue;
        }>;
    }
}
