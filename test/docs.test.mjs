/**
 * La documentazione non afferma cose che il codice smentisce.
 *
 * Il controllo vero e' condiviso e vive in Standards (`tools/check_docs_current.py`),
 * uno solo per tutti i progetti: una copia per repo diventerebbe quattro copie
 * divergenti, che e' il problema che deve risolvere. Qui c'e' solo l'aggancio, e
 * `docs-check.yaml` nella radice dice dove guardare in questo repo.
 *
 * Standards non e' un pacchetto installabile, quindi il percorso e' relativo:
 * sull'Air i due repo sono fratelli sotto ~/Software/. Dove non lo sono — un'altra
 * macchina, la CI di Pages — il test salta dicendo perche', invece di fallire per
 * una ragione che non riguarda questo progetto.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checker = resolve(root, '..', 'Standards', 'tools', 'check_docs_current.py');

test('la documentazione non contraddice il codice', { skip: !existsSync(checker)
    && `Standards non e' accanto a questo repo (${checker})` }, () => {
  const run = spawnSync('python3', [checker, root, '--quiet'], { encoding: 'utf8' });
  assert.equal(run.status, 0, `\n${run.stdout}${run.stderr}`);
});
