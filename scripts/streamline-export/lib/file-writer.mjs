import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeSvgFile(outputPath, svgText) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${String(svgText).trim()}\n`, "utf8");
}
