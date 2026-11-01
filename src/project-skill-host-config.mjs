/** Workspace writes stay explicit; system temp is not an additional writable project. */
export function projectSkillSandboxArgs(platform = process.platform) {
  return [
    "--sandbox", "workspace-write",
    "-c", 'approval_policy="never"',
    "-c", "sandbox_workspace_write.exclude_tmpdir_env_var=true",
    "-c", "sandbox_workspace_write.exclude_slash_tmp=true",
    ...(platform === "win32" ? ["-c", 'windows.sandbox="elevated"'] : []),
  ];
}
