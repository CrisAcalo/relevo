'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { projectRoot } = require('./root.cjs');
const { getManagedTemplates } = require('./init.cjs');

function computeHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function update({ cwd = process.cwd(), apply = false, force = false, templatesDir, silent = false } = {}) {
  const root = projectRoot(cwd);
  const relevoPkgRoot = path.resolve(__dirname, '..');
  const managedTemplates = getManagedTemplates(relevoPkgRoot, templatesDir);

  const lockFilePath = path.join(root, '.agents', 'relevo.lock.json');
  let lock = null;
  if (fs.existsSync(lockFilePath)) {
    try {
      lock = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
    } catch {}
  }

  const results = [];
  const newLockFiles = { ...(lock?.files || {}) };
  let lockModified = false;
  let hasError = false;

  for (const item of managedTemplates) {
    const relPath = item.relPath;
    const normalizedRel = relPath.replace(/\\/g, '/');
    const templateContent = item.content;
    const templateHash = computeHash(templateContent);
    const installedPath = path.join(root, relPath);

    if (!fs.existsSync(installedPath)) {
      if (normalizedRel.startsWith('.agents/agents/') && normalizedRel.endsWith('.md')) {
        const oldRelPath = `.agents/plugins/relevo/agents/${path.basename(normalizedRel)}`;
        const oldInstalledPath = path.join(root, oldRelPath);
        if (fs.existsSync(oldInstalledPath)) {
          if (apply) {
            fs.mkdirSync(path.dirname(installedPath), { recursive: true });
            fs.copyFileSync(oldInstalledPath, installedPath);
            if (newLockFiles[oldRelPath] !== undefined) {
              newLockFiles[normalizedRel] = newLockFiles[oldRelPath];
              delete newLockFiles[oldRelPath];
              lockModified = true;
            }
            fs.unlinkSync(oldInstalledPath);
          }
          results.push({
            file: normalizedRel,
            status: 'migrado',
            note: `desde ${oldRelPath}`,
          });
          continue;
        }
      }

      results.push({ file: normalizedRel, status: 'nuevo', note: '' });
      if (apply) {
        fs.mkdirSync(path.dirname(installedPath), { recursive: true });
        fs.writeFileSync(installedPath, templateContent, 'utf8');
        newLockFiles[normalizedRel] = templateHash;
        lockModified = true;
      }
      continue;
    }

    const installedContent = fs.readFileSync(installedPath, 'utf8');
    const installedHash = computeHash(installedContent);
    const base = lock?.files?.[normalizedRel] ?? null;
    const isGate = (normalizedRel === '.agents/hooks/permission-gate.cjs');

    // 1. instalado == plantilla → "al día" (y si el lock no coincide con la plantilla, con --apply actualiza el lock a ese hash)
    if (installedContent === templateContent) {
      results.push({ file: normalizedRel, status: 'al día', note: '' });
      if (apply && base !== templateHash) {
        newLockFiles[normalizedRel] = templateHash;
        lockModified = true;
      }
      continue;
    }

    // 2. hash(instalado) == base → "actualizable" (igual que hoy)
    const isUntouched = base !== null && installedHash === base;
    if (isUntouched) {
      results.push({ file: normalizedRel, status: 'actualizable', note: '' });
      if (apply) {
        fs.mkdirSync(path.dirname(installedPath), { recursive: true });
        fs.writeFileSync(installedPath, templateContent, 'utf8');
        newLockFiles[normalizedRel] = templateHash;
        lockModified = true;
      }
      continue;
    }

    // 3. Puerta de permisos: si la puerta instalada difiere de la plantilla, sigue siendo "error"
    // (no debe personalizarse) aunque la plantilla no haya cambiado.
    // Solo --apply --force la sobrescribe.
    if (isGate) {
      if (apply && force) {
        results.push({ file: normalizedRel, status: 'actualizado-por-fuerza', note: 'puerta sobrescrita por --force' });
        fs.mkdirSync(path.dirname(installedPath), { recursive: true });
        fs.writeFileSync(installedPath, templateContent, 'utf8');
        newLockFiles[normalizedRel] = templateHash;
        lockModified = true;
      } else {
        results.push({
          file: normalizedRel,
          status: 'error',
          note: 'la puerta de permisos no debe personalizarse; usa relevo.config.json o --force',
        });
        hasError = true;
      }
      continue;
    }

    // 4. hash(plantilla) == base → "personalizado" con nota "sin novedades de la plantilla":
    // NO escribe .relevo-new ni con --apply; no es error.
    if (base !== null && templateHash === base) {
      results.push({
        file: normalizedRel,
        status: 'personalizado',
        note: 'sin novedades de la plantilla',
      });
      continue;
    }

    // 5. Resto (personalizado y plantilla nueva) o sin entrada en el lock →
    // "personalizado" con .relevo-new como hoy, y con --apply actualiza la base del lock
    // al hash de la plantilla ofrecida (así no se vuelve a ofrecer la misma; la próxima vez cae en "sin novedades").
    results.push({
      file: normalizedRel,
      status: 'personalizado',
      note: `plantilla nueva en ${normalizedRel}.relevo-new`,
    });
    if (apply) {
      const sidecarPath = `${installedPath}.relevo-new`;
      fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
      fs.writeFileSync(sidecarPath, templateContent, 'utf8');
      newLockFiles[normalizedRel] = templateHash;
      lockModified = true;
    }
  }

  const oldPlugin = '.agents/plugins/relevo/plugin.json';
  const oldPluginPath = path.join(root, oldPlugin);
  if (fs.existsSync(oldPluginPath)) {
    let isOriginal = false;
    let content = null;
    try {
      content = fs.readFileSync(oldPluginPath, 'utf8');
    } catch {}
    if (content !== null) {
      try {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const keys = Object.keys(parsed);
          if (keys.length === 1 && keys[0] === 'name' && parsed.name === 'relevo') {
            isOriginal = true;
          }
        }
      } catch {}
      if (!isOriginal && lock?.files?.[oldPlugin] !== undefined) {
        if (computeHash(content) === lock.files[oldPlugin]) {
          isOriginal = true;
        }
      }
    }

    if (isOriginal) {
      results.push({
        file: oldPlugin,
        status: 'retirado',
        note: 'agy ya no usa el plugin de relevo',
      });
      if (apply) {
        try {
          fs.unlinkSync(oldPluginPath);
        } catch {}
        if (newLockFiles[oldPlugin] !== undefined) {
          delete newLockFiles[oldPlugin];
          lockModified = true;
        }
        const dirs = [
          path.join(root, '.agents', 'plugins', 'relevo', 'agents'),
          path.join(root, '.agents', 'plugins', 'relevo'),
          path.join(root, '.agents', 'plugins'),
        ];
        for (const dir of dirs) {
          try {
            fs.rmdirSync(dir);
          } catch {}
        }
      }
    } else {
      results.push({
        file: oldPlugin,
        status: 'personalizado',
        note: 'plugin.json antiguo modificado: revísalo y retíralo a mano',
      });
    }
  } else if (apply && newLockFiles[oldPlugin] !== undefined) {
    delete newLockFiles[oldPlugin];
    lockModified = true;
  }

  if (apply && lockModified) {
    const sortedFiles = {};
    for (const key of Object.keys(newLockFiles).sort()) {
      sortedFiles[key] = newLockFiles[key];
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(relevoPkgRoot, 'package.json'), 'utf8'));
    const lockContent = JSON.stringify({
      version: 1,
      relevo: pkg.version,
      files: sortedFiles,
    }, null, 2) + '\n';
    fs.mkdirSync(path.dirname(lockFilePath), { recursive: true });
    fs.writeFileSync(lockFilePath, lockContent, 'utf8');
  }

  const counts = {
    al_dia: results.filter((r) => r.status === 'al día').length,
    actualizable: results.filter((r) => r.status === 'actualizable').length,
    personalizado: results.filter((r) => r.status === 'personalizado').length,
    nuevo: results.filter((r) => r.status === 'nuevo').length,
    retirado: results.filter((r) => r.status === 'retirado').length,
    error: results.filter((r) => r.status === 'error').length,
  };

  if (!silent) {
    const mode = apply ? (force ? '(apply --force) ' : '(apply) ') : '(plan) ';
    console.log(`relevo update · ${mode}resumen: ${counts.al_dia} al día, ${counts.actualizable} actualizables, ${counts.personalizado} personalizados, ${counts.nuevo} nuevos, ${counts.retirado} retirados, ${counts.error} errores`);
    for (const r of results) {
      const extra = r.note ? ` (${r.note})` : '';
      console.log(`  [${r.status}] ${r.file}${extra}`);
    }
    const hasPending = counts.actualizable > 0 || counts.nuevo > 0 || counts.retirado > 0 || results.some((r) => r.status === 'migrado') || results.some((r) => r.status === 'personalizado' && r.note !== 'sin novedades de la plantilla');
    if (!apply && hasPending) {
      console.log('\nEjecuta "relevo update --apply" para aplicar las actualizaciones.');
    }
  }

  return { results, counts, hasError };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const force = args.includes('--force');
  try {
    const res = update({ cwd: process.cwd(), apply, force });
    if (res.hasError) {
      process.exit(1);
    }
  } catch (err) {
    console.error(`relevo update · error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  update,
  computeHash,
};
