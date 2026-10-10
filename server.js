// Universal Partner — serveur Node sans dépendance (API JSON + fichiers statiques)
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
// DATA_DIR (ex. /var/lib/universal-partner) : base + photos sur disque permanent ; sinon dossier de l'appli (Render)
const DATA=process.env.DATA_DIR||__dirname,PORT=process.env.PORT||3000;const DB=path.join(DATA,'data.json');
const UPL=process.env.DATA_DIR?path.join(DATA,'img'):path.join(__dirname,'public','img');fs.mkdirSync(UPL,{recursive:true});
if(process.env.DATA_DIR&&!fs.existsSync(DB)&&fs.existsSync(path.join(__dirname,'data.json')))fs.copyFileSync(path.join(__dirname,'data.json'),DB);
const id=()=>crypto.randomBytes(6).toString('hex');
const hash=p=>crypto.createHash('sha256').update('up$'+p).digest('hex');
const defZones=()=>[{id:'partout',name:'Livraison gratuite partout (Sénégal et international)',fee:0}];
function seed(){
 const cats=[['femme','Femme','👡'],['homme','Homme','🥿'],['enfant','Enfant','🧸']].map(([id,name,icon])=>({id,name,icon}));
 const sellers=[{id:'s1',name:'UNIVERSAL PARTNER',email:'admin@up.sn',pass:hash(process.env.UP_ADMIN_PASS||crypto.randomBytes(9).toString('base64url')),role:'admin',country:'Sénégal',verified:true,years:8}];
 const P=(name,cat,base,moq,img,desc)=>({id:id(),name,cat,sizes:cat==='enfant'?['24-25','26-27','28-29','30-31','32-33']:cat==='homme'?['40','41','42','43','44','45']:['36','37','38','39','40','41'],seller:'s1',unit:'pièce',moq,img,desc,sold:0,
  tiers:[{min:moq,price:base},{min:Math.max(10,moq*10),price:Math.round(base*.9)},{min:Math.max(50,moq*50),price:Math.round(base*.8)}],created:Date.now()});
 const pr=[{...P('Pantoufle peluche « Together » ourson corail','femme',5000,1,'🥿','Pantoufle fermée en peluche corail, broderie « Together » et ourson, semelle antidérapante.'),imgs:['/img/p0.jpg','/img/p8.jpg']},
  {...P('Mule ouverte noire nœud rouge','femme',4500,1,'🩴','Mule bout ouvert en bouclette noire, nœud rouge brodé, semelle souple.'),imgs:['/img/p1.jpg','/img/p9.jpg']},
  {...P('Pantoufle fourrure à carreaux beige','femme',5500,1,'🥿','Pantoufle fermée fausse fourrure à motif carreaux beige et blanc, intérieur moelleux.'),imgs:['/img/p2.jpg','/img/p6.jpg']},
  {...P('Pantoufle ourson rose semelle nuage','femme',6000,1,'🧸','Peluche rose brodée ourson, semelle épaisse effet nuage, très confortable.'),imgs:['/img/p4.jpg','/img/p5.jpg']},
P('Pantoufle homme cuir souple','homme',8500,1,'🥿','Cuir véritable, semelle antidérapante, tailles 39–46.'),
  P('Mule homme éponge confort','homme',4500,1,'🩴','Éponge lavable, semelle mousse à mémoire de forme.'),
  P('Babouche traditionnelle homme','homme',7000,1,'👞','Babouche cuir cousue main, coloris assortis.'),
  P('Claquette homme EVA','homme',2500,1,'🩴','Légère et imperméable, idéale maison et plage.'),
  P('Pantoufle femme fourrure douce','femme',6000,1,'👡','Peluche douce, semelle caoutchouc, tailles 36–41.'),
  P('Mule femme satin brodée','femme',7500,1,'👠','Satin brodé, élégante pour la maison.'),
  P('Babouche femme perlée','femme',9000,1,'🥿','Cuir et perles, finition artisanale.'),
  P('Claquette femme EVA colorée','femme',2500,1,'🩴','Coloris vifs, semelle ergonomique.'),
  {...P('Pantoufle enfant ourson rose','enfant',3500,1,'🧸','Peluche rose brodée ourson, intérieur doux, semelle antidérapante. Tailles enfant.'),imgs:['/img/p3.jpg','/img/p7.jpg']},
  P('Chausson bébé tricot','enfant',3000,1,'👶','Tricot coton, 0–24 mois.')];
 return {zones:defZones(),cats,users:[...sellers,{id:'b1',name:'Acheteur Démo',email:'demo@up.sn',pass:hash('demo123'),role:'buyer',country:'Sénégal'}],products:pr,orders:[],rfqs:[],messages:[],reviews:[],sessions:{}};
}
// Stockage : fichier local + copie durable optionnelle sur Upstash Redis (survit aux redémarrages Render)
const RU=process.env.UPSTASH_REDIS_REST_URL,RT=process.env.UPSTASH_REDIS_REST_TOKEN;
const rcall=async(cmd)=>{const r=await fetch(RU,{method:'POST',headers:{Authorization:'Bearer '+RT,'Content-Type':'application/json'},body:JSON.stringify(cmd)});return (await r.json()).result};
let db=fs.existsSync(DB)?JSON.parse(fs.readFileSync(DB)):seed();db.zones=defZones();
let st=null;const save=()=>{fs.writeFileSync(DB+'.tmp',JSON.stringify(db,null,1));fs.renameSync(DB+'.tmp',DB);if(RU&&RT){clearTimeout(st);st=setTimeout(()=>rcall(['SET','up-db',JSON.stringify(db)]).catch(e=>console.error('Redis',e.message)),800)}};
const boot=async()=>{if(RU&&RT){try{const v=await rcall(['GET','up-db']);if(v){db=JSON.parse(v);db.zones=defZones();console.log('Données chargées depuis Redis')}}catch(e){console.error('Redis indisponible',e.message)}}
 if(process.env.ADMIN_PASS){const a=db.users.find(u=>u.role==='admin');if(a)a.pass=hash(process.env.ADMIN_PASS)}save()};
const pub=u=>u&&({courier:u.courier,id:u.id,name:u.name,email:u.email,role:u.role,country:u.country,verified:u.verified,years:u.years});
const priceFor=(p,q)=>[...p.tiers].reverse().find(t=>q>=t.min)?.price??p.tiers[0].price;
const withSeller=p=>({...p,sellerInfo:pub(db.users.find(u=>u.id===p.seller)),reviews:db.reviews.filter(r=>r.product===p.id)});
const routes={
 'GET /api/meta':()=>({settings:{whatsapp:db.settings?.whatsapp||'',pixel:db.settings?.pixel||''},zones:db.zones,cats:db.cats.map(c=>({...c,count:db.products.filter(p=>p.cat===c.id&&!p.draft).length})),sellers:db.users.filter(u=>u.role==='admin').map(pub)}),
 'GET /api/products':(q,b,u)=>{let r=u?.role==='admin'&&q.all?db.products:db.products.filter(p=>!p.draft);
  if(q.q){const s=q.q.toLowerCase();r=r.filter(p=>(p.name+p.desc).toLowerCase().includes(s))}
  if(q.cat)r=r.filter(p=>p.cat===q.cat);if(q.seller)r=r.filter(p=>p.seller===q.seller);
  if(q.min)r=r.filter(p=>p.tiers[0].price>=+q.min);if(q.max)r=r.filter(p=>p.tiers[0].price<=+q.max);
  if(q.verified)r=r.filter(p=>db.users.find(u=>u.id===p.seller)?.verified);
  const s={price_asc:(a,b)=>a.tiers[0].price-b.tiers[0].price,price_desc:(a,b)=>b.tiers[0].price-a.tiers[0].price,sold:(a,b)=>b.sold-a.sold,new:(a,b)=>b.created-a.created}[q.sort];
  if(s)r=[...r].sort(s);return r.map(withSeller)},
 'GET /api/product':(q,b,u)=>{const p=db.products.find(p=>p.id===q.id&&(!p.draft||u?.role==='admin'));if(!p)throw[404,'Produit introuvable'];return withSeller(p)},
 'POST /api/register':(q,b)=>{if(!b.email||!b.pass||!b.name)throw[400,'Champs manquants'];if(db.users.find(u=>u.email===b.email))throw[400,'Email déjà utilisé'];
  const u={id:id(),name:b.name,email:b.email,pass:hash(b.pass),role:'buyer',country:b.country||'Sénégal',verified:false,years:0};db.users.push(u);return login(u)},
 'POST /api/login':(q,b)=>{const u=db.users.find(u=>u.email===b.email&&u.pass===hash(b.pass));if(!u)throw[401,'Identifiants invalides'];return login(u)},
 'GET /api/me':(q,b,u)=>pub(u),
 'POST /api/orders':(q,b,u)=>{if(!b.items?.length)throw[400,'Panier vide'];if(!u&&(!b.name?.trim()||!b.phone?.trim()||!b.address?.trim()))throw[400,'Nom, téléphone et adresse requis'];if(!b.phone?.trim()||!b.address?.trim())throw[400,'Téléphone et adresse requis'];
  const items=b.items.map(i=>{const p=db.products.find(p=>p.id===i.id);if(!p||p.draft)throw[400,'Produit invalide'];if(p.out)throw[400,'Stock épuisé : '+p.name];if(p.sizes?.length&&!p.sizes.includes(i.size))throw[400,'Choisissez la taille : '+p.name];if(p.colors?.length&&!p.colors.includes(i.color))throw[400,'Choisissez la couleur : '+p.name];if((p.outSizes||[]).includes('Taille '+i.size))throw[400,'Taille '+i.size+' épuisée : '+p.name];const qty=Math.max(+i.qty,p.moq);return{id:p.id,size:i.size||'',color:i.color||'',img:p.imgs?.[0]||p.img,name:p.name,seller:p.seller,qty,price:priceFor(p,qty)}});
  const ship=0;
  const o={id:'UP'+Date.now().toString().slice(-7),buyer:u?.id||null,name:(b.name||u?.name||'').trim(),items,ship,sub:items.reduce((s,i)=>s+i.qty*i.price,0),total:items.reduce((s,i)=>s+i.qty*i.price,0)+(ship||0),pay:'livraison',address:b.address,phone:b.phone,zone:'partout',
   status:'à payer à la livraison',date:Date.now()};
  db.orders.push(o);save();try{ERP.notifyOrder({no:o.id,source:'site',name:o.name,phone:o.phone,address:o.address,zone:o.zone==='partout'?'':o.zone,items:o.items.map(i=>({name:i.name,variant:[i.size?'Taille '+i.size:'',i.color||''].filter(Boolean).join(' / '),qty:i.qty,price:i.price}))})}catch(e){console.error('notif',e)}return o},
 'GET /api/order':(q)=>{const o=db.orders.find(o=>o.id===q.id&&o.phone.replace(/\D/g,'')===String(q.phone||'').replace(/\D/g,''));if(!o)throw[404,'Commande introuvable'];return o},
 'POST /api/password':(q,b,u)=>{need(u);if(u.pass!==hash(b.old||''))throw[400,'Mot de passe actuel incorrect'];if(String(b.pass||'').length<10)throw[400,'10 caractères minimum'];u.pass=hash(b.pass);for(const t in db.sessions)if(db.sessions[t]===u.id)delete db.sessions[t];save();return login(u)},
 'GET /api/tmapi':(q,b,u)=>{need(u,'admin');const k=db.secrets?.tmapi||'';return{set:!!k,hint:k?'••••'+k.slice(-4):''}},
 'POST /api/tmapi':(q,b,u)=>{need(u,'admin');db.secrets={...db.secrets,tmapi:String(b.key||'').trim()};save();return{set:!!db.secrets.tmapi}},
 'POST /api/import-1688':async(q,b,u)=>{need(u,'admin');const p=await import1688(b.url,b.cat,u);db.products.unshift(p);save();return p},
 'POST /api/products/publish':(q,b,u)=>{need(u,'admin');const p=db.products.find(p=>p.id===b.id);if(!p)throw[404,'Produit introuvable'];const base=+b.price;if(!base)throw[400,'Prix FCFA requis'];
  p.tiers=[{min:1,price:base},{min:10,price:Math.round(base*.9)},{min:50,price:Math.round(base*.8)}];if(b.name)p.name=String(b.name);if(b.cat)p.cat=b.cat;if(b.sizes)p.sizes=String(b.sizes).split(',').map(x=>x.trim()).filter(Boolean);delete p.draft;p.created=Date.now();save();return p},
 'POST /api/settings':(q,b,u)=>{need(u,'admin');db.settings={...db.settings,whatsapp:String(b.whatsapp||'').replace(/\D/g,'')};save();return db.settings},
 'GET /api/orders':(q,b,u)=>{need(u);return db.orders.filter(o=>o.buyer===u.id||u.role==='admin'||u.role==='logistique').reverse()},
 'POST /api/order-status':(q,b,u)=>{need(u);const o=db.orders.find(o=>o.id===b.id);if(!o||u.role!=='admin')throw[403,'Interdit'];o.status=b.status;save();return o},
 'POST /api/rfq':(q,b,u)=>{need(u);const p=db.products.find(p=>p.id===b.product);const r={id:id(),buyer:u.id,buyerName:u.name,product:b.product,productName:p?.name||b.title,seller:p?.seller||null,qty:b.qty,details:b.details,status:'ouverte',quotes:[],date:Date.now()};db.rfqs.push(r);save();return r},
 'GET /api/rfq':(q,b,u)=>{need(u);return db.rfqs.filter(r=>r.buyer===u.id||(u.role==='admin'&&(!r.seller||r.seller===u.id))).reverse()},
 'POST /api/quote':(q,b,u)=>{need(u,'admin');const r=db.rfqs.find(r=>r.id===b.rfq);if(!r)throw[404,'RFQ introuvable'];r.quotes.push({seller:u.id,sellerName:u.name,price:+b.price,delay:b.delay,note:b.note,date:Date.now()});r.status='devis reçu';save();return r},
 'POST /api/messages':(q,b,u)=>{need(u);if(!b.to||!b.text)throw[400,'Message vide'];const m={id:id(),from:u.id,to:b.to,text:b.text,product:b.product,date:Date.now()};db.messages.push(m);save();return m},
 'GET /api/messages':(q,b,u)=>{need(u);const ms=db.messages.filter(m=>m.from===u.id||m.to===u.id);const conv={};
  ms.forEach(m=>{const o=m.from===u.id?m.to:m.from;(conv[o]??=({with:pub(db.users.find(x=>x.id===o)),msgs:[]})).msgs.push(m)});return Object.values(conv)},
 'POST /api/reviews':(q,b,u)=>{need(u);const r={id:id(),product:b.product,user:u.name,stars:Math.min(5,Math.max(1,+b.stars)),text:b.text,date:Date.now()};db.reviews.push(r);save();return r},
 'POST /api/products':(q,b,u)=>{need(u,'admin');const base=+b.price,moq=Math.max(1,+b.moq||1);
  const p={id:id(),name:b.name,cat:b.cat,seller:u.id,unit:b.unit||'unité',moq,img:b.img||'🥿',imgs:b.imgUrl?[b.imgUrl]:undefined,sizes:(b.sizes||'36,37,38,39,40,41').split(',').map(x=>x.trim()).filter(Boolean),desc:b.desc||'',sold:0,created:Date.now(),
   tiers:b.tiers?.length?b.tiers:[{min:moq,price:base},{min:moq*10,price:Math.round(base*.92)},{min:moq*50,price:Math.round(base*.85)}]};
  if(!p.name||!base)throw[400,'Nom et prix requis'];db.products.push(p);save();return p},
 'POST /api/ship-fee':(q,b,u)=>{need(u,'admin');const o=db.orders.find(o=>o.id===b.id);if(!o)throw[404,'Commande introuvable'];o.ship=Math.max(0,+b.fee||0);o.total=o.sub+o.ship;o.status='frais communiqués — en attente de paiement';save();return o},
 'POST /api/zones':(q,b,u)=>{need(u,'admin');if(!Array.isArray(b.zones))throw[400,'Format invalide'];db.zones=b.zones.filter(z=>z.name).map(z=>({id:z.id||id(),name:String(z.name),fee:Math.max(0,+z.fee||0)}));save();return db.zones},
 'POST /api/products/delete':(q,b,u)=>{need(u,'admin');db.products=db.products.filter(p=>!(p.id===b.id&&p.seller===u.id));save();return{ok:true}},
};

// ---- Module ERP ----
const fmtDate=t=>new Intl.DateTimeFormat('fr-FR',{timeZone:'Africa/Dakar',day:'2-digit',month:'2-digit',year:'numeric'}).format(t);
const ERP=require('./erp.js')(routes,{img:UPL,db:()=>db,save:()=>save(),pub,fmtDate});
const STAFF=['gerant','stock','commercial','comptable','livreur','logistique'];
routes['GET /api/erp/pixel']=(q,b,u)=>{need(u,'admin');return{pixel:db.settings?.pixel||''}};
routes['POST /api/erp/pixel']=(q,b,u)=>{need(u,'admin');const p=String(b.pixel||'').replace(/\D/g,'');if(p&&(p.length<10||p.length>20))throw[400,'Identifiant de pixel invalide (15 à 16 chiffres en général)'];db.settings={...db.settings,pixel:p};save();return{pixel:p}};
routes['GET /api/erp/users']=(q,b,u)=>{need(u,'admin');return db.users.filter(x=>x.role==='admin'||STAFF.includes(x.role)).map(pub)};
routes['POST /api/erp/users']=(q,b,u)=>{need(u,'admin');if(!STAFF.includes(b.role))throw[400,'Rôle invalide'];if(!b.email||!b.name||String(b.pass||'').length<8)throw[400,'Nom, email et mot de passe (8 car. min) requis'];if(b.role==='livreur'&&!db.erp?.couriers?.some(c=>c.id===b.courier))throw[400,'Choisis la fiche livreur à relier au compte'];
 let x=db.users.find(v=>v.email===b.email);if(x&&x.role==='admin')throw[400,'Compte admin non modifiable'];if(!x){x={id:id(),country:'Sénégal'};db.users.push(x)}Object.assign(x,{name:b.name,email:b.email,role:b.role,pass:hash(b.pass),courier:b.role==='livreur'?String(b.courier||''):undefined});save();return pub(x)};
routes['POST /api/erp/users/delete']=(q,b,u)=>{need(u,'admin');db.users=db.users.filter(x=>!(x.id===b.id&&STAFF.includes(x.role)));save();return{ok:true}};
// Sauvegarde quotidienne de la base (Redis up-db-backup-AAAAMMJJ, 30 jours) + copie locale
const backup=async()=>{const k=new Date().toISOString().slice(0,10).replace(/-/g,'');db.lastBackup=Date.now();const BK=path.join(DATA,'backups');fs.mkdirSync(BK,{recursive:true});fs.writeFileSync(path.join(BK,'backup-'+k+'.json'),JSON.stringify(db));fs.readdirSync(BK).filter(f=>/^backup-\d{8}\.json$/.test(f)).sort().slice(0,-30).forEach(f=>fs.unlinkSync(path.join(BK,f)));
 if(RU&&RT){await rcall(['SET','up-db-backup-'+k,JSON.stringify(db),'EX',String(30*86400)]).catch(e=>console.error('Backup',e.message))}};
setInterval(()=>{if(!db.lastBackup||Date.now()-db.lastBackup>864e5)backup()},36e5);setTimeout(()=>{if(!db.lastBackup||Date.now()-db.lastBackup>864e5)backup()},6e4);
routes['POST /api/erp/backup']=async(q,b,u)=>{need(u,'admin');await backup();return{ok:true,date:db.lastBackup}};

// ---- Import 1688 via TMAPI ----
const IMG=UPL;
async function tm(pathq,body){const k=db.secrets?.tmapi;if(!k)throw[400,'Clé TMAPI non enregistrée dans Gestion UP'];
 const r=await fetch('http://api.tmapi.top'+pathq,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,headers:{apikey:k,'Content-Type':'application/json'},signal:AbortSignal.timeout(40000)});
 const j=await r.json().catch(()=>({}));if(j.code===4393)throw[402,'TMAPI : crédits insuffisants (forfait pas encore actif ?)'];if(j.code!==200||!j.data)throw[502,'TMAPI : '+(j.msg||j.message||('erreur '+r.status))];return j.data}
async function tr(t){t=String(t||'').trim();if(!t||!/[\u4e00-\u9fff]/.test(t))return t;try{const r=await fetch('https://api.mymemory.translated.net/get?langpair=zh-CN|fr&q='+encodeURIComponent(t.slice(0,450)),{signal:AbortSignal.timeout(15000)});const j=await r.json();return j.responseData?.translatedText||t}catch{return t}}
async function dl(u,name){try{if(u.startsWith('//'))u='https:'+u;const r=await fetch(u,{signal:AbortSignal.timeout(30000)});if(!r.ok)return null;fs.writeFileSync(path.join(IMG,name),Buffer.from(await r.arrayBuffer()));return '/img/'+name}catch{return null}}
const SITES={'1688':'1688',taobao:'Taobao/Tmall',alibaba:'Alibaba',yiwugo:'Yiwugo',aliexpress:'AliExpress',tiktok:'TikTok Shop'};
async function fetchItem(url){url=String(url||'').trim();const L=url.toLowerCase();const num=(url.match(/(\d{6,})/g)||[]).pop();
 if(/alibaba\.com/.test(L)&&!/1688|taobao|aliexpress/.test(L))return{site:'alibaba',id:num||'',cur:'$',d:await tm('/alibaba/item_detail_by_url',{url})};
 if(/aliexpress/.test(L)){const m=url.match(/item\/(\d+)/)||[0,num];return{site:'aliexpress',id:m[1],cur:'$',d:await tm('/aliexpress/item_detail?item_id='+m[1]+'&country=us')}}
 if(/tiktok/.test(L)){const m=url.match(/(\d{15,})/);if(!m)throw[400,'Numéro de produit TikTok introuvable dans le lien'];const st=(url.match(/[?&]region=([a-z]{2})/i)||url.match(/\/\/(?:shop|www)\.tiktok\.com\/([a-z]{2})\//i)||[0,'us'])[1].toLowerCase().replace('gb','uk');const site=['id','vn','my','th','ph','sg','us','uk'].includes(st)?st:'us';return{site:'tiktok',id:m[1],cur:site==='us'?'$':site.toUpperCase()+' ',d:await tm('/tikshop/item_detail?site='+site+'&item_id='+m[1])}}
 if(/yiwugo/.test(L))return{site:'yiwugo',id:num,cur:'¥',d:await tm('/yiwugo/item_detail?item_id='+num)};
 if(/taobao|tmall/.test(L)){const m=url.match(/[?&]id=(\d+)/)||[0,num];return{site:'taobao',id:m[1],cur:'¥',d:await tm('/taobao/item_detail?item_id='+m[1])}}
 if(!num)throw[400,'Lien produit non reconnu'];let d;try{d=await tm('/1688/global/item_detail?item_id='+num+'&language=fr')}catch(e){d=await tm('/1688/item_detail?item_id='+num)}return{site:'1688',id:num,cur:'¥',d}}
async function import1688(url,cat,u){const F=await fetchItem(url);const d=F.d,iid=String(F.id||Date.now());
 const title=d.title||d.subject||'';const props=(d.sku_props||d.skuProps||[]);
 const pv=props.map(p=>({name:p.prop_name||p.name||'',values:(p.values||p.value||[]).map(v=>({name:v.name||v.value||'',img:v.imageUrl||v.image_url||v.img||''}))}));
 const imgsSrc=[...new Set([...(d.main_imgs||d.images||[]),...pv.flatMap(p=>p.values.map(v=>v.img)).filter(Boolean)])].slice(0,8);
 const tag='t'+iid.slice(-6)+'_';const imgs=(await Promise.all(imgsSrc.map((s,i)=>dl(s,tag+i+'.jpg')))).filter(Boolean);
 const isSize=n=>/尺码|码|尺寸|size|taille/i.test(n);
 const sizeP=pv.find(p=>isSize(p.name)),colorP=pv.find(p=>p!==sizeP);
 const cn=[title,...(colorP?.values.map(v=>v.name)||[])];const fr=await Promise.all(cn.map(tr));
 const colors=fr.slice(1);const sizes=sizeP?(await Promise.all(sizeP.values.map(v=>tr(v.name.replace(/码/g,'').trim())))):[];
 const pr=d.price_info||{};const cny=+(pr.price||pr.sale_price||d.price||(d.price_range||d.priceRange||[])[0]?.[1]||0)||null;
 const name=(fr[0]||'Nouveau produit '+SITES[F.site]).slice(0,90);
 return {id:id(),name,cat:db.cats.some(c=>c.id===cat)?cat:db.cats[0].id,seller:u.id,unit:'pièce',moq:1,img:'🥿',imgs:imgs.length?imgs:undefined,sizes,colors,
  desc:name+(colors.length?'. Coloris : '+colors.join(', ')+'.':''),sold:0,created:Date.now(),draft:true,src:{site:F.site,id:iid,cny,cur:F.cur},tiers:[{min:1,price:0}]}}
function login(u){const t=id()+id();db.sessions[t]=u.id;save();return{token:t,user:pub(u)}}
function need(u,role){if(!u)throw[401,'Connexion requise'];if(role&&u.role!==role)throw[403,'Réservé à UP']}
const mime={'.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'};
const srv=http.createServer((req,res)=>{const url=new URL(req.url,'http://x'),q=Object.fromEntries(url.searchParams);
 if(url.pathname.startsWith('/api/')){let body='';req.on('data',c=>body+=c);req.on('end',()=>{
  const send=(c,d)=>{if(d&&d.__raw){res.writeHead(c,{'Content-Type':d.__raw.type,'Content-Disposition':'inline; filename="'+d.__raw.name+'"'});return res.end(d.__raw.body)}res.writeHead(c,{'Content-Type':'application/json'});res.end(JSON.stringify(d))};
  try{let M=req.method;if(q._m){M=q._m;if(q._b&&!body)body=q._b;}const h=routes[M+' '+url.pathname];if(!h)throw[404,'Route inconnue'];
   const tok=(req.headers.authorization||'').replace('Bearer ','')||q._t||'';let u=db.users.find(x=>x.id===db.sessions[tok]);if(u&&u.role==='gerant'&&url.pathname!=='/api/password'){if(/delete|demo/.test(url.pathname)||M==='DELETE')throw[403,'Suppression réservée à l\'admin'];u={...u,role:'admin',gerant:true}}
   Promise.resolve().then(()=>h(q,body?JSON.parse(body):{},u)).then(d=>send(200,d),e=>Array.isArray(e)?send(e[0],{error:e[1]}):(console.error(e),send(500,{error:'Erreur serveur'})))}catch(e){Array.isArray(e)?send(e[0],{error:e[1]}):(console.error(e),send(500,{error:'Erreur serveur'}))}});return}
 // --- URL produit réelles /p/<id> : balises Open Graph rendues côté serveur (aperçus Facebook/WhatsApp) ---
 if(url.pathname.startsWith('/p/')){
  const pid=url.pathname.slice(3).replace(/\/+$/,'');
  const p=db.products.find(x=>x.id===pid&&!x.draft);
  const proto=String(req.headers['x-forwarded-proto']||'https').split(',')[0].trim()||'https';
  const base=process.env.SITE_URL||(proto+'://'+String(req.headers.host||'universal-partner.com'));
  const escO=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const fmtP=n=>Number(n||0).toLocaleString('fr-FR').replace(/\u202f|\u00a0/g,' ');
  const title=p?p.name:'Universal Partner — Boutique';
  const price=p&&p.tiers&&p.tiers[0]?p.tiers[0].price:0;
  const desc=p?(p.name+' — '+fmtP(price)+' FCFA · Livraison gratuite · Paiement à la livraison · Universal Partner'):'Boutique Universal Partner — livraison gratuite, paiement à la livraison.';
  const urlProd=base+'/p/'+pid;
  const og=['<meta property="og:type" content="product">','<meta property="og:site_name" content="Universal Partner">','<meta property="og:title" content="'+escO(title)+'">','<meta property="og:description" content="'+escO(desc)+'">','<meta property="og:url" content="'+escO(urlProd)+'">','<meta name="twitter:card" content="summary_large_image">','<meta name="twitter:title" content="'+escO(title)+'">','<meta name="twitter:description" content="'+escO(desc)+'">'];
  if(p&&p.imgs&&p.imgs[0]){const im=base+p.imgs[0];og.splice(4,0,'<meta property="og:image" content="'+escO(im)+'">','<meta property="og:image:secure_url" content="'+escO(im)+'">');og.push('<meta name="twitter:image" content="'+escO(im)+'">')}
  fs.readFile(path.join(__dirname,'public','index.html'),(e,d)=>{
   let html=(e||!d)?('<!doctype html><meta http-equiv="refresh" content="0;url=/#/p/'+pid+'">'):d.toString();
   html=html.replace('</head>',og.join('\n')+'\n</head>');
   if(p)html=html.replace('</body>','<script>location.replace("/#/p/'+pid+'")</script></body>');
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);
  });
  return;
 }
 let f=path.join(__dirname,'public',url.pathname==='/'?'index.html':path.normalize(url.pathname));
 if(url.pathname.startsWith('/img/')){const g=path.join(UPL,path.basename(url.pathname));if(fs.existsSync(g))f=g}
 fs.readFile(fs.existsSync(f)?f:path.join(__dirname,'public/index.html'),(e,d)=>{res.writeHead(200,{'Content-Type':mime[path.extname(f)]||'text/html; charset=utf-8'});res.end(d)});
});
boot().then(()=>srv.listen(PORT,()=>console.log('Universal Partner sur',PORT)));
