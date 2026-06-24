export function shouldProcessManifestMetadataItem(item, { force = false, retryFailed = false } = {}) {
  if (force) return true;
  if (item?.metadataStatus === "success" && Array.isArray(item?.tags) && item.tags.length > 0) {
    return false;
  }
  if (item?.metadataStatus === "failed") {
    return retryFailed;
  }
  return true;
}

function filterManifestMetadataItemsByIds(items, itemIds) {
  const normalizedIds = new Set(
    (Array.isArray(itemIds) ? itemIds : [])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  );
  if (normalizedIds.size === 0) {
    return Array.isArray(items) ? items : [];
  }
  return (Array.isArray(items) ? items : []).filter((item) => {
    const itemId = String(item?.itemId ?? "").trim();
    const slug = String(item?.slug ?? "").trim();
    return normalizedIds.has(itemId) || normalizedIds.has(slug);
  });
}

export function selectManifestMetadataCandidateItems(items, { force = false, retryFailed = false, maxItems, itemIds } = {}) {
  const sourceItems = filterManifestMetadataItemsByIds(items, itemIds);
  const pendingItems = sourceItems.filter((item) => shouldProcessManifestMetadataItem(item, { force, retryFailed: false }));
  const failedItems = retryFailed || force
    ? sourceItems.filter((item) => item?.metadataStatus === "failed")
    : [];
  const orderedItems = force ? sourceItems : [...pendingItems, ...failedItems];
  if (Number.isInteger(maxItems) && maxItems > 0) {
    return orderedItems.slice(0, maxItems);
  }
  return orderedItems;
}

export function buildManifestMetadataUpdatePayload(result, item) {
  const metadataUpdatedAt = new Date().toISOString();
  if (result.ok) {
    return {
      itemId: item.itemId,
      slug: item.slug,
      tags: result.tags,
      metadataStatus: "success",
      metadataError: null,
      metadataUpdatedAt,
    };
  }

  return {
    itemId: item.itemId,
    slug: item.slug,
    tags: item.tags,
    metadataStatus: "failed",
    metadataError: result.error,
    metadataUpdatedAt,
  };
}
