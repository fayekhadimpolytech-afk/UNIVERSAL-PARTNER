// Module ERP Universal Partner — étape 1 : stock + réception
// Même base (db), même authentification (sessions admin), même serveur.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
module.exports=function(routes,X){
 const id=()=>crypto.randomBytes(6).toString('hex');
 const E=()=>{const db=X.db();db.erp??={};const e=db.erp;
  e.settings??={rate:90,air:7500,sea:175000};if(!e.settings.v2){if(e.settings.rate===85)e.settings.rate=90;e.settings.v2=1}e.settings.etaAir??=15;e.settings.etaSea??=60;
  if(!e.settings.v3){e.settings.v3=1;if(e.settings.etaAir===10)e.settings.etaAir=15;if(e.settings.etaSea===45)e.settings.etaSea=60;
   (e.pos||[]).filter(p=>!p.receptions?.length&&p.status!=='clôturée').forEach(p=>{p.customs=0;if(p.dates?.['expédiée'])p.eta=new Date(p.dates['expédiée']+864e5*(p.mode==='maritime'?e.settings.etaSea:e.settings.etaAir)).toISOString().slice(0,10);if(p.lines)cost(p)})}
  for(const k of['sales','couriers'])e[k]??=[];for(const k of['stock','moves','pos','disputes','inventories','audit'])e[k]??=[];return e};
 // Rôles : admin, stock (gestionnaire stock), commercial, comptable (lecture), livreur
 const ROLES={admin:'Admin',stock:'Gestionnaire stock',commercial:'Commercial',comptable:'Comptable (lecture)',livreur:'Livreur'};
 const can=(u,w)=>{if(!u)throw[401,'Connexion requise'];const r=u.role;
  if(r==='admin')return;if(!w&&['stock','commercial','comptable'].includes(r))return;
  if(w==='stock'&&r==='stock')return;if(w==='sales'&&['commercial','stock'].includes(r))return;throw[403,'Accès refusé pour le rôle '+(ROLES[r]||r)]};
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
 // Coût de revient : marchandise (CNY × taux) + frais 1688 + fret + dédouanement + transport local.
 // Fret auto = poids × tarif aérien ou CBM × tarif maritime (poids/CBM saisis sur la commande, sinon somme des lignes).
 // Fret réparti au poids (aérien) ou au volume (maritime) ; à défaut de poids/volume par ligne, au prorata des quantités.
 // Frais 1688, dédouanement et transport local répartis au prorata de la valeur marchandise.
 function cost(po,dry){const st=E().settings,rate=+po.rate||st.rate,L=po.lines||[];
  L.forEach(l=>{l.goods=Math.round((+l.cny||0)*(+l.qty||0)*rate)});
  const goods=L.reduce((a,l)=>a+l.goods,0),sea=po.mode==='maritime';
  const key=l=>(sea?+l.cbm:+l.kg)*(+l.qty||0),sumKey=L.reduce((a,l)=>a+key(l),0);
  const measure=sea?(+po.cbm||sumKey):(+po.weight||sumKey);
  if(po.freightManual===''||po.freightManual===undefined)po.freightManual=null;const freightAuto=Math.round(measure*(sea?st.sea:st.air)),freight=po.freightManual!=null?Math.round(po.freightManual):freightAuto;
  const other=Math.round((+po.fees1688||0)+(+po.local||0)),qtot=L.reduce((a,l)=>a+(+l.qty||0),0)||1;
  L.forEach(l=>{const wf=sumKey>0?key(l)/sumKey:(+l.qty||0)/qtot,wv=goods>0?l.goods/goods:(+l.qty||0)/qtot;
   l.freight=Math.round(freight*wf);l.other=Math.round(other*wv);l.total=l.goods+l.freight+l.other;l.unitCost=Math.round(l.total/(+l.qty||1))});
  Object.assign(po,{rate,goods,measure,freightAuto,freight,other,total:goods+freight+other,allocBy:sumKey>0?(sea?'volume':'poids'):'quantité'});return dry?po:po}
 const tot=sa=>sa.items.reduce((a,i)=>a+i.qty*i.price,0);
 const sv=sa=>{const t=tot(sa),c=sa.items.reduce((a,i)=>a+(i.cost||0)*i.qty,0);return{...sa,total:t,cost:sa.picked?c:null,margin:sa.picked?t-c:null}};
 function syncSite(){const e=E(),db=X.db();for(const o of db.orders||[]){if(e.sales.some(s=>s.ref===o.id))continue;
  e.sales.unshift({id:id(),ref:o.id,no:o.id,source:'site',date:o.date,name:o.name||'',phone:o.phone||'',address:o.address||'',zone:'',note:'',status:'nouvelle',dates:{nouvelle:o.date},
   items:o.items.map(i=>({pid:i.id,name:i.name,variant:i.size?'Taille '+i.size:'',qty:i.qty,price:i.price}))})}e.sales.sort((a,b)=>b.date-a.date)}
 // Sortie de stock à la préparation, au CMP du moment (sert au calcul de marge)
 function stockFor(i){const L=E().stock.filter(s=>s.pid===i.pid);return L.find(s=>s.variant===i.variant)||L.find(s=>i.variant&&s.variant.replace(/^Taille /,'')===i.variant.replace(/^Taille /,''))||(!i.variant?L.find(s=>s.qty>=i.qty):null)}
 function pick(u,sa){const miss=sa.items.filter(i=>{const s=stockFor(i);return !s||s.qty<i.qty});if(miss.length)throw[400,'Stock insuffisant : '+miss.map(i=>i.name+(i.variant?' '+i.variant:'')).join(', ')];
  for(const i of sa.items){const s=stockFor(i);i.sid=s.id;i.cost=s.cmp;move(u,s,'vente',-i.qty,{reason:'Vente '+sa.no,ref:sa.id})}sa.picked=true}
 function restock(u,sa,why){for(const i of sa.items){const s=E().stock.find(x=>x.id===i.sid);if(s)move(u,s,'retour',i.qty,{reason:'Commande '+why+' '+sa.no,ref:sa.id})}sa.picked=false;sa.restocked=true}
 // Bon de livraison PDF (générateur PDF minimal, police Helvetica, accents WinAnsi)
 function pdfBL(sa){const t=tot(sa),L=[];const W=(x,y,sz,txt,bold)=>L.push(`BT /F${bold?2:1} ${sz} Tf ${x} ${y} Td (${String(txt).replace(/[\\()]/g,m=>'\\'+m).replace(/[\u2019]/g,"'").replace(/[\u2014\u2013]/g,'-').replace(/[^\x20-\xff]/g,'?')}) Tj ET`);
  const fm=n=>new Intl.NumberFormat('fr-FR').format(n).replace(/\s/g,' ')+' FCFA',dt=X.fmtDate(sa.date);let y=790;
  W(50,y,20,'UNIVERSAL PARTNER',1);W(380,y,14,'BON DE LIVRAISON',1);y-=18;W(50,y,10,'Dakar - WhatsApp +221 77 872 27 77');W(380,y,10,'N° '+sa.no+'  du '+dt);y-=40;
  W(50,y,12,'Client',1);y-=16;W(50,y,11,sa.name);y-=14;W(50,y,11,'Tél. '+sa.phone);y-=14;W(50,y,11,('Adresse : '+(sa.address||'')).slice(0,95));y-=14;if(sa.delivery){W(50,y,11,'Zone : '+(sa.delivery.zone||'-')+'   Livreur : '+sa.delivery.courierName+' ('+sa.delivery.courierPhone+')');y-=14}
  y-=20;L.push(`0.9 g 45 ${y-6} 505 20 re f 0 g`);W(50,y,11,'Article',1);W(330,y,11,'Qté',1);W(380,y,11,'Prix u.',1);W(470,y,11,'Total',1);y-=24;
  for(const i of sa.items){W(50,y,10,(i.name+(i.variant?' - '+i.variant:'')).slice(0,52));W(335,y,10,i.qty);W(380,y,10,fm(i.price));W(470,y,10,fm(i.qty*i.price));y-=18}
  L.push(`45 ${y+6} m 550 ${y+6} l S`);y-=14;W(330,y,13,'À ENCAISSER : '+fm(t),1);y-=22;W(50,y,10,'Paiement à la livraison : espèces, Wave ou Orange Money.');y-=50;
  W(50,y,10,'Signature client :');W(330,y,10,'Signature livreur :');y-=60;W(50,y,9,'Marchandise reçue en bon état. Merci pour votre confiance !');
  const st=L.join('\n'),objs=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
   `<< /Length ${Buffer.byteLength(st,'latin1')} >>\nstream\n${st}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  let out='%PDF-1.4\n';const off=[];objs.forEach((o,i)=>{off.push(Buffer.byteLength(out,'latin1'));out+=`${i+1} 0 obj\n${o}\nendobj\n`});const x=Buffer.byteLength(out,'latin1');
  out+=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`+off.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;return Buffer.from(out,'latin1')}
 const PO_ST=['brouillon','commandée','payée','expédiée','chez le transitaire','en transit','arrivée Dakar','réceptionnée partielle','réceptionnée totale','clôturée'];
 const S=X.save;
 Object.assign(routes,{
  'GET /api/erp/me':(q,b,u)=>{can(u);return{user:X.pub(u),roles:ROLES,write:u.role==='admin'||u.role==='stock',settings:E().settings,poStatuses:PO_ST}},
  'GET /api/erp/products':(q,b,u)=>{can(u);return X.db().products.map(p=>({id:p.id,name:p.name,sizes:p.sizes||[],colors:p.colors||[],draft:!!p.draft,out:!!p.out,img:p.imgs?.[0]||'',cny:p.src?.cny||null,price:p.tiers?.[0]?.price||0,srcId:p.src?.id||'',site:p.src?.site||''}))},
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
  'POST /api/erp/pos':(q,b,u)=>{can(u,'stock');const e=E();let po=b.id&&e.pos.find(p=>p.id===b.id);const isNew=!po;
   if(po&&po.receptions.length)throw[400,'Commande déjà en réception : coûts figés'];if(!b.lines?.length)throw[400,'Au moins une ligne'];
   if(isNew)po={id:id(),status:'brouillon',created:Date.now(),dates:{brouillon:Date.now()},receptions:[]};
   const n=v=>Math.max(0,+v||0);
   Object.assign(po,{no:String(b.no||'').trim(),tracking:String(b.tracking||'').trim(),supplier:String(b.supplier||'').trim(),link:String(b.link||'').trim(),mode:b.mode==='maritime'?'maritime':'aérien',
    rate:n(b.rate)||e.settings.rate,weight:n(b.weight),cbm:n(b.cbm),fees1688:n(b.fees1688),customs:0,freightManual:b.freightManual===''||b.freightManual==null?null:n(b.freightManual),customs:n(b.customs),local:n(b.local),eta:b.eta||po.eta||null,note:String(b.note||'')});
   po.lines=b.lines.map(l=>{if(!prod(l.pid))throw[400,'Produit invalide'];return{id:l.id||id(),pid:l.pid,variant:String(l.variant||'').trim(),qty:Math.max(1,Math.round(+l.qty)),cny:n(l.cny),kg:n(l.kg),cbm:n(l.cbm),recv:0}});
   cost(po);if(isNew)e.pos.unshift(po);audit(u,isNew?'Création commande 1688':'Modification commande 1688',po.no||po.id,po.lines.length+' lignes, total '+po.total+' FCFA');S();return po},
  'POST /api/erp/po/status':(q,b,u)=>{can(u,'stock');const e=E();const po=e.pos.find(p=>p.id===b.id);if(!po)throw[404,'Commande introuvable'];
   const MAN=['brouillon','commandée','payée','expédiée','chez le transitaire','en transit','arrivée Dakar','clôturée'];if(!MAN.includes(b.status))throw[400,'Statut invalide'];
   if(/réceptionnée/.test(po.status)&&b.status!=='clôturée')throw[400,'Commande déjà réceptionnée : seule la clôture est possible'];
   if(b.status==='clôturée'&&!/réceptionnée/.test(po.status)&&u.role!=='admin')throw[400,'Clôture avant réception réservée à l\'admin'];
   const prev=po.status;po.status=b.status;po.dates??={};po.dates[b.status]=b.date?Date.parse(b.date+'T12:00:00Z'):Date.now();
   if(b.status==='commandée'&&!po.no&&b.no)po.no=String(b.no);if(b.tracking)po.tracking=String(b.tracking);
   if(b.status==='expédiée'&&!b.keepEta)po.eta=new Date(po.dates['expédiée']+864e5*(po.mode==='maritime'?e.settings.etaSea:e.settings.etaAir)).toISOString().slice(0,10);
   audit(u,'Statut commande 1688',po.no||po.id,prev+' → '+po.status);S();return po},
  'POST /api/erp/po/delete':(q,b,u)=>{can(u,'stock');const e=E();const po=e.pos.find(p=>p.id===b.id);if(!po)throw[404,'Commande introuvable'];if(po.status!=='brouillon')throw[400,'Seul un brouillon peut être supprimé'];
   e.pos=e.pos.filter(p=>p!==po);audit(u,'Suppression brouillon 1688',po.no||po.id);S();return{ok:true}},
  'POST /api/erp/settings':(q,b,u)=>{if(u?.role!=='admin')throw[403,'Réservé à l\'admin'];const e=E();const before=JSON.stringify(e.settings);
   for(const k of['rate','air','sea','etaAir','etaSea'])if(+b[k]>0)e.settings[k]=+b[k];
   E().pos.filter(p=>!p.receptions.length&&p.status!=='clôturée'&&b.apply).forEach(p=>{p.rate=e.settings.rate;cost(p)});
   audit(u,'Paramètres ERP',before,JSON.stringify(e.settings));S();return e.settings},
  'GET /api/erp/po/preview':(q,b,u)=>{can(u);return cost(JSON.parse(q.po||'{}'),true)},
  'POST /api/erp/receive':(q,b,u)=>{can(u,'stock');const e=E();const po=e.pos.find(p=>p.id===b.po);if(!po)throw[404,'Commande introuvable'];
   if(!['arrivée Dakar','réceptionnée partielle'].includes(po.status))throw[400,'Commande non réceptionnable (statut '+po.status+')'];
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
  // ---- Ventes et livraisons ----
  'GET /api/erp/sales':(q,b,u)=>{can(u);syncSite();let r=E().sales;if(q.status)r=r.filter(x=>x.status===q.status);if(q.src)r=r.filter(x=>x.source===q.src);
   if(q.q){const k=q.q.toLowerCase();r=r.filter(x=>(x.no+x.name+x.phone+x.address).toLowerCase().includes(k))}return r.map(sv)},
  'POST /api/erp/sales':(q,b,u)=>{can(u,'sales');const e=E();if(!String(b.name||'').trim()||!String(b.phone||'').trim())throw[400,'Nom et téléphone requis'];if(!b.items?.length)throw[400,'Au moins un article'];
   const items=b.items.map(i=>{const p=prod(i.pid);if(!p)throw[400,'Produit invalide'];return{pid:p.id,name:p.name,variant:String(i.variant||'').trim(),qty:Math.max(1,Math.round(+i.qty)),price:Math.round(+i.price||p.tiers?.[0]?.price||0)}});
   const sa={id:id(),no:'WA'+String(Date.now()).slice(-6),source:'whatsapp',date:Date.now(),name:String(b.name).trim(),phone:String(b.phone).trim(),address:String(b.address||'').trim(),zone:String(b.zone||'').trim(),note:String(b.note||''),items,status:'nouvelle',dates:{nouvelle:Date.now()},by:u.name};
   e.sales.unshift(sa);audit(u,'Vente WhatsApp saisie',sa.no,sa.name+' — '+tot(sa)+' FCFA');S();return sv(sa)},
  'POST /api/erp/sale/status':(q,b,u)=>{can(u,'sales');const sa=E().sales.find(x=>x.id===b.id);if(!sa)throw[404,'Vente introuvable'];
   const NEXT={nouvelle:['confirmée','annulée'],confirmée:['préparée','annulée'],préparée:['en livraison','annulée'],'en livraison':['livrée/payée','refusée','retournée'],'livrée/payée':['retournée']};
   if(!(NEXT[sa.status]||[]).includes(b.status))throw[400,'Passage '+sa.status+' → '+b.status+' impossible'];const prev=sa.status;
   if(b.status==='préparée')pick(u,sa);
   if(b.status==='en livraison'){let c=E().couriers.find(x=>x.id===b.courier);
    if(!c&&b.newCourier?.name){if(!String(b.newCourier.phone||'').trim())throw[400,'Téléphone du livreur requis'];c={id:id(),name:String(b.newCourier.name).trim(),phone:String(b.newCourier.phone).trim(),zone:String(b.newCourier.zone||'').trim(),created:Date.now()};E().couriers.unshift(c);audit(u,'Nouveau livreur',c.name,c.phone+' '+c.zone)}
    if(!c)throw[400,'Choisis ou crée un livreur'];sa.delivery={courier:c.id,courierName:c.name,courierPhone:c.phone,zone:String(b.zone||sa.zone||c.zone||''),fee:Math.max(0,Math.round(+b.fee||0)),out:Date.now()}}
   if(['refusée','retournée','annulée'].includes(b.status)&&sa.picked)restock(u,sa,b.status);
   if(b.status==='livrée/payée'){sa.paid={method:['espèces','Wave','Orange Money'].includes(b.method)?b.method:'espèces',amount:Math.round(+b.amount||tot(sa)),date:Date.now()};if(sa.delivery)sa.delivery.done=Date.now()}
   sa.status=b.status;sa.dates[b.status]=Date.now();if(b.reason)sa.reason=String(b.reason);
   if(sa.source==='site'){const o=X.db().orders.find(o=>o.id===sa.ref);if(o)o.status=b.status==='livrée/payée'?'livrée et payée':b.status}
   audit(u,'Statut vente',sa.no,prev+' → '+b.status+(b.reason?' ('+b.reason+')':''));S();return sv(sa)},
  'GET /api/erp/couriers':(q,b,u)=>{can(u);const e=E();return e.couriers.map(c=>{const L=e.sales.filter(s=>s.delivery?.courier===c.id);return{...c,count:L.length,ok:L.filter(s=>s.status==='livrée/payée').length,ko:L.filter(s=>['refusée','retournée'].includes(s.status)).length,fees:L.reduce((a,s)=>a+(s.delivery.fee||0),0)}})},
  'POST /api/erp/couriers':(q,b,u)=>{can(u,'sales');const e=E();if(!String(b.name||'').trim()||!String(b.phone||'').trim())throw[400,'Nom et téléphone requis'];
   let c=b.id&&e.couriers.find(x=>x.id===b.id);if(!c){c={id:id(),created:Date.now()};e.couriers.unshift(c)}Object.assign(c,{name:String(b.name).trim(),phone:String(b.phone).trim(),zone:String(b.zone||'').trim()});audit(u,'Fiche livreur',c.name,c.phone+' '+c.zone);S();return c},
  'GET /api/erp/sale/pdf':(q,b,u)=>{can(u);const sa=E().sales.find(x=>x.id===q.id);if(!sa)throw[404,'Vente introuvable'];return{__raw:{type:'application/pdf',name:'bon-livraison-'+sa.no+'.pdf',body:pdfBL(sa)}}},
  'POST /api/erp/demo':(q,b,u)=>{if(u?.role!=='admin')throw[403,'Réservé à l\'admin'];const r=demo(u,b.purge);S();return r},
 });
 // Données de démo : 10 produits suivis en stock + 2 commandes 1688 (1 réceptionnée avec litige, 1 à réceptionner)
 function demo(u,purge){const e=E();
  if(purge){const ids=new Set(e.stock.filter(s=>s.demo).map(s=>s.id));e.stock=e.stock.filter(s=>!s.demo);e.moves=e.moves.filter(m=>!ids.has(m.sid));e.pos=e.pos.filter(p=>!p.demo);e.disputes=e.disputes.filter(d=>!d.demo);e.sales=e.sales.filter(x=>!x.demo);e.couriers=e.couriers.filter(x=>!x.demo);
   X.db().products.forEach(p=>{if(!e.stock.some(s=>s.pid===p.id)){delete p.out;delete p.stockQty;delete p.outSizes}});audit(u,'Purge données de démo');return{ok:true}}
  if(e.stock.some(s=>s.demo))throw[400,'Données de démo déjà présentes'];
  const ps=X.db().products.filter(p=>!p.draft).slice(0,10);
  ps.forEach((p,i)=>{const sz=(p.sizes||[]).slice(0,2);(sz.length?sz:['']).forEach((v,j)=>{const s=getStock(p.id,v?'Taille '+v:'');s.demo=true;s.min=3;s.loc='Étagère '+String.fromCharCode(65+i%4)+(j+1);
   move(u,s,'ajustement',[12,6,2,9,4,15,1,8,5,10][i]+j*3,{cost:1400+i*150,reason:'Stock initial (démo)'})})});
  const S1=e.stock.filter(s=>s.demo);
  const d0=Date.now();const mk=(no,sup,mode,status,ago,extra,lines)=>{const po={id:id(),demo:true,no,tracking:'SF'+no.slice(-8),supplier:sup,link:'https://detail.1688.com/offer/'+no+'.html',mode,status,created:d0-864e5*ago,receptions:[],
   rate:e.settings.rate,fees1688:0,customs:0,local:0,freightManual:null,weight:0,cbm:0,...extra,lines:lines.map(([s,q,cny,kg,cbm])=>({id:id(),pid:s.pid,variant:s.variant,qty:q,cny,kg,cbm,recv:0}))};
   const seq=PO_ST.slice(0,PO_ST.indexOf(status)+1);po.dates={};seq.forEach((x,i)=>po.dates[x]=d0-864e5*(ago-i*Math.floor(ago/seq.length)));
   po.eta=new Date((po.dates['expédiée']||d0)+864e5*(mode==='maritime'?e.settings.etaSea:e.settings.etaAir)).toISOString().slice(0,10);cost(po);e.pos.unshift(po);return po};
  const a=mk('3921457788012','Yangzhou Comfy Slippers Co.','aérien','arrivée Dakar',14,{fees1688:4500,local:5000},[[S1[0],20,14,0.45,0],[S1[2],10,16,0.6,0]]);
  mk('3921460015577','Jinjiang Soft Home Factory','maritime','en transit',30,{fees1688:6000,local:10000},[[S1[4],30,11,0,0.004],[S1[6],24,12.5,0,0.005],[S1[8],18,13,0,0.006]]);
  // réception partielle de la 1re commande avec écart → litige
  routes['POST /api/erp/receive']({}, {po:a.id,final:true,note:'Démo : carton 2 ouvert',lines:[{id:a.lines[0].id,received:18,ok:17,damaged:1},{id:a.lines[1].id,received:10,ok:10,damaged:0}]},u);
  e.disputes[0].demo=true;e.moves.slice(0,40).forEach(m=>{if(S1.some(s=>s.id===m.sid))m.demo=true});
  const CR=[['Moussa Diop','77 123 45 67','Dakar Plateau / Médina'],['Ibrahima Fall','78 234 56 78','Parcelles / Guédiawaye'],['Cheikh Ndiaye','76 345 67 89','Pikine / Rufisque']].map(([name,phone,zone])=>{const c={id:id(),demo:true,name,phone,zone,created:d0};e.couriers.unshift(c);return c});
  const CL=[['Aminata Sow','Sacré-Cœur 3'],['Fatou Ba','Parcelles U17'],['Mariama Diallo','Médina rue 22'],['Awa Ndiaye','Pikine Icotaf'],['Khady Faye','Liberté 6'],['Ndeye Seck','Guédiawaye'],['Coumba Gueye','Ouakam'],['Rokhaya Mbaye','Grand Yoff'],['Astou Sarr','Rufisque'],['Bineta Thiam','HLM 5'],['Sokhna Diouf','Point E'],['Adama Kane','Yoff'],['Dieynaba Ly','Mermoz'],['Oumou Cisse','Keur Massar'],['Penda Niang','Plateau']];
  const FIN=['livrée/payée','livrée/payée','livrée/payée','livrée/payée','livrée/payée','livrée/payée','livrée/payée','refusée','retournée','en livraison','en livraison','préparée','confirmée','nouvelle','nouvelle'];
  const PATH=['nouvelle','confirmée','préparée','en livraison'],PAY=['espèces','Wave','Orange Money'],stocked=S1.filter(s=>s.qty>3);
  CL.forEach(([name,addr],k)=>{const s=stocked[k%stocked.length],p=prod(s.pid),qty=k%4===0?2:1,price=p.tiers?.[0]?.price||4500,c=CR[k%3];
   const sa={id:id(),demo:true,no:(k%3?'WA':'UP')+String(4100+k),source:k%3?'whatsapp':'site',date:d0-864e5*(14-k),name,phone:'77 '+(500+k*7)+' '+(10+k)+' '+(20+k),address:addr+', Dakar',zone:c.zone.split(' / ')[0],note:'',items:[{pid:p.id,name:p.name,variant:s.variant,qty,price}],status:'nouvelle',dates:{nouvelle:d0-864e5*(14-k)},by:'démo'};e.sales.push(sa);
   const tgt=FIN[k],steps=[...PATH.slice(1,(PATH.includes(tgt)?PATH.indexOf(tgt):3)+1),...(['livrée/payée','refusée','retournée'].includes(tgt)?[tgt]:[])];
   for(const st of steps)routes['POST /api/erp/sale/status']({},{id:sa.id,status:st,courier:c.id,zone:sa.zone,fee:[1500,2000,2500][k%3],method:PAY[k%3],reason:tgt==='refusée'?'Client injoignable':tgt==='retournée'?'Taille trop petite':''},u)});
  e.sales.sort((a,b)=>b.date-a.date);e.moves.forEach(m=>{if(S1.some(s=>s.id===m.sid))m.demo=true});
  audit(u,'Chargement données de démo','',ps.length+' produits, 2 commandes 1688, 15 ventes');return{ok:true}}
 return{E,audit,can,move,getStock};
};
