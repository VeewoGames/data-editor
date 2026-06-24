export function normalizeParts(itemId) {
  return String(itemId ?? "")
    .toLowerCase()
    .split("-")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function dedupeTags(tags) {
  const seen = new Set();
  const result = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    const normalized = String(tag ?? "").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function hasPart(parts, token) {
  return parts.includes(token);
}

function hasAllParts(parts, tokens) {
  return tokens.every((token) => parts.includes(token));
}

function hasOrderedParts(parts, firstToken, secondToken) {
  const firstIndex = parts.indexOf(firstToken);
  const secondIndex = parts.indexOf(secondToken);
  return firstIndex !== -1 && secondIndex !== -1 && firstIndex < secondIndex;
}

function tokenRule(token, tags) {
  return {
    match: (parts) => hasPart(parts, token),
    tags,
  };
}

function allPartsRule(tokens, tags) {
  return {
    match: (parts) => hasAllParts(parts, tokens),
    tags,
  };
}

function orderedRule(firstToken, secondToken, tags) {
  return {
    match: (parts) => hasOrderedParts(parts, firstToken, secondToken),
    tags,
  };
}

function buildTagsFromTemplate(parts, {
  baseTags = [],
  rules = [],
  maxTags = 8,
} = {}) {
  const tags = [...baseTags];
  for (const rule of rules) {
    if (rule?.match?.(parts)) {
      tags.push(...(Array.isArray(rule.tags) ? rule.tags : []));
    }
  }
  return dedupeTags(tags).slice(0, maxTags);
}

function buildWarningTags(parts) {
  const tags = ["warning", "alert", "caution", "exclamation"];

  if (parts.includes("circle")) tags.push("circle");
  if (parts.includes("diamond")) tags.push("diamond");
  if (parts.includes("octagon")) tags.push("octagon");
  if (parts.includes("shield")) tags.push("shield");
  if (parts.includes("square")) tags.push("square");
  if (parts.includes("triangle")) tags.push("triangle");

  return dedupeTags(tags).slice(0, 8);
}

function buildShareTags(parts) {
  const tags = ["share"];

  if (parts.includes("code")) {
    tags.push("code", "programming", "software");
  }
  if (parts.includes("hand") && parts.includes("lock")) {
    tags.push("lock", "privacy", "secure");
  }
  if (parts.includes("heart")) {
    tags.push("heart", "favorite", "like");
  }
  if (parts.includes("link") && parts.includes("approved")) {
    tags.push("link", "approved", "network");
  }
  if (parts.includes("link") && parts.includes("circle")) {
    tags.push("link", "circle", "network");
  }
  if (parts.includes("link") && parts.includes("lock")) {
    tags.push("link", "lock", "privacy", "secure");
  }
  if (parts.includes("symbol")) {
    tags.push("symbol");
  }
  if (parts.includes("user")) {
    tags.push("user", "account");
  }

  return dedupeTags(tags).slice(0, 8);
}

function buildTimeTags(parts) {
  const tags = ["time"];

  if (parts.includes("alarm")) {
    tags.push("alarm", "alert", "reminder");
  }
  if (parts.includes("clock")) {
    tags.push("clock");
  }
  if (parts.includes("circle")) {
    tags.push("circle");
  }
  if (parts.includes("square")) {
    tags.push("square");
  }
  if (parts.includes("hand")) {
    tags.push("hand");
  }
  if (parts.includes("history") && parts.includes("off")) {
    tags.push("history", "off", "disable");
  }
  if (parts.includes("hour") && parts.includes("glass")) {
    tags.push("hourglass");
  }
  if (parts.includes("lapse")) {
    tags.push("lapse");
  }
  if (parts.includes("midnight")) {
    tags.push("midnight");
  }
  if (parts.includes("reset")) {
    tags.push("reset");
  }
  if (parts.includes("timer")) {
    tags.push("timer");
  }
  if (parts.includes("three")) {
    tags.push("three", "digit");
  }
  if (parts.includes("six")) {
    tags.push("six", "digit");
  }
  if (parts.includes("nine")) {
    tags.push("nine", "digit");
  }

  return dedupeTags(tags).slice(0, 8);
}

function buildUserTags(parts) {
  return buildTagsFromTemplate(parts, {
    baseTags: ["user"],
    rules: [
      tokenRule("add", ["add", "plus"]),
      tokenRule("block", ["block", "disable", "deny"]),
      tokenRule("check", ["check", "verify", "approve"]),
      tokenRule("circle", ["circle", "profile"]),
      tokenRule("delete", ["delete", "remove"]),
      tokenRule("edit", ["edit"]),
      tokenRule("following", ["following", "account"]),
      allPartsRule(["identifier", "card"], ["identifier", "card", "id"]),
      tokenRule("multiple", ["multiple", "group"]),
      tokenRule("off", ["off", "disable", "inactive"]),
      tokenRule("protection", ["protection", "security", "shield"]),
      allPartsRule(["question", "query"], ["question", "query", "help"]),
      allPartsRule(["refresh", "sync"], ["refresh", "sync"]),
      allPartsRule(["remove", "subtract"], ["remove", "subtract", "minus"]),
      allPartsRule(["search", "magnifier"], ["search", "find", "magnifier"]),
      tokenRule("share", ["share", "account"]),
      tokenRule("single", ["single", "profile"]),
      tokenRule("square", ["square", "profile"]),
      tokenRule("story", ["story", "profile"]),
      {
        match: (currentParts) => hasPart(currentParts, "sync") && !hasPart(currentParts, "refresh"),
        tags: ["sync", "account"],
      },
      allPartsRule(["team", "community"], ["team", "community", "group"]),
      tokenRule("warning", ["warning", "alert"]),
    ],
  });
}

function buildShoppingTags(parts) {
  return buildTagsFromTemplate(parts, {
    baseTags: ["shopping"],
    rules: [
      tokenRule("bag", ["bag", "commerce"]),
      tokenRule("basket", ["basket", "commerce"]),
      tokenRule("cart", ["cart", "checkout", "commerce"]),
      tokenRule("store", ["store", "commerce"]),
      tokenRule("signage", ["signage", "store"]),
      tokenRule("add", ["add", "plus"]),
      tokenRule("remove", ["remove", "delete"]),
      tokenRule("subtract", ["subtract", "minus"]),
      tokenRule("check", ["check", "approve"]),
      tokenRule("cross", ["cross", "remove"]),
      tokenRule("heavy", ["heavy"]),
      tokenRule("load", ["load"]),
      tokenRule("unload", ["unload"]),
    ],
  });
}

function buildLaptopTags(parts) {
  return buildTagsFromTemplate(parts, {
    baseTags: ["laptop", "computer"],
    rules: [
      allPartsRule(["add", "plus"], ["add", "plus"]),
      allPartsRule(["block", "remove"], ["block", "remove", "disable"]),
      tokenRule("charging", ["charging", "power", "battery"]),
      allPartsRule(["check", "validate"], ["check", "validate", "approve"]),
      allPartsRule(["delete", "cross"], ["delete", "cross", "remove"]),
      tokenRule("disable", ["disable", "inactive"]),
      tokenRule("help", ["help", "support"]),
      tokenRule("lock", ["lock", "secure", "privacy"]),
      allPartsRule(["project", "screen"], ["project", "screen", "display"]),
      allPartsRule(["remove", "subtract"], ["remove", "subtract", "minus"]),
      tokenRule("search", ["search", "find"]),
      tokenRule("setting", ["setting", "gear"]),
      tokenRule("warning", ["warning", "alert"]),
    ],
  });
}

function buildTextTags(parts) {
  const tags = ["text"];

  if (parts.includes("bar")) {
    tags.push("bar", "formatting");
  }
  if (parts.includes("box")) {
    tags.push("box", "container");
  }
  if (parts.includes("character")) {
    tags.push("character", "typography");
  }
  if (parts.includes("flow") && parts.includes("columns")) {
    tags.push("flow", "columns", "layout");
  }
  if (parts.includes("flow") && parts.includes("rows")) {
    tags.push("flow", "rows", "layout");
  }
  if (parts.includes("line") && parts.includes("spacing")) {
    tags.push("line", "spacing", "formatting");
  }
  if (parts.includes("search")) {
    tags.push("search", "find");
  }
  if (parts.includes("select") && parts.includes("start")) {
    tags.push("select", "start");
  }
  if (parts.includes("shadow")) {
    tags.push("shadow");
  }
  if (parts.includes("square")) {
    tags.push("square");
  }
  if (parts.includes("strike") && parts.includes("through")) {
    tags.push("strike", "through", "formatting");
  }
  if (parts.includes("style")) {
    tags.push("style", "formatting");
  }
  if (parts.includes("speech")) {
    tags.push("speech", "audio");
  }

  return dedupeTags(tags).slice(0, 8);
}

function buildVolumeTags(parts) {
  const tags = ["volume", "audio"];

  if (parts.includes("decrease")) {
    tags.push("decrease", "down");
  }
  if (parts.includes("disable") && parts.includes("mute")) {
    tags.push("disable", "mute", "off");
  }
  if (parts.includes("high")) {
    tags.push("high", "speaker");
  }
  if (parts.includes("increase")) {
    tags.push("increase", "up");
  }
  if (parts.includes("low")) {
    tags.push("low", "speaker");
  }
  if (parts.includes("setting")) {
    tags.push("setting", "control");
  }
  if (parts.includes("sleep")) {
    tags.push("sleep");
  }
  if (parts.includes("speaker")) {
    tags.push("speaker");
  }
  if (parts.includes("warning")) {
    tags.push("warning", "alert");
  }
  if (parts.includes("2")) {
    tags.push("speaker");
  }

  return dedupeTags(tags).slice(0, 8);
}

function buildSelectTags(parts) {
  const tags = ["select"];

  if (parts.includes("all")) {
    tags.push("all");
  }
  if (parts.includes("back")) {
    tags.push("back");
  }
  if (parts.includes("button")) {
    tags.push("button");
  }
  if (parts.includes("circle") && parts.includes("area")) {
    tags.push("circle", "area");
  }
  if (parts.includes("frame")) {
    tags.push("frame");
  }
  if (parts.includes("front")) {
    tags.push("front");
  }
  if (parts.includes("none")) {
    tags.push("none");
  }
  if (parts.includes("square") && parts.includes("area")) {
    tags.push("square", "area");
  }

  return dedupeTags(tags).slice(0, 8);
}

function buildListTags(parts) {
  return buildTagsFromTemplate(parts, {
    baseTags: ["list"],
    rules: [
      {
        match: (currentParts) => hasOrderedParts(currentParts, "1", "9") && hasPart(currentParts, "arrangement"),
        tags: ["sort", "ascending", "numbers"],
      },
      {
        match: (currentParts) => hasOrderedParts(currentParts, "9", "1") && hasPart(currentParts, "arrangement"),
        tags: ["sort", "descending", "numbers"],
      },
      {
        match: (currentParts) => hasOrderedParts(currentParts, "a", "z") && hasPart(currentParts, "arrangement"),
        tags: ["sort", "ascending", "alphabet"],
      },
      {
        match: (currentParts) => hasOrderedParts(currentParts, "z", "a") && hasPart(currentParts, "arrangement"),
        tags: ["sort", "descending", "alphabet"],
      },
      tokenRule("add", ["add", "plus"]),
      tokenRule("bullets", ["bullets", "formatting"]),
      tokenRule("check", ["check", "tasks"]),
      tokenRule("remove", ["remove", "delete"]),
      allPartsRule(["to", "do", "tasks", "checklist"], ["todo", "tasks", "checklist"]),
    ],
  });
}

function buildLocationTags(parts) {
  return buildTagsFromTemplate(parts, {
    baseTags: ["location"],
    rules: [
      tokenRule("compass", ["compass", "navigation"]),
      tokenRule("pin", ["pin", "marker"]),
      tokenRule("disabled", ["disabled", "off"]),
      allPartsRule(["option", "add"], ["add", "plus"]),
      allPartsRule(["option", "check"], ["check", "confirm"]),
      allPartsRule(["option", "remove"], ["remove", "delete"]),
      allPartsRule(["target", "off"], ["target", "off", "disable"]),
    ],
  });
}

function buildWifiTags(parts) {
  return buildTagsFromTemplate(parts, {
    baseTags: ["wifi", "network"],
    rules: [
      tokenRule("antenna", ["antenna", "signal"]),
      tokenRule("disabled", ["disabled", "off"]),
      allPartsRule(["not", "secure", "connection"], ["connection", "insecure"]),
      {
        match: (currentParts) => hasAllParts(currentParts, ["secure", "connection"]) && !hasPart(currentParts, "not"),
        tags: ["connection", "secure"],
      },
      allPartsRule(["signal", "low"], ["signal", "low"]),
      allPartsRule(["signal", "medium"], ["signal", "medium"]),
      allPartsRule(["signal", "none"], ["signal", "none"]),
    ],
  });
}

function buildMusicTags(parts) {
  return buildTagsFromTemplate(parts, {
    baseTags: ["music", "note", "audio"],
    rules: [
      tokenRule("circle", ["circle"]),
      tokenRule("off", ["off", "mute", "disable"]),
    ],
  });
}

function buildPathfinderTags(parts) {
  return buildTagsFromTemplate(parts, {
    baseTags: ["pathfinder"],
    rules: [
      tokenRule("circle", ["circle"]),
      tokenRule("square", ["square"]),
      tokenRule("divide", ["divide", "split"]),
      tokenRule("exclude", ["exclude", "subtract"]),
      tokenRule("intersect", ["intersect", "overlap"]),
      tokenRule("merge", ["merge", "combine"]),
      tokenRule("minus", ["minus"]),
      tokenRule("outline", ["outline"]),
      tokenRule("trim", ["trim"]),
      tokenRule("union", ["union", "combine"]),
      tokenRule("back", ["back", "layer"]),
      tokenRule("front", ["front", "layer"]),
    ],
  });
}

function buildPlayTags(parts) {
  return buildTagsFromTemplate(parts, {
    baseTags: ["play", "playlist"],
    rules: [
      tokenRule("folder", ["folder"]),
      tokenRule("phone", ["phone"]),
      {
        match: (currentParts) => ["1", "2", "3", "4"].some((token) => hasPart(currentParts, token)),
        tags: ["list"],
      },
    ],
  });
}

function buildPrintTags(parts) {
  return buildTagsFromTemplate(parts, {
    baseTags: ["print", "printer"],
    rules: [
      tokenRule("add", ["add", "plus"]),
      tokenRule("remove", ["remove", "delete"]),
      tokenRule("error", ["error", "alert"]),
      {
        match: (currentParts) => hasPart(currentParts, "off") || hasPart(currentParts, "disabled"),
        tags: ["off", "disable"],
      },
      tokenRule("connected", ["connected"]),
      tokenRule("disconnected", ["disconnected"]),
    ],
  });
}

function buildScreenTags(parts) {
  return buildTagsFromTemplate(parts, {
    baseTags: ["screen", "display"],
    rules: [
      tokenRule("broadcast", ["broadcast"]),
      tokenRule("sharing", ["sharing"]),
      tokenRule("tutorial", ["tutorial"]),
      tokenRule("tv", ["tv"]),
    ],
  });
}

function buildTimerTags(parts) {
  return buildTagsFromTemplate(parts, {
    baseTags: ["timer", "time"],
    rules: [
      tokenRule("10", ["10", "seconds"]),
      tokenRule("3", ["3", "seconds"]),
      tokenRule("5", ["5", "seconds"]),
      tokenRule("auto", ["auto"]),
      tokenRule("pace", ["pace"]),
      tokenRule("average", ["average"]),
    ],
  });
}

function buildZoomTags(parts) {
  return buildTagsFromTemplate(parts, {
    baseTags: ["zoom"],
    rules: [
      tokenRule("area", ["area"]),
      allPartsRule(["fit", "screen"], ["fit", "screen"]),
      allPartsRule(["in", "area"], ["in", "area"]),
      {
        match: (currentParts) => hasPart(currentParts, "in") && !hasPart(currentParts, "area"),
        tags: ["in"],
      },
      allPartsRule(["out", "area"], ["out", "area"]),
      {
        match: (currentParts) => hasPart(currentParts, "out") && !hasPart(currentParts, "area"),
        tags: ["out"],
      },
    ],
  });
}

function buildLightTags(parts) {
  return buildTagsFromTemplate(parts, {
    baseTags: ["light"],
    rules: [
      allPartsRule(["bulb", "on"], ["bulb", "on"]),
      allPartsRule(["dark", "mode"], ["dark", "mode"]),
      allPartsRule(["display", "mode"], ["display", "mode"]),
      allPartsRule(["home", "ceiling", "on"], ["home", "ceiling", "on"]),
      tokenRule("off", ["off", "disable"]),
    ],
  });
}

function buildLockTags(parts) {
  return buildTagsFromTemplate(parts, {
    baseTags: ["lock", "secure"],
    rules: [
      tokenRule("circle", ["circle"]),
      tokenRule("key", ["key"]),
      tokenRule("rotation", ["rotation"]),
      tokenRule("shield", ["shield", "protection"]),
    ],
  });
}

function buildMoveTags(parts) {
  return buildTagsFromTemplate(parts, {
    baseTags: ["move"],
    rules: [
      tokenRule("circle", ["circle"]),
      allPartsRule(["object", "down"], ["object", "down"]),
      allPartsRule(["object", "left"], ["object", "left"]),
      allPartsRule(["object", "right"], ["object", "right"]),
      allPartsRule(["object", "up"], ["object", "up"]),
    ],
  });
}

function buildNotepadTags(parts) {
  return buildTagsFromTemplate(parts, {
    baseTags: ["notepad"],
    rules: [
      tokenRule("add", ["add", "plus"]),
      tokenRule("check", ["check", "confirm"]),
      tokenRule("remove", ["remove", "delete"]),
      tokenRule("subtract", ["subtract", "minus"]),
      tokenRule("text", ["text"]),
    ],
  });
}

function buildShipmentTags(parts) {
  return buildTagsFromTemplate(parts, {
    baseTags: ["shipment"],
    rules: [
      tokenRule("add", ["add", "plus"]),
      tokenRule("check", ["check", "confirm"]),
      tokenRule("favorite", ["favorite", "bookmark"]),
      tokenRule("remove", ["remove", "delete"]),
      tokenRule("search", ["search", "find"]),
    ],
  });
}

function buildSignalTags(parts) {
  return buildTagsFromTemplate(parts, {
    baseTags: ["signal"],
    rules: [
      tokenRule("disconnected", ["disconnected", "network"]),
      tokenRule("graph", ["graph", "bars"]),
      allPartsRule(["graph", "circle"], ["circle"]),
      tokenRule("loading", ["loading"]),
      tokenRule("square", ["square"]),
    ],
  });
}

function buildScrollTags(parts) {
  return buildTagsFromTemplate(parts, {
    baseTags: ["scroll"],
    rules: [
      tokenRule("top", ["top"]),
      tokenRule("up", ["up", "arrow"]),
      {
        match: (currentParts) => hasAllParts(currentParts, ["up", "down"]),
        tags: ["down", "arrows"],
      },
    ],
  });
}

function buildShieldTags(parts) {
  return buildTagsFromTemplate(parts, {
    baseTags: ["shield", "protection", "security"],
    rules: [
      tokenRule("check", ["check", "confirm"]),
      tokenRule("cross", ["cross", "remove"]),
      tokenRule("privacy", ["privacy"]),
      tokenRule("protection", ["moderation"]),
      tokenRule("moderator", ["moderator"]),
      tokenRule("add", ["add", "plus"]),
      tokenRule("star", ["star"]),
      tokenRule("police", ["police"]),
      tokenRule("badge", ["badge"]),
    ],
  });
}

function buildSignTags(parts) {
  return buildTagsFromTemplate(parts, {
    baseTags: ["sign", "symbol"],
    rules: [
      tokenRule("cross", ["cross"]),
      tokenRule("circle", ["circle"]),
      tokenRule("shield", ["shield"]),
      tokenRule("square", ["square"]),
    ],
  });
}

export const stableClusterProfiles = {
  warning: {
    prefix: "warning-",
    promotedBy: "stable_prefix_batch5",
    reportKind: "streamline-stable-prefix-batch5-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch5-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch5-suggestions.json",
    buildTagsFromParts: buildWarningTags,
  },
  share: {
    prefix: "share-",
    promotedBy: "stable_prefix_batch6",
    reportKind: "streamline-stable-prefix-batch6-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch6-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch6-suggestions.json",
    buildTagsFromParts: buildShareTags,
  },
  time: {
    prefix: "time-",
    promotedBy: "stable_prefix_batch7",
    reportKind: "streamline-stable-prefix-batch7-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch7-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch7-suggestions.json",
    buildTagsFromParts: buildTimeTags,
  },
  user: {
    prefix: "user-",
    promotedBy: "stable_prefix_batch8",
    reportKind: "streamline-stable-prefix-batch8-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch8-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch8-suggestions.json",
    buildTagsFromParts: buildUserTags,
  },
  shopping: {
    prefix: "shopping-",
    promotedBy: "stable_prefix_batch9",
    reportKind: "streamline-stable-prefix-batch9-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch9-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch9-suggestions.json",
    buildTagsFromParts: buildShoppingTags,
  },
  laptop: {
    prefix: "laptop-",
    promotedBy: "stable_prefix_batch10",
    reportKind: "streamline-stable-prefix-batch10-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch10-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch10-suggestions.json",
    buildTagsFromParts: buildLaptopTags,
  },
  text: {
    prefix: "text-",
    promotedBy: "stable_prefix_batch11",
    reportKind: "streamline-stable-prefix-batch11-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch11-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch11-suggestions.json",
    buildTagsFromParts: buildTextTags,
  },
  volume: {
    prefix: "volume-",
    promotedBy: "stable_prefix_batch12",
    reportKind: "streamline-stable-prefix-batch12-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch12-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch12-suggestions.json",
    buildTagsFromParts: buildVolumeTags,
  },
  select: {
    prefix: "select-",
    promotedBy: "stable_prefix_batch13",
    reportKind: "streamline-stable-prefix-batch13-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch13-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch13-suggestions.json",
    buildTagsFromParts: buildSelectTags,
  },
  list: {
    prefix: "list-",
    promotedBy: "stable_prefix_batch14",
    reportKind: "streamline-stable-prefix-batch14-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch14-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch14-suggestions.json",
    buildTagsFromParts: buildListTags,
  },
  location: {
    prefix: "location-",
    promotedBy: "stable_prefix_batch15",
    reportKind: "streamline-stable-prefix-batch15-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch15-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch15-suggestions.json",
    buildTagsFromParts: buildLocationTags,
  },
  wifi: {
    prefix: "wifi-",
    promotedBy: "stable_prefix_batch16",
    reportKind: "streamline-stable-prefix-batch16-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch16-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch16-suggestions.json",
    buildTagsFromParts: buildWifiTags,
  },
  music: {
    prefix: "music-",
    promotedBy: "stable_prefix_batch17",
    reportKind: "streamline-stable-prefix-batch17-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch17-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch17-suggestions.json",
    buildTagsFromParts: buildMusicTags,
  },
  pathfinder: {
    prefix: "pathfinder-",
    promotedBy: "stable_prefix_batch18",
    reportKind: "streamline-stable-prefix-batch18-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch18-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch18-suggestions.json",
    buildTagsFromParts: buildPathfinderTags,
  },
  play: {
    prefix: "play-",
    promotedBy: "stable_prefix_batch19",
    reportKind: "streamline-stable-prefix-batch19-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch19-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch19-suggestions.json",
    buildTagsFromParts: buildPlayTags,
  },
  print: {
    prefix: "print-",
    promotedBy: "stable_prefix_batch20",
    reportKind: "streamline-stable-prefix-batch20-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch20-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch20-suggestions.json",
    buildTagsFromParts: buildPrintTags,
  },
  screen: {
    prefix: "screen-",
    promotedBy: "stable_prefix_batch21",
    reportKind: "streamline-stable-prefix-batch21-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch21-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch21-suggestions.json",
    buildTagsFromParts: buildScreenTags,
  },
  timer: {
    prefix: "timer-",
    promotedBy: "stable_prefix_batch22",
    reportKind: "streamline-stable-prefix-batch22-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch22-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch22-suggestions.json",
    buildTagsFromParts: buildTimerTags,
  },
  zoom: {
    prefix: "zoom-",
    promotedBy: "stable_prefix_batch23",
    reportKind: "streamline-stable-prefix-batch23-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch23-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch23-suggestions.json",
    buildTagsFromParts: buildZoomTags,
  },
  light: {
    prefix: "light-",
    promotedBy: "stable_prefix_batch24",
    reportKind: "streamline-stable-prefix-batch24-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch24-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch24-suggestions.json",
    buildTagsFromParts: buildLightTags,
  },
  lock: {
    prefix: "lock-",
    promotedBy: "stable_prefix_batch25",
    reportKind: "streamline-stable-prefix-batch25-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch25-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch25-suggestions.json",
    buildTagsFromParts: buildLockTags,
  },
  move: {
    prefix: "move-",
    promotedBy: "stable_prefix_batch26",
    reportKind: "streamline-stable-prefix-batch26-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch26-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch26-suggestions.json",
    buildTagsFromParts: buildMoveTags,
  },
  notepad: {
    prefix: "notepad-",
    promotedBy: "stable_prefix_batch27",
    reportKind: "streamline-stable-prefix-batch27-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch27-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch27-suggestions.json",
    buildTagsFromParts: buildNotepadTags,
  },
  shipment: {
    prefix: "shipment-",
    promotedBy: "stable_prefix_batch28",
    reportKind: "streamline-stable-prefix-batch28-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch28-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch28-suggestions.json",
    buildTagsFromParts: buildShipmentTags,
  },
  signal: {
    prefix: "signal-",
    promotedBy: "stable_prefix_batch29",
    reportKind: "streamline-stable-prefix-batch29-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch29-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch29-suggestions.json",
    buildTagsFromParts: buildSignalTags,
  },
  scroll: {
    prefix: "scroll-",
    promotedBy: "stable_prefix_batch30",
    reportKind: "streamline-stable-prefix-batch30-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch30-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch30-suggestions.json",
    buildTagsFromParts: buildScrollTags,
  },
  shield: {
    prefix: "shield-",
    promotedBy: "stable_prefix_batch31",
    reportKind: "streamline-stable-prefix-batch31-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch31-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch31-suggestions.json",
    buildTagsFromParts: buildShieldTags,
  },
  sign: {
    prefix: "sign-",
    promotedBy: "stable_prefix_batch32",
    reportKind: "streamline-stable-prefix-batch32-promotion",
    defaultReportName: "micro-solid-stable-prefix-batch32-report.json",
    defaultSuggestionsName: "micro-solid-stable-prefix-batch32-suggestions.json",
    buildTagsFromParts: buildSignTags,
  },
};
