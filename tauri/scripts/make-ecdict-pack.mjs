import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { once } from 'node:events';

const src = process.argv[2];
const out = process.argv[3];
if (!src || !out) {
  console.error('usage: node make-ecdict-pack.mjs <dict_json dir> <out .jsonl.gz>');
  process.exit(1);
}
const names = fs.readdirSync(src).filter((n) => n.toLowerCase().endsWith('.json')).sort();
console.log('files', names.length);
const gz = zlib.createGzip({ level: 6 });
const ws = fs.createWriteStream(out);
gz.pipe(ws);
let buf = '';
const started = Date.now();
for (let i = 0; i < names.length; i += 1) {
  const text = fs.readFileSync(path.join(src, names[i]), 'utf8');
  // Each ECDICT file is one pretty-printed JSON object; collapsing the
  // formatting newlines yields the one-object-per-line JSONL record without
  // re-serialising 770k objects.
  buf += text.replace(/[\r\n]+/g, ' ') + '\n';
  if (buf.length > 1 << 20) {
    if (!gz.write(buf)) await once(gz, 'drain');
    buf = '';
  }
  if ((i + 1) % 100000 === 0) console.log('packed', i + 1, 'in', Math.round((Date.now() - started) / 1000) + 's');
}
if (buf) gz.write(buf);
gz.end();
await once(ws, 'close');
console.log('done', names.length, 'bytes', fs.statSync(out).size, 'secs', Math.round((Date.now() - started) / 1000));
