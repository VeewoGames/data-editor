import { incompleteResultStatuses, resultOnlyStatuses } from "./entry-action-result-status.mjs";

/** Structured status projection shared by the detail view and regression tests.
 * @returns {{tone: "warning" | "error" | "success", title: string, detail: string} | null}
 */
export function presentEntryActionResult(result, actionLabel) {
  if (result.outcome === "completed_with_writeback" && incompleteResultStatuses.includes(result.resultStatus)) {
    return { tone: "warning", title: `已保存部分修改，${actionLabel}未完成`, detail: result.message ?? "合法修改已保存；仍有未解决事项，请查看执行输出。" };
  }
  if (result.outcome === "failed" || result.resultStatus === "failed") {
    return { tone: "error", title: `${actionLabel} 执行失败`, detail: result.message ?? "自动化执行失败。" };
  }
  if (result.outcome !== "completed_without_changes" || !result.resultOnly) return null;
  if (!resultOnlyStatuses.includes(result.resultStatus)) return { tone: "warning", title: `${actionLabel} 结果需核实`, detail: result.message ?? "结果缺少可识别的结构化状态。" };
  if (incompleteResultStatuses.includes(result.resultStatus)) return { tone: "warning", title: `${actionLabel} 未完成`, detail: result.message ?? "分析仍有缺口，请查看执行输出。" };
  return { tone: "success", title: `${actionLabel} ${result.resultStatus === "no_changes" ? "已完成（无变更）" : "已完成"}`, detail: result.message ?? "检查已完成，请查看执行输出。" };
}
