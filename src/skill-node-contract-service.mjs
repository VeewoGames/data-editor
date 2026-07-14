import { createHash } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import { assertSkillNodeContractSemantics } from "./skill-node-contract-semantics.mjs";
import { SUPPORTED_CONTRACT_VERSION } from "./skill-node-contract-version.mjs";

export const skillNodeContractRelativePath = "data/contracts/skill_nodes.json";
export const skillNodeContractSchemaRelativePath = "data/contracts/skill_nodes.schema.json";

export class SkillNodeContractError extends Error {
  constructor(code, message, { status = 422, details = null } = {}) {
    super(message);
    this.name = "SkillNodeContractError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function loadSkillNodeContract(projectRoot) {
  const contractPath = path.resolve(projectRoot, skillNodeContractRelativePath);
  const schemaPath = path.resolve(projectRoot, skillNodeContractSchemaRelativePath);
  const [contractBytes, schemaBytes] = await Promise.all([
    readRequiredFile(contractPath, "SKILL_NODE_CONTRACT_MISSING", "Skill node contract is missing."),
    readRequiredFile(schemaPath, "SKILL_NODE_CONTRACT_META_SCHEMA_MISSING", "Skill node contract meta-schema is missing."),
  ]);
  const contract = parseJson(contractBytes, "SKILL_NODE_CONTRACT_INVALID_JSON", "Skill node contract contains invalid JSON.");
  const schema = parseJson(schemaBytes, "SKILL_NODE_CONTRACT_META_SCHEMA_INVALID_JSON", "Skill node contract meta-schema contains invalid JSON.");

  let validate;
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    validate = ajv.compile(schema);
  } catch (error) {
    throw new SkillNodeContractError(
      "SKILL_NODE_CONTRACT_META_SCHEMA_INVALID",
      "Skill node contract meta-schema is not a valid JSON Schema.",
      { details: error instanceof Error ? error.message : String(error) },
    );
  }

  if (!validate(contract)) {
    throw new SkillNodeContractError(
      "SKILL_NODE_CONTRACT_SCHEMA_INVALID",
      "Skill node contract does not satisfy its meta-schema.",
      { details: validate.errors ?? [] },
    );
  }
  if (contract.contract_version !== SUPPORTED_CONTRACT_VERSION) {
    throw new SkillNodeContractError(
      "SKILL_NODE_CONTRACT_VERSION_UNSUPPORTED",
      `Unsupported skill node contract version: ${String(contract.contract_version)}.`,
      {
        status: 409,
        details: {
          actual: contract.contract_version,
          supported: SUPPORTED_CONTRACT_VERSION,
        },
      },
    );
  }
  try {
    assertSkillNodeContractSemantics(contract);
  } catch (error) {
    throw new SkillNodeContractError(
      "SKILL_NODE_CONTRACT_SEMANTICS_INVALID",
      "Skill node contract contains incomplete or ambiguous runtime semantics.",
      { details: error instanceof Error ? error.message : String(error) },
    );
  }

  return {
    contract,
    etag: `"${createHash("sha256").update(contractBytes).digest("hex")}"`,
  };
}

export function matchesIfNoneMatch(ifNoneMatch, etag) {
  if (typeof ifNoneMatch !== "string" || !ifNoneMatch.trim()) return false;
  return ifNoneMatch.split(",").some((candidate) => {
    const normalized = candidate.trim().replace(/^W\//, "");
    return normalized === "*" || normalized === etag;
  });
}

async function readRequiredFile(filePath, missingCode, missingMessage) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new SkillNodeContractError(missingCode, missingMessage, { status: 404 });
    }
    throw error;
  }
}

function parseJson(bytes, code, message) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new SkillNodeContractError(code, message, {
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
