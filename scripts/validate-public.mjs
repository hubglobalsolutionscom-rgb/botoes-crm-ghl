import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const excludedDirectories = new Set([".git", "node_modules"]);
const textExtensions = new Set([
  "",
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".txt",
  ".yaml",
  ".yml",
]);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) {
        files.push(...(await collectFiles(path.join(directory, entry.name))));
      }
      continue;
    }

    if (entry.isFile() && textExtensions.has(path.extname(entry.name))) {
      files.push(path.join(directory, entry.name));
    }
  }

  return files;
}

function listPngChunks(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < signature.length || !buffer.subarray(0, 8).equals(signature)) {
    throw new Error("invalid PNG signature");
  }

  const chunks = [];
  let offset = 8;

  while (offset + 12 <= buffer.length) {
    const dataLength = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const nextOffset = offset + 12 + dataLength;
    if (nextOffset > buffer.length) throw new Error("truncated PNG chunk");

    chunks.push(type);
    offset = nextOffset;
    if (type === "IEND") return chunks;
  }

  throw new Error("missing PNG end chunk");
}

const sourcePath = path.join(root, "ghl-conversation-control.js");
const readmePath = path.join(root, "README.md");
const source = await readFile(sourcePath, "utf8");
const readme = await readFile(readmePath, "utf8");

const requiredSourcePatterns = [
  [/const VERSION = "1\.3\.0";/, "version 1.3.0"],
  [/open: "open"/, "open tag"],
  [/closed: "closed"/, "closed tag"],
  [/tagsModal:/, "current tag interface"],
  [/tagsMenu:/, "legacy tag interface"],
];

const requiredReadmePatterns = [
  [/^# Buttons for the GHL CRM$/m, "English project title"],
  [/R\$ 18/, "symbolic contribution amount"],
  [
    /https:\/\/buy\.stripe\.com\/5kQbJ1dm1eDLgAFcq504803/,
    "Pix contribution link",
  ],
  [
    /https:\/\/donate\.stripe\.com\/7sYdR91Dj9jr1FL9dT04802/,
    "USD donation link",
  ],
  [
    /docs\/images\/ghl-crm-open-button\.png/,
    "Open button screenshot",
  ],
  [
    /docs\/images\/ghl-crm-close-button\.png/,
    "Close button screenshot",
  ],
];

const failures = [];

for (const [pattern, description] of requiredSourcePatterns) {
  if (!pattern.test(source)) failures.push(`Missing from script: ${description}.`);
}

for (const [pattern, description] of requiredReadmePatterns) {
  if (!pattern.test(readme)) failures.push(`Missing from README: ${description}.`);
}

const screenshotPaths = [
  "docs/images/ghl-crm-open-button.png",
  "docs/images/ghl-crm-close-button.png",
];
const metadataChunks = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

for (const relativePath of screenshotPaths) {
  try {
    const chunks = listPngChunks(await readFile(path.join(root, relativePath)));
    const embeddedMetadata = chunks.filter((type) => metadataChunks.has(type));
    if (embeddedMetadata.length > 0) {
      failures.push(
        `${relativePath}: embedded metadata chunks found (${embeddedMetadata.join(", ")}).`,
      );
    }
  } catch (error) {
    failures.push(`${relativePath}: ${error.message}.`);
  }
}

if (/\b(?:fetch\s*\(|XMLHttpRequest\b|WebSocket\s*\()/u.test(source)) {
  failures.push("The script now initiates its own network connection.");
}

if (/https?:\/\//iu.test(source)) {
  failures.push("The script contains an operational URL.");
}

if (
  /logger\.(?:log|warn|error)\([^;]{0,600}\b(?:contactId|conversationId|contactName|user\.email|user\.id|user\.name)\b[^;]{0,600}\);/u.test(
    source,
  )
) {
  failures.push("The script logs identifiable data to the console.");
}

const sensitivePatterns = [
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u, "private key"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/u, "GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/u, "fine-grained GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/u, "AWS access key"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/iu, "Bearer token"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u, "JWT"],
  [/\baccount_id\s*[:=]/iu, "account ID in configuration"],
  [/["'](?:api[_-]?key|access[_-]?token|client[_-]?secret|password)["']\s*[:=]\s*["'][^"']{8,}["']/iu, "secret in configuration"],
];

for (const file of await collectFiles(root)) {
  const relativePath = path.relative(root, file);
  const content = await readFile(file, "utf8");

  for (const [pattern, description] of sensitivePatterns) {
    if (pattern.test(content)) {
      failures.push(`${relativePath}: possible ${description}.`);
    }
  }
}

if (failures.length > 0) {
  console.error("Public validation failed:\n- " + failures.join("\n- "));
  process.exitCode = 1;
} else {
  console.log("Public validation passed: syntax, documentation, and security checks.");
}
