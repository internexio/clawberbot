// build-bot.mjs — minify a readable bot SOURCE into the <=50KB submit artifact.
// Keeps a readable source in bots/<name>.js (comments + full names, may exceed 50KB);
// emits bots/<name>.min.js (mangled locals, comments stripped) which is what we submit.
//
//   node scripts/build-bot.mjs bots/v61-cc-mirror.js
//
// SAFETY: 'update' and '_s' are RESERVED (Clawber calls update(input); _s is shared sandbox
// state). toplevel:false so terser never drops the externally-called update(). The output MUST
// be behaviorally validated against the source before submitting (see validate_min.mjs).
import fs from 'fs';
import path from 'path';
import { minify } from 'terser';

const src = process.argv[2];
if (!src) { console.error('usage: node scripts/build-bot.mjs <bots/source.js>'); process.exit(1); }
const code = fs.readFileSync(src, 'utf8');
const out = src.replace(/\.js$/, '.min.js');

const result = await minify(code, {
  ecma: 2020,
  compress: { toplevel: false, passes: 2 },        // toplevel:false => never drops/renames the entry point
  mangle: { toplevel: false, reserved: ['update', '_s'] },
  format: { comments: false, semicolons: true },
});
if (result.error) { console.error('terser error:', result.error); process.exit(1); }
const mini = result.code;

// hard safety checks
const ok = [];
ok.push(['update() preserved', /function update\s*\(/.test(mini) || /update=function/.test(mini) || /\bupdate\b/.test(mini)]);
ok.push(['_s preserved', /\b_s\b/.test(mini)]);
ok.push(['NAV_FLOW preserved', /NAV_FLOW/.test(mini)]);
let parses = true; try { new Function(mini); } catch { parses = false; }
ok.push(['parses', parses]);
const sz = Buffer.byteLength(mini);
ok.push(['<50KB', sz < 50000]);

fs.writeFileSync(out, mini);
console.log(`built ${out}`);
console.log(`  source ${Buffer.byteLength(code)} B -> minified ${sz} B  (${(100*(1-sz/Buffer.byteLength(code))).toFixed(0)}% smaller, ${50000-sz} B headroom)`);
for (const [k, v] of ok) console.log(`  ${v ? '✅' : '❌'} ${k}`);
if (ok.some(([, v]) => !v)) { console.error('BUILD FAILED safety checks'); process.exit(1); }
