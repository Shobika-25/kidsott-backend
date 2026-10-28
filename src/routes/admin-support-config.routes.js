"use strict";
// KIDSOTT_SUPPORT_CONFIG_ADMIN_29A09
// Admin-only Support Types, FAQs, Contact. Deactivation, not hard deletion.
const express = require('express');
const db = require('../config/db');
const authenticate = require('../middleware/auth.middleware');
const requireAdmin = require('../middleware/admin.middleware');
const router = express.Router();
router.use(authenticate, requireAdmin);
router.use((_req, res, next) => {
  res.set('Cache-Control','private, no-store');
  res.set('Pragma','no-cache');
  next();
});
const bad = (res,code,message) => res.status(code).json({success:false,message});
const failed = (res,e) => {
  console.error('SUPPORT CONFIG ADMIN ERROR:', e && (e.code || e.name) || 'unknown');
  return bad(res,500,'Unable to process Support configuration.');
};
function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function exact(value,allowed,required=[]) {
  if(!object(value) || Object.keys(value).some(k=>!allowed.includes(k)) || !Object.keys(value).length) return false;
  return required.every(k=>Object.prototype.hasOwnProperty.call(value,k));
}
function ident(input) {
  if(typeof input !== 'string' || !/^[1-9][0-9]*$/.test(input)) return null;
  const n = Number(input); return Number.isSafeInteger(n) ? n : null;
}
function clean(value,min,max) {
  if(typeof value !== 'string') return null;
  const v = value.trim();
  if(v.length < min || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) return null;
  return v;
}
function integer(value) {return Number.isSafeInteger(value) && value >= 0 && value <= 100000 ? value : null;}
function enabled(value){return typeof value === 'boolean' ? (value ? 1 : 0) : null;}
function keywords(value) {
  if(!Array.isArray(value) || value.length > 20) return null;
  const out = [];
  for(const word of value) {
    const trimmed = clean(word,1,60);
    if(!trimmed) return null;
    if(!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}
function parseKeywords(raw){
  try { const data = JSON.parse(String(raw||'[]')); return keywords(data)||[]; }
  catch(_){return [];}
}
function typeInput(v,create) {
  const allowed=['name','sortOrder','isActive'];
  if(!exact(v,allowed,create?['name']:[])) return null;
  const result = {};
  if('name' in v){result.name=clean(v.name,2,80);if(!result.name)return null;}
  if('sortOrder' in v){result.sortOrder=integer(v.sortOrder);if(result.sortOrder===null)return null;}
  if('isActive' in v){result.isActive=enabled(v.isActive);if(result.isActive===null)return null;}
  return result;
}
function faqInput(v,create) {
  const allowed=['question','answer','keywords','sortOrder','isActive'];
  if(!exact(v,allowed,create?['question','answer']:[])) return null;
  const result = {};
  if('question' in v){result.question=clean(v.question,5,255);if(!result.question)return null;}
  if('answer' in v){result.answer=clean(v.answer,2,10000);if(!result.answer)return null;}
  if('keywords' in v){result.keywords=keywords(v.keywords);if(!result.keywords)return null;}
  if('sortOrder' in v){result.sortOrder=integer(v.sortOrder);if(result.sortOrder===null)return null;}
  if('isActive' in v){result.isActive=enabled(v.isActive);if(result.isActive===null)return null;}
  return result;
}
function contactInput(v){
  if(!exact(v,['email','phone'],['email','phone']) || Object.keys(v).length!==2) return null;
  const email=clean(v.email,5,190);
  const phone=clean(v.phone,3,60);
  if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
     !phone || !/^[+()0-9.\s\-]+$/.test(phone) || !/[0-9]{3}/.test(phone.replace(/\D/g,''))) return null;
  return {email:email.toLowerCase(),phone};
}
const stamp = d => d==null?null:new Date(d).toISOString();
async function activeAdmin(req,res,next){
  const adminId = ident(String(req.user && req.user.id || ''));
  if(!adminId) return bad(res,401,'Administrator session required.');
  try {
    const [admins] = await db.query("SELECT id FROM users WHERE id=? AND role='admin' AND is_active=1 LIMIT 1",[adminId]);
    if(!admins.length) return bad(res,403,'Active Administrator required.');
    next();
  }catch(e){return failed(res,e);}
}
router.get('/types',async(_req,res)=>{
  try{
    const [rows]=await db.query('SELECT id,name,sort_order,is_active,created_at,updated_at FROM support_types ORDER BY sort_order,id LIMIT 501');
    return res.json({success:true,truncated:rows.length>500,types:rows.slice(0,500).map(r=>({
      id:String(r.id),name:String(r.name),sortOrder:Number(r.sort_order),isActive:!!r.is_active,
      createdAt:stamp(r.created_at),updatedAt:stamp(r.updated_at)
    }))});
  }catch(e){return failed(res,e);}
});
router.get('/faqs',async(_req,res)=>{
  try{
    const [rows]=await db.query('SELECT id,question,answer,keywords_json,sort_order,is_active,created_at,updated_at FROM support_faqs ORDER BY sort_order,id LIMIT 1001');
    return res.json({success:true,truncated:rows.length>1000,faqs:rows.slice(0,1000).map(r=>({
      id:String(r.id),question:String(r.question),answer:String(r.answer),keywords:parseKeywords(r.keywords_json),
      sortOrder:Number(r.sort_order),isActive:!!r.is_active,createdAt:stamp(r.created_at),updatedAt:stamp(r.updated_at)
    }))});
  }catch(e){return failed(res,e);}
});
router.get('/contact',async(_req,res)=>{
  try {
    const [rows]=await db.query('SELECT id,email,phone,updated_at FROM support_contact ORDER BY id ASC LIMIT 2');
    if(rows.length!==1)return bad(res,409,'Exactly one Support contact record is required.');
    const r=rows[0];return res.json({success:true,contact:{id:String(r.id),email:String(r.email),phone:String(r.phone),updatedAt:stamp(r.updated_at)}});
  }catch(e){return failed(res,e);}
});
// Mutations are Admin-protected and use only parameterized database statements.
router.post('/types',activeAdmin,async(req,res)=>{
  const input=typeInput(req.body,true);
  if(!input)return bad(res,400,'Invalid Support type fields.');
  try {
    const [matches]=await db.query('SELECT id FROM support_types WHERE LOWER(name)=LOWER(?) LIMIT 1',[input.name]);
    if(matches.length)return bad(res,409,'Support type name already exists.');
    const [result]=await db.query('INSERT INTO support_types (name,sort_order,is_active) VALUES (?,?,?)',[
      input.name,input.sortOrder??0,input.isActive??1
    ]);
    return res.status(201).json({success:true,id:String(result.insertId),created:true});
  }catch(e){return failed(res,e);}
});
router.patch('/types/:id',activeAdmin,async(req,res)=>{
  const id=ident(req.params.id),input=typeInput(req.body,false);
  if(!id || !input)return bad(res,400,'Invalid Support type ID or fields.');
  try {
    const [found]=await db.query('SELECT id,name,sort_order,is_active FROM support_types WHERE id=? LIMIT 1',[id]);
    if(!found.length)return bad(res,404,'Support type not found.');
    const row=found[0];
    const name=input.name??String(row.name),sort=input.sortOrder??Number(row.sort_order),active=input.isActive??Number(row.is_active);
    if(name!==String(row.name)){
      const [dupe]=await db.query('SELECT id FROM support_types WHERE LOWER(name)=LOWER(?) AND id<>? LIMIT 1',[name,id]);
      if(dupe.length)return bad(res,409,'Support type name already exists.');
    }
    if(active===0 && Number(row.is_active)!==0){
      const [[counts]]=await db.query('SELECT COUNT(*) AS total FROM support_types WHERE is_active=1');
      if(Number(counts.total)<=1)return bad(res,409,'At least one active Support type must remain.');
    }
    const changed=name!==String(row.name)||sort!==Number(row.sort_order)||active!==Number(row.is_active);
    if(!changed)return res.json({success:true,id:String(id),changed:false});
    const [result]=await db.query('UPDATE support_types SET name=?,sort_order=?,is_active=? WHERE id=?',[name,sort,active,id]);
    if(result.affectedRows!==1)return bad(res,409,'Support type changed during update. Retry.');
    return res.json({success:true,id:String(id),changed:true});
  }catch(e){return failed(res,e);}
});
router.post('/faqs',activeAdmin,async(req,res)=>{
  const input=faqInput(req.body,true);
  if(!input)return bad(res,400,'Invalid Support FAQ fields.');
  try{
    const [result]=await db.query('INSERT INTO support_faqs (question,answer,keywords_json,sort_order,is_active) VALUES (?,?,?,?,?)',[
      input.question,input.answer,JSON.stringify(input.keywords??[]),input.sortOrder??0,input.isActive??1
    ]);
    return res.status(201).json({success:true,id:String(result.insertId),created:true});
  }catch(e){return failed(res,e);}
});
router.patch('/faqs/:id',activeAdmin,async(req,res)=>{
  const id=ident(req.params.id),input=faqInput(req.body,false);
  if(!id || !input)return bad(res,400,'Invalid FAQ ID or fields.');
  try{
    const [found]=await db.query('SELECT id,question,answer,keywords_json,sort_order,is_active FROM support_faqs WHERE id=? LIMIT 1',[id]);
    if(!found.length)return bad(res,404,'Support FAQ not found.');
    const row=found[0];
    const question=input.question??String(row.question),answer=input.answer??String(row.answer),
      keywordsRaw=Object.hasOwn(input,'keywords')?JSON.stringify(input.keywords):String(row.keywords_json),
      sort=input.sortOrder??Number(row.sort_order),active=input.isActive??Number(row.is_active);
    const changed=question!==String(row.question)||answer!==String(row.answer)||keywordsRaw!==String(row.keywords_json)||sort!==Number(row.sort_order)||active!==Number(row.is_active);
    if(!changed)return res.json({success:true,id:String(id),changed:false});
    const [result]=await db.query('UPDATE support_faqs SET question=?,answer=?,keywords_json=?,sort_order=?,is_active=? WHERE id=?',[
      question,answer,keywordsRaw,sort,active,id
    ]);
    if(result.affectedRows!==1)return bad(res,409,'Support FAQ changed during update. Retry.');
    return res.json({success:true,id:String(id),changed:true});
  }catch(e){return failed(res,e);}
});
router.put('/contact',activeAdmin,async(req,res)=>{
  const input=contactInput(req.body);
  if(!input)return bad(res,400,'Valid email and phone are both required.');
  try{
    const [found]=await db.query('SELECT id,email,phone FROM support_contact ORDER BY id ASC LIMIT 2');
    if(found.length!==1)return bad(res,409,'Exactly one Support contact record is required.');
    const row=found[0];
    const changed=input.email!==String(row.email)||input.phone!==String(row.phone);
    if(!changed)return res.json({success:true,changed:false});
    const [result]=await db.query('UPDATE support_contact SET email=?,phone=? WHERE id=?',[input.email,input.phone,row.id]);
    if(result.affectedRows!==1)return bad(res,409,'Support contact changed during update. Retry.');
    return res.json({success:true,changed:true});
  }catch(e){return failed(res,e);}
});
module.exports=router;
