// offload.mjs — jsonl writers for the analysis-ready dataset.
import fs from 'fs';
export function jsonlWriter(path) {
  const fd = fs.openSync(path, 'w');
  let n = 0;
  return {
    write(o) { fs.writeSync(fd, JSON.stringify(o) + '\n'); n++; },
    get count() { return n; },
    close() { fs.closeSync(fd); },
  };
}
