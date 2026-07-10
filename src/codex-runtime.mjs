import path from "node:path";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

const defaultCodexModel = "gpt-5.6-terra";

export async function resolveCodexCli() {
  for (const candidate of codexCliCandidates()) {
    if (await pathExists(candidate)) {
      return {
        available: true,
        path: candidate,
        model: defaultCodexModel,
      };
    }
  }
  return {
    available: false,
    path: null,
    model: defaultCodexModel,
    reason: "codex_cli_missing",
    message: "当前设备未找到可执行的 Codex CLI，请先安装或修复本机 Codex。",
  };
}

export async function resolveCodexSkill(bindingSkill, options = {}) {
  const skill = String(bindingSkill ?? "").trim();
  const projectRoot = typeof options.projectRoot === "string" && options.projectRoot.trim()
    ? path.resolve(options.projectRoot)
    : null;
  if (!skill) {
    return {
      available: false,
      skill,
      skillPath: null,
      reason: "skill_missing",
      message: "未配置 skill。",
    };
  }

  if (path.isAbsolute(skill)) {
    if (await pathExists(skill)) {
      return {
        available: true,
        skill,
        skillPath: path.resolve(skill),
      };
    }
    return {
      available: false,
      skill,
      skillPath: path.resolve(skill),
      reason: "skill_missing",
      message: `未找到 skill 文件：${skill}`,
    };
  }

  for (const candidate of resolveCodexSkillCandidatePaths(skill, projectRoot)) {
    if (await pathExists(candidate)) {
      return {
        available: true,
        skill,
        skillPath: candidate,
      };
    }
  }

  return {
    available: false,
    skill,
    skillPath: null,
    reason: "skill_missing",
    message: `未找到 skill "${skill}"，请确认它已安装到当前设备。`,
  };
}

export function resolveCodexSkillSearchRoots(projectRoot) {
  const roots = [];
  if (projectRoot) {
    roots.push(path.join(projectRoot, ".agents", "skills"));
  }
  const userProfile = process.env.USERPROFILE;
  if (userProfile) {
    roots.push(path.join(userProfile, ".codex", "skills"));
    roots.push(path.join(userProfile, ".agents", "skills"));
  }
  return uniquePaths(roots);
}

export function resolveCodexSkillCandidatePaths(skill, projectRoot) {
  return resolveCodexSkillSearchRoots(projectRoot).map((root) => path.join(root, skill, "SKILL.md"));
}

export async function resolveCodexBindingStatus(binding, options = {}) {
  if (!binding) {
    return {
      status: "missing",
      reason: "binding_missing",
      message: "当前设备还没有配置这条规则的本机绑定。",
    };
  }
  if (binding.enabled === false) {
    return {
      status: "invalid",
      reason: "binding_disabled",
      message: "当前设备已禁用这条本机绑定。",
    };
  }
  if (binding.provider !== "codex") {
    return {
      status: "invalid",
      reason: "provider_unsupported",
      message: `当前只支持 codex provider，收到的是 ${binding.provider ?? "unknown"}。`,
    };
  }

  const [codexCli, skill] = await Promise.all([
    resolveCodexCli(),
    resolveCodexSkill(binding.skill, options),
  ]);

  if (!codexCli.available) {
    return {
      status: "invalid",
      reason: codexCli.reason,
      message: codexCli.message,
      codexCliPath: null,
    };
  }
  if (!skill.available) {
    return {
      status: "invalid",
      reason: skill.reason,
      message: skill.message,
      codexCliPath: codexCli.path,
      skillPath: null,
    };
  }

  return {
    status: "ready",
    reason: null,
    message: null,
    codexCliPath: codexCli.path,
    skillPath: skill.skillPath,
    model: codexCli.model,
  };
}

function codexCliCandidates() {
  const candidates = [];
  if (process.env.DATA_EDITOR_CODEX_CLI) {
    candidates.push(process.env.DATA_EDITOR_CODEX_CLI);
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    candidates.push(path.join(localAppData, "OpenAI", "Codex", "bin", "codex.exe"));
  }
  candidates.push(path.join(process.cwd(), "codex.exe"));
  return uniquePaths(candidates);
}

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean).map((value) => path.resolve(value)))];
}

async function pathExists(targetPath) {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
