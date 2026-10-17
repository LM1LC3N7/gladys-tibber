// -----------------------------------------------------------------------------
// The texts read by Gladys, the store and people are clean UTF-8: no BOM, no
// mojibake (a file written through a wrong code page).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILES = [
  'gladys-assistant-integration.json',
  'docs/fr.md',
  'docs/en.md',
  'README.md',
  'CHANGELOG.md',
  'TODO.md',
  'CLAUDE.md',
];

// "Ã" and "Â" followed by a Latin-1 symbol, and the "â€" family: what UTF-8
// becomes when read as Windows-1252.
const MOJIBAKE = /[ÃÂ][\u0080-¿]|â€/;

for (const file of FILES) {
  test(`${file} is clean UTF-8`, () => {
    const bytes = readFileSync(new URL(`../${file}`, import.meta.url));
    assert.ok(
      !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf),
      `${file} starts with a BOM`,
    );
    const text = bytes.toString('utf8');
    assert.ok(!text.includes('�'), `${file} has invalid UTF-8`);
    const match = MOJIBAKE.exec(text);
    assert.equal(
      match,
      null,
      `${file} has mojibake near "${match?.input.slice(match.index, match.index + 20)}"`,
    );
  });
}
