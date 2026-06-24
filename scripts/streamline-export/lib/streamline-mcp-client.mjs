import { normalizeStreamlineTags } from "./streamline-tag-normalization.mjs";

const defaultMcpUrl = "https://public-api.streamlinehq.com/mcp";

function extractSseJsonPayload(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const dataLine = lines.find((line) => line.startsWith("data:"));
  if (!dataLine) {
    throw new Error("MCP SSE response did not include a data payload");
  }
  return JSON.parse(dataLine.slice(5).trim());
}

function extractToolContentText(payload) {
  const content = Array.isArray(payload?.result?.content) ? payload.result.content : [];
  const textPart = content.find((item) => item?.type === "text" && typeof item?.text === "string");
  if (!textPart?.text) {
    throw new Error("MCP tool response did not include text content");
  }
  return textPart.text;
}

export async function callStreamlineMcpTool({
  toolName,
  arguments: toolArguments = {},
  apiKey,
  mcpUrl = defaultMcpUrl,
  fetchImpl = fetch,
} = {}) {
  if (!toolName || !apiKey) {
    throw new Error("callStreamlineMcpTool requires toolName and apiKey");
  }

  const response = await fetchImpl(mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: toolArguments,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
  }

  const payload = extractSseJsonPayload(await response.text());
  if (payload?.result?.isError) {
    throw new Error(extractToolContentText(payload));
  }
  return payload;
}

export function parseStreamlineMcpToolJsonText(payload) {
  return JSON.parse(extractToolContentText(payload));
}

export function normalizeStreamlineMcpIconMetadata(record) {
  const tags = normalizeStreamlineTags(record?.tags);

  return {
    hash: typeof record?.hash === "string" && record.hash.trim() ? record.hash.trim() : null,
    slug: typeof record?.slug === "string" && record.slug.trim() ? record.slug.trim() : null,
    webUrl: typeof record?.webUrl === "string" && record.webUrl.trim() ? record.webUrl.trim() : null,
    tags,
  };
}
