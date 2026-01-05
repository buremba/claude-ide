import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as https from "https";
import * as http from "http";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { createUnzip } from "zlib";
import { Extract } from "unzipper";

const CACHE_DIR = path.join(os.homedir(), ".cache", "mcp-sidecar", "extensions");

// Chrome's extension download URL
// See: https://developer.chrome.com/docs/extensions/how-to/distribute/host-on-a-custom-server
function getCrxDownloadUrl(extensionId: string): string {
  const chromeVersion = "130.0.0.0";
  return `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${chromeVersion}&acceptformat=crx2,crx3&x=id%3D${extensionId}%26uc`;
}

/**
 * Ensure an extension is downloaded and cached, return path to unpacked extension
 */
export async function ensureExtension(extensionId: string): Promise<string> {
  const extensionDir = path.join(CACHE_DIR, extensionId);
  const manifestPath = path.join(extensionDir, "manifest.json");

  // Check if already cached
  if (fs.existsSync(manifestPath)) {
    console.error(`[ExtensionManager] Using cached extension: ${extensionId}`);
    return extensionDir;
  }

  console.error(`[ExtensionManager] Downloading extension: ${extensionId}`);

  // Create cache directory
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  // Download the .crx file
  const crxPath = path.join(CACHE_DIR, `${extensionId}.crx`);
  await downloadFile(getCrxDownloadUrl(extensionId), crxPath);

  // Extract the .crx (it's a zip with a special header)
  await extractCrx(crxPath, extensionDir);

  // Clean up .crx file
  fs.unlinkSync(crxPath);

  console.error(`[ExtensionManager] Extension installed: ${extensionId}`);
  return extensionDir;
}

/**
 * Ensure multiple extensions are ready
 */
export async function ensureExtensions(extensionIds: string[]): Promise<string[]> {
  const paths: string[] = [];
  for (const id of extensionIds) {
    try {
      const extPath = await ensureExtension(id);
      paths.push(extPath);
    } catch (error) {
      console.error(`[ExtensionManager] Failed to install extension ${id}:`, error);
    }
  }
  return paths;
}

/**
 * Download a file from URL, following redirects
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);

    const request = (urlStr: string) => {
      const protocol = urlStr.startsWith("https") ? https : http;
      protocol
        .get(urlStr, (response) => {
          // Follow redirects
          if (response.statusCode === 301 || response.statusCode === 302) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              request(redirectUrl);
              return;
            }
          }

          if (response.statusCode !== 200) {
            reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
            return;
          }

          response.pipe(file);
          file.on("finish", () => {
            file.close();
            resolve();
          });
        })
        .on("error", (err) => {
          fs.unlink(destPath, () => {}); // Clean up on error
          reject(err);
        });
    };

    request(url);
  });
}

/**
 * Extract a .crx file to a directory
 * CRX files are ZIP files with a special header that needs to be skipped
 */
async function extractCrx(crxPath: string, destDir: string): Promise<void> {
  const buffer = fs.readFileSync(crxPath);

  // CRX3 format: magic (4) + version (4) + header length (4) + header
  // CRX2 format: magic (4) + version (4) + pubkey length (4) + sig length (4) + pubkey + sig
  const magic = buffer.toString("utf8", 0, 4);

  let zipStart = 0;

  if (magic === "Cr24") {
    const version = buffer.readUInt32LE(4);
    if (version === 3) {
      // CRX3
      const headerLength = buffer.readUInt32LE(8);
      zipStart = 12 + headerLength;
    } else if (version === 2) {
      // CRX2
      const pubkeyLength = buffer.readUInt32LE(8);
      const sigLength = buffer.readUInt32LE(12);
      zipStart = 16 + pubkeyLength + sigLength;
    }
  }

  // Find ZIP magic (PK\x03\x04) if header parsing failed
  if (zipStart === 0) {
    for (let i = 0; i < Math.min(buffer.length, 1000); i++) {
      if (
        buffer[i] === 0x50 &&
        buffer[i + 1] === 0x4b &&
        buffer[i + 2] === 0x03 &&
        buffer[i + 3] === 0x04
      ) {
        zipStart = i;
        break;
      }
    }
  }

  // Extract ZIP portion
  const zipBuffer = buffer.slice(zipStart);
  const tempZipPath = crxPath + ".zip";
  fs.writeFileSync(tempZipPath, zipBuffer);

  // Create destination directory
  fs.mkdirSync(destDir, { recursive: true });

  // Extract using unzipper
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(tempZipPath)
      .pipe(Extract({ path: destDir }))
      .on("close", resolve)
      .on("error", reject);
  });

  // Clean up temp zip
  fs.unlinkSync(tempZipPath);
}
