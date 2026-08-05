export async function executeJournaledDocumentCommit({ journal, entry, admit = async () => {}, replace, verify, publishResult = async () => {} }) {
  const existing = await journal.begin({ ...entry, stage: "commit_intent" });
  if (existing.stage === "result_published") return existing;
  if (existing.stage === "commit_intent") {
    await admit(existing);
    await replace();
    await journal.advance(entry, "source_replaced");
  }
  if ((await journal.read(entry.idempotencyKey)).stage === "source_replaced") {
    await verify();
    await journal.advance(entry, "verified");
  }
  if ((await journal.read(entry.idempotencyKey)).stage === "verified") {
    await publishResult();
    return journal.advance(entry, "result_published");
  }
  return journal.read(entry.idempotencyKey);
}
