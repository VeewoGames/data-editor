export function normalizeSectionOnlyPolicy(value, invalid) {
  if (value == null) return null;
  if (!plain(value) || Object.keys(value).sort().join(",") !== "allowCreate,allowUpdate,heading,level"
    || typeof value.heading !== "string" || !value.heading.trim() || /[\r\n]/.test(value.heading)
    || !Number.isSafeInteger(value.level) || value.level < 1 || value.level > 6
    || typeof value.allowCreate !== "boolean" || typeof value.allowUpdate !== "boolean") invalid("textArtifactPolicy.sectionOnly is invalid");
  return structuredClone(value);
}

export function assertTextArtifactSectionPolicy(policy, artifact) {
  if (!policy?.sectionOnly || artifact === null) return;
  const section = policy.sectionOnly;
  if (artifact.beforeExists === false) {
    if (!section.allowCreate) fail("ENTRY_ACTION_TEXT_ARTIFACT_SECTION_POLICY_FAILED");
    locate(artifact.afterContent, section);
    return;
  }
  if (!section.allowUpdate || typeof artifact.beforeContent !== "string") fail("ENTRY_ACTION_TEXT_ARTIFACT_SECTION_STATE_REQUIRED");
  const before = locate(artifact.beforeContent, section); const after = locate(artifact.afterContent, section);
  if (artifact.beforeContent.slice(0, before.bodyStart) !== artifact.afterContent.slice(0, after.bodyStart)
    || artifact.beforeContent.slice(before.end) !== artifact.afterContent.slice(after.end)) fail("ENTRY_ACTION_TEXT_ARTIFACT_SECTION_POLICY_FAILED");
}

function locate(text, section) {
  if (typeof text !== "string") fail("ENTRY_ACTION_TEXT_ARTIFACT_SECTION_POLICY_FAILED");
  const headings = scanAtxHeadings(text);
  const matches = headings.filter((item) => item.level === section.level && item.text === section.heading);
  if (matches.length !== 1) fail("ENTRY_ACTION_TEXT_ARTIFACT_SECTION_POLICY_FAILED");
  const match = matches[0]; const next = headings.find((item) => item.index >= match.bodyStart && item.level <= section.level);
  return { bodyStart: match.bodyStart, end: next?.index ?? text.length };
}

function scanAtxHeadings(text) {
  const result = []; let offset = 0; let fence = null; let html = null;
  for (const raw of text.split(/(?<=\n)/u)) {
    const line = raw.endsWith("\n") ? raw.slice(0, -1).replace(/\r$/u, "") : raw.replace(/\r$/u, "");
    const bodyStart = offset + raw.length;
    if (html) { if ((html.blank && line.trim() === "") || (html.end && line.includes(html.end)) || (html.pattern && html.pattern.test(line))) html = null; offset += raw.length; continue; }
    const htmlStart = classifyHtmlBlock(line); if (htmlStart) { html = htmlStart.closed ? null : htmlStart; offset += raw.length; continue; }
    const fenceMatch = line.match(/^[ ]{0,3}(`{3,}|~{3,})/u);
    if (fenceMatch) { const marker = fenceMatch[1][0]; const length = fenceMatch[1].length; if (!fence) fence = { marker, length }; else if (fence.marker === marker && length >= fence.length && line.slice(line.indexOf(fenceMatch[1]) + length).trim() === "") fence = null; offset += raw.length; continue; }
    if (fence || /^(?: {4}|\t)/u.test(line)) { offset += raw.length; continue; }
    const heading = line.match(/^[ ]{0,3}(#{1,6})(?:[ \\t]+(.*)|[ \\t]*)$/u);
    if (heading) {
      const content = (heading[2] ?? "").replace(/[ \\t]+#+[ \\t]*$/u, "").trim();
      result.push({ index: offset, bodyStart, level: heading[1].length, text: content });
    }
    offset += raw.length;
  }
  if (fence || (html && !html.blank)) fail("ENTRY_ACTION_TEXT_ARTIFACT_SECTION_POLICY_FAILED");
  return result;
}

const HTML_BLOCK_TAGS = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
function classifyHtmlBlock(line) {
  const prefix = line.match(/^[ ]{0,3}(.*)$/u)?.[1] ?? line;
  const type1 = prefix.match(/^<(script|pre|style|textarea)(?:[ \\t>]|$)/iu); if (type1) { const pattern = new RegExp(`</${type1[1]}[ \\t]*>`, "iu"); return { pattern, closed: pattern.test(prefix), blank: false }; }
  if (prefix.startsWith("<!--")) return { end: "-->", closed: prefix.includes("-->"), blank: false };
  if (prefix.startsWith("<?")) return { end: "?>", closed: prefix.includes("?>"), blank: false };
  if (/^<![A-Z]/u.test(prefix)) return { end: ">", closed: prefix.includes(">"), blank: false };
  if (prefix.startsWith("<![CDATA[")) return { end: "]]>", closed: prefix.includes("]]>") , blank: false };
  const blockTag = new RegExp(`^</?(?:${HTML_BLOCK_TAGS})(?:[ \\t/>]|$)`, "iu"); if (blockTag.test(prefix)) return { blank: true, closed: false };
  const type7 = parseCompleteHtmlTag(prefix);
  if (type7 === "valid") return { blank: true, closed: false };
  if (type7 === "invalid") fail("ENTRY_ACTION_TEXT_ARTIFACT_SECTION_POLICY_FAILED");
  return null;
}

function parseCompleteHtmlTag(line) {
  if (line[0] !== "<") return "none";
  let index = 1; let closing = false;
  if (line[index] === "/") { closing = true; index += 1; }
  if (!isAsciiLetter(line[index])) return "none";
  index += 1;
  while (isAsciiLetter(line[index]) || isAsciiDigit(line[index]) || line[index] === "-") index += 1;
  if (!isHtmlWhitespace(line[index]) && line[index] !== ">" && line[index] !== "/") return "none";

  if (closing) {
    index = skipHtmlWhitespace(line, index);
    if (line[index] !== ">") return "invalid";
    return onlyTrailingHtmlWhitespace(line, index + 1) ? "valid" : "invalid";
  }

  while (index < line.length) {
    if (line[index] === ">") return onlyTrailingHtmlWhitespace(line, index + 1) ? "valid" : "invalid";
    if (line[index] === "/" && line[index + 1] === ">") return onlyTrailingHtmlWhitespace(line, index + 2) ? "valid" : "invalid";
    if (!isHtmlWhitespace(line[index])) return "invalid";
    index = skipHtmlWhitespace(line, index);
    if (line[index] === ">") return onlyTrailingHtmlWhitespace(line, index + 1) ? "valid" : "invalid";
    if (line[index] === "/" && line[index + 1] === ">") return onlyTrailingHtmlWhitespace(line, index + 2) ? "valid" : "invalid";
    if (!isAttributeNameStart(line[index])) return "invalid";
    index += 1;
    while (isAttributeNameContinuation(line[index])) index += 1;
    const equalsIndex = skipHtmlWhitespace(line, index);
    if (line[equalsIndex] !== "=") continue;
    index = skipHtmlWhitespace(line, equalsIndex + 1);
    const quote = line[index];
    if (quote === "\"" || quote === "'") {
      index += 1;
      while (index < line.length && line[index] !== quote) index += 1;
      if (index === line.length) return "invalid";
      index += 1;
      continue;
    }
    const valueStart = index;
    while (index < line.length && isUnquotedAttributeValueCharacter(line[index])) index += 1;
    if (index === valueStart) return "invalid";
  }
  return "invalid";
}

function skipHtmlWhitespace(line, index) { while (isHtmlWhitespace(line[index])) index += 1; return index; }
function onlyTrailingHtmlWhitespace(line, index) { return skipHtmlWhitespace(line, index) === line.length; }
function isHtmlWhitespace(character) { return character === " " || character === "\t"; }
function isAsciiLetter(character) { return typeof character === "string" && /^[A-Za-z]$/u.test(character); }
function isAsciiDigit(character) { return typeof character === "string" && /^[0-9]$/u.test(character); }
function isAttributeNameStart(character) { return isAsciiLetter(character) || character === "_" || character === ":"; }
function isAttributeNameContinuation(character) { return isAttributeNameStart(character) || isAsciiDigit(character) || character === "." || character === "-"; }
function isUnquotedAttributeValueCharacter(character) { return typeof character === "string" && !/[\u0000-\u0020"'`=<>]/u.test(character); }
function plain(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function fail(code) { throw Object.assign(new Error(code), { code }); }
