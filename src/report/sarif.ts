import type { RunResult, Severity } from '../types.ts';

const LEVEL: Record<Severity, string> = { error: 'error', warning: 'warning', info: 'note' };

export function toSarif(result: RunResult): string {
  const rules = new Map<string, { id: string; helpUri?: string }>();
  for (const f of result.findings) {
    const id = `${f.engine}/${f.rule}`;
    const rule = rules.get(id) ?? { id };
    if (f.docs && !rule.helpUri) rule.helpUri = f.docs;
    rules.set(id, rule);
  }
  const results = result.findings.map((f) => {
    // SARIF wants a URI, so a space in a file path has to be encoded.
    const uri = f.location.file !== undefined ? encodeURI(f.location.file) : f.location.url;
    const region =
      f.location.line !== undefined
        ? { startLine: f.location.line, ...(f.location.column !== undefined ? { startColumn: f.location.column } : {}) }
        : undefined;
    return {
      ruleId: `${f.engine}/${f.rule}`,
      level: LEVEL[f.severity],
      message: { text: f.message },
      partialFingerprints: { 'wpShakedown/v1': f.id },
      ...(uri !== undefined ? { locations: [{ physicalLocation: { artifactLocation: { uri }, ...(region ? { region } : {}) } }] } : {}),
      ...(f.suppressed ? { suppressions: [{ kind: 'external', justification: f.suppressed.reason }] } : {}),
    };
  });
  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'wp-shakedown',
            version: result.tool.version,
            informationUri: 'https://github.com/alexposlushnyak/wp-shakedown',
            rules: [...rules.values()],
          },
        },
        results,
      },
    ],
  };
  return JSON.stringify(sarif, null, 2) + '\n';
}
