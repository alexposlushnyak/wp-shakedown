// Prefixes the file URIs of a SARIF file with the tested folder, so code scanning finds them from the repository root.
import { readFileSync, writeFileSync } from 'node:fs';

const [file, prefix] = process.argv.slice(2);
if (!file || !prefix) {
  console.error('usage: action-sarif.mjs <report.sarif> <prefix>');
  process.exit(2);
}

const sarif = JSON.parse(readFileSync(file, 'utf8'));
for (const run of sarif.runs ?? []) {
  for (const result of run.results ?? []) {
    for (const loc of result.locations ?? []) {
      const art = loc.physicalLocation?.artifactLocation;
      if (art?.uri && !/^[a-z][a-z0-9+.-]*:/i.test(art.uri)) art.uri = `${encodeURI(prefix)}/${art.uri}`;
    }
  }
}
writeFileSync(file, JSON.stringify(sarif, null, 2));
