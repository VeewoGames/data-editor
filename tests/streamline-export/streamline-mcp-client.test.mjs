import test from "node:test";
import assert from "node:assert/strict";
import {
  callStreamlineMcpTool,
  normalizeStreamlineMcpIconMetadata,
  parseStreamlineMcpToolJsonText,
} from "../../scripts/streamline-export/lib/streamline-mcp-client.mjs";

test("parseStreamlineMcpToolJsonText parses SSE-wrapped tool json", async () => {
  const payload = await callStreamlineMcpTool({
    toolName: "get_icon_by_hash",
    arguments: { iconHash: "ico_attachment" },
    apiKey: "test-key",
    fetchImpl: async () => new Response([
      "event: message",
      "data: {\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"{\\\"hash\\\":\\\"ico_attachment\\\",\\\"tags\\\":[\\\"attachment\\\",\\\"paperclip\\\"]}\"}]},\"jsonrpc\":\"2.0\",\"id\":1}",
      "",
    ].join("\n"), { status: 200 }),
  });

  assert.deepEqual(parseStreamlineMcpToolJsonText(payload), {
    hash: "ico_attachment",
    tags: ["attachment", "paperclip"],
  });
});

test("callStreamlineMcpTool surfaces MCP tool errors", async () => {
  await assert.rejects(() => callStreamlineMcpTool({
    toolName: "get_icon_by_hash",
    arguments: { iconHash: "ico_attachment" },
    apiKey: "test-key",
    fetchImpl: async () => new Response([
      "event: message",
      "data: {\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"search_assets failed: bad request\"}],\"isError\":true},\"jsonrpc\":\"2.0\",\"id\":1}",
      "",
    ].join("\n"), { status: 200 }),
  }), /bad request/i);
});

test("normalizeStreamlineMcpIconMetadata keeps tags when returned", () => {
  assert.deepEqual(normalizeStreamlineMcpIconMetadata({
    hash: "ico_attachment",
    slug: "attachment-1",
    webUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582",
    tags: [" attachment ", "", "paperclip"],
  }), {
    hash: "ico_attachment",
    slug: "attachment-1",
    webUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582",
    tags: ["attachment", "paperclip"],
  });
});

test("normalizeStreamlineMcpIconMetadata strips fenced-code pollution from tags", () => {
  assert.deepEqual(normalizeStreamlineMcpIconMetadata({
    hash: "ico_chat",
    slug: "chat-bubble-disable-oval",
    webUrl: "https://www.streamlinehq.com/icons/download/chat-bubble-disable-oval--26641",
    tags: ["```plaintext\nchat", "disable", "nosound\n```"],
  }), {
    hash: "ico_chat",
    slug: "chat-bubble-disable-oval",
    webUrl: "https://www.streamlinehq.com/icons/download/chat-bubble-disable-oval--26641",
    tags: ["chat", "disable", "nosound"],
  });
});
