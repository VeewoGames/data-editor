import type { ProjectProcessStatus } from "./api/client";
export function acceptsProjectProcessObservation(current: ProjectProcessStatus | null, incoming: ProjectProcessStatus | null, generation: number): boolean;
export function singleFlightPoll(operation: () => Promise<void>): () => Promise<boolean>;
