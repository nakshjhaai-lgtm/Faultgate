import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

/**
 * Reads one built page. The prompt carries the file name; no model is involved,
 * so this provider returns the page source verbatim for the assertions to read.
 */
export default class DistPageProvider {
  id() {
    return 'faultgate-dist';
  }

  async callApi(prompt) {
    const page = String(prompt).trim();
    if (!page.endsWith('.html')) return { error: `not a page name: ${page}` };
    try {
      return { output: await readFile(path.join(dist, page), 'utf8') };
    } catch (err) {
      return { error: `could not read ${page}: ${err.message}` };
    }
  }
}
