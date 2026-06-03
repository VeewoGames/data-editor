export function isBackgroundDevProcess(env) {
  return String(env?.DATA_EDITOR_BACKGROUND ?? "") === "1";
}

export function buildDevChildSpawnOptions(background) {
  if (background) {
    return {
      shell: false,
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
    };
  }
  return {
    shell: false,
    stdio: "inherit",
    windowsHide: false,
  };
}
