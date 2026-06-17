import { useEffect, useRef, useState, type ComponentType } from "react";

type ReadonlyMarkdownRendererProps = {
  value: string;
};

type ReadonlyMarkdownRendererModule = {
  ReadonlyMarkdownRendererImpl: ComponentType<ReadonlyMarkdownRendererProps>;
};

let cachedRendererComponent: ComponentType<ReadonlyMarkdownRendererProps> | null = null;
let rendererModulePromise: Promise<ReadonlyMarkdownRendererModule> | null = null;

function loadReadonlyMarkdownRendererModule() {
  if (!rendererModulePromise) {
    rendererModulePromise = import("./ReadonlyMarkdownRendererImpl");
  }
  return rendererModulePromise;
}

export function preloadReadonlyMarkdownRenderer() {
  void loadReadonlyMarkdownRendererModule();
}

export function ReadonlyMarkdownRenderer(props: ReadonlyMarkdownRendererProps) {
  const [LoadedRenderer, setLoadedRenderer] = useState<ComponentType<ReadonlyMarkdownRendererProps> | null>(() => cachedRendererComponent);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    if (cachedRendererComponent) {
      setLoadedRenderer(() => cachedRendererComponent);
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let disposed = false;
    void loadReadonlyMarkdownRendererModule()
      .then((module) => {
        if (disposed || generationRef.current !== generation) return;
        cachedRendererComponent = module.ReadonlyMarkdownRendererImpl;
        setLoadedRenderer(() => module.ReadonlyMarkdownRendererImpl);
      })
      .catch((error: unknown) => {
        if (disposed || generationRef.current !== generation) return;
        setLoadError(error instanceof Error ? error : new Error("只读渲染器加载失败"));
      });
    return () => {
      disposed = true;
    };
  }, []);

  if (LoadedRenderer) return <LoadedRenderer {...props} />;
  if (loadError) {
    return <div className="readonly-markdown-renderer readonly-markdown-renderer--error">只读渲染器加载失败：{loadError.message}</div>;
  }
  return <div className="readonly-markdown-renderer readonly-markdown-renderer--loading">正在加载只读渲染器…</div>;
}
