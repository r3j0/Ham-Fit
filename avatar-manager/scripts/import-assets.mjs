import path from 'node:path';
import { buildCatalog, writeCatalog } from './catalog-import.mjs';
const source=process.argv[2];
if(!source) { console.error('Usage: npm run import:assets -- /path/to/art-production/sets');process.exit(1); }
const result=await buildCatalog(path.resolve(source));
await writeCatalog(result,process.cwd());
console.log(JSON.stringify(result.report.counts,null,2));
console.log('Imported QA-passed frames only. See docs/CATALOG_STATUS.json for exact coverage and omissions.');
