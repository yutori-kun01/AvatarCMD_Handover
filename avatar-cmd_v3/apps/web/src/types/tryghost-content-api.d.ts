// @tryghost/content-api は型定義を同梱していないため、
// 本アプリで使用する範囲の最小限のアンビエント宣言を置く。
declare module "@tryghost/content-api" {
  interface BrowseParams {
    limit?: number | "all";
    filter?: string;
    include?: string[];
    fields?: string[];
    order?: string;
    page?: number;
  }

  interface ReadParams {
    id?: string;
    slug?: string;
  }

  interface ResourceApi {
    browse(params?: BrowseParams): Promise<unknown[]>;
    read(params: ReadParams, options?: BrowseParams): Promise<unknown>;
  }

  export interface GhostContentApiOptions {
    url: string;
    key: string;
    version: string;
  }

  export default class GhostContentAPI {
    constructor(options: GhostContentApiOptions);
    posts: ResourceApi;
    pages: ResourceApi;
    tags: ResourceApi;
    authors: ResourceApi;
    settings: ResourceApi;
  }
}
