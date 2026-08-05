import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { compileDocumentContract } from "./document-contract-compiler.mjs";
import { DocumentContractGrammarError } from "./document-contract-grammar.mjs";

export class DocumentContractError extends Error {
  constructor(code, message, { status = 422, details = null } = {}) {
    super(message);
    this.name = "DocumentContractError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Loads only the JSON contract declared by an active document-contract-v1 binding. */
export async function loadDocumentContract(projectRoot, binding) {
  const contractPath = path.resolve(projectRoot, binding.contract);
  const schemaPath = path.resolve(projectRoot, binding.contractSchema);
  const [contractBytes, schemaBytes] = await Promise.all([
    required(contractPath, "DOCUMENT_CONTRACT_MISSING", "Document contract is missing."),
    required(schemaPath, "DOCUMENT_CONTRACT_SCHEMA_MISSING", "Document contract schema is missing."),
  ]);
  const contract = parse(contractBytes, "DOCUMENT_CONTRACT_INVALID_JSON", "Document contract contains invalid JSON.");
  const schema = parse(schemaBytes, "DOCUMENT_CONTRACT_SCHEMA_INVALID_JSON", "Document contract schema contains invalid JSON.");
  try {
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    if (!validate(contract)) throw new DocumentContractError("DOCUMENT_CONTRACT_SCHEMA_INVALID", "Document contract does not satisfy its schema.", { details: validate.errors ?? [] });
  } catch (error) {
    if (error instanceof DocumentContractError) throw error;
    throw new DocumentContractError("DOCUMENT_CONTRACT_SCHEMA_COMPILE_INVALID", "Document contract schema is not a valid JSON Schema.", { details: error instanceof Error ? error.message : String(error) });
  }
  if (!Number.isInteger(contract.contract_version)) throw new DocumentContractError("DOCUMENT_CONTRACT_VERSION_MISSING", "Document contract is missing contract_version.");
  let compiled;
  try {
    compiled = compileDocumentContract(contract, binding);
  } catch (error) {
    if (!(error instanceof DocumentContractGrammarError)) throw error;
    throw new DocumentContractError(error.code, error.message, { details: error.details });
  }
  const contractDigest = createHash("sha256").update(contractBytes).digest("hex");
  return { contract, compiled, version: contract.contract_version, contractDigest, etag: `"${contractDigest}"` };
}

async function required(filePath, code, message) {
  try { return await readFile(filePath); }
  catch (error) {
    if (error?.code === "ENOENT") throw new DocumentContractError(code, message, { status: 409, details: { filePath } });
    throw error;
  }
}

function parse(bytes, code, message) {
  try { return JSON.parse(bytes); }
  catch { throw new DocumentContractError(code, message, { status: 409 }); }
}
