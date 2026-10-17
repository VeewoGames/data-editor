/** Preserve the machine's already configured native sandbox when user config is ignored. */
export function projectSkillPlatformSandboxArgs(platform = process.platform) {
  return platform === "win32" ? ["-c", 'windows.sandbox="elevated"'] : [];
}
