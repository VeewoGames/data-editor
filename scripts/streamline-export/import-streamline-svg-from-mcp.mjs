import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadManifest,
  markManifestItemFailed,
  markManifestItemSuccess,
} from "./lib/manifest-store.mjs";
import { writeSvgFile } from "./lib/file-writer.mjs";
import {
  callStreamlineMcpTool,
  parseStreamlineMcpToolJsonText,
} from "./lib/streamline-mcp-client.mjs";

function isSvgText(value) {
  return typeof value === "string" && value.trimStart().startsWith("<svg");
}

function selectManifestSvgCandidateItems(items, { force = false, retryFailed = false, maxItems } = {}) {
  const sourceItems = Array.isArray(items) ? items : [];
  const selected = sourceItems.filter((item) => {
    if (force) {
      return true;
    }
    if (item?.status === "success") {
      return false;
    }
    if (item?.status === "failed") {
      return retryFailed;
    }
    return true;
  });

  if (Number.isInteger(maxItems) && maxItems > 0) {
    return selected.slice(0, maxItems);
  }
  return selected;
}

async function fetchManifestItemSvgFromMcp({
  item,
  apiKey,
  callTool = callStreamlineMcpTool,
} = {}) {
  if (!item?.hash) {
    return {
      itemId: item.itemId ?? item.slug,
      slug: item.slug,
      ok: false,
      error: `Missing official hash for ${item.slug}`,
    };
  }

  try {
    const payload = await callTool({
      toolName: "get_icon_by_hash",
      arguments: {
        iconHash: item.hash,
      },
      apiKey,
    });
    const record = parseStreamlineMcpToolJsonText(payload);
    const svg = typeof record?.svg === "string" ? record.svg.trim() : "";
    if (!isSvgText(svg)) {
      return {
        itemId: item.itemId ?? item.slug,
        slug: item.slug,
        ok: false,
        error: `Official MCP asset returned no svg for hash ${item.hash}`,
      };
    }
    return {
      itemId: item.itemId ?? item.slug,
      slug: item.slug,
      ok: true,
      svg,
    };
  } catch (error) {
    return {
      itemId: item.itemId ?? item.slug,
      slug: item.slug,
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

export async function importManifestSvgFromMcp({
  manifestPath,
  apiKey,
  maxItems,
  force = false,
  retryFailed = false,
  concurrency = 1,
  callTool = callStreamlineMcpTool,
} = {}) {
  if (!manifestPath || !apiKey) {
    throw new Error("importManifestSvgFromMcp requires manifestPath and apiKey");
  }
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error("importManifestSvgFromMcp requires concurrency >= 1");
  }

  const manifest = await loadManifest(manifestPath);
  const selectedItems = selectManifestSvgCandidateItems(manifest.items, {
    force,
    retryFailed,
    maxItems,
  });
  const results = [];

  for (let offset = 0; offset < selectedItems.length; offset += concurrency) {
    const chunk = selectedItems.slice(offset, offset + concurrency);
    const chunkResults = await Promise.all(chunk.map((item) => fetchManifestItemSvgFromMcp({
      item,
      apiKey,
      callTool,
    })));

    for (let index = 0; index < chunkResults.length; index += 1) {
      const result = chunkResults[index];
      const item = chunk[index];
      if (result.ok) {
        await writeSvgFile(resolve(item.outputPath), result.svg);
        await markManifestItemSuccess({
          manifestPath,
          itemId: item.itemId,
          slug: item.slug,
          extractedAt: new Date().toISOString(),
        });
      } else {
        await markManifestItemFailed({
          manifestPath,
          itemId: item.itemId,
          slug: item.slug,
          error: result.error,
        });
      }
    }

    results.push(...chunkResults);
  }

  return {
    family: manifest.family,
    total: selectedItems.length,
    success: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results,
  };
}

function parseCliArgs(argv) {
  const options = {
    manifestPath: "",
    maxItems: undefined,
    force: false,
    retryFailed: false,
    concurrency: 1,
  };
  const positional = [];
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--force") {
      options.force = true;
      continue;
    }
    if (value === "--retry-failed") {
      options.retryFailed = true;
      continue;
    }
    if (value === "--max-items") {
      const nextValue = argv[index + 1];
      if (!nextValue) throw new Error("--max-items requires a value");
      options.maxItems = Number.parseInt(nextValue, 10);
      index += 1;
      continue;
    }
    if (value === "--concurrency") {
      const nextValue = argv[index + 1];
      if (!nextValue) throw new Error("--concurrency requires a value");
      options.concurrency = Number.parseInt(nextValue, 10);
      index += 1;
      continue;
    }
    positional.push(value);
  }
  options.manifestPath = positional[0] ? resolve(positional[0]) : "";
  return options;
}

async function main(argv) {
  const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const parsed = parseCliArgs(argv);
  const manifestPath = parsed.manifestPath ? resolve(projectRoot, parsed.manifestPath) : "";
  const apiKey = process.env.STREAMLINE_API_KEY ?? "";
  if (!manifestPath) {
    throw new Error("Usage: STREAMLINE_API_KEY=<key> node scripts/streamline-export/import-streamline-svg-from-mcp.mjs <manifestPath> [--max-items <n>] [--concurrency <n>] [--force] [--retry-failed]");
  }
  if (!apiKey) {
    throw new Error("STREAMLINE_API_KEY is required");
  }

  const result = await importManifestSvgFromMcp({
    manifestPath,
    apiKey,
    maxItems: parsed.maxItems,
    force: parsed.force,
    retryFailed: parsed.retryFailed,
    concurrency: parsed.concurrency,
  });
  console.log(JSON.stringify({ manifestPath, ...result }, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("import-streamline-svg-from-mcp.mjs")) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
