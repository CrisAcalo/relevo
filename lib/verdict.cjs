'use strict';

/**
 * Validador estricto del contrato de .qa-verdict.json emitido por el agente de QA.
 * validateVerdict(value) -> { ok: boolean, errors: string[] } (nunca lanza).
 */

const ALLOWED_ROOT_KEYS = new Set([
  'version',
  'commit',
  'branch',
  'verdict',
  'checkedAt',
  'suites',
  'findings',
  'testReview',
  'documentation',
]);

const ALLOWED_SUITE_KEYS = new Set(['name', 'passed', 'console']);
const ALLOWED_CONSOLE_KEYS = new Set(['errors', 'warnings', 'pageErrors']);
const ALLOWED_FINDING_KEYS = new Set(['severity', 'file', 'detail']);

function validateVerdict(value) {
  const errors = [];

  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, errors: ['el veredicto debe ser un objeto'] };
    }

    // 1. Claves desconocidas en la raíz
    for (const key of Object.keys(value)) {
      if (!ALLOWED_ROOT_KEYS.has(key)) {
        errors.push(`clave desconocida "${key}"`);
      }
    }

    // 2. version === 1
    if (value.version !== 1) {
      errors.push('version debe ser 1');
    }

    // 3. commit: 40 hexadecimales en minúscula
    if (typeof value.commit !== 'string' || !/^[0-9a-f]{40}$/.test(value.commit)) {
      errors.push('commit debe ser un hash sha1 de 40 caracteres hexadecimales en minúscula');
    }

    // 4. branch: texto no vacío (opcional)
    if (value.branch !== undefined) {
      if (typeof value.branch !== 'string' || value.branch.trim() === '') {
        errors.push('branch debe ser un texto no vacío');
      }
    }

    // 5. verdict: exactamente "aprobado" o "rechazado"
    if (value.verdict !== 'aprobado' && value.verdict !== 'rechazado') {
      errors.push('verdict debe ser "aprobado" o "rechazado"');
    }

    // 6. checkedAt: texto que Date.parse interpreta (opcional)
    if (value.checkedAt !== undefined) {
      if (typeof value.checkedAt !== 'string' || Number.isNaN(Date.parse(value.checkedAt))) {
        errors.push('checkedAt debe ser un texto de fecha interpretable');
      }
    }

    // 7. suites: lista obligatoria (puede estar vacía)
    if (!Array.isArray(value.suites)) {
      errors.push('suites debe ser una lista');
    } else {
      for (let i = 0; i < value.suites.length; i++) {
        const suite = value.suites[i];
        const prefix = `suites[${i}]`;
        if (suite === null || typeof suite !== 'object' || Array.isArray(suite)) {
          errors.push(`${prefix} debe ser un objeto`);
          continue;
        }

        for (const k of Object.keys(suite)) {
          if (!ALLOWED_SUITE_KEYS.has(k)) {
            errors.push(`${prefix}: clave desconocida "${k}"`);
          }
        }

        if (typeof suite.name !== 'string' || suite.name.trim() === '') {
          errors.push(`${prefix}.name debe ser un texto no vacío`);
        }

        if (typeof suite.passed !== 'boolean') {
          errors.push(`${prefix}.passed debe ser booleano`);
        }

        if (suite.console !== undefined) {
          const consolePrefix = `${prefix}.console`;
          if (suite.console === null || typeof suite.console !== 'object' || Array.isArray(suite.console)) {
            errors.push(`${consolePrefix} debe ser un objeto`);
          } else {
            for (const ck of Object.keys(suite.console)) {
              if (!ALLOWED_CONSOLE_KEYS.has(ck)) {
                errors.push(`${consolePrefix}: clave desconocida "${ck}"`);
              }
            }
            for (const field of ['errors', 'warnings', 'pageErrors']) {
              const val = suite.console[field];
              if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
                errors.push(`${consolePrefix}.${field} debe ser un entero ≥ 0`);
              }
            }
          }
        }
      }
    }

    // 8. findings: lista opcional
    if (value.findings !== undefined) {
      if (!Array.isArray(value.findings)) {
        errors.push('findings debe ser una lista');
      } else {
        for (let i = 0; i < value.findings.length; i++) {
          const finding = value.findings[i];
          const prefix = `findings[${i}]`;
          if (finding === null || typeof finding !== 'object' || Array.isArray(finding)) {
            errors.push(`${prefix} debe ser un objeto`);
            continue;
          }

          for (const fk of Object.keys(finding)) {
            if (!ALLOWED_FINDING_KEYS.has(fk)) {
              errors.push(`${prefix}: clave desconocida "${fk}"`);
            }
          }

          if (finding.severity !== 'alta' && finding.severity !== 'media' && finding.severity !== 'baja') {
            errors.push(`${prefix}.severity debe ser "alta", "media" o "baja"`);
          }

          if (finding.file !== undefined && typeof finding.file !== 'string') {
            errors.push(`${prefix}.file debe ser un texto`);
          }

          if (typeof finding.detail !== 'string' || finding.detail.trim() === '') {
            errors.push(`${prefix}.detail debe ser un texto no vacío`);
          }
        }
      }
    }

    // 9. testReview: lista opcional de textos
    if (value.testReview !== undefined) {
      if (!Array.isArray(value.testReview)) {
        errors.push('testReview debe ser una lista');
      } else {
        for (let i = 0; i < value.testReview.length; i++) {
          if (typeof value.testReview[i] !== 'string') {
            errors.push(`testReview[${i}] debe ser un texto`);
          }
        }
      }
    }

    // 10. documentation: lista opcional de textos
    if (value.documentation !== undefined) {
      if (!Array.isArray(value.documentation)) {
        errors.push('documentation debe ser una lista');
      } else {
        for (let i = 0; i < value.documentation.length; i++) {
          if (typeof value.documentation[i] !== 'string') {
            errors.push(`documentation[${i}] debe ser un texto`);
          }
        }
      }
    }
  } catch (err) {
    errors.push(err.message);
  }

  return { ok: errors.length === 0, errors };
}

module.exports = { validateVerdict };
