import { createGeneratedFieldResolver, invalidateGeneratedFieldResult } from "./generated-field-resolver.mjs";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GeneratedFieldsResponse } from "./generated-fields-types";

/** One resolver for load, save/version changes, focus and visible polling. */
export function useGeneratedFields(projectId: string | null, sourcePath: string | null, collectionPath: string, documentEtag: string | undefined, dirty: boolean) {
  const [loaded, setLoaded] = useState<{ key: string; value: GeneratedFieldsResponse } | null>(null);
  const key = JSON.stringify([projectId, sourcePath, collectionPath, documentEtag]);
  const latest = useRef({ key, projectId, sourcePath, collectionPath, documentEtag, dirty });
  latest.current = { key, projectId, sourcePath, collectionPath, documentEtag, dirty };
  const resolver = useMemo(() => createGeneratedFieldResolver({
    getCurrent: () => latest.current,
    read: async (request) => {
      const query = new URLSearchParams({ projectId: request.projectId!, path: request.sourcePath!, collection: request.collectionPath });
      const response = await fetch(`/api/generated-fields?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("生成字段读取失败");
      return await response.json() as GeneratedFieldsResponse;
    },
    onResult: (request, value) => {
      if (value.projectId !== request.projectId || value.sourcePath !== request.sourcePath || value.collectionPath !== request.collectionPath || !Array.isArray(value.fields) || !Array.isArray(value.bindings)) throw new Error("生成字段作用域失配");
      const paired = !latest.current.dirty && value.documentEtag === latest.current.documentEtag;
      if (!paired) value.bindings = value.bindings.map((binding) => ({ ...binding, state: "unavailable", rows: [], reason: latest.current.dirty ? "保存后计算" : "文档版本失配，请重新载入文档" }));
      setLoaded({ key: request.key, value });
    },
    onError: (request) => {
      setLoaded((previous) => invalidateGeneratedFieldResult(previous, request));
    },
  }), []);
  const refreshRef = useRef(() => {});
  refreshRef.current = () => { void resolver.refresh(); };
  useEffect(() => { refreshRef.current(); }, [key, dirty]);
  useEffect(() => {
    resolver.activate();
    const refresh = () => { if (document.visibilityState === "visible") refreshRef.current(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 15000);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); window.clearInterval(timer); resolver.dispose(); };
  }, [resolver]);
  return useMemo(() => {
    const value = loaded?.value;
    if (!value || value.projectId !== projectId || value.sourcePath !== sourcePath || value.collectionPath !== collectionPath) return null;
    if (loaded.key === key) return value;
    // Retain only the declaration across saves; never pair old values with a
    // new document version while the next request is in flight.
    return { ...value, bindings: value.bindings.map((binding) => ({ ...binding, state: "unavailable", rows: [], reason: dirty ? "保存后计算" : "正在核验文档版本" })) };
  }, [loaded, key, projectId, sourcePath, collectionPath, dirty]);
}
