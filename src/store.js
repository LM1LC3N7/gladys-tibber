// -----------------------------------------------------------------------------
// A small JSON file in the writable /data volume, for what must survive a
// restart of the container and a reconnection to Gladys:
//   - refusals.token: an HMAC (keyed with `meta.salt`) of the access token
//     Tibber refused: the same token is not tried again until the user saves
//     the configuration.
//   - meta.salt: a random key generated once for the HMAC above.
//   - meta.pausedUntil: the end of an HTTP 429 pause (ms, as a string).
// The token itself is never written here. Writes are atomic (temporary file
// + rename) and queued. When the file cannot be written (no /data during
// development), values stay in memory.
// Same design as LM1LC3N7/gladys-portainer (src/store.js).
// -----------------------------------------------------------------------------

import { createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const SECTIONS = ['refusals', 'meta'];
const EMPTY = () => Object.fromEntries(SECTIONS.map((section) => [section, {}]));

export class Store {
  #writes = Promise.resolve();

  /** @param {{ filePath: string, logger?: { warn: Function } }} options */
  constructor({ filePath, logger }) {
    this.filePath = filePath;
    this.logger = logger;
    this.data = EMPTY();
    this.loaded = null;
  }

  /** Reads the file once; later calls share the first read. */
  load() {
    this.loaded ??= readFile(this.filePath, 'utf8')
      .then((content) => {
        const parsed = JSON.parse(content);
        const pick = (value) =>
          Object.fromEntries(
            Object.entries(value && typeof value === 'object' ? value : {}).filter(
              ([, v]) => typeof v === 'string' && v,
            ),
          );
        this.data = Object.fromEntries(
          SECTIONS.map((section) => [section, pick(parsed?.[section])]),
        );
      })
      .catch((err) => {
        if (err.code !== 'ENOENT') {
          this.logger?.warn(`Store unreadable, starting empty: ${err.message}`);
        }
        this.data = EMPTY();
      });
    return this.loaded;
  }

  get(section, key) {
    return this.data[section]?.[key] ?? null;
  }

  async set(section, key, value) {
    if (value === null || value === undefined) {
      delete this.data[section][key];
    } else {
      this.data[section][key] = value;
    }
    await this.#save();
  }

  /** The random key of this installation (created on first use). */
  async salt() {
    let salt = this.get('meta', 'salt');
    if (!salt) {
      salt = randomBytes(32).toString('hex');
      await this.set('meta', 'salt', salt);
    }
    return salt;
  }

  /** What a refusal is about: an HMAC of the token with the salt, never the token. */
  async tokenKey(token) {
    return createHmac('sha256', await this.salt())
      .update(String(token))
      .digest('hex');
  }

  #save() {
    const write = this.#writes.then(() => this.#write());
    this.#writes = write.catch(() => {});
    return write;
  }

  async #write() {
    const tmp = `${this.filePath}.tmp`;
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(tmp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, this.filePath);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => {});
      this.logger?.warn(`Store not saved, values kept in memory only: ${err.message}`);
    }
  }
}
