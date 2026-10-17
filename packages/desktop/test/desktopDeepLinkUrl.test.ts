import { describe, expect, it } from "vitest";

describe("desktop deep link url helpers", () => {
  it("recognizes only the unified OAuth callback url", async () => {
    const { isOAuthCallbackUrl } = await import("../src/main/desktopDeepLinkUrl.js");

    expect(isOAuthCallbackUrl(new URL("secretariat://oauth/callback?code=1&state=s"))).toBe(true);
    expect(isOAuthCallbackUrl(new URL("secretariat://bigmodel-auth/callback?authCode=1&state=s"))).toBe(
      false,
    );
    expect(isOAuthCallbackUrl(new URL("secretariat://zai-auth/callback?code=1&state=s"))).toBe(false);
    expect(isOAuthCallbackUrl(new URL("secretariat://oauth/other?code=1&state=s"))).toBe(false);
    expect(isOAuthCallbackUrl(new URL("https://oauth/callback?code=1&state=s"))).toBe(false);
  });

  it("accepts Linux one-slash callback urls", async () => {
    const { isOAuthCallbackUrl, isPaymentCallbackUrl } =
      await import("../src/main/desktopDeepLinkUrl.js");

    expect(isOAuthCallbackUrl(new URL("secretariat:/oauth/callback?code=1&state=s"))).toBe(true);
    expect(isOAuthCallbackUrl(new URL("secretariat:oauth/callback?code=1&state=s"))).toBe(true);
    expect(isPaymentCallbackUrl(new URL("secretariat:/payment/callback?status=return"))).toBe(true);
    expect(isPaymentCallbackUrl(new URL("secretariat:payment/callback?status=cancel"))).toBe(true);
  });

  it("recognizes payment callback urls separately from OAuth", async () => {
    const { isOAuthCallbackUrl, isPaymentCallbackUrl } =
      await import("../src/main/desktopDeepLinkUrl.js");

    const paymentUrl = new URL("secretariat://payment/callback?provider=zai&channel=paypal");
    expect(isPaymentCallbackUrl(paymentUrl)).toBe(true);
    expect(isOAuthCallbackUrl(paymentUrl)).toBe(false);
    expect(isPaymentCallbackUrl(new URL("secretariat://payment/other"))).toBe(false);
  });

  it("recognizes workspace open urls and extracts the encoded folder path", async () => {
    const { extractWorkspaceOpenPath, isWorkspaceOpenUrl } =
      await import("../src/main/desktopDeepLinkUrl.js");

    const workspaceUrl = new URL("secretariat://workspace/open?path=%2FUsers%2Fdemo%2FProject%20A%26B");
    expect(isWorkspaceOpenUrl(workspaceUrl)).toBe(true);
    expect(extractWorkspaceOpenPath(workspaceUrl)).toBe("/Users/demo/Project A&B");
    expect(isWorkspaceOpenUrl(new URL("secretariat://workspace/other?path=%2Ftmp"))).toBe(false);
    expect(extractWorkspaceOpenPath(new URL("secretariat://workspace/open"))).toBeNull();
  });

  it("只接受不含额外敏感参数的 share import code", async () => {
    const { extractShareImportCode, isShareImportUrl } =
      await import("../src/main/desktopDeepLinkUrl.js");
    const valid = new URL("secretariat://share/import?code=abc_DEF-123");
    expect(isShareImportUrl(valid)).toBe(true);
    expect(extractShareImportCode(valid)).toBe("abc_DEF-123");
    expect(extractShareImportCode(new URL("secretariat://share/import"))).toBeNull();
    expect(extractShareImportCode(new URL("secretariat://share/import?code=bad%2Fcode"))).toBeNull();
    expect(isShareImportUrl(new URL("https://share/import?code=abc"))).toBe(false);
  });

  it("extracts protocol urls from desktop argv variants", async () => {
    const { extractDeepLinkUrlFromArgs } = await import("../src/main/desktopDeepLinkUrl.js");

    expect(
      extractDeepLinkUrlFromArgs(["/opt/Secretariat/zcode", "secretariat://oauth/callback?code=1&state=s"]),
    ).toBe("secretariat://oauth/callback?code=1&state=s");
    expect(
      extractDeepLinkUrlFromArgs([
        "/opt/Secretariat/zcode",
        "--open-url=secretariat://oauth/callback?code=1&state=s",
      ]),
    ).toBe("secretariat://oauth/callback?code=1&state=s");
    expect(
      extractDeepLinkUrlFromArgs([
        "/opt/Secretariat/zcode",
        "secretariat%3A%2F%2Foauth%2Fcallback%3Fcode%3D1%26state%3Ds",
      ]),
    ).toBe("secretariat://oauth/callback?code=1&state=s");
    expect(
      extractDeepLinkUrlFromArgs([
        "/opt/Secretariat/zcode",
        "zcode%253A%252F%252Foauth%252Fcallback%253Fcode%253D1%2526state%253Ds",
      ]),
    ).toBe("secretariat://oauth/callback?code=1&state=s");
    expect(
      extractDeepLinkUrlFromArgs(["/opt/Secretariat/zcode", "secretariat://oauth/callback?code=1", "&state=s"]),
    ).toBe("secretariat://oauth/callback?code=1&state=s");
    expect(
      extractDeepLinkUrlFromArgs(["/opt/Secretariat/zcode", "secretariat://oauth/callback?code=1&amp;state=s"]),
    ).toBe("secretariat://oauth/callback?code=1&state=s");
    expect(
      extractDeepLinkUrlFromArgs([
        "/opt/Secretariat/zcode",
        "secretariat://payment/callback?provider=zai",
        "&channel=paypal",
        "&status=return",
      ]),
    ).toBe("secretariat://payment/callback?provider=zai&channel=paypal&status=return");
    expect(
      extractDeepLinkUrlFromArgs([
        "/Applications/Secretariat.app/Contents/MacOS/Secretariat",
        "secretariat://workspace/open?path=%2FUsers%2Fdemo%2FProject%2520A",
      ]),
    ).toBe("secretariat://workspace/open?path=%2FUsers%2Fdemo%2FProject%2520A");
  });

  it("returns null when argv does not contain a deep link", async () => {
    const { extractDeepLinkUrlFromArgs } = await import("../src/main/desktopDeepLinkUrl.js");

    expect(extractDeepLinkUrlFromArgs(["/opt/Secretariat/zcode", "--no-sandbox"])).toBeNull();
  });

  it("extracts Windows open workspace argv without URL decoding", async () => {
    const { extractOpenWorkspacePathFromArgs } = await import("../src/main/desktopDeepLinkUrl.js");

    expect(
      extractOpenWorkspacePathFromArgs([
        "C:\\Program Files\\Secretariat\\Secretariat.exe",
        "--open-workspace",
        "C:\\Users\\demo\\Project A&B#1",
      ]),
    ).toBe("C:\\Users\\demo\\Project A&B#1");
    expect(
      extractOpenWorkspacePathFromArgs([
        "C:\\Program Files\\Secretariat\\Secretariat.exe",
        "--open-workspace=C:\\Users\\demo\\Project%20A",
      ]),
    ).toBe("C:\\Users\\demo\\Project%20A");
    expect(extractOpenWorkspacePathFromArgs(["Secretariat.exe", "--open-workspace", 'C:"'])).toBe("C:\\");
    expect(extractOpenWorkspacePathFromArgs(["Secretariat.exe", "--open-workspace", 'C:\\repo"'])).toBe(
      "C:\\repo\\",
    );
    expect(extractOpenWorkspacePathFromArgs(["Secretariat.exe", "--open-workspace"])).toBeNull();
  });

  it("passes parsed deep links through single instance additionalData", async () => {
    const {
      createDeepLinkSingleInstanceData,
      extractDeepLinkUrlFromSingleInstanceData,
      extractOpenWorkspacePathFromSingleInstanceData,
    } = await import("../src/main/desktopDeepLinkUrl.js");

    const additionalData = createDeepLinkSingleInstanceData([
      "/opt/Secretariat/zcode",
      "zcode%253A%252F%252Foauth%252Fcallback%253Fcode%253D1%2526state%253Ds",
      "--open-workspace=C:\\Users\\demo\\Project A",
    ]);

    expect(extractDeepLinkUrlFromSingleInstanceData(additionalData)).toBe(
      "secretariat://oauth/callback?code=1&state=s",
    );
    expect(extractOpenWorkspacePathFromSingleInstanceData(additionalData)).toBe(
      "C:\\Users\\demo\\Project A",
    );
    expect(extractDeepLinkUrlFromSingleInstanceData({ deepLinkUrl: "https://example.com" })).toBe(
      null,
    );
  });

  it("builds Windows Explorer registry operations for folder context menu", async () => {
    const { buildWindowsOpenFolderCommand, buildWindowsOpenFolderRegistryOperations } =
      await import("../src/main/desktopWindowsOpenFolderContextMenu.js");

    expect(buildWindowsOpenFolderCommand("C:\\Program Files\\Secretariat\\Secretariat.exe")).toBe(
      '"C:\\Program Files\\Secretariat\\Secretariat.exe" --open-workspace "%1"',
    );
    expect(
      buildWindowsOpenFolderCommand("C:\\Electron\\electron.exe", ["C:\\repo\\desktop\\main.js"]),
    ).toBe('"C:\\Electron\\electron.exe" "C:\\repo\\desktop\\main.js" --open-workspace "%1"');

    const operations = buildWindowsOpenFolderRegistryOperations({
      executablePath: "C:\\Program Files\\Secretariat\\Secretariat.exe",
      locale: "en-US",
    });

    expect(operations).toContainEqual({
      args: [
        "add",
        "HKCU\\Software\\Classes\\Directory\\shell\\Secretariat.OpenInZCode\\command",
        "/ve",
        "/d",
        '"C:\\Program Files\\Secretariat\\Secretariat.exe" --open-workspace "%1"',
        "/f",
      ],
    });
    expect(operations).toContainEqual({
      args: [
        "add",
        "HKCU\\Software\\Classes\\Drive\\shell\\Secretariat.OpenInZCode\\command",
        "/ve",
        "/d",
        '"C:\\Program Files\\Secretariat\\Secretariat.exe" --open-workspace "%1"',
        "/f",
      ],
    });
  });

  it("builds localized Windows Explorer registry menu labels", async () => {
    const { buildWindowsOpenFolderRegistryOperations, getWindowsOpenFolderMenuName } =
      await import("../src/main/desktopWindowsOpenFolderContextMenu.js");

    expect(getWindowsOpenFolderMenuName("zh-CN")).toBe("在ZCode中打开");
    expect(getWindowsOpenFolderMenuName("en-US")).toBe("Open in Secretariat");

    const operations = buildWindowsOpenFolderRegistryOperations({
      executablePath: "C:\\Program Files\\Secretariat\\Secretariat.exe",
      locale: "zh-CN",
    });

    expect(operations).toContainEqual({
      args: [
        "add",
        "HKCU\\Software\\Classes\\Directory\\shell\\Secretariat.OpenInZCode",
        "/ve",
        "/d",
        "在ZCode中打开",
        "/f",
      ],
    });
    expect(operations).toContainEqual({
      args: [
        "add",
        "HKCU\\Software\\Classes\\Directory\\shell\\Secretariat.OpenInZCode",
        "/v",
        "MUIVerb",
        "/t",
        "REG_SZ",
        "/d",
        "在ZCode中打开",
        "/f",
      ],
    });
  });
});
