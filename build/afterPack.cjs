// Ad-hoc codesign the macOS app bundle.
//
// The builds are unsigned (no Apple Developer identity), and macOS refuses to
// launch an unsigned arm64 bundle outright. Signing with the ad-hoc identity
// ("-") makes it launchable; Gatekeeper still quarantines the download, which
// the release notes explain how to clear.
const path = require("node:path");
const { execFileSync } = require("node:child_process");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  console.log(`  • ad-hoc signed  ${app}`);
};
