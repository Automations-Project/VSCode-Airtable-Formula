import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pins from "./cloudflared-pins.json" with { type: "json" };
import { getHomeDir } from "../paths.js";

export async function installCloudflared(options = {}) {
  const configDir = options.configDir ?? getHomeDir();
  const assetKey = resolvePinnedAssetKey(options.platform ?? process.platform, options.arch ?? process.arch);
  const asset = pins.assets[assetKey];
  const downloadUrl = `https://github.com/cloudflare/cloudflared/releases/download/${pins.version}/${asset.filename}`;
  const response = await (options.fetchImpl ?? fetch)(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download cloudflared (${response.status} ${response.statusText}).`);
  }

  const archiveBuffer = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(archiveBuffer).digest("hex");
  if (sha256 !== asset.sha256) {
    throw new Error(`cloudflared checksum mismatch for ${asset.filename}. Expected ${asset.sha256}, received ${sha256}.`);
  }

  const binaryBuffer = asset.filename.endsWith(".tgz")
    ? extractCloudflaredBinaryFromTarGz(archiveBuffer)
    : archiveBuffer;
  const binaryPath = getTunnelBinaryPath(configDir, options.platform ?? process.platform);
  const tempPath = `${binaryPath}.tmp`;

  mkdirSync(join(configDir, "bin"), { recursive: true });
  writeFileSync(tempPath, binaryBuffer, { mode: 0o755 });
  renameSync(tempPath, binaryPath);
  if ((options.platform ?? process.platform) !== "win32") {
    chmodSync(binaryPath, 0o755);
  }

  return {
    binaryPath,
    version: pins.version,
    assetKey,
    filename: asset.filename,
    sha256,
  };
}

export function getPinnedCloudflaredVersion() {
  return pins.version;
}

export function getTunnelBinaryPath(configDir = getHomeDir(), platform = process.platform) {
  return join(configDir, "bin", platform === "win32" ? "cloudflared.exe" : "cloudflared");
}

export function resolvePinnedAssetKey(platform, arch) {
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64";
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "win32" && arch === "x64") return "windows-x64";
  throw new Error(`Unsupported cloudflared platform: ${platform}/${arch}`);
}

function extractCloudflaredBinaryFromTarGz(buffer) {
  const tarBuffer = gunzipSync(buffer);
  let offset = 0;

  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) {
      break;
    }

    const name = readTarString(header.subarray(0, 100));
    const sizeText = readTarString(header.subarray(124, 136)).trim();
    const size = Number.parseInt(sizeText || "0", 8);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if (name === "cloudflared" || name.endsWith("/cloudflared")) {
      return tarBuffer.subarray(dataStart, dataEnd);
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  throw new Error("Downloaded cloudflared archive did not contain the cloudflared binary.");
}

function readTarString(buffer) {
  const nullIndex = buffer.indexOf(0);
  const end = nullIndex === -1 ? buffer.length : nullIndex;
  return buffer.subarray(0, end).toString("utf8");
}
