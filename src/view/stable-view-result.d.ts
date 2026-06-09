import type { ViewResult } from "./contracts";

export function stabilizeViewResult(previous: ViewResult | null, next: ViewResult): ViewResult;
