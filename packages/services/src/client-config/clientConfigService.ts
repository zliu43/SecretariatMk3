import type { IClientConfigService } from "./clientConfig.js";

/**
 * Public client config (plugin store order, zsrc URL) used to come from the upstream vendor's server.
 * That service is removed (#46); every field keeps its local default.
 */
export function createClientConfigService(): IClientConfigService {
  return {
    getSnapshot: async () => ({ pluginStoreOrder: null, zsrcUrl: null }),
  };
}
