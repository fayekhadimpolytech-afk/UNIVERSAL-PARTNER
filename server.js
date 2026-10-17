// Universal Partner — serveur Node sans dépendance (API JSON + fichiers statiques)
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
// DATA_DIR (ex. /var/lib/universal-partner) : base + photos sur disque permanent ; sinon dossier de l'appli (Render)
const DATA=process.env.DATA_DIR||__dirname,PORT=process.env.PORT||3000;const DB=path.join(DATA,'data.json');
const UPL=process.env.DATA_DIR?path.join(DATA,'img'):path.join(__dirname,'public','img');fs.mkdirSync(UPL,{recursive:true});
if(process.env.DATA_DIR&&!fs.existsSync(DB)&&fs.existsSync(path.join(__dirname,'data.json')))fs.copyFileSync(path.join(__dirname,'data.json'),DB);
const id=()=>crypto.randomBytes(6).toString('hex');
const hash=p=>crypto.createHash('sha256').update('up$'+p).digest('hex');
const defZones=()=>[{id:'partout',name:'Livraison gratuite partout (Sénégal et international)',fee:0}];
// Arborescence de catégories proposée (2 niveaux) — appliquée une fois, éditable dans Gestion UP
const PROPOSED_SUBCATS=[['femme-pantoufles','Pantoufles & chaussons femme','🥿','femme'],['femme-mules','Mules & claquettes femme','🩴','femme'],['femme-beaute','Beauté & soins','💅','femme'],['homme-pantoufles','Pantoufles & chaussons homme','🥿','homme'],['homme-mules','Mules & claquettes homme','🩴','homme'],['enfant-bebe','Chaussons bébé','👶','enfant'],['enfant-pantoufles','Pantoufles enfant','🧸','enfant'],['info-souris','Souris & claviers','🖱️','informatique'],['info-accessoires','Accessoires bureau','⌨️','informatique'],['maison-entretien','Entretien & nettoyage','🧽','maison'],['maison-cuisine','Cuisine & rangement','🍽️','maison']];
function migrateCats(){if(db.seedTree==='2')return;const ids=new Set(db.cats.map(c=>c.id));db.cats.forEach(c=>{if(c.parent===undefined)c.parent=null});
 for(const s of PROPOSED_SUBCATS)if(!ids.has(s[0])&&ids.has(s[3])){db.cats.push({id:s[0],name:s[1],icon:s[2],parent:s[3]});ids.add(s[0])}
 db.seedTree='2';console.log('Catégories : arborescence proposée appliquée')}
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
 if(process.env.ADMIN_PASS){const a=db.users.find(u=>u.role==='admin');if(a)a.pass=hash(process.env.ADMIN_PASS)}
 try{migrateCats()}catch(e){console.error('migrate',e.message)}save()};
const pub=u=>u&&({courier:u.courier,id:u.id,name:u.name,email:u.email,role:u.role,country:u.country,verified:u.verified,years:u.years});
const priceFor=(p,q)=>[...p.tiers].reverse().find(t=>q>=t.min)?.price??p.tiers[0].price;
const couponFind=c=>{const k=String(c||'').trim().toUpperCase();return k?(db.coupons||[]).find(x=>String(x.code||'').toUpperCase()===k):null};
function couponDisc(c,sub){if(!c||!c.active)return 0;if(c.expires&&Date.now()>Date.parse(c.expires+'T23:59:59'))return 0;if(c.maxUses&&(c.uses||0)>=c.maxUses)return 0;if(c.min&&sub<c.min)return 0;const d=c.type==='amount'?Math.round(+c.value||0):Math.round(sub*(+c.value||0)/100);return Math.max(0,Math.min(sub,d))}
function couponWhy(c,sub){if(!c)return'Code promo inconnu';if(!c.active)return'Code promo désactivé';if(c.expires&&Date.now()>Date.parse(c.expires+'T23:59:59'))return'Code promo expiré';if(c.maxUses&&(c.uses||0)>=c.maxUses)return'Code promo déjà utilisé au maximum';if(c.min&&sub<c.min)return'Code promo valable dès '+c.min+' FCFA';return null}
const REVOK=r=>r.status!=='en attente'&&r.status!=='rejeté';
const ratingFor=pid=>{const rs=db.reviews.filter(r=>r.product===pid&&REVOK(r)),count=rs.length;return{avg:count?Math.round(rs.reduce((s,r)=>s+r.stars,0)/count*10)/10:0,count}};
const withSeller=p=>{const r=ratingFor(p.id);return{...p,sellerInfo:pub(db.users.find(u=>u.id===p.seller)),rating:r,reviews:db.reviews.filter(x=>x.product===p.id&&REVOK(x)).map(x=>({id:x.id,user:x.user,stars:x.stars,text:x.text,date:x.date}))}};
const routes={
 'GET /api/meta':()=>{const live=db.products.filter(p=>!p.draft),par=id=>db.cats.find(c=>c.id===id)?.parent,n=c=>live.filter(p=>p.cat===c.id||par(p.cat)===c.id).length;
  return{settings:{whatsapp:db.settings?.whatsapp||'',pixel:db.settings?.pixel||''},zones:db.zones,cats:db.cats.map(c=>({...c,count:n(c)})),sellers:db.users.filter(u=>u.role==='admin').map(pub)}},
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
  const items=b.items.map(i=>{const p=db.products.find(p=>p.id===i.id);if(!p||p.draft)throw[400,'Produit invalide'];if(p.out||p.sold)throw[400,'Sold out (rupture de stock) : '+p.name];if(p.sizes?.length&&!p.sizes.includes(i.size))throw[400,'Choisissez la taille : '+p.name];if(p.colors?.length&&!p.colors.includes(i.color))throw[400,'Choisissez la couleur : '+p.name];if((p.outSizes||[]).includes('Taille '+i.size)||(p.soldSizes||[]).includes(i.size))throw[400,'Taille '+i.size+' épuisée : '+p.name];if((p.soldColors||[]).includes(i.color))throw[400,'Couleur '+i.color+' épuisée : '+p.name];const qty=Math.max(+i.qty,p.moq);return{id:p.id,size:i.size||'',color:i.color||'',img:p.imgs?.[0]||p.img,name:p.name,seller:p.seller,qty,price:priceFor(p,qty)}});
  const ship=0,sub=items.reduce((s,i)=>s+i.qty*i.price,0);
  let disc=0,coupon=null;const cc=couponFind(b.coupon);if(String(b.coupon||'').trim()&&!cc)throw[400,'Code promo inconnu'];if(cc){const why=couponWhy(cc,sub);if(why)throw[400,why];disc=couponDisc(cc,sub);if(disc>0){coupon={code:cc.code,disc};cc.uses=(cc.uses||0)+1}}
  const o={id:'UP'+Date.now().toString().slice(-7),buyer:u?.id||null,name:(b.name||u?.name||'').trim(),email:String(b.email||u?.email||'').trim().slice(0,80),items,ship,sub,disc,coupon,total:Math.max(0,sub-disc)+(ship||0),pay:'livraison',address:b.address,phone:b.phone,zone:'partout',
   status:'à payer à la livraison',date:Date.now()};
  db.orders.push(o);save();try{ERP.notifyOrder({no:o.id,source:'site',name:o.name,phone:o.phone,address:o.address,zone:o.zone==='partout'?'':o.zone,items:o.items.map(i=>({name:i.name,variant:[i.size?'Taille '+i.size:'',i.color||''].filter(Boolean).join(' / '),qty:i.qty,price:i.price}))})}catch(e){console.error('notif',e)}return o},
 'GET /api/order':(q)=>{const o=db.orders.find(o=>o.id===q.id&&o.phone.replace(/\D/g,'')===String(q.phone||'').replace(/\D/g,''));if(!o)throw[404,'Commande introuvable'];return o},
 'POST /api/password':(q,b,u)=>{need(u);if(u.pass!==hash(b.old||''))throw[400,'Mot de passe actuel incorrect'];if(String(b.pass||'').length<10)throw[400,'10 caractères minimum'];u.pass=hash(b.pass);for(const t in db.sessions)if(db.sessions[t]===u.id)delete db.sessions[t];save();return login(u)},
 'GET /api/tmapi':(q,b,u)=>{need(u,'admin');const k=db.secrets?.tmapi||'';return{set:!!k,hint:k?'••••'+k.slice(-4):''}},
 'POST /api/tmapi':(q,b,u)=>{need(u,'admin');const k=String(b.key||'').trim();
  if(!k)throw[400,'Clé TMAPI vide'];
  if(/\.\.\.|…|\s/.test(k))throw[400,'Clé incomplète : on dirait un extrait masqué (…). Dans console.tmapi.io → API Keys, clique sur Copier pour récupérer la clé entière, puis colle-la ici.'];
  db.secrets={...db.secrets,tmapi:k};save();return{set:!!db.secrets.tmapi}},
 'POST /api/import-1688':async(q,b,u)=>{need(u,'admin');const p=await import1688(b.url,b.cat,u);db.products.unshift(p);save();return p},
 'GET /api/import/config':(q,b,u)=>{need(u,'admin');return{...impCfg(),cur:'¥',formula:'prix = (CNY × taux + fret estimé/unité) ÷ (1 − marge)'}},
 'POST /api/import/manual':async(q,b,u)=>{need(u,'admin');const name=String(b.name||'').trim();if(!name)throw[400,'Nom du produit requis'];
  const cny=+b.cny||0;const urls=String(b.imgs||'').split(/[\s,]+/).map(x=>x.trim()).filter(Boolean).slice(0,8);
  const tag='m'+Date.now().toString(36);const imgs=(await Promise.all(urls.map((s,i)=>dl(s,tag+i+'.jpg')))).filter(Boolean);
  const cfg=impCfg();const price=suggestedPrice(cny)||Math.max(0,Math.round(+b.price||0));
  const desc=[String(b.desc||'').trim(),b.specs?'Caractéristiques : '+String(b.specs).trim():''].filter(Boolean).join(' · ');
  const p={id:id(),name,cat:db.cats.some(c=>c.id===b.cat)?b.cat:db.cats[0].id,seller:u.id,unit:'pièce',moq:1,img:'📦',
   imgs:imgs.length?imgs:undefined,sizes:String(b.sizes||'').split(',').map(x=>x.trim()).filter(Boolean),colors:String(b.colors||'').split(',').map(x=>x.trim()).filter(Boolean),
   desc,sold:0,created:Date.now(),draft:true,src:{site:'manuel',id:tag,cny:cny||null,cur:'¥',goods:cny?Math.round(cny*cfg.rate):null,freight:cfg.freightUnit,suggested:price},tiers:[{min:1,price}]};
  db.products.unshift(p);save();return p},
 'POST /api/products/publish':(q,b,u)=>{need(u,'admin');const p=db.products.find(p=>p.id===b.id);if(!p)throw[404,'Produit introuvable'];const base=+b.price;if(!base)throw[400,'Prix FCFA requis'];
  p.tiers=[{min:1,price:base},{min:10,price:Math.round(base*.9)},{min:50,price:Math.round(base*.8)}];if(b.name)p.name=String(b.name);if(b.was!=null){const w=Math.round(+b.was||0);p.was=w>base?w:0}if(b.cat)p.cat=b.cat;if(b.sizes)p.sizes=String(b.sizes).split(',').map(x=>x.trim()).filter(Boolean);delete p.draft;p.created=Date.now();save();return p},
 // Modifier le prix (et le nom) d'un produit déjà publié — paliers 10/50 recalculés (−10 %/−20 %)
 'POST /api/products/price':(q,b,u)=>{need(u,'admin');const p=db.products.find(p=>p.id===b.id);if(!p)throw[404,'Produit introuvable'];const base=Math.round(+b.price);if(!(base>0))throw[400,'Prix FCFA requis'];
  p.tiers=[{min:1,price:base},{min:10,price:Math.round(base*.9)},{min:50,price:Math.round(base*.8)}];if(b.name)p.name=String(b.name);
  if(b.was!=null){const w=Math.round(+b.was||0);p.was=w>base?w:0}save();return p},
 // Marquage manuel « Sold out » (produit et/ou variantes) — prioritaire sur le stock ERP
 'POST /api/product/soldout':(q,b,u)=>{need(u,'admin');const p=db.products.find(p=>p.id===b.id);if(!p)throw[404,'Produit introuvable'];
  if(b.sold!=null)p.sold=!!b.sold;
  if(b.soldSizes!=null)p.soldSizes=(Array.isArray(b.soldSizes)?b.soldSizes:[]).map(x=>String(x).trim()).filter(Boolean);
  if(b.soldColors!=null)p.soldColors=(Array.isArray(b.soldColors)?b.soldColors:[]).map(x=>String(x).trim()).filter(Boolean);
  save();return p},
 'POST /api/settings':(q,b,u)=>{need(u,'admin');db.settings={...db.settings,whatsapp:String(b.whatsapp||'').replace(/\D/g,'')};save();return db.settings},
 'GET /api/orders':(q,b,u)=>{need(u);return db.orders.filter(o=>o.buyer===u.id||u.role==='admin'||u.role==='logistique').reverse()},
 'POST /api/order-status':(q,b,u)=>{need(u);const o=db.orders.find(o=>o.id===b.id);if(!o||u.role!=='admin')throw[403,'Interdit'];o.status=b.status;save();return o},
 'POST /api/rfq':(q,b,u)=>{need(u);const p=db.products.find(p=>p.id===b.product);const r={id:id(),buyer:u.id,buyerName:u.name,product:b.product,productName:p?.name||b.title,seller:p?.seller||null,qty:b.qty,details:b.details,status:'ouverte',quotes:[],date:Date.now()};db.rfqs.push(r);save();return r},
 'GET /api/rfq':(q,b,u)=>{need(u);return db.rfqs.filter(r=>r.buyer===u.id||(u.role==='admin'&&(!r.seller||r.seller===u.id))).reverse()},
 'POST /api/quote':(q,b,u)=>{need(u,'admin');const r=db.rfqs.find(r=>r.id===b.rfq);if(!r)throw[404,'RFQ introuvable'];r.quotes.push({seller:u.id,sellerName:u.name,price:+b.price,delay:b.delay,note:b.note,date:Date.now()});r.status='devis reçu';save();return r},
 'POST /api/messages':(q,b,u)=>{need(u);if(!b.to||!b.text)throw[400,'Message vide'];const m={id:id(),from:u.id,to:b.to,text:b.text,product:b.product,date:Date.now()};db.messages.push(m);save();return m},
 'GET /api/messages':(q,b,u)=>{need(u);const ms=db.messages.filter(m=>m.from===u.id||m.to===u.id);const conv={};
  ms.forEach(m=>{const o=m.from===u.id?m.to:m.from;(conv[o]??=({with:pub(db.users.find(x=>x.id===o)),msgs:[]})).msgs.push(m)});return Object.values(conv)},
 // Avis clients : tout le monde peut proposer un avis (nom requis) ; publication après modération dans Gestion UP
 'GET /api/reviews':(q,b,u)=>{if(q.all&&u?.role==='admin')return[...db.reviews].sort((a,b)=>b.date-a.date);
  return db.reviews.filter(r=>r.product===q.product&&REVOK(r)).sort((a,b)=>b.date-a.date).map(r=>({id:r.id,user:r.user,stars:r.stars,text:r.text,date:r.date}))},
 'POST /api/reviews':(q,b,u)=>{const name=String(b.name||u?.name||'').trim();if(!name)throw[400,'Votre nom est requis'];const pid=String(b.product||'');
  if(!db.products.find(p=>p.id===pid))throw[400,'Produit inconnu'];const stars=Math.min(5,Math.max(1,+b.stars||0));if(!stars)throw[400,'Choisissez une note'];
  const text=String(b.text||'').trim();if(text.length<3)throw[400,'Écrivez votre avis'];
  const r={id:id(),product:pid,user:name.slice(0,40),email:String(b.email||u?.email||'').trim().slice(0,80),stars,text:text.slice(0,600),status:'en attente',date:Date.now()};
  db.reviews.push(r);save();return{ok:true,status:r.status}},
 'POST /api/reviews/status':(q,b,u)=>{need(u,'admin');const r=db.reviews.find(x=>x.id===b.id);if(!r)throw[404,'Avis introuvable'];
  if(!['publié','en attente','rejeté'].includes(b.status))throw[400,'Statut invalide'];r.status=b.status;save();return r},
 'POST /api/reviews/delete':(q,b,u)=>{need(u,'admin');db.reviews=db.reviews.filter(x=>x.id!==b.id);save();return{ok:true}},
 // Codes promo / coupons
 'GET /api/coupons':(q,b,u)=>{need(u,'admin');return db.coupons||[]},
 'POST /api/coupons':(q,b,u)=>{need(u,'admin');const code=String(b.code||'').trim().toUpperCase().replace(/\s+/g,'');if(!code)throw[400,'Code requis'];
  const type=b.type==='amount'?'amount':'percent',value=Math.max(0,+b.value||0);if(type==='percent'&&value>90)throw[400,'Réduction maximum 90 %'];
  db.coupons=db.coupons||[];const i=b.id?db.coupons.findIndex(x=>x.id===b.id):db.coupons.findIndex(x=>x.code===code);
  const rec={id:i>=0?db.coupons[i].id:id(),code,type,value,min:Math.max(0,Math.round(+b.min||0)),maxUses:Math.max(0,Math.round(+b.maxUses||0)),expires:String(b.expires||'').slice(0,10),active:b.active!==false,uses:i>=0?(db.coupons[i].uses||0):0};
  if(i>=0)db.coupons[i]={...db.coupons[i],...rec};else db.coupons.unshift(rec);save();return rec},
 'POST /api/coupons/delete':(q,b,u)=>{need(u,'admin');db.coupons=(db.coupons||[]).filter(x=>x.id!==b.id);save();return{ok:true}},
 'POST /api/coupon/check':(q,b,u)=>{const c=couponFind(b.code),sub=Math.max(0,Math.round(+b.sub||0));const why=couponWhy(c,sub);if(why)throw[400,why];
  const disc=couponDisc(c,sub);if(disc<=0)throw[400,'Code promo sans effet sur ce panier'];return{ok:true,code:c.code,type:c.type,value:c.value,disc,total:Math.max(0,sub-disc)}},
 // Catégories & sous-catégories (2 niveaux)
 'POST /api/cats':(q,b,u)=>{need(u,'admin');if(!Array.isArray(b.cats))throw[400,'Format invalide'];
  const seen=new Set(),next=b.cats.filter(c=>String(c.name||'').trim()).map(c=>{let i=String(c.id||'').trim();if(!i||seen.has(i))i=crypto.randomBytes(3).toString('hex');seen.add(i);
   return{id:i,name:String(c.name).trim().slice(0,40),icon:String(c.icon||'🏷️').trim().slice(0,4)||'🏷️',parent:c.parent?String(c.parent):null}});
  if(!next.length)throw[400,'Au moins une catégorie'];
  const ids=new Set(next.map(c=>c.id)),roots=new Set(next.filter(c=>!c.parent||!ids.has(c.parent)).map(c=>c.id));
  next.forEach(c=>{if(c.parent&&(!ids.has(c.parent)||!roots.has(c.parent)||c.parent===c.id))c.parent=null});
  const rootCat=next.find(c=>!c.parent)||next[0];db.cats=next;let moved=0;
  db.products.forEach(p=>{if(!ids.has(p.cat)){p.cat=rootCat.id;moved++}});
  save();return{ok:true,cats:db.cats,moved}},
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
 const j=await r.json().catch(()=>({}));if(j.code===200&&j.data)return j.data;
 const code=j.code||r.status,msg=String(j.message||j.msg||('erreur '+r.status));
 if(code===4011)throw[502,'TMAPI : aucune clé API dans la requête (code 4011) — enregistre ta clé dans Gestion UP'];
 if(code===4013)throw[502,'TMAPI : clé API refusée (code 4013) — recopie la clé COMPLÈTE depuis console.tmapi.io → API Keys (bouton Copier), puis Enregistrer dans Gestion UP'];
 if(code===4393)throw[402,'TMAPI : crédits insuffisants (forfait pas encore actif ?)'];
 throw[502,'TMAPI : '+msg+' (code '+code+')']}
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
const impCfg=()=>{const s=(db.erp&&db.erp.settings)||{},i=s.imp||{};return{rate:+s.rate||90,freightUnit:+(i.freightUnit??4000),margin:+(i.margin??50)}};
function suggestedPrice(cny){const c=impCfg();if(!(cny>0))return 0;const goods=Math.round(cny*c.rate),cost=goods+c.freightUnit,m=Math.min(95,Math.max(0,c.margin));return Math.round((cost/(1-m/100))/50)*50}
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
 const cfg=impCfg(),sp=cny?suggestedPrice(cny):0;
 return {id:id(),name,cat:db.cats.some(c=>c.id===cat)?cat:db.cats[0].id,seller:u.id,unit:'pièce',moq:1,img:'🥿',imgs:imgs.length?imgs:undefined,sizes,colors,
  desc:name+(colors.length?'. Coloris : '+colors.join(', ')+'.':''),sold:0,created:Date.now(),draft:true,
  src:{site:F.site,id:iid,cny,cur:F.cur,goods:cny?Math.round(cny*cfg.rate):null,freight:cfg.freightUnit,suggested:sp},tiers:[{min:1,price:sp}]}}
// ---- Préparation de fiche produit par IA (fournisseur pluggable) ----
const AI_PROVIDERS={
 gemini:{label:'Google Gemini',base:'https://generativelanguage.googleapis.com/v1beta',models:['gemini-2.5-flash','gemini-2.5-flash-lite','gemini-2.0-flash'],defaultModel:'gemini-2.5-flash'},
 openai:{label:'OpenAI-compatible (OpenAI, OpenRouter, Groq…)',base:'https://api.openai.com/v1',models:['gpt-4o-mini','gpt-4.1-mini'],defaultModel:'gpt-4o-mini'}};
const aiCfg=()=>{const a=(db.secrets&&db.secrets.ai)||{};const id=AI_PROVIDERS[a.provider]?a.provider:'gemini';const P=AI_PROVIDERS[id];return{provider:id,key:String(a.key||''),base:String(a.base||P.base||'').replace(/\/+$/,''),model:String(a.model||P.defaultModel||'')}};
function aiExtractJson(t){t=String(t||'').trim().replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();const i=t.indexOf('{'),j=t.lastIndexOf('}');if(i<0||j<=i)throw[502,'IA : réponse illisible (pas de JSON)'];try{return JSON.parse(t.slice(i,j+1))}catch(e){throw[502,'IA : JSON invalide dans la réponse']}}
async function aiCall(prompt,imgs){const c=aiCfg();if(!c.key)throw[400,'Clé IA non enregistrée — ajoute-la dans Gestion UP → 🤖 Fiche produit par IA'];
 const filt=(imgs||[]).filter(x=>x&&x.data).slice(0,4);
 if(c.provider==='gemini'){
  const parts=[{text:prompt}];for(const im of filt)parts.push({inline_data:{mime_type:im.mime,data:im.data}});
  const r=await fetch(c.base+'/models/'+c.model+':generateContent?key='+encodeURIComponent(c.key),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts}],generationConfig:{temperature:0.7,responseMimeType:'application/json'}}),signal:AbortSignal.timeout(90000)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.error)throw[502,'IA (Gemini) : '+((j.error&&j.error.message)||('erreur '+r.status))];
  const c0=(j.candidates&&j.candidates[0])||{};return ((c0.content&&c0.content.parts)||[]).map(p=>p.text).filter(Boolean).join('')}
 const content=[{type:'text',text:prompt}];for(const im of filt)content.push({type:'image_url',image_url:{url:'data:'+im.mime+';base64,'+im.data}});
 const r=await fetch(c.base+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.key},body:JSON.stringify({model:c.model,messages:[{role:'user',content}],temperature:0.7}),signal:AbortSignal.timeout(90000)});
 const j=await r.json().catch(()=>({}));
 if(!r.ok||j.error)throw[502,'IA : '+((j.error&&j.error.message)||('erreur '+r.status))];
 return ((j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content)||'')}
function saveDataUrl(durl,name){const m=/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(durl||''));if(!m)return null;
 const mime=m[1].toLowerCase(),data=m[2].replace(/\s/g,''),ext=mime.includes('png')?'png':mime.includes('webp')?'webp':mime.includes('gif')?'gif':'jpg';const file=name+'.'+ext;fs.writeFileSync(path.join(IMG,file),Buffer.from(data,'base64'));return{url:'/img/'+file,mime,data}}
routes['GET /api/ai']=(q,b,u)=>{need(u,'admin');const c=aiCfg();return{provider:c.provider,model:c.model,base:c.base,set:!!c.key,hint:c.key?'••••'+c.key.slice(-4):'',providers:Object.entries(AI_PROVIDERS).map(([id,v])=>({id,label:v.label,models:v.models,defaultModel:v.defaultModel,base:v.base}))}};
routes['POST /api/ai']=(q,b,u)=>{need(u,'admin');const provider=AI_PROVIDERS[b.provider]?b.provider:'gemini';const cur=(db.secrets&&db.secrets.ai)||{};const key=String(b.key||'').trim();
 if(key&&/\.\.\.|…|\s/.test(key))throw[400,'Clé IA incomplète : copie-la entière (bouton Copier du fournisseur), sans « … ».'];
 db.secrets={...db.secrets,ai:{provider,key:key||String(cur.key||''),model:String(b.model||'').trim()||cur.model||'',base:String(b.base||'').trim()}};save();return{set:!!db.secrets.ai.key}};
routes['POST /api/ai/fiche']=async(q,b,u)=>{need(u,'admin');const c=aiCfg();if(!c.key)throw[400,'Clé IA non enregistrée — ajoute-la dans Gestion UP (section 🤖 Fiche produit par IA)'];
 const ids=db.cats.map(x=>x.id),catSel=ids.includes(b.cat)?b.cat:null,tag='ai'+Date.now().toString(36);
 const photos=(Array.isArray(b.photos)?b.photos:[]).slice(0,6).map((d,i)=>saveDataUrl(d,tag+'_'+i)).filter(Boolean);
 let raw={title:'',cny:null,cur:'¥',site:'',id:'',imgUrls:[]},linkErr=null;
 if(String(b.url||'').trim()){try{const F=await fetchItem(b.url);const d=F.d||{};raw={title:d.title||d.subject||'',cny:+(d.price_info?.price||d.price||(d.price_range||[])[0]?.[1]||0)||null,cur:F.cur,site:F.site,id:String(F.id||''),imgUrls:[...(d.main_imgs||d.images||[])].slice(0,4)}}catch(e){linkErr=Array.isArray(e)?e[1]:String(e)}}
 if(!raw.title&&!photos.length&&!String(b.name||'').trim())throw[400,linkErr?('Lien illisible ('+linkErr+') — ajoute des photos ou le nom du produit.'):'Donne un lien, des photos ou le nom du produit'];
 const cny=raw.cny||(+b.cny||0)||null,catList=db.cats.map(x=>x.id+'='+x.name).join(', ');
 const prompt='Tu es l\'assistant e-commerce de Universal Partner, boutique sénégalaise (livraison gratuite partout, paiement à la livraison). À partir des éléments fournis, rédige une FICHE PRODUIT en français, prête à publier.\n'
  +'Réponds UNIQUEMENT par un objet JSON valide, sans texte ni balises autour, avec exactement ces clés :\n'
  +'{"titre":"nom produit pro et vendeur, sans marque chinoise, 70 caractères max","accroche":"une phrase d\'accroche, 90 caractères max","description":"3 à 5 phrases : problème → solution → bénéfices, ton chaleureux, français simple","caracteristiques":["point clé","..."],"categorie":"un id parmi '+catList+'","motsCles":["mot","..."],"coloris":["..."],"tailles":["..."],"prixConseille":0,"pubFacebook":"post Facebook prêt : 3-4 lignes, emojis, appel à l\'action + livraison gratuite / paiement à la livraison","pubWhatsapp":"message WhatsApp court, prêt à envoyer"}\n'
  +'Règles : prixConseille en FCFA entier (0 si non estimable) ; n\'invente pas de caractéristiques techniques non déductibles ; adapte-toi au marché sénégalais ; coloris/tailles = uniquement ceux visibles ou fournis (tableaux vides sinon).\n'
  +'Éléments : nom fourni="'+String(b.name||'')+'" ; infos fournies="'+String(b.infos||'')+'" ; titre d\'origine="'+raw.title+'" ; prix fournisseur='+(cny?cny+' CNY':'inconnu')+' ; site='+(raw.site||'n/a')+'.';
 const out=await aiCall(prompt,photos.map(p=>({mime:p.mime,data:p.data})));
 const a=aiExtractJson(out);
 const name=String(a.titre||raw.title||b.name||'Nouveau produit').slice(0,90),cat=catSel||(ids.includes(a.categorie)?a.categorie:db.cats[0].id),imp=impCfg();
 const price=cny?suggestedPrice(cny):Math.max(0,Math.round(+a.prixConseille||0));
 const car=(Array.isArray(a.caracteristiques)?a.caracteristiques:[]).map(String).filter(Boolean);
 const imgUrls=photos.length?photos.map(p=>p.url):raw.imgUrls;
 const desc=[String(a.description||'').trim(),car.length?'Caractéristiques : '+car.join(' · '):''].filter(Boolean).join(' · ').slice(0,900);
 const p={id:id(),name,cat,seller:u.id,unit:'pièce',moq:1,img:imgUrls.length?'🖼️':'📦',imgs:imgUrls.length?imgUrls:undefined,
  sizes:(Array.isArray(a.tailles)?a.tailles:[]).map(String).filter(Boolean),colors:(Array.isArray(a.coloris)?a.coloris:[]).map(String).filter(Boolean),
  desc,sold:0,created:Date.now(),draft:true,accroche:String(a.accroche||'').trim(),keywords:(Array.isArray(a.motsCles)?a.motsCles:[]).map(String).filter(Boolean),
  pubFb:String(a.pubFacebook||'').trim(),pubWa:String(a.pubWhatsapp||'').trim(),ai:{provider:c.provider,model:c.model,generated:Date.now()},
  src:{site:'ia'+(raw.site?'/'+raw.site:''),id:raw.id||tag,cny,cur:raw.cur||'¥',goods:cny?Math.round(cny*imp.rate):null,freight:imp.freightUnit,suggested:price},
  tiers:[{min:1,price}]};
 db.products.unshift(p);save();return p};
function login(u){const t=id()+id();db.sessions[t]=u.id;save();return{token:t,user:pub(u)}}
function need(u,role){if(!u)throw[401,'Connexion requise'];if(role&&u.role!==role)throw[403,'Réservé à UP']}
const mime={'.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4','.webm':'video/webm','.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'};
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
 if(!fs.existsSync(f))f=path.join(__dirname,'public/index.html');
 const mt=mime[path.extname(f)]||'text/html; charset=utf-8';
 // En-têtes + support des requêtes Range (lecture/seek des vidéos sur mobile)
 const st=fs.statSync(f);
 const rg=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range||'');
 if(rg&&st.isFile()){let s=rg[1]?+rg[1]:0,e=rg[2]?+rg[2]:st.size-1;if(s>e||s>=st.size){res.writeHead(416,{'Content-Range':'bytes */'+st.size});return res.end()}e=Math.min(e,st.size-1);
  res.writeHead(206,{'Content-Type':mt,'Accept-Ranges':'bytes','Content-Range':'bytes '+s+'-'+e+'/'+st.size,'Content-Length':e-s+1});fs.createReadStream(f,{start:s,end:e}).pipe(res);return}
 res.writeHead(200,{'Content-Type':mt,'Accept-Ranges':'bytes','Content-Length':st.size});fs.createReadStream(f).pipe(res);
});
boot().then(()=>srv.listen(PORT,()=>console.log('Universal Partner sur',PORT)));
