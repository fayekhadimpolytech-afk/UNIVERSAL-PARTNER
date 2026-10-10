// Module ERP Universal Partner — étape 1 : stock + réception
// Même base (db), même authentification (sessions admin), même serveur.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
module.exports=function(routes,X){
 const id=()=>crypto.randomBytes(6).toString('hex');
 const E=()=>{const db=X.db();db.erp??={};const e=db.erp;
  e.settings??={rate:90,air:7500,sea:175000};if(!e.settings.v2){if(e.settings.rate===85)e.settings.rate=90;e.settings.v2=1}e.settings.etaAir??=15;e.settings.etaSea??=60;e.settings.imp??={freightUnit:4000,margin:50};
  if(!e.settings.v3){e.settings.v3=1;if(e.settings.etaAir===10)e.settings.etaAir=15;if(e.settings.etaSea===45)e.settings.etaSea=60;
   (e.pos||[]).filter(p=>!p.receptions?.length&&p.status!=='clôturée').forEach(p=>{p.customs=0;if(p.dates?.['expédiée'])p.eta=new Date(p.dates['expédiée']+864e5*(p.mode==='maritime'?e.settings.etaSea:e.settings.etaAir)).toISOString().slice(0,10);if(p.lines)cost(p)})}
  for(const k of['sales','couriers','cash','expenses','reports'])e[k]??=[];for(const k of['stock','moves','pos','disputes','inventories','audit'])e[k]??=[];return e};
 // Rôles : admin, stock (gestionnaire stock), commercial, comptable (lecture), livreur
 const ROLES={admin:'Admin',gerant:'Gérant (tout sauf supprimer)',stock:'Gestionnaire stock',commercial:'Commercial',comptable:'Comptable (lecture)',livreur:'Livreur',logistique:'Commandes & livraisons'};
 const can=(u,w,ok)=>{if(!u)throw[401,'Connexion requise'];const r=u.role;if(r==='logistique'){if(ok)return;throw[403,'Accès réservé : commandes et livraisons uniquement']}
  if(r==='admin')return;if(!w&&['stock','commercial','comptable'].includes(r))return;
  if(w==='stock'&&r==='stock')return;if(w==='sales'&&['commercial','stock'].includes(r))return;throw[403,'Accès refusé pour le rôle '+(ROLES[r]||r)]};
 const audit=(u,action,obj,detail)=>{const e=E();e.audit.unshift({id:id(),date:Date.now(),user:u?.name||'système',role:u?.role||'',action,obj,detail:detail||''});if(e.audit.length>5000)e.audit.length=5000;try{const n=NS();if(n.all&&!X.quiet&&!/^Paramètres notifications/.test(action))setImmediate(()=>push('ERP · '+action,[(u?.name||'système')+(u?.role?' ('+u.role+')':''),obj,detail].filter(Boolean).join('\n'),'',''))}catch(_){}};
 const prod=pid=>X.db().products.find(p=>p.id===pid);
  const label=s=>{const p=prod(s.pid);return (p?.name||'Produit supprimé')+(s.variant?' — '+s.variant:'')};
  // Vignette produit : image de la variante si elle existe (p.vimgs[variant]), sinon l'image principale.
  const pimg=(pid,variant)=>{const p=prod(pid);if(!p)return '';const v=String(variant||'').trim();return (p.vimgs&&p.vimgs[v])||p.imgs?.[0]||''};
 const getStock=(pid,variant,loc)=>{const e=E();variant=String(variant||'').trim();let s=e.stock.find(x=>x.pid===pid&&x.variant===variant);
  if(!s){s={id:id(),pid,variant,loc:loc||'Entrepôt Dakar',qty:0,cmp:0,min:3};e.stock.push(s)}return s};
 // Mouvement : qty signée. Entrées au coût → coût moyen pondéré.
 function move(u,s,type,qty,{cost,reason,ref}={}){qty=Math.round(+qty);if(!qty)return;
  if(qty<0&&s.qty+qty<0)throw[400,'Stock insuffisant pour '+label(s)+' ('+s.qty+' dispo)'];
  if(qty>0&&cost!=null&&type!=='retour'){const c=Math.round(+cost);s.cmp=s.qty>0?Math.round((s.qty*s.cmp+qty*c)/(s.qty+qty)):c}
  const wasOk=s.qty>s.min;s.qty+=qty;if(qty<0&&wasOk&&s.qty<=s.min&&!X.quiet)setImmediate(()=>checkLow(s));if(s.qty>s.min)delete lowSent[s.id];E().moves.unshift({id:id(),date:Date.now(),type,sid:s.id,label:label(s),qty,cost:Math.round(cost??s.cmp),reason:reason||'',ref:ref||'',user:u?.name||'système'});
  sync(s.pid)}
 // Synchronisation site : stock total 0 sur un produit suivi → « épuisé »
 function sync(pid){const p=prod(pid);if(!p)return;const ss=E().stock.filter(s=>s.pid===pid);if(!ss.length)return;
  const tot=ss.reduce((a,s)=>a+s.qty,0);p.out=tot<=0;p.stockQty=tot;p.outSizes=ss.filter(s=>s.qty<=0&&s.variant).map(s=>s.variant)}
  const view=s=>({...s,label:label(s),product:prod(s.pid)?.name||'',img:pimg(s.pid,s.variant),value:s.qty*s.cmp,alert:s.qty<=s.min});
 const IMG=X.img||path.join(__dirname,'public','img');
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
  const sv=sa=>{const t=tot(sa),c=sa.items.reduce((a,i)=>a+(i.cost||0)*i.qty,0);return{...sa,items:sa.items.map(i=>({...i,img:pimg(i.pid,i.variant)})),total:t,cost:sa.picked?c:null,margin:sa.picked?t-c:null,pct:sa.picked&&t?Math.round(100*(t-c)/t):null}};
 function syncSite(){const e=E(),db=X.db();for(const o of db.orders||[]){if(e.sales.some(s=>s.ref===o.id))continue;
  e.sales.unshift({id:id(),ref:o.id,no:o.id,source:'site',date:o.date,name:o.name||'',phone:o.phone||'',address:o.address||'',zone:'',note:'',status:'nouvelle',dates:{nouvelle:o.date},
   items:o.items.map(i=>({pid:i.id,name:i.name,variant:[i.size?'Taille '+i.size:'',i.color||''].filter(Boolean).join(' / '),qty:i.qty,price:i.price}))})}e.sales.sort((a,b)=>b.date-a.date)}
 // Sortie de stock à la préparation, au CMP du moment (sert au calcul de marge)
 function stockFor(i){const L=E().stock.filter(s=>s.pid===i.pid),nz=v=>String(v||'').replace(/Taille /g,'').toLowerCase().split(/\s*\/\s*/).filter(Boolean).sort().join('/');
  // Variante exacte (taille + couleur) ; sinon la seule ligne de stock du produit si elle n'a pas de variante. Plus de « première variante disponible ».
  return L.find(s=>s.variant===i.variant)||L.find(s=>nz(s.variant)===nz(i.variant))||(L.length===1&&!L[0].variant?L[0]:null)}
 function pick(u,sa){const miss=sa.items.filter(i=>{const s=stockFor(i);return !s||s.qty<i.qty});if(miss.length)throw[400,'Stock insuffisant ou variante absente du stock : '+miss.map(i=>i.name+(i.variant?' '+i.variant:'')).join(', ')];
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
 const EXP=['fret','transitaire','publicité Facebook','transport','salaires','autres'];
 const dayOf=t=>new Date(t).toISOString().slice(0,10); // Africa/Dakar = UTC+0 toute l'année
 // ---- Notifications (CallMeBot WhatsApp + ntfy) ----
 const BASE=process.env.PUBLIC_URL||'https://universal-partner.com';
 const NS=()=>{const e=E();e.notif??={};const n=e.notif;n.wa??={on:false,phone:'221778722777',key:''};n.ntfy??={on:false,topic:'up-'+crypto.randomBytes(9).toString('hex'),server:'https://ntfy.sh'};n.orders??=true;n.stock??=true;n.all??=true;n.log??=[];return n};
 const fmF=v=>new Intl.NumberFormat('fr-FR').format(Math.round(v||0)).replace(/\s/g,' ')+' FCFA';
 async function push(title,body,link,tags){const n=NS(),out=[];
  if(n.wa.on&&n.wa.key&&n.wa.phone){try{const r=await fetch('https://api.callmebot.com/whatsapp.php?phone='+encodeURIComponent(n.wa.phone)+'&apikey='+encodeURIComponent(n.wa.key)+'&text='+encodeURIComponent('*'+title+'*\n'+body+(link?'\n'+link:'')),{signal:AbortSignal.timeout(20000)});const t=await r.text();
   out.push({ch:'WhatsApp',ok:r.ok&&!/error|invalid|not/i.test(t.slice(0,300)),msg:t.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,160)})}catch(x){out.push({ch:'WhatsApp',ok:false,msg:x.message})}}
  if(n.ntfy.on&&n.ntfy.topic){try{const r=await fetch(n.ntfy.server.replace(/\/$/,''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:n.ntfy.topic,title,message:body,click:link||undefined,tags:tags||[],priority:4}),signal:AbortSignal.timeout(15000)});
   out.push({ch:'ntfy',ok:r.ok,msg:r.ok?'envoyé':'HTTP '+r.status})}catch(x){out.push({ch:'ntfy',ok:false,msg:x.message})}}
  n.log.unshift({date:Date.now(),title,res:out});n.log.length=Math.min(n.log.length,30);X.save();return out}
 function notifyOrder(o){const n=NS();if(!n.orders)return;const t=o.items.reduce((a,i)=>a+i.qty*i.price,0);
  const body=`${o.source==='site'?'🌐 Site':'💬 WhatsApp'} · ${o.no}\n👤 ${o.name} · ${o.phone}\n${o.items.map(i=>`• ${i.qty} × ${i.name}${i.variant?' ('+i.variant+')':''}`).join('\n')}\n💰 ${fmF(t)}\n📍 ${[o.zone,o.address].filter(Boolean).join(' — ')||'—'}`;
  push('Nouvelle commande '+o.no,body,BASE+'/erp.html#ventes?q='+encodeURIComponent(o.no),['shopping_cart']).catch(()=>{})}
 const lowSent={};function checkLow(s){const n=NS();if(!n.stock||!s)return;if(s.qty>s.min){delete lowSent[s.id];return}if(lowSent[s.id])return;lowSent[s.id]=1;
  push(s.qty<=0?'Rupture de stock':'Stock sous le seuil',`${label(s)}\nReste ${s.qty} (seuil ${s.min}) · 📍 ${s.loc}`,BASE+'/erp.html#stock',['warning']).catch(()=>{})}
 const PO_ST=['brouillon','commandée','payée','expédiée','chez le transitaire','en transit','arrivée Dakar','réceptionnée partielle','réceptionnée totale','clôturée'];
 const S=X.save;
 Object.assign(routes,{
  'GET /api/erp/me':(q,b,u)=>{if(u?.role!=='livreur')can(u,0,1);return{user:X.pub(u),roles:ROLES,write:u.role==='admin'||u.role==='stock',settings:E().settings,poStatuses:PO_ST}},
  'GET /api/erp/products':(q,b,u)=>{can(u,0,1);return X.db().products.map(p=>({id:p.id,name:p.name,sizes:p.sizes||[],colors:p.colors||[],draft:!!p.draft,out:!!p.out,img:p.imgs?.[0]||'',cny:p.src?.cny||null,price:p.tiers?.[0]?.price||0,srcId:p.src?.id||'',site:p.src?.site||''}))},
  'GET /api/erp/stock':(q,b,u)=>{can(u,0,1);const e=E();let r=e.stock.map(view);
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
  'GET /api/erp/moves':(q,b,u)=>{can(u,0,1);let r=E().moves;if(q.type)r=r.filter(m=>m.type===q.type);if(q.sid)r=r.filter(m=>m.sid===q.sid);return r.slice(0,+q.limit||500)},
  // Commandes fournisseurs (version minimale pour la réception ; étape 2 = cycle complet + coût de revient)
  'GET /api/erp/pos':(q,b,u)=>{can(u);return E().pos.map(po=>({...po,lines:(po.lines||[]).map(l=>({...l,img:pimg(l.pid,l.variant)}))}))},
  'POST /api/erp/pos':(q,b,u)=>{can(u,'stock');const e=E();let po=b.id&&e.pos.find(p=>p.id===b.id);const isNew=!po;
   if(po&&po.receptions.length)throw[400,'Commande déjà en réception : coûts figés'];if(!b.lines?.length)throw[400,'Au moins une ligne'];
   if(isNew)po={id:id(),status:'brouillon',created:Date.now(),dates:{brouillon:Date.now()},receptions:[]};
   const n=v=>Math.max(0,+v||0);
   Object.assign(po,{no:String(b.no||'').trim(),tracking:String(b.tracking||'').trim(),supplier:String(b.supplier||'').trim(),link:String(b.link||'').trim(),mode:b.mode==='maritime'?'maritime':'aérien',
    rate:n(b.rate)||e.settings.rate,weight:n(b.weight),cbm:n(b.cbm),fees1688:n(b.fees1688),customs:0,freightManual:b.freightManual===''||b.freightManual==null?null:n(b.freightManual),customs:n(b.customs),local:n(b.local),eta:b.eta||po.eta||null,note:String(b.note||'')});
   po.lines=b.lines.map(l=>{if(!prod(l.pid))throw[400,'Produit invalide'];return{id:l.id||id(),pid:l.pid,variant:String(l.variant||'').trim(),qty:Math.max(1,Math.round(+l.qty)),cny:n(l.cny),kg:n(l.kg),cbm:n(l.cbm),recv:0}});
   cost(po);if(isNew)e.pos.unshift(po);audit(u,isNew?'Création réapprovisionnement':'Modification réapprovisionnement',po.no||po.id,po.lines.length+' lignes, total '+po.total+' FCFA');S();return po},
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
   if(b.impFreight!=null||b.impMargin!=null)e.settings.imp={freightUnit:Math.max(0,Math.round(+(b.impFreight??e.settings.imp.freightUnit))),margin:Math.min(95,Math.max(0,+(b.impMargin??e.settings.imp.margin)))};
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
  'GET /api/erp/sales':(q,b,u)=>{can(u,0,1);syncSite();let r=E().sales;if(q.status)r=r.filter(x=>x.status===q.status);if(q.src)r=r.filter(x=>x.source===q.src);
   if(q.q){const k=q.q.toLowerCase();r=r.filter(x=>(x.no+x.name+x.phone+x.address).toLowerCase().includes(k))}return r.map(sv)},
  'POST /api/erp/sales':(q,b,u)=>{can(u,'sales',1);const e=E();if(!String(b.name||'').trim()||!String(b.phone||'').trim())throw[400,'Nom et téléphone requis'];if(!b.items?.length)throw[400,'Au moins un article'];
   const items=b.items.map(i=>{const p=prod(i.pid);if(!p)throw[400,'Produit invalide'];return{pid:p.id,name:p.name,variant:String(i.variant||'').trim(),qty:Math.max(1,Math.round(+i.qty)),price:Math.round(+i.price||p.tiers?.[0]?.price||0)}});
   const sa={id:id(),no:'WA'+String(Date.now()).slice(-6),source:'whatsapp',date:Date.now(),name:String(b.name).trim(),phone:String(b.phone).trim(),address:String(b.address||'').trim(),zone:String(b.zone||'').trim(),note:String(b.note||''),items,status:'nouvelle',dates:{nouvelle:Date.now()},by:u.name};
   e.sales.unshift(sa);notifyOrder(sa);audit(u,'Vente WhatsApp saisie',sa.no,sa.name+' — '+tot(sa)+' FCFA');S();return sv(sa)},
  'POST /api/erp/sale/status':(q,b,u)=>{can(u,'sales',1);const sa=E().sales.find(x=>x.id===b.id);if(!sa)throw[404,'Vente introuvable'];
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
  'GET /api/erp/couriers':(q,b,u)=>{can(u,0,1);const e=E();return e.couriers.map(c=>{const L=e.sales.filter(s=>s.delivery?.courier===c.id);return{...c,count:L.length,ok:L.filter(s=>s.status==='livrée/payée').length,ko:L.filter(s=>['refusée','retournée'].includes(s.status)).length,fees:L.reduce((a,s)=>a+(s.delivery.fee||0),0)}})},
  'POST /api/erp/couriers':(q,b,u)=>{can(u,'sales',1);const e=E();if(!String(b.name||'').trim()||!String(b.phone||'').trim())throw[400,'Nom et téléphone requis'];
   let c=b.id&&e.couriers.find(x=>x.id===b.id);if(!c){c={id:id(),created:Date.now()};e.couriers.unshift(c)}Object.assign(c,{name:String(b.name).trim(),phone:String(b.phone).trim(),zone:String(b.zone||'').trim()});audit(u,'Fiche livreur',c.name,c.phone+' '+c.zone);S();return c},
  'GET /api/erp/sale/pdf':(q,b,u)=>{can(u,0,1);const sa=E().sales.find(x=>x.id===q.id);if(!sa)throw[404,'Vente introuvable'];return{__raw:{type:'application/pdf',name:'bon-livraison-'+sa.no+'.pdf',body:pdfBL(sa)}}},
  // ---- Recettes : remise de caisse quotidienne par livreur ----
  'GET /api/erp/cash':(q,b,u)=>{can(u);const e=E(),day=q.day||dayOf(Date.now());const rows={};
   for(const s of e.sales){if(s.status!=='livrée/payée'||!s.paid||!s.delivery||dayOf(s.paid.date)!==day)continue;const r=rows[s.delivery.courier]??={courier:s.delivery.courier,name:s.delivery.courierName,phone:s.delivery.courierPhone,expected:{'espèces':0,Wave:0,'Orange Money':0},fees:0,sales:[]};
    r.expected[s.paid.method]+=s.paid.amount;r.fees+=s.delivery.fee||0;r.sales.push({no:s.no,name:s.name,amount:s.paid.amount,method:s.paid.method,items:(s.items||[]).map(i=>({name:i.name,variant:i.variant,img:pimg(i.pid,i.variant)}))})}
   for(const c of e.cash.filter(c=>c.day===day))rows[c.courier]??={courier:c.courier,name:c.name,phone:'',expected:c.expected,fees:0,sales:[]};
   const list=Object.values(rows).map(r=>{const st=e.cash.find(c=>c.day===day&&c.courier===r.courier);return{...r,settlement:st||null}});
   return{day,rows:list,history:e.cash.slice(0,200)}},
  'POST /api/erp/cash':(q,b,u)=>{can(u,'sales');const e=E();const day=String(b.day||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw[400,'Date invalide'];
   const cur=routes['GET /api/erp/cash']({day},{},u).rows.find(r=>r.courier===b.courier);if(!cur)throw[404,'Aucun encaissement pour ce livreur ce jour-là'];
   const M=['espèces','Wave','Orange Money'],rem={},gap={};M.forEach(m=>{rem[m]=Math.max(0,Math.round(+b.remitted?.[m]||0));gap[m]=rem[m]-cur.expected[m]});
   let st=e.cash.find(c=>c.day===day&&c.courier===b.courier);const isNew=!st;if(!st){st={id:id(),day,courier:b.courier,name:cur.name};e.cash.unshift(st)}
   const feePaid=b.feePaid!==false;Object.assign(st,{expected:cur.expected,remitted:rem,gap,totalExpected:M.reduce((a,m)=>a+cur.expected[m],0),totalRemitted:M.reduce((a,m)=>a+rem[m],0),fees:cur.fees,feePaid,note:String(b.note||''),user:u.name,date:Date.now()});
   st.totalGap=st.totalRemitted-st.totalExpected;audit(u,isNew?'Remise de caisse':'Correction remise de caisse',st.name+' '+day,'attendu '+st.totalExpected+', remis '+st.totalRemitted+', écart '+st.totalGap);S();return st},
  // ---- Dépenses ----
  'GET /api/erp/expenses':(q,b,u)=>{can(u);let r=E().expenses;if(q.from)r=r.filter(x=>x.day>=q.from);if(q.to)r=r.filter(x=>x.day<=q.to);if(q.cat)r=r.filter(x=>x.cat===q.cat);
   const by={};EXP.forEach(c=>by[c]=0);r.forEach(x=>by[x.cat]=(by[x.cat]||0)+x.amount);return{cats:EXP,rows:r,byCat:by,total:r.reduce((a,x)=>a+x.amount,0)}},
  'POST /api/erp/expenses':(q,b,u)=>{can(u,'admin');const e=E();if(!EXP.includes(b.cat))throw[400,'Catégorie invalide'];const amount=Math.round(+b.amount);if(!(amount>0))throw[400,'Montant requis'];
   const day=/^\d{4}-\d{2}-\d{2}$/.test(b.day||'')?b.day:dayOf(Date.now());let x=b.id&&e.expenses.find(v=>v.id===b.id);const isNew=!x;if(!x){x={id:id(),created:Date.now()};e.expenses.unshift(x)}
   Object.assign(x,{day,cat:b.cat,amount,label:String(b.label||'').trim(),po:b.po||'',pay:String(b.pay||''),user:u.name});e.expenses.sort((a,b)=>b.day.localeCompare(a.day));
   audit(u,isNew?'Dépense':'Modification dépense',x.cat,x.amount+' FCFA — '+x.label);S();return x},
  'POST /api/erp/expenses/delete':(q,b,u)=>{can(u,'admin');const e=E();const x=e.expenses.find(v=>v.id===b.id);if(!x)throw[404,'Dépense introuvable'];e.expenses=e.expenses.filter(v=>v!==x);audit(u,'Suppression dépense',x.cat,x.amount+' FCFA — '+x.label);S();return{ok:true}},
  // ---- Marges ----
  'GET /api/erp/margins':(q,b,u)=>{can(u);const e=E(),from=q.from||'0000',to=q.to||'9999',g=q.group||'jour';
   const L=e.sales.filter(s=>s.status==='livrée/payée'&&s.picked!==false).map(sv).filter(s=>{const d=dayOf(s.paid?.date||s.date);return d>=from&&d<=to});
   const key=t=>{const d=dayOf(t);if(g==='mois')return d.slice(0,7);if(g==='semaine'){const x=new Date(d+'T00:00:00Z'),w=(x.getUTCDay()+6)%7;x.setUTCDate(x.getUTCDate()-w);return x.toISOString().slice(0,10)}return d};
   const P={};for(const s of L){const k=key(s.paid?.date||s.date),p=P[k]??={period:k,count:0,revenue:0,cost:0,fees:0};p.count++;p.revenue+=s.total;p.cost+=s.cost||0;p.fees+=s.delivery?.fee||0}
   const ex=e.expenses.filter(x=>x.day>=from&&x.day<=to);for(const x of ex.filter(x=>!['fret','transitaire'].includes(x.cat))){const p=P[key(Date.parse(x.day+'T12:00:00Z'))]??={period:key(Date.parse(x.day+'T12:00:00Z')),count:0,revenue:0,cost:0,fees:0};p.exp=(p.exp||0)+x.amount}
   const per=Object.values(P).map(p=>({...p,exp:p.exp||0,margin:p.revenue-p.cost,pct:p.revenue?Math.round(100*(p.revenue-p.cost)/p.revenue):0,net:p.revenue-p.cost-p.fees-(p.exp||0)})).sort((a,b)=>b.period.localeCompare(a.period));
   const T=per.reduce((a,p)=>({count:a.count+p.count,revenue:a.revenue+p.revenue,cost:a.cost+p.cost,fees:a.fees+p.fees,exp:a.exp+p.exp}),{count:0,revenue:0,cost:0,fees:0,exp:0});
   T.margin=T.revenue-T.cost;T.pct=T.revenue?Math.round(100*T.margin/T.revenue):0;T.net=T.margin-T.fees-T.exp;
   return{sales:L.map(s=>({id:s.id,no:s.no,date:s.paid?.date||s.date,name:s.name,total:s.total,cost:s.cost,margin:s.margin,pct:s.total?Math.round(100*s.margin/s.total):0,fee:s.delivery?.fee||0,red:s.total?s.margin/s.total<.5:false,items:s.items.map(i=>i.qty+'× '+i.name+(i.variant?' '+i.variant:'')).join(' | ')})),periods:per,total:T,threshold:50}},
  // ---- Tableau de bord ----
  'GET /api/erp/dashboard':(q,b,u)=>{can(u,0,1);syncSite();const e=E(),now=Date.now(),td=dayOf(now);
   const wk=(()=>{const x=new Date(td+'T00:00:00Z');x.setUTCDate(x.getUTCDate()-(x.getUTCDay()+6)%7);return x.toISOString().slice(0,10)})(),mo=td.slice(0,7)+'-01';
   const paid=e.sales.filter(s=>s.status==='livrée/payée').map(sv),pd=s=>dayOf(s.paid?.date||s.date);
   const per=from=>{const L=paid.filter(s=>pd(s)>=from),ca=L.reduce((a,s)=>a+s.total,0),c=L.reduce((a,s)=>a+(s.cost||0),0);return{count:L.length,ca,margin:ca-c,pct:ca?Math.round(100*(ca-c)/ca):0,basket:L.length?Math.round(ca/L.length):0}};
   const ok=e.sales.filter(s=>s.status==='livrée/payée').length,ko=e.sales.filter(s=>['refusée','retournée'].includes(s.status)).length;
   const st=e.stock.map(view);const top={};for(const s of paid)for(const i of s.items){const t=top[i.pid]??={pid:i.pid,name:i.name,img:pimg(i.pid,i.variant),qty:0,ca:0};t.qty+=i.qty;t.ca+=i.qty*i.price}
   const last={};for(const m of e.moves){const k=m.sid;if(m.type==='vente')last[k]=Math.max(last[k]||0,m.date);if(m.qty>0&&m.type!=='retour')(last['in'+k]??=m.date,last['in'+k]=Math.min(last['in'+k],m.date))}
   const dormant=st.filter(s=>s.qty>0).map(s=>{const ref=last[s.id]||last['in'+s.id]||now;return{...s,lastSale:last[s.id]||null,days:Math.floor((now-ref)/864e5)}}).filter(s=>s.days>60).sort((a,b)=>b.days-a.days);
   const pos=e.pos.filter(p=>!/réceptionnée totale|clôturée/.test(p.status)).sort((a,b)=>String(a.eta||'9').localeCompare(String(b.eta||'9'))).map(p=>({id:p.id,no:p.no,supplier:p.supplier,mode:p.mode,status:p.status,eta:p.eta,total:p.total,late:p.eta&&p.eta<td&&!/arrivée|réceptionnée/.test(p.status)}));
   return{today:per(td),week:per(wk),month:per(mo),delivery:{ok,ko,rate:ok+ko?Math.round(100*ok/(ok+ko)):0,pending:e.sales.filter(s=>['nouvelle','confirmée','préparée','en livraison'].includes(s.status)).length},
    stock:{value:st.reduce((a,s)=>a+s.value,0),qty:st.reduce((a,s)=>a+s.qty,0),outs:st.filter(s=>s.qty<=0),low:st.filter(s=>s.qty>0&&s.alert)},top:Object.values(top).sort((a,b)=>b.qty-a.qty||b.ca-a.ca).slice(0,5),dormant,pos,
     cashGaps:e.cash.filter(c=>c.totalGap).slice(0,5),threshold:50}},
   // ---- Rapports hebdomadaires ----
   'GET /api/erp/reports':(q,b,u)=>{can(u,0,1);return E().reports||[]},
   'POST /api/erp/report/run':(q,b,u)=>{if(u?.role!=='admin')throw[403,'Réservé à l\'admin'];return runWeeklyReport(u)},
  // ---- Espace livreur ----
  'GET /api/erp/livreur':(q,b,u)=>{if(u?.role!=='livreur')throw[403,'Réservé aux livreurs'];const e=E(),td=dayOf(Date.now());
   const L=e.sales.filter(s=>s.delivery?.courier===u.courier&&(s.status==='en livraison'||dayOf(s.delivery.done||s.delivery.out)===td)).map(sv);
   const cash={'espèces':0,Wave:0,'Orange Money':0};L.filter(s=>s.paid&&dayOf(s.paid.date)===td).forEach(s=>cash[s.paid.method]+=s.paid.amount);
   return{courier:e.couriers.find(c=>c.id===u.courier)||null,sales:L,cash,fees:L.filter(s=>s.status!=='en livraison').reduce((a,s)=>a+(s.delivery.fee||0),0)}},
  'POST /api/erp/livreur/status':(q,b,u)=>{if(u?.role!=='livreur')throw[403,'Réservé aux livreurs'];const sa=E().sales.find(x=>x.id===b.id);
   if(!sa||sa.delivery?.courier!==u.courier||sa.status!=='en livraison')throw[403,'Livraison non attribuée'];if(!['livrée/payée','refusée','retournée'].includes(b.status))throw[400,'Statut invalide'];
   if(b.status!=='livrée/payée'&&!String(b.reason||'').trim())throw[400,'Motif obligatoire'];return routes['POST /api/erp/sale/status'](q,{...b,_lv:1},{...u,role:'admin',name:u.name+' (livreur)'})},
  'GET /api/erp/notif':(q,b,u)=>{if(u?.role!=='admin')throw[403,'Réservé à l\'admin'];const n=NS();X.save();return{wa:{on:n.wa.on,phone:n.wa.phone,keySet:!!n.wa.key,hint:n.wa.key?'••••'+n.wa.key.slice(-2):''},ntfy:n.ntfy,orders:n.orders,stock:n.stock,all:n.all,log:n.log.slice(0,10)}},
  'POST /api/erp/notif':(q,b,u)=>{if(u?.role!=='admin')throw[403,'Réservé à l\'admin'];const n=NS();
   if(b.wa){n.wa.on=!!b.wa.on;if(b.wa.phone)n.wa.phone=String(b.wa.phone).replace(/\D/g,'');if(b.wa.key)n.wa.key=String(b.wa.key).trim();if(b.wa.clearKey)n.wa.key=''}
   if(b.ntfy){n.ntfy.on=!!b.ntfy.on;if(b.ntfy.regen)n.ntfy.topic='up-'+crypto.randomBytes(9).toString('hex')}if(b.orders!=null)n.orders=!!b.orders;if(b.stock!=null)n.stock=!!b.stock;if(b.all!=null)n.all=!!b.all;
   audit(u,'Paramètres notifications','',`WhatsApp ${n.wa.on?'oui':'non'}, ntfy ${n.ntfy.on?'oui':'non'}, commandes ${n.orders?'oui':'non'}, stock ${n.stock?'oui':'non'}`);X.save();return routes['GET /api/erp/notif'](q,b,u)},
  'POST /api/erp/notif/test':async(q,b,u)=>{if(u?.role!=='admin')throw[403,'Réservé à l\'admin'];const n=NS();if(!(n.wa.on&&n.wa.key)&&!n.ntfy.on)throw[400,'Active au moins un canal (et enregistre la clé CallMeBot pour WhatsApp)'];
   return push('Test Universal Partner','✅ Les notifications fonctionnent.\nExemple : nouvelle commande, client, articles, montant, zone.',BASE+'/erp.html',['white_check_mark'])},
  'POST /api/erp/demo':(q,b,u)=>{if(u?.role!=='admin')throw[403,'Réservé à l\'admin'];const r=demo(u,b.purge);S();return r},
 });
 // ---- Rapport hebdomadaire (auto chaque lundi 09:00 Dakar = UTC) ----
 const nF=n=>Number(n||0).toLocaleString('fr-FR');
 function buildReport(from,to){const e=E();syncSite();
  const inR=t=>{const d=dayOf(t);return d>=from&&d<=to};
  const paid=e.sales.filter(s=>s.status==='livrée/payée').map(sv).filter(s=>inR(s.paid?.date||s.date));
  const ca=paid.reduce((a,s)=>a+s.total,0),cost=paid.reduce((a,s)=>a+(s.cost||0),0);
  const margin=ca-cost,pct=ca?Math.round(100*margin/ca):0;
  const received=e.sales.filter(s=>inR(s.date));
  const bySource={};received.forEach(s=>bySource[s.source]=(bySource[s.source]||0)+1);
  const top={};for(const s of paid)for(const i of s.items){const t=top[i.pid]??={pid:i.pid,name:i.name,img:pimg(i.pid,i.variant),qty:0,ca:0};t.qty+=i.qty;t.ca+=i.qty*i.price}
  const st=e.stock.map(view);
  const outs=st.filter(s=>s.qty<=0),low=st.filter(s=>s.qty>0&&s.alert);
  const last={};for(const m of e.moves){const k=m.sid;if(m.type==='vente')last[k]=Math.max(last[k]||0,m.date);if(m.qty>0&&m.type!=='retour')last['in'+k]=Math.min(last['in'+k]??m.date,m.date)}
  const now=Date.now();
  const dormant=st.filter(s=>s.qty>0).map(s=>{const ref=last[s.id]||last['in'+s.id]||now;return{...s,days:Math.floor((now-ref)/864e5)}}).filter(s=>s.days>60).sort((a,b)=>b.days-a.days);
  const byMethod={'espèces':0,Wave:0,'Orange Money':0};paid.forEach(s=>{if(s.paid)byMethod[s.paid.method]=(byMethod[s.paid.method]||0)+s.paid.amount});
  const gaps=e.cash.filter(c=>c.totalGap&&inR(Date.parse(c.day+'T12:00:00Z'))).map(c=>({day:c.day,name:c.name||c.courier,totalGap:c.totalGap}));
  const pending=e.sales.filter(s=>['nouvelle','confirmée','préparée','en livraison'].includes(s.status));
  const pos=e.pos.filter(p=>!/réceptionnée totale|clôturée/.test(p.status)).map(p=>({no:p.no||'brouillon',status:p.status,eta:p.eta,total:p.total}));
  return{from,to,ca,margin,pct,count:paid.length,basket:paid.length?Math.round(ca/paid.length):0,received:received.length,bySource,top:Object.values(top).sort((a,b)=>b.qty-a.qty||b.ca-a.ca).slice(0,5),outs:outs.map(s=>({label:s.label,qty:s.qty,img:s.img})),low:low.map(s=>({label:s.label,qty:s.qty,min:s.min,img:s.img})),dormant:dormant.map(s=>({label:s.label,days:s.days,qty:s.qty,value:s.value,img:s.img})),cash:{byMethod,total:Object.values(byMethod).reduce((a,b)=>a+b,0),gaps},pending:{count:pending.length,value:pending.reduce((a,s)=>a+tot(s),0)},pos}}
 function reportText(r){const dd=d=>d.split('-').reverse().join('/');return ['📊 Rapport hebdo Universal Partner','Semaine du '+dd(r.from)+' au '+dd(r.to),
  'CA livré/payé : '+nF(r.ca)+' FCFA · marge '+nF(r.margin)+' ('+r.pct+' %) · '+r.count+' vente(s) · panier '+nF(r.basket)+' FCFA',
  'Commandes reçues : '+r.received+' (site '+(r.bySource.site||0)+', WhatsApp '+(r.bySource.whatsapp||0)+')',
  'Meilleures ventes : '+(r.top.map((t,i)=>(i+1)+') '+t.name+' ('+t.qty+')').join(' · ')||'—'),
  'Ruptures : '+(r.outs.map(s=>s.label).join(', ')||'aucune')+'  |  Stock bas : '+(r.low.map(s=>s.label).join(', ')||'aucun'),
  'Dormants (>60 j) : '+(r.dormant.length?r.dormant.slice(0,5).map(s=>s.label+' ('+s.days+' j)').join(', '):'aucun'),
  'Caisse encaissée : '+nF(r.cash.total)+' FCFA'+(r.cash.gaps.length?' · écarts : '+r.cash.gaps.map(g=>g.name+' '+nF(g.totalGap)+' F').join(', '):' · aucun écart'),
  'En cours : '+r.pending.count+' commande(s) · '+nF(r.pending.value)+' FCFA · '+r.pos.length+' réappro',
  BASE+'/erp.html#report'].join('\n')}
 function runWeeklyReport(u){const now=Date.now(),from=dayOf(now-7*864e5),to=dayOf(now-864e5);const r=buildReport(from,to);r.id=id();r.generated=now;const e=E();e.reports.unshift(r);if(e.reports.length>30)e.reports.length=30;S();
  try{push('📊 Rapport hebdo UP',reportText(r),BASE+'/erp.html#report',['bar_chart']).catch(()=>{})}catch(_){}
  const q=X.quiet;X.quiet=1;audit(u||{name:'système',role:'système'},'Rapport hebdomadaire généré',r.from+' → '+r.to,'CA '+r.ca+' · marge '+r.margin);X.quiet=q;return r}
 function nextMonday9(now){const d=new Date(now);d.setUTCHours(9,0,0,0);const day=d.getUTCDay();let add=(1-day+7)%7;if(add===0&&now>=d.getTime())add=7;d.setUTCDate(d.getUTCDate()+add);return d.getTime()}
 function prevMonday9(now){const d=new Date(now);d.setUTCHours(9,0,0,0);const day=d.getUTCDay();let sub=(day-1+7)%7;d.setUTCDate(d.getUTCDate()-sub);if(d.getTime()>now)d.setUTCDate(d.getUTCDate()-7);return d.getTime()}
 function scheduleReports(){const t=nextMonday9(Date.now());setTimeout(()=>{try{runWeeklyReport()}catch(e){console.error('Rapport hebdo',e.message)}scheduleReports()},Math.max(1000,t-Date.now()))}
 try{const e=E();const last=e.reports[0]?.generated||0;if(last&&last<prevMonday9(Date.now()))runWeeklyReport()}catch(_){}
 scheduleReports();
 // Données de démo : 10 produits suivis en stock + 2 commandes 1688 (1 réceptionnée avec litige, 1 à réceptionner)
 function demo(u,purge){X.quiet=1;const n=NS(),o=n.orders;n.orders=false;try{return demo0(u,purge)}finally{n.orders=o;X.quiet=0}}
 function demo0(u,purge){const e=E();
  if(purge){const ids=new Set(e.stock.filter(s=>s.demo).map(s=>s.id));e.stock=e.stock.filter(s=>!s.demo);e.moves=e.moves.filter(m=>!ids.has(m.sid));e.pos=e.pos.filter(p=>!p.demo);e.disputes=e.disputes.filter(d=>!d.demo);e.sales=e.sales.filter(x=>!x.demo);e.couriers=e.couriers.filter(x=>!x.demo);e.cash=e.cash.filter(x=>!x.demo);e.expenses=e.expenses.filter(x=>!x.demo);
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
   const sa={id:id(),demo:true,no:(k%3?'WA':'UP')+String(4100+k),source:k%3?'whatsapp':'site',date:d0-864e5*(k<7?6-k:Math.max(0,14-k))-36e5*3,name,phone:'77 '+(500+k*7)+' '+(10+k)+' '+(20+k),address:addr+', Dakar',zone:c.zone.split(' / ')[0],note:'',items:[{pid:p.id,name:p.name,variant:s.variant,qty,price}],status:'nouvelle',dates:{nouvelle:d0-864e5*(k<7?6-k:Math.max(0,14-k))},by:'démo'};e.sales.push(sa);
   const tgt=FIN[k],steps=[...PATH.slice(1,(PATH.includes(tgt)?PATH.indexOf(tgt):3)+1),...(['livrée/payée','refusée','retournée'].includes(tgt)?[tgt]:[])];
   for(const st of steps)routes['POST /api/erp/sale/status']({},{id:sa.id,status:st,courier:c.id,zone:sa.zone,fee:[1500,2000,2500][k%3],method:PAY[k%3],reason:tgt==='refusée'?'Client injoignable':tgt==='retournée'?'Taille trop petite':''},u)});
  e.sales.filter(s=>s.demo&&s.paid).forEach(s=>{s.paid.date=Math.min(d0,s.date+36e5*2);s.dates['livrée/payée']=s.paid.date;if(s.delivery)s.delivery.done=s.paid.date});
  const days=[...new Set(e.sales.filter(s=>s.demo&&s.paid).map(s=>dayOf(s.paid.date)))];
  let gapDone=0;days.forEach((d,k)=>{const r=routes['GET /api/erp/cash']({day:d},{},u).rows;r.forEach((c,j)=>{const rem={...c.expected};const gp=!gapDone&&k>0&&rem['espèces']>=1000;if(gp){rem['espèces']-=1000;gapDone=1}
   const st=routes['POST /api/erp/cash']({},{day:d,courier:c.courier,remitted:rem,note:gp?'Démo : manque 1 000 F, à récupérer':''},u);st.demo=true})});
  [['fret',112500,'Fret aérien commande 3921457788012',13],['transitaire',15000,'Frais de dossier transitaire',12],['publicité Facebook',25000,'Campagne pantoufles 7 jours',10],['publicité Facebook',15000,'Boost post carrousel',4],
   ['transport',5000,'Taxi entrepôt → bureau',9],['transport',3000,'Course livraison urgente',3],['salaires',60000,'Préparateur commandes (quinzaine)',2],['autres',4500,'Sachets et étiquettes',6]].forEach(([cat,amount,label,ago])=>{
   const x={id:id(),demo:true,created:d0,day:dayOf(d0-864e5*ago),cat,amount,label,po:'',pay:'',user:u.name};e.expenses.push(x)});e.expenses.sort((a,b)=>b.day.localeCompare(a.day));
  const dz=S1.filter(s=>!e.moves.some(m=>m.sid===s.id&&m.type==='vente')).slice(-2);dz.forEach(s=>e.moves.filter(m=>m.sid===s.id).forEach(m=>m.date=d0-864e5*75));
  e.sales.sort((a,b)=>b.date-a.date);e.moves.forEach(m=>{if(S1.some(s=>s.id===m.sid))m.demo=true});
  audit(u,'Chargement données de démo','',ps.length+' produits, 2 commandes 1688, 15 ventes');return{ok:true}}
 return{E,audit,can,move,getStock,notifyOrder};
};
