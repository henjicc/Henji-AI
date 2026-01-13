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
            [key: string]: any;
        });

        put(name: string, file: any): Promise<{
            name: string;
            url: string;
            res: any;
        }>;
    }
}
