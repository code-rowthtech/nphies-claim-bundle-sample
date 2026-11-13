import {context,message,validateEnvelope,text,date,isRecord} from './common.ts';
import type {Input} from './common.ts';
export type BillingInput = Input & {claimId:string;diagnosisCode:string;currency:'SAR';items:{code:string;quantity:number;unitPriceMinor:number}[]};
export function build(input:BillingInput,timestamp='2026-01-01T12:00:00Z') {
 text(input.claimId,'claimId');text(input.diagnosisCode,'diagnosisCode');
 if(input.currency!=='SAR' || !Array.isArray(input.items) || !input.items.length)throw new Error('SAR and at least one item required');
 let totalMinor=0;
 const items=input.items.map((item,index)=>{
  text(item.code,'service code');
  if(!Number.isSafeInteger(item.quantity)||item.quantity<=0||!Number.isSafeInteger(item.unitPriceMinor)||item.unitPriceMinor<=0)throw new Error('Positive integer quantity and minor-unit price required');
  const net=item.quantity*item.unitPriceMinor;totalMinor+=net;
  if(!Number.isSafeInteger(net)||!Number.isSafeInteger(totalMinor))throw new Error('Amount overflow');
  return {sequence:index+1,productOrService:{coding:[{system:'https://example.invalid/synthetic-services',code:item.code}]},servicedDate:input.serviceDate,
    quantity:{value:item.quantity},unitPrice:{value:item.unitPriceMinor/100,currency:'SAR'},net:{value:net/100,currency:'SAR'},diagnosisSequence:[1]};
 });
 const {make,ref,patient,provider,insurer,coverage}=context(input);
 const claim=make('Claim',{identifier:[{system:'https://example.invalid/claims',value:input.claimId}],status:'active',
  type:{coding:[{system:'http://terminology.hl7.org/CodeSystem/claim-type',code:'professional'}]},use:'claim',patient:ref(patient),created:timestamp,provider:ref(provider),insurer:ref(insurer),
  priority:{coding:[{system:'http://terminology.hl7.org/CodeSystem/processpriority',code:'normal'}]},
  diagnosis:[{sequence:1,diagnosisCodeableConcept:{coding:[{system:'https://example.invalid/synthetic-diagnoses',code:input.diagnosisCode}]}}],
  insurance:[{sequence:1,focal:true,coverage:ref(coverage)}],item:items,total:{value:totalMinor/100,currency:'SAR'}});
 return message(input,claim,[patient,provider,insurer,coverage],timestamp);
}
export function validate(bundle:unknown):string[]{
 const errors=validateEnvelope(bundle,'Claim');
 if(!isRecord(bundle)||!Array.isArray(bundle.entry))return errors;
 const claim=bundle.entry.find((entry:unknown)=>isRecord(entry)&&isRecord(entry.resource)&&entry.resource.resourceType==='Claim')?.resource;
 if(!claim)return [...errors,'Missing claim'];
 if(claim.status!=='active'||claim.use!=='claim'||claim.type?.coding?.[0]?.code!=='professional')errors.push('Invalid claim status/use/type');
 if(!claim.patient?.reference||!claim.provider?.reference||!claim.insurer?.reference||!claim.insurance?.[0]?.coverage?.reference)errors.push('Missing claim references');
 if(!Array.isArray(claim.item)||!claim.item.length)return [...errors,'Missing claim items'];
 const money=(n:unknown): n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0&&Number.isSafeInteger(Math.round(n*100))&&Math.abs(Math.round(n*100)-n*100)<0.000001;
 const diagnosisSequences=new Set<number>();
 if(!Array.isArray(claim.diagnosis)||!claim.diagnosis.length) errors.push('Missing claim diagnoses');
 else for(const diagnosis of claim.diagnosis){
  if(!isRecord(diagnosis)||!Number.isSafeInteger(diagnosis.sequence)||diagnosis.sequence<1||diagnosisSequences.has(diagnosis.sequence)){
   errors.push('Invalid or duplicate diagnosis sequence');continue;
  }
  const coding=diagnosis.diagnosisCodeableConcept?.coding;
  if(!Array.isArray(coding)||!coding.some((code:unknown)=>isRecord(code)&&typeof code.code==='string'&&code.code.trim().length>0)){
   errors.push('Missing diagnosis code');continue;
  }
  diagnosisSequences.add(diagnosis.sequence);
 }
 let total=0;const sequences=new Set<number>();
 for(const item of claim.item){
  if(!isRecord(item)){errors.push('Invalid claim item');continue;}
  if(sequences.has(item.sequence)||!Number.isSafeInteger(item.sequence)||item.sequence<1)errors.push('Invalid item sequence');sequences.add(item.sequence);
  if(!Number.isSafeInteger(item.quantity?.value)||item.quantity.value<=0||!money(item.unitPrice?.value)||!money(item.net?.value)||item.unitPrice?.currency!=='SAR'||item.net?.currency!=='SAR')errors.push('Invalid item money or quantity');
  else if(Math.round(item.net.value*100)!==Math.round(item.unitPrice.value*100)*item.quantity.value)errors.push('Item net mismatch');
  if(money(item.net?.value)) total+=Math.round(item.net.value*100);
  try{date(item.servicedDate);}catch{errors.push('Invalid service date');}
  if(!item.productOrService?.coding?.[0]?.code)errors.push('Missing service code');
  const links=item.diagnosisSequence;
  if(!Array.isArray(links)||!links.length)errors.push('Missing item diagnosis sequences');
  else if(new Set(links).size!==links.length||!links.every((sequence:unknown)=>typeof sequence==='number'&&Number.isSafeInteger(sequence)&&sequence>0&&diagnosisSequences.has(sequence)))errors.push('Unresolved diagnosis sequence');
 }
 if(!Number.isSafeInteger(total)||!money(claim.total?.value)||claim.total?.currency!=='SAR'||Math.round(claim.total.value*100)!==total)errors.push('Claim total mismatch');
 return errors;
}
