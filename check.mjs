import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
for(const [dir,files] of [['dist',['app.js','api.js','core.js','config.js']],['platform',['app.js','store.js','core.js','config.js']]]){
 for(const file of files)execFileSync(process.execPath,['--check',`${dir}/${file}`],{stdio:'inherit'});
 const html=await readFile(`${dir}/index.html`,'utf8');
 for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)){if(!match[1].startsWith('http'))await readFile(`${dir}/`+match[1].split('?')[0]);}
 await readFile(`${dir}/vendor/supabase.js`);
}
console.log('JavaScript syntax and local assets verified.');
