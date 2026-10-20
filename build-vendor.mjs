import {build} from 'esbuild-wasm';
await build({entryPoints:['./vendor-entry.js'],bundle:true,format:'esm',platform:'browser',outfile:'dist/vendor/supabase.js',minify:true});
