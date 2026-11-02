import path from 'node:path';

// Exact configuration category policy; callers hold registry/store through effects.
export async function checkCurrentConfigurationTarget(context, descriptor, {io, schema, resolveConfigurationSaveTarget}, protection, {readOnly = false} = {}) {
  const fail = code => { throw Object.assign(new Error(code), {code, status: 409}); };
  const physical = async file => schema.normalize(await io.authorityPhysical(file));
  const inside = (file, root) => file === root || file.startsWith(root + '/');
  const {target} = resolveConfigurationSaveTarget(context, descriptor);
  const currentTarget = await physical(target);
  if (currentTarget !== schema.normalize(target)) fail('HISTORY_CONFIGURATION_ALIAS_REJECTED');
  const root = await physical(context.projectRoot);
  const runtime = await physical(path.resolve(root, context.runtimeDir));
  if (!runtime.startsWith(root + '/')) fail('HISTORY_BINDING_INVALID');
  const selected = protection.projects.find(project => project.root === root);
  if (!selected && protection.projects.some(project => inside(root, project.root))) fail('HISTORY_BINDING_INVALID');
  if (selected && (selected.runtime !== runtime || context.historicalDispositionAnchorId && context.historicalDispositionAnchorId !== selected.anchorId)) fail('HISTORY_BINDING_INVALID');
  // Names-only recovery reads and compares the original profile; it cannot
  // acquire permission to rewrite a destination now protected from writes.
  if (readOnly) return {target, physicalTarget: currentTarget};
  const forbidden = [runtime, schema.normalize(protection.directory),
    root + '/.data-editor/publication-admission',
    root + '/.data-editor/entry-action-contracts.json',
    root + '/.data-editor/historical-disposition-registration.json'];
  for (const source of context.dataSources) {
    const sourceRoot = await physical(source.kind === 'absolute' ? path.resolve(source.path) : path.resolve(context.projectRoot, source.path));
    if (sourceRoot === root && currentTarget.startsWith(root + '/.data-editor/')) continue;
    forbidden.push(sourceRoot);
  }
  for (const relative of selected?.businessFiles ?? []) forbidden.push(await physical(path.resolve(root, relative)));
  if (forbidden.some(area => inside(currentTarget, area))) fail('HISTORY_CONFIGURATION_WRITESET_INVALID');
  if (protection.projects.some(project => project.root !== root && inside(currentTarget, project.root))) fail('HISTORY_BINDING_INVALID');
  return {target, physicalTarget: currentTarget};
}
