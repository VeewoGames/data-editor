import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { icons } from "./icons";
import { controlProjectProcess, loadProjectProcesses, type ProjectProcessRequest, type ProjectProcessStatus } from "../api/client";
import { acceptsProjectProcessObservation, singleFlightPoll } from "../project-process-observation.mjs";

const stateText = { running: "运行中", stopped: "已停止", starting: "启动中", stopping: "停止中", unknown: "状态未知", failed: "启动失败" };

export function ProjectProcessButton({ projectId }: { projectId: string }) {
  const [current, setCurrent] = useState<ProjectProcessStatus | null>(null);
  const [pending, setPending] = useState<ProjectProcessRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const revision = useRef(0);
  const inFlight = useRef(false);
  const latest = useRef<ProjectProcessStatus | null>(null);

  useEffect(() => {
    mounted.current = true;
    let canceled = false;
    const refresh = singleFlightPoll(async () => {
      if (inFlight.current) return;
      const version = revision.current;
      try {
        const snapshot = await loadProjectProcesses(projectId);
        const incoming = snapshot.processes[0] ?? null;
        if (!canceled && version === revision.current && acceptsProjectProcessObservation(latest.current, incoming, snapshot.generation)) {
          latest.current = incoming; setCurrent(incoming); setError(null);
        }
      } catch (cause) { if (!canceled && version === revision.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => { canceled = true; mounted.current = false; window.clearInterval(timer); };
  }, [projectId]);

  async function submit(request: ProjectProcessRequest, authorize = false) {
    if (inFlight.current) return;
    inFlight.current = true; revision.current++; setBusy(true); setError(null);
    if (authorize) setPending(null);
    try {
      const result = await controlProjectProcess(request, authorize);
      if (!mounted.current) return;
      latest.current = result; setCurrent(result);
      if (result.code === "AUTH_REQUIRED" && result.authorizationRequest) setPending(result.authorizationRequest);
    } catch (cause) { if (mounted.current) { setPending(null); setError(cause instanceof Error ? cause.message : String(cause)); } }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }

  if (!current) return null;
  const transitioning = busy || (current.state === "starting" && !current.canStop) || current.state === "stopping";
  const unavailable = !current.canStart && !current.canStop;
  const explanation = [error ?? current.error, current.state === "running" && !current.desiredEnabled ? "已禁止下次自动启动，当前实例仍在运行。" : null].filter(Boolean).join("\n");
  const label = `${current.displayName}：${stateText[current.state]}`;
  const color = current.state === "running" ? "#22a06b" : ["unknown", "failed"].includes(current.state) ? "#d99216" : undefined;
  return <>
    <button className="project-switcher-add" type="button" aria-label={label} aria-pressed={current.state === "running"}
      aria-busy={transitioning} disabled={transitioning || unavailable || pending !== null} title={`${label}${explanation ? `\n${explanation}` : ""}`}
      style={{ color, opacity: transitioning ? 0.6 : undefined }} data-process-state={current.state}
      onClick={() => void submit({ projectId, processId: current.processId, action: current.canStop ? "stop" : "start",
        expectedGeneration: current.generation, declarationDigest: current.declarationDigest, expectedIntentVersion: current.intentVersion })}>
      {transitioning ? <icons.hourglassEmpty aria-hidden="true" size={16} /> : <icons.power aria-hidden="true" size={16} />}
    </button>
    <span role="status" aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>{label}{explanation ? `，${explanation}` : ""}</span>
    <Dialog.Root open={pending !== null} onOpenChange={open => { if (!open) setPending(null); }}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Title>允许此项目的后台计算入口？</Dialog.Title>
          <Dialog.Description className="dialog-description">此入口及其导入代码将以当前用户权限执行，包括后续项目代码维护。项目内路径检查不是沙盒。</Dialog.Description>
          <p>项目：<code>{current.root}</code></p><p>入口：<code>{current.entry}</code></p>
          <p>{pending?.action === "stop" ? "确认后仅继续这次停止；已保存关闭意图，取消也不会恢复自动启动。" : "确认后开启后台计算。更换入口或执行协议时需要重新许可。"}</p>
          <div className="dialog-actions"><Dialog.Close className="ghost-button">取消</Dialog.Close>
            <button type="button" className="primary-button" disabled={busy} onClick={() => { if (pending) void submit(pending, true); }}>允许并{pending?.action === "stop" ? "停止" : "开启"}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}
