// Module ERP Universal Partner — étape 1 : stock + réception
// Même base (db), même authentification (sessions admin), même serveur.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
module.exports=function(routes,X){
 const id=()=>crypto.randomBytes(6).toString('hex');
 const E=()=>{const db=X.db();db.erp??={};const e=db.erp;
  e.settings??={rate:85,air:7500,sea:175000};for(const k of['stock','moves','pos','disputes','inventories','audit'])e[k]??=[];return e};
 // Rôles : admin, stock (gestionnaire stock), commercial, comptable (lecture), livreur
 const ROLES={admin:'Admin',stock:'Gestionnaire stock',commercial:'Commercial',comptable:'Comptable (lecture)',livreur:'Livreur'};
 const can=(u,w)=>{if(!u)throw[401,'Connexion requise'];const r=u.role;
  if(r==='admin')return;if(!w&&['stock','commercial','comptable'].includes(r))return;
  if(w==='stock'&&r==='stock')return;throw[403,'Accès refusé pour le rôle '+(ROLES[r]||r)]};
 const audit=(u,action,obj,detail)=>{const e=E();e.audit.unshift({id:id(),date:Date.now(),user:u?.name||'système',role:u?.role||'',action,obj,detail:detail||''});if(e.audit.length>5000)e.audit.length=5000};
 const prod=pid=>X.db().products.find(p=>p.id===pid);
 const label=s=>{const p=prod(s.pid);return (p?.name||'Produit supprimé')+(s.variant?' — '+s.variant:'')};
 const getStock=(pid,variant,loc)=>{const e=E();variant=String(variant||'').trim();let s=e.stock.find(x=>x.pid===pid&&x.variant===variant);
  if(!s){s={id:id(),pid,variant,loc:loc||'Entrepôt Dakar',qty:0,cmp:0,min:3};e.stock.push(s)}return s};
 // Mouvement : qty signée. Entrées au coût → coût moyen pondéré.
 function move(u,s,type,qty,{cost,reason,ref}={}){qty=Math.round(+qty);if(!qty)return;
  if(qty<0&&s.qty+qty<0)throw[400,'Stock insuffisant pour '+label(s)+' ('+s.qty+' dispo)'];
  if(qty>0&&cost!=null&&type!=='retour'){const c=Math.round(+cost);s.cmp=s.qty>0?Math.round((s.qty*s.cmp+qty*c)/(s.qty+qty)):c}
  s.qty+=qty;E().moves.unshift({id:id(),date:Date.now(),type,sid:s.id,label:label(s),qty,cost:Math.round(cost??s.cmp),reason:reason||'',ref:ref||'',user:u?.name||'système'});
  sync(s.pid)}
 // Synchronisation site : stock total 0 sur un produit suivi → « épuisé »
 function sync(pid){const p=prod(pid);if(!p)return;const ss=E().stock.filter(s=>s.pid===pid);if(!ss.length)return;
  const tot=ss.reduce((a,s)=>a+s.qty,0);p.out=tot<=0;p.stockQty=tot;p.outSizes=ss.filter(s=>s.qty<=0&&s.variant).map(s=>s.variant)}
 const view=s=>({...s,label:label(s),product:prod(s.pid)?.name||'',img:prod(s.pid)?.imgs?.[0]||'',value:s.qty*s.cmp,alert:s.qty<=s.min});
 const IMG=path.join(__dirname,'public','img');
 const savePhoto=(data)=>{const m=String(data||'').match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);if(!m)return null;
  const buf=Buffer.from(m[2],'base64');if(buf.length>4e6)throw[400,'Photo trop lourde (4 Mo max)'];const n='rec_'+id()+'.'+(m[1]==='png'?'png':'jpg');fs.writeFileSync(path.join(IMG,n),buf);return '/img/'+n};
 const PO_ST=['brouillon','commandée','payée','expédiée','chez le transitaire','en transit','arrivée Dakar','réceptionnée partielle','réceptionnée totale','clôturée'];
 const S=X.save;
 Object.assign(routes,{
  'GET /api/erp/me':(q,b,u)=>{can(u);return{user:X.pub(u),roles:ROLES,write:u.role==='admin'||u.role==='stock',settings:E().settings,poStatuses:PO_ST}},
  'GET /api/erp/products':(q,b,u)=>{can(u);return X.db().products.map(p=>({id:p.id,name:p.name,sizes:p.sizes||[],colors:p.colors||[],draft:!!p.draft,out:!!p.out,img:p.imgs?.[0]||''}))},
  'GET /api/erp/stock':(q,b,u)=>{can(u);const e=E();let r=e.stock.map(view);
   if(q.q){const s=q.q.toLowerCase();r=r.filter(x=>(x.label+x.loc).toLowerCase().includes(s))}if(q.alert)r=r.filter(x=>x.alert);
   r.sort((a,b)=>a.label.localeCompare(b.label));
   return{rows:r,total:{qty:r.reduce((a,x)=>a+x.qty,0),value:r.reduce((a,x)=>a+x.value,0),alerts:e.stock.filter(s=>s.qty<=s.min).length,outs:e.stock.filter(s=>s.qty<=0).length}}},
  'POST /api/erp/stock':(q,b,u)=>{can(u,'stock');if(!prod(b.pid))throw[400,'Produit requis'];const e=E();const v=String(b.variant||'').trim();
   if(e.stock.find(x=>x.pid===b.pid&&x.variant===v))throw[400,'Cette variante existe déjà'];const s=getStock(b.pid,v,b.loc);s.min=Math.max(0,+b.min||0);
   if(+b.qty>0)move(u,s,'ajustement',+b.qty,{cost:+b.cost||0,reason:'Stock initial'});else sync(b.pid);
   audit(u,'Création variante stock',label(s),'qté '+s.qty+', emplacement '+s.loc);S();return view(s)},
  'POST /api/erp/stock/edit':(q,b,u)=>{can(u,'stock');const s=E().stock.find(x=>x.id===b.id);if(!s)throw[404,'Ligne introuvable'];
   const before=s.loc+' / seuil '+s.min;if(b.loc!=null)s.loc=String(b.loc).trim()||s.loc;if(b.min!=null)s.min=Math.max(0,+b.min||0);
   audit(u,'Modification stock',label(s),before+' → '+s.loc+' / seuil '+s.min);S();return view(s)},
  'POST /api/erp/move':(q,b,u)=>{can(u,'stock');const s=E().stock.find(x=>x.id===b.sid);if(!s)throw[404,'Ligne introuvable'];
   const t=b.type;if(!['vente','retour','casse','ajustement'].includes(t))throw[400,'Type invalide'];if(!String(b.reason||'').trim())throw[400,'Motif obligatoire'];
   let qn=Math.abs(Math.round(+b.qty));if(!qn)throw[400,'Quantité requise'];const sign=t==='retour'?1:t==='ajustement'?(b.dir==='out'?-1:1):-1;
   move(u,s,t,sign*qn,{reason:b.reason,cost:t==='ajustement'&&sign>0?(+b.cost||s.cmp):undefined});audit(u,'Mouvement '+t,label(s),(sign*qn)+' — '+b.reason);S();return view(s)},
  'GET /api/erp/moves':(q,b,u)=>{can(u);let r=E().moves;if(q.type)r=r.filter(m=>m.type===q.type);if(q.sid)r=r.filter(m=>m.sid===q.sid);return r.slice(0,+q.limit||500)},
  // Commandes fournisseurs (version minimale pour la réception ; étape 2 = cycle complet + coût de revient)
  'GET /api/erp/pos':(q,b,u)=>{can(u);return E().pos},
  'POST /api/erp/pos':(q,b,u)=>{can(u,'stock');const e=E();if(!b.lines?.length)throw[400,'Au moins une ligne'];
   const po={id:id(),no:b.no||'',supplier:b.supplier||'',link:b.link||'',mode:b.mode==='maritime'?'maritime':'aérien',status:'arrivée Dakar',created:Date.now(),eta:b.eta||null,
    lines:b.lines.map(l=>{if(!prod(l.pid))throw[400,'Produit invalide'];return{id:id(),pid:l.pid,variant:String(l.variant||'').trim(),qty:Math.max(1,Math.round(+l.qty)),cny:+l.cny||0,unitCost:Math.round(+l.unitCost||(+l.cny||0)*e.settings.rate),recv:0}}),receptions:[]};
   e.pos.unshift(po);audit(u,'Création commande fournisseur',po.no||po.id,po.lines.length+' lignes');S();return po},
  'POST /api/erp/receive':(q,b,u)=>{can(u,'stock');const e=E();const po=e.pos.find(p=>p.id===b.po);if(!po)throw[404,'Commande introuvable'];
   if(['brouillon','commandée','payée','clôturée'].includes(po.status))throw[400,'Commande non réceptionnable (statut '+po.status+')'];
   const photos=(b.photos||[]).slice(0,6).map(savePhoto).filter(Boolean);const rec={id:id(),date:Date.now(),user:u.name,lines:[],photos,note:b.note||''};const gaps=[];
   for(const r of b.lines||[]){const l=po.lines.find(x=>x.id===r.id);if(!l)continue;
    const got=Math.max(0,Math.round(+r.received||0)),ok=Math.max(0,Math.round(+r.ok||0)),bad=Math.max(0,Math.round(+r.damaged||0));
    if(ok+bad!==got)throw[400,'Ligne '+label(l)+' : conforme + abîmée doit égaler reçue'];
    const rest=l.qty-l.recv;if(got>rest)throw[400,'Ligne '+label(l)+' : reçu ('+got+') > restant ('+rest+')'];
    const missing=b.final?rest-got:Math.max(0,Math.round(+r.missing||0));
    l.recv+=got;l.ok=(l.ok||0)+ok;l.damaged=(l.damaged||0)+bad;l.missing=(l.missing||0)+missing;if(b.final)l.closed=true;
    rec.lines.push({lid:l.id,label:label(l),received:got,ok,damaged:bad,missing});
    if(ok)move(u,getStock(l.pid,l.variant),'réception',ok,{cost:l.unitCost,reason:'Réception '+(po.no||po.id),ref:po.id});
    if(bad||missing)gaps.push({label:label(l),damaged:bad,missing,value:(bad+missing)*l.unitCost})}
   if(!rec.lines.length)throw[400,'Rien à réceptionner'];po.receptions.push(rec);
   const done=po.lines.every(l=>l.closed||l.recv>=l.qty);po.status=done?'réceptionnée totale':'réceptionnée partielle';
   let dsp=null;if(gaps.length){dsp={id:id(),po:po.id,poNo:po.no,supplier:po.supplier,date:Date.now(),status:'ouvert',lines:gaps,photos,value:gaps.reduce((a,g)=>a+g.value,0),notes:[]};e.disputes.unshift(dsp)}
   audit(u,'Réception',po.no||po.id,rec.lines.map(l=>l.label+' reçu '+l.received+' (ok '+l.ok+', abîmé '+l.damaged+', manquant '+l.missing+')').join(' ; '));S();return{po,dispute:dsp}},
  'GET /api/erp/disputes':(q,b,u)=>{can(u);return E().disputes},
  'POST /api/erp/dispute':(q,b,u)=>{can(u,'stock');const d=E().disputes.find(x=>x.id===b.id);if(!d)throw[404,'Litige introuvable'];
   if(b.note)d.notes.push({date:Date.now(),user:u.name,text:String(b.note)});if(b.status&&['ouvert','réclamé','remboursé','avoir','clos'].includes(b.status))d.status=b.status;
   audit(u,'Litige fournisseur',d.poNo||d.po,'statut '+d.status+(b.note?' — '+b.note:''));S();return d},
  // Inventaire physique
  'POST /api/erp/inventory/start':(q,b,u)=>{can(u,'stock');const e=E();if(e.inventories.find(i=>i.status==='en cours'))throw[400,'Un inventaire est déjà en cours'];
   const inv={id:id(),date:Date.now(),user:u.name,status:'en cours',lines:e.stock.map(s=>({sid:s.id,label:label(s),loc:s.loc,expected:s.qty,counted:null,cmp:s.cmp}))};e.inventories.unshift(inv);audit(u,'Début inventaire','',inv.lines.length+' lignes');S();return inv},
  'GET /api/erp/inventories':(q,b,u)=>{can(u);return E().inventories},
  'POST /api/erp/inventory/count':(q,b,u)=>{can(u,'stock');const inv=E().inventories.find(i=>i.id===b.id&&i.status==='en cours');if(!inv)throw[404,'Inventaire introuvable'];
   for(const c of b.counts||[]){const l=inv.lines.find(x=>x.sid===c.sid);if(l)l.counted=c.counted===''||c.counted==null?null:Math.max(0,Math.round(+c.counted))}S();return inv},
  'POST /api/erp/inventory/validate':(q,b,u)=>{can(u,'stock');const e=E();const inv=e.inventories.find(i=>i.id===b.id&&i.status==='en cours');if(!inv)throw[404,'Inventaire introuvable'];
   if(inv.lines.some(l=>l.counted==null))throw[400,'Toutes les lignes doivent être comptées'];let n=0;
   for(const l of inv.lines){const s=e.stock.find(x=>x.id===l.sid);if(!s)continue;const d=l.counted-s.qty;l.gap=l.counted-l.expected;if(d){move(u,s,'ajustement',d,{reason:'Inventaire physique du '+X.fmtDate(inv.date)});n++}}
   inv.status='validé';inv.closed=Date.now();audit(u,'Validation inventaire','',n+' écarts ajustés');S();return inv},
  'GET /api/erp/audit':(q,b,u)=>{can(u);return E().audit.slice(0,+q.limit||500)},
  'POST /api/erp/demo':(q,b,u)=>{if(u?.role!=='admin')throw[403,'Réservé à l\'admin'];const r=demo(u,b.purge);S();return r},
 });
 // Données de démo : 10 produits suivis en stock + 2 commandes 1688 (1 réceptionnée avec litige, 1 à réceptionner)
 function demo(u,purge){const e=E();
  if(purge){const ids=new Set(e.stock.filter(s=>s.demo).map(s=>s.id));e.stock=e.stock.filter(s=>!s.demo);e.moves=e.moves.filter(m=>!ids.has(m.sid));e.pos=e.pos.filter(p=>!p.demo);e.disputes=e.disputes.filter(d=>!d.demo);
   X.db().products.forEach(p=>{if(!e.stock.some(s=>s.pid===p.id)){delete p.out;delete p.stockQty;delete p.outSizes}});audit(u,'Purge données de démo');return{ok:true}}
  if(e.stock.some(s=>s.demo))throw[400,'Données de démo déjà présentes'];
  const ps=X.db().products.filter(p=>!p.draft).slice(0,10);
  ps.forEach((p,i)=>{const sz=(p.sizes||[]).slice(0,2);(sz.length?sz:['']).forEach((v,j)=>{const s=getStock(p.id,v?'Taille '+v:'');s.demo=true;s.min=3;s.loc='Étagère '+String.fromCharCode(65+i%4)+(j+1);
   move(u,s,'ajustement',[12,6,2,9,4,15,1,8,5,10][i]+j*3,{cost:1400+i*150,reason:'Stock initial (démo)'})})});
  const S1=e.stock.filter(s=>s.demo);
  const mk=(no,sup,mode,lines)=>{const po={id:id(),demo:true,no,supplier:sup,link:'https://detail.1688.com/offer/'+no+'.html',mode,status:'arrivée Dakar',created:Date.now()-864e5*12,lines:lines.map(([s,q,cny])=>({id:id(),pid:s.pid,variant:s.variant,qty:q,cny,unitCost:Math.round(cny*e.settings.rate+600),recv:0})),receptions:[]};e.pos.unshift(po);return po};
  const a=mk('3921457788012','Yangzhou Comfy Slippers Co.','aérien',[[S1[0],20,14],[S1[2],10,16]]);
  mk('3921460015577','Jinjiang Soft Home Factory','maritime',[[S1[4],30,11],[S1[6],24,12.5],[S1[8],18,13]]);
  // réception partielle de la 1re commande avec écart → litige
  routes['POST /api/erp/receive']({}, {po:a.id,final:true,note:'Démo : carton 2 ouvert',lines:[{id:a.lines[0].id,received:18,ok:17,damaged:1},{id:a.lines[1].id,received:10,ok:10,damaged:0}]},u);
  e.disputes[0].demo=true;e.moves.slice(0,40).forEach(m=>{if(S1.some(s=>s.id===m.sid))m.demo=true});
  audit(u,'Chargement données de démo','',ps.length+' produits, 2 commandes 1688');return{ok:true}}
 return{E,audit,can,move,getStock};
};
