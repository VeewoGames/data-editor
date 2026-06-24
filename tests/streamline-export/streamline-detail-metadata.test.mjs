import test from "node:test";
import assert from "node:assert/strict";
import {
  extractDetailStatePayload,
  findIconDetailsInStatePayload,
  normalizeMetadataTags,
  parseStreamlineDetailMetadataRecord,
} from "../../scripts/streamline-export/lib/streamline-detail-metadata.mjs";

test("normalizeMetadataTags trims, lowercases, deduplicates, and removes empties", () => {
  assert.deepEqual(
    normalizeMetadataTags([" Paperclip ", "", "Affix", "paperclip", null, "attach "]),
    ["paperclip", "affix", "attach"],
  );
});

test("normalizeMetadataTags strips fenced-code wrappers before lowercasing", () => {
  assert.deepEqual(
    normalizeMetadataTags(["```plaintext\nChat", "disable", "nosound\n```"]),
    ["chat", "disable", "nosound"],
  );
});

test("extractDetailStatePayload returns parsed page state from application json", () => {
  const html = [
    "<html><body>",
    '<script type="application/json">{"props":{"pageProps":{"initialState":{"streamlineApi":{"queries":{}}}}}}</script>',
    "</body></html>",
  ].join("");

  assert.deepEqual(extractDetailStatePayload(html), {
    props: {
      pageProps: {
        initialState: {
          streamlineApi: {
            queries: {},
          },
        },
      },
    },
  });
});

test("extractDetailStatePayload also accepts raw script json text", () => {
  assert.deepEqual(
    extractDetailStatePayload('{"props":{"pageProps":{"initialState":{"streamlineApi":{"queries":{}}}}}}'),
    {
      props: {
        pageProps: {
          initialState: {
            streamlineApi: {
              queries: {},
            },
          },
        },
      },
    },
  );
});

test("findIconDetailsInStatePayload locates matching detail query payload", () => {
  const payload = {
    props: {
      pageProps: {
        initialState: {
          streamlineApi: {
            queries: {
              'getIconDetailsBySlugAndSubcategoryId({"iconSlug":"attachment-1","subcategoryId":26582})': {
                endpointName: "getIconDetailsBySlugAndSubcategoryId",
                originalArgs: {
                  iconSlug: "attachment-1",
                  subcategoryId: 26582,
                },
                data: {
                  slug: "attachment-1",
                  name: "Attachment 1",
                  tags: ["attachment", "paperclip", "clip", "affix"],
                },
              },
            },
          },
        },
      },
    },
  };

  assert.deepEqual(
    findIconDetailsInStatePayload(payload, {
      iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582",
      slug: "attachment-1",
    }),
    {
      name: "Attachment 1",
      slug: "attachment-1",
      sourceId: "26582",
      tags: ["attachment", "paperclip", "clip", "affix"],
    },
  );
});

test("parseStreamlineDetailMetadataRecord extracts normalized metadata from html", () => {
  const html = [
    "<html><body>",
    '<script type="application/json">',
    JSON.stringify({
      props: {
        pageProps: {
          initialState: {
            streamlineApi: {
              queries: {
                'getIconDetailsBySlugAndSubcategoryId({"iconSlug":"attachment-1","subcategoryId":26582})': {
                  endpointName: "getIconDetailsBySlugAndSubcategoryId",
                  originalArgs: {
                    iconSlug: "attachment-1",
                    subcategoryId: 26582,
                  },
                  data: {
                    slug: "attachment-1",
                    name: "Attachment 1",
                    tags: ["Attachment", "paperclip", "Affix", "paperclip", ""],
                  },
                },
              },
            },
          },
        },
      },
    }),
    "</script>",
    "</body></html>",
  ].join("");

  assert.deepEqual(
    parseStreamlineDetailMetadataRecord(html, {
      iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582",
      slug: "attachment-1",
    }),
    {
      iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582",
      name: "Attachment 1",
      slug: "attachment-1",
      sourceId: "26582",
      tags: ["attachment", "paperclip", "affix"],
    },
  );
});

test("parseStreamlineDetailMetadataRecord throws when matching detail query is absent", () => {
  assert.throws(
    () => parseStreamlineDetailMetadataRecord("<html><body></body></html>", {
      iconUrl: "https://www.streamlinehq.com/icons/download/attachment-1--26582",
      slug: "attachment-1",
    }),
    /Streamline detail metadata payload not found/,
  );
});
