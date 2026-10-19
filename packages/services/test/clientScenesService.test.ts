import { describe, expect, it } from "vitest";
import { createClientConfigService } from "../src/client-config/clientConfigService.js";
import { createClientScenesService } from "../src/client-scenes/clientScenesService.js";

// The upstream vendor's client-config and client-scenes endpoints are removed (#46): both services
// answer locally and never touch the network.
describe("client config and scenes without a remote service", () => {
  it("returns local defaults for client config", async () => {
    await expect(createClientConfigService().getSnapshot()).resolves.toEqual({
      pluginStoreOrder: null,
      zsrcUrl: null,
    });
  });

  it("returns no remote scenes", async () => {
    await expect(createClientScenesService().list()).resolves.toEqual({
      code: 0,
      msg: "",
      data: [],
    });
  });
});
