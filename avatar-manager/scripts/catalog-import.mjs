import { readFile, readdir, mkdir, writeFile, rename, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const POSE_IDS = ['basic','cant-hear','curious','drink','droopy','foam-roller','lying','passion','phone','pushup','run','situp','stretch','toilet','victory','weight'];
export const VARIANTS = ['cream','gray'];
export const SLOT_Z = {bottom:10,top:20,hat:30,accessory:40};
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

/** The only accepted artwork is an explicitly reviewed, transparent, nonempty PNG. */
export async function inspectPng(buffer, name) {
  const image = sharp(buffer); const meta = await image.metadata();
  assert(meta.format === 'png', `${name}: must be PNG`);
  assert(meta.width === 1000 && meta.height === 1000, `${name}: expected 1000×1000`);
  assert(meta.hasAlpha, `${name}: missing alpha channel`);
  const stats = await image.stats(); const alpha = stats.channels.at(-1);
  assert(alpha.min < 255 && alpha.max > 0, `${name}: must have both visible and transparent pixels`);
  return {sha256:sha256(buffer),bytes:buffer.length,width:1000,height:1000};
}

export async function buildCatalog(sourceRoot) {
  const root = await realpath(sourceRoot);
  const setDirectories = (await readdir(root,{withFileTypes:true})).filter(x=>x.isDirectory()).map(x=>x.name).sort();
  const catalog = {}; const files = new Map(); const manifests = {};
  const report = {schemaVersion:1,generatedAt:new Date().toISOString(),target:{hat:30,top:30,bottom:30},sets:[],items:[],assets:{},counts:{hat:0,top:0,bottom:0,accessory:0,items:0,completeItems:0,frames:0,files:0,skippedFrames:0}};
  for (const directory of setDirectories) {
    const setRoot = await realpath(path.join(root,directory));
    assert(setRoot.startsWith(root+path.sep), `Set escapes source root: ${directory}`);
    let manifest;
    try { manifest=JSON.parse(await readFile(path.join(setRoot,'manifest.json'),'utf8')); }
    catch (error) { if(error.code==='ENOENT') continue; throw new Error(`${directory}/manifest.json: ${error.message}`); }
    assert(manifest.schemaVersion===1 && idPattern.test(manifest.setId), `${directory}: invalid schemaVersion or setId`);
    assert(manifest.setId===directory, `${directory}: setId must match its directory`);
    assert(Array.isArray(manifest.items), `${directory}: items must be an array`);
    manifests[manifest.setId]=manifest; report.sets.push(manifest.setId);
    const readAsset = async (src) => {
      assert(typeof src==='string' && /^[a-zA-Z0-9_./-]+\.png$/.test(src) && !src.startsWith('/') && !src.split('/').some(s=>s==='..'||s==='.'||s===''), `${directory}: unsafe PNG path ${src}`);
      const file = await realpath(path.join(setRoot,src));
      assert(file.startsWith(setRoot+path.sep), `${directory}: asset escapes set directory: ${src}`);
      const url=`/hamsters/wardrobe/${manifest.setId}/${src}`;
      if(!files.has(url)) { const bytes=await readFile(file); report.assets[url]=await inspectPng(bytes,url); files.set(url,bytes); }
      return url;
    };
    for(const item of manifest.items) {
      assert(item && idPattern.test(item.id) && Object.hasOwn(SLOT_Z,item.slot) && typeof item.label==='string' && item.label.trim(), `${directory}: invalid item metadata`);
      assert(!report.items.some(x=>x.id===item.id), `Duplicate item ID: ${item.id}`);
      assert(item.frames && typeof item.frames==='object' && !Array.isArray(item.frames), `${item.id}: frames must be an object`);
      const registered={slot:item.slot,label:item.label,setId:manifest.setId,poses:{}};
      const coverage={id:item.id,slot:item.slot,setId:manifest.setId,label:item.label,passedFrames:0,totalFrames:32,complete:false,missing:[],skipped:[]};
      for(const [pose,variants] of Object.entries(item.frames)) {
        assert(POSE_IDS.includes(pose), `${item.id}: unknown pose ${pose}`);
        assert(variants && typeof variants==='object',`${item.id}/${pose}: invalid variants`);
        for(const [variant,frame] of Object.entries(variants)) {
          assert(VARIANTS.includes(variant),`${item.id}/${pose}: unknown variant ${variant}`);
          if(frame?.qa?.status!=='passed') { report.counts.skippedFrames++;coverage.skipped.push(`${pose}/${variant}`);continue; }
          assert(typeof frame.qa.reviewer==='string' && frame.qa.reviewer.trim() && typeof frame.qa.reviewedAt==='string' && Number.isFinite(Date.parse(frame.qa.reviewedAt)), `${item.id}/${pose}/${variant}: passed QA requires reviewer and reviewedAt`);
          const layers=[{src:await readAsset(frame.src),x:0,y:0,width:1000,height:1000,zIndex:SLOT_Z[item.slot]}];
          const foreground=[];
          assert(frame.foreground===undefined || Array.isArray(frame.foreground),`${item.id}: invalid foreground`);
          for(const layer of frame.foreground??[]) {
            const z=layer.zIndex??SLOT_Z[item.slot]+1;
            assert(Number.isFinite(z),`${item.id}: invalid foreground zIndex`);
            foreground.push({src:await readAsset(layer.src),x:0,y:0,width:1000,height:1000,zIndex:z});
          }
          registered.poses[pose]??={};
          registered.poses[pose][variant]={layers,...(foreground.length?{foreground}:{}),qa:frame.qa};
          coverage.passedFrames++;
        }
      }
      for(const pose of POSE_IDS) for(const variant of VARIANTS) if(!registered.poses[pose]?.[variant]) coverage.missing.push(`${pose}/${variant}`);
      coverage.complete=coverage.passedFrames===32; report.items.push(coverage);
      if(coverage.passedFrames) {catalog[item.id]=registered;report.counts[item.slot]++;report.counts.items++;report.counts.frames+=coverage.passedFrames;if(coverage.complete)report.counts.completeItems++;}
    }
  }
  report.counts.files=files.size;
  return {catalog,report,files,manifests};
}

export async function writeCatalog(result,destinationRoot) {
  // Validate/read all assets before changing the release snapshot. On validation errors it stays untouched.
  const artworkFile=path.join(destinationRoot,'.local/artwork.json');
  let artwork;
  try {
    artwork=JSON.parse(await readFile(artworkFile,'utf8'));
    assert(artwork.schemaVersion===1 && Array.isArray(artwork.entries),'Invalid saved artwork document');
    assert(artwork.entries.every(entry=>entry && typeof entry.originalSrc==='string' && /^[a-f0-9]{64}$/.test(entry.originalSha256) && /^[a-f0-9]{64}$/.test(entry.sha256) && entry.src===`/hamsters/edits/${entry.sha256}.png`),'Invalid saved artwork entries');
    // Keep pixel edits only while the exact imported source PNG remains unchanged.
    artwork.entries=artwork.entries.filter(entry=>entry && result.report.assets[entry.originalSrc]?.sha256===entry.originalSha256);
  } catch(error) {if(error.code!=='ENOENT')throw error;}
  const assetsRoot=path.join(destinationRoot,'public/hamsters/wardrobe');
  const staging=`${assetsRoot}.staging-${process.pid}`;
  await rm(staging,{recursive:true,force:true});await mkdir(staging,{recursive:true});
  for(const [url,bytes] of result.files) {const target=path.join(staging,url.slice('/hamsters/wardrobe/'.length));await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
  await mkdir(path.join(destinationRoot,'docs/imports'),{recursive:true});
  for(const [setId,manifest] of Object.entries(result.manifests)) await writeFile(path.join(destinationRoot,'docs/imports',`${setId}.json`),JSON.stringify(manifest,null,2)+'\n');
  // Run import while dev/build is stopped. Cross-platform directory replacement.
  await rm(assetsRoot,{recursive:true,force:true});await rename(staging,assetsRoot);
  const generated=`// Generated by npm run import:assets. Do not edit. Only QA-passed frames are included.\nimport type { ItemCatalog } from './types';\nexport const GENERATED_ITEMS = ${JSON.stringify(result.catalog,null,2)} as const satisfies ItemCatalog;\n`;
  await writeFile(path.join(destinationRoot,'src/components/hamster/catalog.generated.ts'),generated);
  await writeFile(path.join(destinationRoot,'src/components/hamster/coverage.generated.json'),JSON.stringify(result.report,null,2)+'\n');
  await writeFile(path.join(destinationRoot,'docs/CATALOG_STATUS.json'),JSON.stringify(result.report,null,2)+'\n');
  await mkdir(path.join(destinationRoot,'.local'),{recursive:true});
  await writeFile(path.join(destinationRoot,'.local/catalog.json'),JSON.stringify(result.catalog,null,2)+'\n');
  if(artwork)await writeFile(artworkFile,JSON.stringify(artwork,null,2)+'\n');
}
