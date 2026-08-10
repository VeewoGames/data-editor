import { submitFreshCandidateCreate } from "./entry-action-candidate-create-service.mjs";

export function createCandidateCreateAdmission({ adapterRegistry, submit = submitFreshCandidateCreate }) {
  if (typeof adapterRegistry?.allocateServerFields !== "function" || typeof submit !== "function") throw new TypeError("Candidate create admission composition is invalid.");
  const allocateServerFields = adapterRegistry.allocateServerFields;
  return (input) => submit({
    ...input,
    dependencies: { ...(input.dependencies ?? {}), allocateServerFields },
  });
}
