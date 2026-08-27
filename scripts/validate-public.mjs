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

const sourcePath = path.join(root, "ghl-conversation-control.js");
const readmePath = path.join(root, "README.md");
const source = await readFile(sourcePath, "utf8");
const readme = await readFile(readmePath, "utf8");

const requiredSourcePatterns = [
  [/const VERSION = "1\.3\.0";/, "versão 1.3.0"],
  [/open: "open"/, "tag open"],
  [/closed: "closed"/, "tag closed"],
  [/tagsModal:/, "interface atual de Tags"],
  [/tagsMenu:/, "interface anterior de Tags"],
];

const requiredReadmePatterns = [
  [/^# Botões para o CRM do GHL$/m, "título solicitado"],
  [/R\$ 18/, "contribuição simbólica"],
  [/Chave Pix:\*\* em breve/, "placeholder da chave Pix"],
  [/Pagamento em dólar:\*\* link em breve/, "placeholder do pagamento em dólar"],
];

const failures = [];

for (const [pattern, description] of requiredSourcePatterns) {
  if (!pattern.test(source)) failures.push(`Ausente no script: ${description}.`);
}

for (const [pattern, description] of requiredReadmePatterns) {
  if (!pattern.test(readme)) failures.push(`Ausente no README: ${description}.`);
}

if (/\b(?:fetch\s*\(|XMLHttpRequest\b|WebSocket\s*\()/u.test(source)) {
  failures.push("O script passou a iniciar uma conexão de rede própria.");
}

if (/https?:\/\//iu.test(source)) {
  failures.push("O script contém uma URL operacional.");
}

if (
  /logger\.(?:log|warn|error)\([^;]{0,600}\b(?:contactId|conversationId|contactName|user\.email|user\.id|user\.name)\b[^;]{0,600}\);/u.test(
    source,
  )
) {
  failures.push("O script registra dados identificáveis no console.");
}

const sensitivePatterns = [
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u, "chave privada"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/u, "token do GitHub"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/u, "token refinado do GitHub"],
  [/\bAKIA[0-9A-Z]{16}\b/u, "chave de acesso AWS"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/iu, "token Bearer"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u, "JWT"],
  [/\baccount_id\s*[:=]/iu, "ID de conta em configuração"],
  [/["'](?:api[_-]?key|access[_-]?token|client[_-]?secret|password)["']\s*[:=]\s*["'][^"']{8,}["']/iu, "segredo em configuração"],
];

for (const file of await collectFiles(root)) {
  const relativePath = path.relative(root, file);
  const content = await readFile(file, "utf8");

  for (const [pattern, description] of sensitivePatterns) {
    if (pattern.test(content)) {
      failures.push(`${relativePath}: possível ${description}.`);
    }
  }
}

if (failures.length > 0) {
  console.error("Validação pública reprovada:\n- " + failures.join("\n- "));
  process.exitCode = 1;
} else {
  console.log("Validação pública aprovada: sintaxe, documentação e verificações de segurança.");
}
