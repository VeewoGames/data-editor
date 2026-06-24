export const streamlineSharedViewIcons = [
  {
    "id": "streamlineMicroSolidAttachment1",
    "family": "micro-solid",
    "itemId": "attachment-1",
    "slug": "attachment-1",
    "sourceId": "26582",
    "name": "Attachment 1",
    "outputPath": "vendor/streamline-svg/micro-solid/attachment-1.svg",
    "tags": [
      "attachment",
      "paperclip",
      "clip",
      "affix",
      "attach",
      "fastener",
      "link",
      "hyperlink",
      "office",
      "stationery",
      "tool",
      "binder",
      "pin",
      "affixation",
      "hook",
      "curve",
      "unlink",
      "level",
      "medium",
      "low"
    ],
    "searchText": "micro-solid attachment-1 attachment 1 attachment-1 26582 attachment paperclip clip affix attach fastener link hyperlink office stationery tool binder pin affixation hook curve unlink level medium low"
  }
];

export const streamlineSharedViewIconIds = streamlineSharedViewIcons.map((icon) => icon.id);
export const streamlineSharedViewIconSearchTextById = Object.fromEntries(streamlineSharedViewIcons.map((icon) => [icon.id, icon.searchText]));
export const streamlineSharedViewIconGroups = [
  {
    "id": "streamline-micro-solid",
    "label": "Solid",
    "family": "micro-solid",
    "iconIds": [
      "streamlineMicroSolidAttachment1"
    ]
  }
];
