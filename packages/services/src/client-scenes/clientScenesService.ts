import type { IClientScenesService } from "./clientScenes.js";

/**
 * Home-page suggestion scenes used to come from the upstream vendor's server. That service is removed
 * (#46), so there are no remote scenes; the UI falls back to its built-in suggestions.
 */
export function createClientScenesService(): IClientScenesService {
  return {
    list: async () => ({ code: 0, msg: "", data: [] }),
  };
}
