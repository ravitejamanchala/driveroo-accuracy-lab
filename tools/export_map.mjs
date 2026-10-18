import fs from 'node:fs';
import path from 'node:path';
import {createMapPackage} from '../js/map-package.js';
const input=process.argv[2]||'data/corrections.json',output=process.argv[3]||'maps/v1/cambridge-map.json';
const pack=createMapPackage(JSON.parse(fs.readFileSync('data/cambridge.json','utf8')),JSON.parse(fs.readFileSync(input,'utf8')));
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(pack));console.log(`Exported ${pack.data.edges.length} road sections to ${output}`);
