import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build,validate} from '../src/builder.ts';
const input=JSON.parse(await readFile(new URL('../sample-data/input.json',import.meta.url),'utf8'));
test('sample has closed references and header first',()=>{
 const bundle=build(input);assert.deepEqual(validate(bundle),[]);assert.equal(bundle.entry[0].resource.resourceType,'MessageHeader');
 const urls=new Set(bundle.entry.map(e=>e.fullUrl));assert.equal(urls.size,bundle.entry.length);
 assert.equal(bundle.entry.length,6);
});
test('rejects missing identifiers',()=>{assert.throws(()=>build({...input,memberId:''}),/memberId/);});
test('rejects impossible calendar dates',()=>{assert.throws(()=>build({...input,serviceDate:'2026-02-30'}),/date/);});
test('detects dangling references',()=>{
 const b=build(input);b.entry.pop();assert.ok(validate(b).some(e=>e.includes('Unresolved reference')));
});
test('detects wrong message order and event',()=>{
 const b=build(input);b.entry.reverse();assert.ok(validate(b).length);
});
test('detects duplicate resource URLs',()=>{const b=build(input);b.entry.push(b.entry[1]);assert.ok(validate(b).length);});
test('does not assert IG profile conformance',()=>{const b=build(input);assert.equal((b.meta as any).profile,undefined);assert.equal(b.meta.tag[0].code,'synthetic-not-exchange-validated');});

test('uses integer minor-unit arithmetic',()=>{
 const b=build({...input,items:[{code:'SYNTHETIC-SVC',quantity:3,unitPriceMinor:10}]});
 const claim=b.entry[1].resource;assert.equal(claim.total.value,0.3);assert.deepEqual(validate(b),[]);
});
test('rejects zero, fractional and unsafe prices',()=>{
 for(const price of [0,1.5,Number.MAX_SAFE_INTEGER])assert.throws(()=>build({...input,items:[{code:'SYNTHETIC-SVC',quantity:2,unitPriceMinor:price}]}));
});
test('detects manipulated totals',()=>{const b=build(input);b.entry[1].resource.total.value+=1;assert.ok(validate(b).includes('Claim total mismatch'));});

test('malformed JSON shapes return findings without throwing',()=>{
 const variants:any[]=[null,[],{},'bad',42,
  {resourceType:'Bundle',type:'message',entry:{}},
  {resourceType:'Bundle',type:'message',entry:[null]},
  {resourceType:'Bundle',type:'message',entry:[{}]},
  {resourceType:'Bundle',type:'message',entry:[{resource:null}]},
  {resourceType:'Bundle',type:'message',entry:[{resource:{resourceType:'MessageHeader',id:'header'}}]},
 ];
 for(const value of variants){let findings:string[]=[];assert.doesNotThrow(()=>{findings=validate(value);});assert.ok(findings.length>0);}
});
test('non-array entries and null members never bypass validation',()=>{
 for(const entry of [null,{},'text',[null],[1],[{fullUrl:null,resource:null}]]){
  const b:any=build(input);b.entry=entry;assert.ok(validate(b).length);
 }
});

test('requires diagnoses even when item diagnosis links are empty',()=>{
 const b=build(input);delete b.entry[1].resource.diagnosis;b.entry[1].resource.item[0].diagnosisSequence=[];
 const findings=validate(b);assert.ok(findings.includes('Missing claim diagnoses'));assert.ok(findings.includes('Missing item diagnosis sequences'));
});
test('rejects invalid, duplicate and empty diagnoses',()=>{
 for(const diagnosis of [[],null,{},[null],[{sequence:1}],[{sequence:0,diagnosisCodeableConcept:{coding:[{code:'SYNTHETIC-DX'}]}}]]){
  const b=build(input);b.entry[1].resource.diagnosis=diagnosis;assert.ok(validate(b).length);
 }
 const b=build(input);b.entry[1].resource.diagnosis.push(b.entry[1].resource.diagnosis[0]);assert.ok(validate(b).length);
});
test('checks nonempty, unique, resolvable item diagnosis sequences',()=>{
 for(const links of [[],null,{},[99],[1,1],[0],['1']]){
  const b=build(input);b.entry[1].resource.item[0].diagnosisSequence=links;assert.ok(validate(b).length);
 }
});
test('malformed item entries return findings instead of crashing',()=>{
 const b=build(input);b.entry[1].resource.item=[null,1,{}, {quantity:{value:1},net:{value:'bad'}}];assert.ok(validate(b).length);
});
