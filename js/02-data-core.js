/* ============================================================
   MULTI-TENANT DATA LAYER (localStorage)
   Collections with barbershopId are tenant-isolated.
   ============================================================ */
const DB=(()=>{
  const KEY='groomin_db_v1';
  const uid=p=>(p||'id')+Math.random().toString(36).slice(2,8)+Date.now().toString(36).slice(-3);
  const todayISO=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
  const addDays=(d,n)=>{const x=new Date(d+'T00:00:00');x.setDate(x.getDate()+n);return x.toISOString().slice(0,10);};

  function seed(){
    const t=todayISO();
    const plans=[
      {id:'free',name:'Teste gratuito',price:0,interval:'até 3 agendamentos',color:'muted',badge:'Sem cartão',tagline:'Para testar o Groomin sem cartão. Receba até 3 agendamentos e assine para continuar.',
       limit_barbers:999,limit_appts:3,
       features:['Página profissional de agendamentos','Link personalizado','Até 3 agendamentos recebidos','Cadastro de serviços','Cadastro de profissionais','Painel administrativo','Sem cartão de crédito']},
      {id:'monthly',name:'Plano Mensal',price:14.90,interval:'mês',color:'info',badge:'',tagline:'Ideal para quem deseja começar sem compromisso.',
       limit_barbers:999,limit_appts:99999,
       features:['Página profissional de agendamentos','Link personalizado','Agendamentos ilimitados','Cadastro de serviços','Cadastro de profissionais','Painel administrativo','Suporte','Atualizações contínuas']},
      {id:'annual',name:'Plano Anual',price:151.98,monthlyEquivalent:12.66,interval:'ano',color:'gold',badge:'Mais escolhido',tagline:'Mais vantajoso para manter sua página profissional ativa o ano todo.',
       limit_barbers:999,limit_appts:99999,
       features:['Página profissional de agendamentos','Link personalizado','Agendamentos ilimitados','Cadastro de serviços','Cadastro de profissionais','Painel administrativo','Suporte','Atualizações contínuas']},
      {id:'founder',name:'Cliente Fundador',price:990,interval:'pagamento único',color:'gold',badge:'Oferta exclusiva',founder:true,tagline:'Faça parte da história do Groomin. Uma oportunidade exclusiva para empresas que desejam apoiar o lançamento da plataforma e garantir benefícios únicos.',
       limit_barbers:999,limit_appts:99999,
       features:['Sem mensalidade enquanto o Groomin permanecer em operação','Todas as funcionalidades atuais do Groomin','Atualizações das funcionalidades atuais','Suporte prioritário','Prioridade para testar novos recursos','Canal direto com o fundador para sugestões','Badge exclusivo de Cliente Fundador','Desconto exclusivo em futuros módulos premium (quando houver)']}
    ];
    const billing={
      monthly:{label:'Mensal',discount:0,months:1},
      annual:{label:'Anual',discount:0.15,months:12},
      founder:{label:'Fundador',discount:0,months:0}
    };
    const barbershops=[
      {id:'shop1',slug:'barbearia-do-joao',name:'Barbearia do João',ownerName:'João Almeida',description:'Tradição e estilo desde 2015. Cortes clássicos e modernos no coração da cidade.',address:'Rua dos Barbeiros, 123 — Centro',city:'São Paulo',neighborhood:'Centro',phone:'(11) 3333-1000',whatsapp:'(11) 99999-1000',email:'contato@barbeariadojoao.com',instagram:'@barbeariadojoao',open:'09:00',close:'20:00',lunchStart:'12:00',lunchEnd:'13:00',planId:'monthly',status:'active',rating:4.9,createdAt:Date.now()-86400000*210,slotInterval:30},
      {id:'shop2',slug:'barber-club',name:'Barber Club',ownerName:'Marcelo Dias',description:'Experiência premium de barbearia com ambiente lounge e drinks.',address:'Av. Paulista, 900 — Bela Vista',city:'São Paulo',neighborhood:'Bela Vista',phone:'(11) 3333-2000',whatsapp:'(11) 99999-2000',email:'hello@barberclub.com',instagram:'@barberclub',open:'10:00',close:'21:00',lunchStart:'13:00',lunchEnd:'14:00',planId:'founder',status:'active',rating:4.8,createdAt:Date.now()-86400000*120,slotInterval:30},
      {id:'shop3',slug:'corte-nobre',name:'Corte Nobre',ownerName:'Rafael Souza',description:'Barbearia de bairro com atendimento de primeira.',address:'Rua das Acácias, 45',city:'Campinas',neighborhood:'Cambuí',phone:'(19) 3333-3000',whatsapp:'(19) 99999-3000',email:'corte@nobre.com',instagram:'@cortenobre',open:'09:00',close:'19:00',lunchStart:'12:00',lunchEnd:'13:00',planId:'free',status:'suspended',rating:4.6,createdAt:Date.now()-86400000*40,slotInterval:30}
    ];
    const users=[
      {id:'u_super',name:'Super Admin',email:'super@groomin.com.br',password:'super123',role:'super_admin',active:true},
      {id:'u_joao',name:'João Almeida',email:'joao@groomin.demo',password:'owner123',role:'owner',barbershopId:'shop1',barberId:'bjoao',active:true},
      {id:'u_man1',name:'Paula Gerente',email:'gerente@barbeariadojoao.com',password:'manager123',role:'manager',barbershopId:'shop1',active:true},
      {id:'u_rec1',name:'Bruna Recepção',email:'recepcao@barbeariadojoao.com',password:'recep123',role:'receptionist',barbershopId:'shop1',active:true},
      {id:'u_barb1',name:'Rafael Moura',email:'rafael@barbeariadojoao.com',password:'barber123',role:'barber',barbershopId:'shop1',barberId:'b1',active:true},
      {id:'u_cust1',name:'Carlos Eduardo',email:'cliente@email.com',password:'cliente123',role:'customer',barbershopId:'shop1',customerId:'c1',active:true},
      {id:'u_marc',name:'Marcelo Dias',email:'marcelo@barberclub.com',password:'owner123',role:'owner',barbershopId:'shop2',active:true}
    ];
    const barbers=[
      {id:'bjoao',barbershopId:'shop1',name:'João Almeida',role:'Proprietário & Barbeiro',bio:'Dono da casa. Atende com hora marcada.',phone:'(11) 99999-1000',email:'joao@barbeariadojoao.com',specialties:['Corte','Barba'],commission:0,productCommission:0,isOwner:true,start:'09:00',end:'18:00',lunchStart:'12:00',lunchEnd:'13:00',days:[1,2,3,4,5,6],vacations:[],active:true,rating:5.0},
      {id:'b1',barbershopId:'shop1',name:'Rafael Moura',role:'Barbeiro Master',bio:'15 anos de experiência em cortes clássicos.',phone:'(11) 98888-0001',email:'rafael@barbeariadojoao.com',specialties:['Corte','Barba','Degradê'],commission:50,productCommission:10,start:'09:00',end:'19:00',lunchStart:'12:00',lunchEnd:'13:00',days:[1,2,3,4,5,6],vacations:[],active:true,rating:4.9},
      {id:'b2',barbershopId:'shop1',name:'Lucas Ferreira',role:'Barbeiro Sênior',bio:'Especialista em barba e visagismo.',phone:'(11) 98888-0002',email:'lucas@barbeariadojoao.com',specialties:['Barba','Sobrancelha'],commission:45,start:'10:00',end:'20:00',lunchStart:'13:00',lunchEnd:'14:00',days:[1,2,3,4,5],vacations:[],active:true,rating:4.8},
      {id:'b3',barbershopId:'shop1',name:'Diego Santos',role:'Barbeiro',bio:'Cortes urbanos e acabamentos perfeitos.',phone:'(11) 98888-0003',email:'diego@barbeariadojoao.com',specialties:['Corte','Hidratação'],commission:40,start:'09:00',end:'18:00',days:[2,3,4,5,6],lunchStart:'12:30',lunchEnd:'13:30',vacations:[],active:true,rating:4.7},
      {id:'b4',barbershopId:'shop2',name:'André Klein',role:'Master Barber',bio:'Referência em degradê e navalhado.',phone:'(11) 97777-0001',email:'andre@barberclub.com',specialties:['Degradê','Barba'],commission:55,start:'10:00',end:'21:00',lunchStart:'13:00',lunchEnd:'14:00',days:[1,2,3,4,5,6],vacations:[],active:true,rating:4.9},
      {id:'b5',barbershopId:'shop2',name:'Tiago Rocha',role:'Barbeiro',bio:'Estilo clássico e atendimento impecável.',phone:'(11) 97777-0002',email:'tiago@barberclub.com',specialties:['Corte','Barba'],commission:45,start:'10:00',end:'20:00',lunchStart:'13:00',lunchEnd:'14:00',days:[2,3,4,5,6],vacations:[],active:true,rating:4.7}
    ];
    const mkSvc=(id,shop,name,desc,price,dur,cat,ic)=>({id,barbershopId:shop,name,desc,price,duration:dur,category:cat,icon:ic,active:true});
    const services=[
      mkSvc('s1','shop1','Corte Masculino','Corte personalizado com máquina e tesoura.',45,30,'Cabelo','scissors'),
      mkSvc('s2','shop1','Barba','Modelagem com toalha quente e navalha.',35,30,'Barba','user'),
      mkSvc('s3','shop1','Corte + Barba','Combo completo de corte e barba.',70,60,'Combo','star'),
      mkSvc('s4','shop1','Sobrancelha','Design e alinhamento.',20,15,'Estética','eye'),
      mkSvc('s5','shop1','Pigmentação','Disfarce de falhas capilares.',60,45,'Tratamento','droplet'),
      mkSvc('s6','shop1','Hidratação','Hidratação capilar profunda.',40,30,'Tratamento','droplet'),
      mkSvc('s7','shop2','Corte Premium','Corte com consultoria de estilo.',80,45,'Cabelo','scissors'),
      mkSvc('s8','shop2','Barba Lux','Ritual completo de barbearia.',60,45,'Barba','user'),
      mkSvc('s9','shop2','Combo Club','Corte + barba + drink.',130,75,'Combo','star')
    ];
    const customers=[
      {id:'c1',barbershopId:'shop1',name:'Carlos Eduardo',phone:'(11) 98888-1111',whatsapp:'(11) 98888-1111',email:'cliente@email.com',birthday:'1990-06-23',notes:'Prefere corte baixo.'},
      {id:'c2',barbershopId:'shop1',name:'João Pereira',phone:'(11) 97777-2222',whatsapp:'(11) 97777-2222',email:'joaop@email.com',birthday:'1992-04-12',notes:''},
      {id:'c3',barbershopId:'shop1',name:'Marcos Vinícius',phone:'(11) 96666-3333',whatsapp:'(11) 96666-3333',email:'marcos@email.com',birthday:'1995-12-05',notes:'Alérgico a alguns produtos.'},
      {id:'c4',barbershopId:'shop1',name:'André Lima',phone:'(11) 95555-4444',whatsapp:'(11) 95555-4444',email:'andre@email.com',birthday:'2000-02-20',notes:''},
      {id:'c5',barbershopId:'shop1',name:'Pedro Henrique',phone:'(11) 94444-5555',whatsapp:'(11) 94444-5555',email:'pedro@email.com',birthday:'1988-09-30',notes:'Cliente VIP.'},
      {id:'c6',barbershopId:'shop2',name:'Rodrigo Alves',phone:'(11) 93333-6666',whatsapp:'(11) 93333-6666',email:'rodrigo@email.com',birthday:'1991-03-15',notes:''}
    ];
    const products=[
      // Profissionais (usados durante os serviços)
      {id:'p1',barbershopId:'shop1',name:'Pomada Modeladora',sku:'POM-001',kind:'professional',cost:18,price:45,qty:24,minStock:8,unit:'g',category:'Pomadas',supplier:'Distribuidora Barber SP',active:true},
      {id:'p2',barbershopId:'shop1',name:'Shampoo Premium',sku:'SHA-001',kind:'professional',cost:22,price:55,qty:5,minStock:10,unit:'ml',category:'Shampoos',supplier:'Distribuidora Barber SP',active:true},
      {id:'p3',barbershopId:'shop1',name:'Óleo para Barba',sku:'OLE-001',kind:'professional',cost:15,price:39,qty:18,minStock:6,unit:'ml',category:'Óleos',supplier:'BeardCo',active:true},
      {id:'p4',barbershopId:'shop1',name:'Gel Fixador',sku:'GEL-001',kind:'professional',cost:9,price:25,qty:3,minStock:8,unit:'g',category:'Gel',supplier:'BeardCo',active:true},
      {id:'p5',barbershopId:'shop1',name:'Pós-Barba (After Shave)',sku:'AFT-001',kind:'professional',cost:12,price:30,qty:16,minStock:6,unit:'ml',category:'Cosméticos',supplier:'BeardCo',active:true},
      // Conveniência / Bar (vendidos direto ao cliente)
      {id:'cv1',barbershopId:'shop1',name:'Coca-Cola Lata',sku:'BEB-001',kind:'convenience',cost:3,price:7,qty:48,minStock:12,unit:'un',category:'Refrigerantes',supplier:'Atacadão Bebidas',active:true},
      {id:'cv2',barbershopId:'shop1',name:'Água Mineral',sku:'BEB-002',kind:'convenience',cost:1.2,price:4,qty:60,minStock:20,unit:'un',category:'Águas',supplier:'Atacadão Bebidas',active:true},
      {id:'cv3',barbershopId:'shop1',name:'Energético',sku:'BEB-003',kind:'convenience',cost:5,price:12,qty:6,minStock:10,unit:'un',category:'Energéticos',supplier:'Atacadão Bebidas',active:true},
      {id:'cv4',barbershopId:'shop1',name:'Cerveja Long Neck',sku:'BEB-004',kind:'convenience',cost:4,price:10,qty:36,minStock:12,unit:'un',category:'Cervejas',supplier:'Atacadão Bebidas',active:true},
      {id:'cv5',barbershopId:'shop1',name:'Café Espresso',sku:'BAR-001',kind:'convenience',cost:1,price:5,qty:200,minStock:30,unit:'un',category:'Café',supplier:'Café do Grão',active:true},
      {id:'cv6',barbershopId:'shop1',name:'Chocolate',sku:'SNK-001',kind:'convenience',cost:2.5,price:6,qty:4,minStock:10,unit:'un',category:'Snacks',supplier:'Atacadão Bebidas',active:true},
      {id:'p9',barbershopId:'shop2',name:'Cera Matte',sku:'CER-001',kind:'professional',cost:20,price:50,qty:30,minStock:10,unit:'g',category:'Cosméticos',supplier:'Premium Grooming',active:true},
      {id:'cv7',barbershopId:'shop2',name:'Whisky Dose',sku:'BAR-010',kind:'convenience',cost:8,price:25,qty:40,minStock:10,unit:'un',category:'Bar',supplier:'Premium Drinks',active:true}
    ];
    const combos=[
      {id:'cb1',barbershopId:'shop1',name:'Corte + Coca-Cola',items:[{type:'service',refId:'s1'},{type:'product',refId:'cv1'}],discountType:'fixed',discountValue:5,active:true},
      {id:'cb2',barbershopId:'shop1',name:'Pacote Premium',items:[{type:'service',refId:'s3'},{type:'product',refId:'p3'}],discountType:'percent',discountValue:10,active:true},
      {id:'cb3',barbershopId:'shop2',name:'Club Experience',items:[{type:'service',refId:'s9'},{type:'product',refId:'cv7'}],discountType:'percent',discountValue:15,active:true}
    ];
    const sales=[]; const cashSessions=[]; const stockMoves=[];
    const campaigns=[
      {id:'cp1',barbershopId:'shop1',name:'Primeira Visita',type:'first_visit',discountType:'percent',discountValue:20,expires:addDays(t,60),usageLimit:100,used:14,active:true},
      {id:'cp2',barbershopId:'shop1',name:'Terça Promo',type:'weekday',discountType:'percent',discountValue:15,expires:addDays(t,90),usageLimit:0,used:32,active:true},
      {id:'cp3',barbershopId:'shop1',name:'Combo Verão',type:'seasonal',discountType:'fixed',discountValue:10,expires:addDays(t,30),usageLimit:50,used:8,active:false}
    ];
    const reviews=[
      {id:'rv1',barbershopId:'shop1',customerName:'Carlos E.',rating:5,text:'Melhor corte que já fiz! Ambiente top.',date:addDays(t,-3)},
      {id:'rv2',barbershopId:'shop1',customerName:'João P.',rating:5,text:'Atendimento impecável e pontual.',date:addDays(t,-10)},
      {id:'rv3',barbershopId:'shop1',customerName:'Marcos V.',rating:4,text:'Muito bom, recomendo o Rafael.',date:addDays(t,-18)},
      {id:'rv4',barbershopId:'shop2',customerName:'Rodrigo A.',rating:5,text:'Experiência premium de verdade.',date:addDays(t,-5)}
    ];
    // appointments
    const A=(shop,cid,cname,phone,sid,bid,date,time,status,price)=>({id:uid('a'),barbershopId:shop,customerId:cid,customerName:cname,phone,serviceId:sid,barberId:bid,date,time,status,price,createdAt:Date.now()});
    const appointments=[
      A('shop1','c1','Carlos Eduardo','(11) 98888-1111','s3','b1',t,'09:30','confirmado',70),
      A('shop1','c2','João Pereira','(11) 97777-2222','s1','b3',t,'10:00','confirmado',45),
      A('shop1','c3','Marcos Vinícius','(11) 96666-3333','s2','b2',t,'11:00','pendente',35),
      A('shop1','c5','Pedro Henrique','(11) 94444-5555','s5','b2',t,'14:30','confirmado',60),
      A('shop1','c4','André Lima','(11) 95555-4444','s1','b1',t,'16:00','confirmado',45),
      A('shop1','c1','Carlos Eduardo','(11) 98888-1111','s1','b1',addDays(t,1),'10:00','confirmado',45),
      A('shop1','c2','João Pereira','(11) 97777-2222','s3','b1',addDays(t,-1),'15:00','concluido',70),
      A('shop1','c3','Marcos Vinícius','(11) 96666-3333','s2','b3',addDays(t,-2),'11:30','concluido',35),
      A('shop1','c5','Pedro Henrique','(11) 94444-5555','s3','b1',addDays(t,-3),'17:00','concluido',70),
      A('shop1','c4','André Lima','(11) 95555-4444','s1','b1',addDays(t,-4),'10:00','cancelado',45),
      A('shop1','c1','Carlos Eduardo','(11) 98888-1111','s3','b2',addDays(t,-6),'16:00','concluido',70),
      A('shop1','c2','João Pereira','(11) 97777-2222','s6','b3',addDays(t,-9),'09:00','concluido',40),
      A('shop1','c5','Pedro Henrique','(11) 94444-5555','s3','b1',addDays(t,-12),'18:00','concluido',70),
      A('shop2','c6','Rodrigo Alves','(11) 93333-6666','s9','b4',t,'15:00','confirmado',130),
      A('shop2','c6','Rodrigo Alves','(11) 93333-6666','s7','b5',addDays(t,-2),'11:00','concluido',80)
    ];
    const blocks=[]; // {id,barbershopId,barberId,date,start,end,reason,fullDay}
    // Planos personalizados legados ficam vazios no MVP.
    const enterpriseConfigs={};
    const planMonthlyOf=s=>{const c=enterpriseConfigs[s.id];if(c)return c.monthly;if(s.planId==='annual')return 12.66;if(s.planId==='founder')return 0;const p=plans.find(x=>x.id===s.planId);return p?p.price:0;};
    // subscriptions + invoices
    const subscriptions=barbershops.map(s=>({id:uid('sub'),barbershopId:s.id,planId:s.planId,status:s.status==='suspended'?'past_due':'active',mrr:planMonthlyOf(s),custom:enterpriseConfigs[s.id]||null,startedAt:s.createdAt,renewsAt:addDays(t,12)}));
    const invoices=[];
    barbershops.forEach(s=>{
      const amount=planMonthlyOf(s);
      for(let i=0;i<4;i++){
        invoices.push({id:uid('inv'),barbershopId:s.id,number:'INV-'+(1000+invoices.length),amount,date:addDays(t,-i*30),status:(s.status==='suspended'&&i===0)?'failed':'paid'});
      }
    });
    const auditLogs=[
      {id:uid('lg'),time:Date.now()-3600000,actorName:'Super Admin',role:'super_admin',action:'Plano alterado',target:'Barbearia do João → Profissional',barbershopId:'shop1'},
      {id:uid('lg'),time:Date.now()-7200000,actorName:'João Almeida',role:'owner',action:'Serviço criado',target:'Hidratação',barbershopId:'shop1'},
      {id:uid('lg'),time:Date.now()-86400000,actorName:'Super Admin',role:'super_admin',action:'Barbearia suspensa',target:'Corte Nobre',barbershopId:'shop3'},
      {id:uid('lg'),time:Date.now()-90000000,actorName:'Bruna Recepção',role:'receptionist',action:'Agendamento criado',target:'Pedro Henrique',barbershopId:'shop1'}
    ];
    const settings={
      featureFlags:{marketplace:false,whatsapp:true,aiInsights:false,onlinePayments:false,reviews:true},
      publicPlans:{free:true,monthly:true,annual:true,founder:true},
      productModules:{crm:false,marketing:false,financial:false,inventory:false,ai:false,multiLocation:false,marketplace:false},
      emailTemplates:[
        {id:'et1',name:'Confirmação de Agendamento',subject:'Seu horário está confirmado!',active:true},
        {id:'et2',name:'Lembrete 24h',subject:'Lembrete: seu horário é amanhã',active:true},
        {id:'et3',name:'Aniversário',subject:'Feliz aniversário! 🎉',active:true}
      ],
      whatsappTemplates:[
        {id:'wt1',name:'Confirmação',text:'Olá {nome}! Seu horário foi confirmado para {data} às {hora}. 💈',active:true},
        {id:'wt2',name:'Lembrete',text:'Oi {nome}, lembrando do seu horário amanhã às {hora}!',active:true},
        {id:'wt3',name:'Reativação 30 dias',text:'Sentimos sua falta, {nome}! Agende e ganhe 10% de desconto.',active:true}
      ],
      notifications:{emailEnabled:true,whatsappEnabled:true,smsEnabled:false}
    };
    const notifications=[
      {id:uid('n'),barbershopId:'shop1',type:'confirm',title:'Novo agendamento',msg:'Carlos Eduardo — Corte + Barba às 09:30',time:Date.now()-3600000,read:false},
      {id:uid('n'),barbershopId:'shop1',type:'remind',title:'Lembrete',msg:'João Pereira tem horário em 1h',time:Date.now()-1800000,read:false},
      {id:uid('n'),barbershopId:'shop1',type:'cancel',title:'Cancelamento',msg:'André Lima cancelou Corte Masculino',time:Date.now()-7200000,read:true}
    ];
    // Com o Firebase ligado, NÃO semeia dados de demonstração: tudo vem da nuvem (Firestore).
    if(window.USE_FIREBASE===true){
      return {plans,billing,settings,barbershops:[],users:[],barbers:[],services:[],customers:[],products:[],combos:[],sales:[],cashSessions:[],stockMoves:[],campaigns:[],reviews:[],appointments:[],blocks:[],subscriptions:[],invoices:[],auditLogs:[],adminActions:[],notifications:[]};
    }
    return {plans,billing,barbershops,users,barbers,services,customers,products,combos,sales,cashSessions,stockMoves,campaigns,reviews,appointments,blocks,subscriptions,invoices,auditLogs,adminActions:[],settings,notifications};
  }

  const FIRESTORE_ONLY = window.USE_FIREBASE === true;
  let data;
  function save(d){if(d)data=d;if(FIRESTORE_ONLY)return;try{localStorage.setItem(KEY,JSON.stringify(data));}catch(e){}}
  function load(){
    if(FIRESTORE_ONLY){try{localStorage.removeItem(KEY);}catch(e){}return seed();}
    try{const r=localStorage.getItem(KEY);if(r)return JSON.parse(r);}catch(e){}
    const s=seed();save(s);return s;
  }
  data=load();

  return {
    uid,todayISO,addDays,
    get:()=>data, save,
    reset:()=>{localStorage.removeItem(KEY);data=load();},
    all:c=>data[c]||[],
    scope:(c,shopId)=>(data[c]||[]).filter(x=>x.barbershopId===shopId),
    find:(c,id)=>(data[c]||[]).find(x=>x.id===id),
    findBy:(c,fn)=>(data[c]||[]).find(fn),
    insert:(c,obj)=>{if(!data[c])data[c]=[];obj.id=obj.id||uid();data[c].unshift(obj);save();if(window.__dbWrite)window.__dbWrite('insert',c,obj);return obj;},
    update:(c,id,patch)=>{if(!data[c])return;const i=data[c].findIndex(x=>x.id===id);if(i>-1){data[c][i]={...data[c][i],...patch};save();if(window.__dbWrite)window.__dbWrite('update',c,data[c][i]);return data[c][i];}},
    remove:(c,id)=>{if(!data[c])return;const obj=data[c].find(x=>x.id===id);data[c]=data[c].filter(x=>x.id!==id);save();if(window.__dbWrite&&obj)window.__dbWrite('remove',c,obj);},
    log:(action,target,shopId)=>{const u=Session.user;data.auditLogs.unshift({id:uid('lg'),time:Date.now(),actorName:u?u.name:'Sistema',role:u?u.role:'system',action,target:target||'',barbershopId:shopId||(u&&u.barbershopId)||null});save();}
  };
})();

/* ============================================================
   HELPERS
   ============================================================ */
const $=(s,el=document)=>el.querySelector(s);
const $$=(s,el=document)=>[...el.querySelectorAll(s)];
const money=n=>'R$ '+Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const moneyK=n=>{n=Number(n||0);return n>=1000?'R$ '+(n/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})+'k':money(n);};
const initials=n=>(n||'?').split(' ').filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase();
const safeImageUrl=url=>{
  url=String(url||'').trim();
  if(!url)return '';
  return /^(https?:|data:image\/)/i.test(url)?url:'';
};
const imageOrInitials=(url,name,cls='')=>{
  const img=safeImageUrl(url);
  return img?`<img class="${cls}" src="${escapeHtml(img)}" alt="${escapeHtml(name||'Imagem')}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';this.parentElement.classList.add('img-failed')"><span class="ini img-fallback">${initials(name)}</span>`:`<span class="ini">${initials(name)}</span>`;
};
const brandLogo=(shop,cls='')=>imageOrInitials(shop&&shop.logoUrl,shop&&shop.name,cls);
const GROOMIN_LOGO='<img class="groomin-logo-img" src="/assets/pwa/logo-mark-192.png" alt="Groomin">';
const escapeHtml=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function normalizeInstagram(v){
  let s=String(v||'').trim();
  if(!s)return '';
  s=s.replace(/^https?:\/\/(www\.)?instagram\.com\//i,'').replace(/^instagram\.com\//i,'').split(/[?#]/)[0].replace(/^@/,'').replace(/\/+$/,'');
  return s;
}
function instagramUrl(v){const u=normalizeInstagram(v);return u?`https://www.instagram.com/${encodeURIComponent(u)}/`:'';}
function instagramDisplay(v){const u=normalizeInstagram(v);return u?`@${u}`:'';}
const DOW=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const DOW_FULL=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
const MON=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
function tsToDate(v){if(!v)return null;if(typeof v==='number')return new Date(v);if(typeof v==='object'&&v.toDate)return v.toDate();const d=new Date(v+'T00:00:00');return isNaN(d)?null:d;}
function fmtDate(iso){const d=tsToDate(iso);if(!d)return'';return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;}
function tsToISO(v){const d=tsToDate(v);if(!d)return null;return d.toISOString().slice(0,10);}
function fmtDateShort(iso){const d=tsToDate(iso);if(!d)return'';return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;}
function relTime(ts){const s=(Date.now()-ts)/1000;if(s<60)return'agora';if(s<3600)return Math.floor(s/60)+'min';if(s<86400)return Math.floor(s/3600)+'h';return Math.floor(s/86400)+'d';}
const STATUS={confirmado:{label:'Confirmado',cls:'ok'},pendente:{label:'Pendente',cls:'warn'},concluido:{label:'Concluído',cls:'info'},cancelado:{label:'Cancelado',cls:'danger'}};
const timeToMin=t=>{const[h,m]=t.split(':').map(Number);return h*60+m;};
const minToTime=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');

function toast(msg,type='ok'){
  const ics={ok:'check',err:'x',info:'bell'};
  const el=document.createElement('div');el.className='toast '+type;
  el.innerHTML=`<span class="ti">${icon(ics[type]||'check')}</span><span>${escapeHtml(msg)}</span>`;
  $('#toastWrap').appendChild(el);
  setTimeout(()=>{el.style.transition='.3s';el.style.opacity='0';el.style.transform='translateX(120%)';setTimeout(()=>el.remove(),300);},3200);
}
function setTheme(t){document.documentElement.setAttribute('data-theme',t);localStorage.setItem('groomin_theme',t);
  $$('[data-theme-ic]').forEach(b=>b.innerHTML=icon(t==='dark'?'moon':'sun'));}
function toggleTheme(){setTheme(document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark');if(window.__afterTheme)window.__afterTheme();}
setTheme(localStorage.getItem('groomin_theme')||localStorage.getItem('barberos_theme')||'dark');

function openModal(html,size=''){
  const m=$('#modal');m.className='modal '+size;m.innerHTML=html;
  m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');
  $('#overlay').classList.add('open');document.body.classList.add('locked');
  setTimeout(()=>{const f=m.querySelector('[data-autofocus],input,select,textarea,button:not(.close-x),a[href],[tabindex]:not([tabindex="-1"])');if(f)f.focus({preventScroll:true});},0);
}
function closeModal(){$('#overlay').classList.remove('open');document.body.classList.remove('locked');const m=$('#modal');m.removeAttribute('role');m.removeAttribute('aria-modal');}
let overlayPointerStarted=false;
$('#overlay').addEventListener('pointerdown',e=>{overlayPointerStarted=e.target&&e.target.id==='overlay';});
$('#overlay').addEventListener('click',e=>{
  const selected=window.getSelection?String(window.getSelection()||''):'';
  if(e.target&&e.target.id==='overlay'&&overlayPointerStarted&&!selected.length)closeModal();
  overlayPointerStarted=false;
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
function confirmAction(title,msg,onYes,danger=true){
  openModal(`<div class="modal-head"><h3>${escapeHtml(title)}</h3><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body"><p class="muted">${escapeHtml(msg)}</p></div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn ${danger?'btn-danger':'btn-primary'}" id="confirmYes">Confirmar</button></div>`);
  $('#confirmYes').addEventListener('click',()=>{closeModal();onYes();});
}
const _emptyActions={};let _emptyActionCounter=0;
function emptyState(ic,title,sub,actionLabel,action){
  if(actionLabel&&action){
    const key='ea'+(++_emptyActionCounter);
    _emptyActions[key]=action;
    return `<div class="empty"><div class="ei">${icon(ic)}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(sub)}</p><button class="btn btn-primary btn-sm" data-ea="${key}">${escapeHtml(actionLabel)}</button></div>`;
  }
  return `<div class="empty"><div class="ei">${icon(ic)}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(sub)}</p></div>`;
}
document.addEventListener('click',e=>{const btn=e.target.closest('[data-ea]');if(!btn)return;const fn=_emptyActions[btn.dataset.ea];if(typeof fn==='function')fn();else if(typeof fn==='string')Function(fn)();});
function statCard(c,ic,lbl,val,delta,dir){return `<div class="stat"><div class="si ${c}">${icon(ic)}</div><div class="lbl">${escapeHtml(lbl)}</div><div class="val">${val}</div>${delta?`<div class="delta ${dir||'up'}">${icon(dir==='down'?'down':'trending')} ${escapeHtml(delta)}</div>`:''}</div>`;}

/* ============================================================
   RBAC — Role Based Access Control
   ============================================================ */
const ROLE_LABEL={super_admin:'Super Admin',owner:'Proprietário',manager:'Gerente',receptionist:'Recepcionista',barber:'Barbeiro',customer:'Cliente'};
const PERMS={
  view_admin:['super_admin'],
  manage_platform:['super_admin'],
  view_dashboard:['owner','manager','receptionist'],
  manage_appointments:['owner','manager','receptionist'],
  manage_services:['owner','manager'],
  manage_barbers:['owner','manager'],
  manage_customers:['owner','manager','receptionist'],
  view_financial:['owner','manager'],
  manage_inventory:['owner','manager'],
  use_pos:['owner','manager','receptionist'],
  manage_commissions:['owner','manager'],
  manage_marketing:['owner','manager'],
  view_ai:['owner','manager'],
  manage_settings:['owner'],
  view_own_schedule:['barber'],
  view_own_stats:['barber']
};
function can(perm){const u=Session.effectiveUser;return !!(u&&PERMS[perm]&&PERMS[perm].includes(u.role));}
function homeRouteFor(role){return ({super_admin:'#/admin',owner:'#/dashboard',manager:'#/dashboard',receptionist:'#/dashboard',barber:'#/my-schedule',customer:'#/my-appointments'})[role]||'#/';}

/* ============================================================
   PRODUCT ARCHITECTURE — Simple SaaS MVP
   Main promise: create a professional booking page in < 5 min.
   Future modules stay in code, hidden until explicitly enabled.
   ============================================================ */
const PRODUCT_MODULES={
  '':{stage:'mvp',area:'core',label:'Painel'},
  agenda:{stage:'mvp',area:'booking',label:'Agenda'},
  servicos:{stage:'mvp',area:'booking',label:'Serviços'},
  barbeiros:{stage:'mvp',area:'booking',label:'Profissionais'},
  assinatura:{stage:'mvp',area:'account',label:'Assinatura'},
  config:{stage:'mvp',area:'account',label:'Página pública'},
  clientes:{stage:'future',area:'crm',label:'CRM'},
  marketing:{stage:'future',area:'marketing',label:'Marketing'},
  financeiro:{stage:'future',area:'financial',label:'Financeiro'},
  comissoes:{stage:'future',area:'financial',label:'Comissões'},
  pdv:{stage:'future',area:'financial',label:'PDV / Caixa'},
  estoque:{stage:'mvp',area:'inventory',label:'Produtos'},
  combos:{stage:'future',area:'inventory',label:'Combos & Pacotes'},
  ia:{stage:'future',area:'ai',label:'Insights de IA'},
  marketplace:{stage:'future',area:'marketplace',label:'Marketplace'},
  multiLocation:{stage:'future',area:'multiLocation',label:'Multi-unidades'}
};
function productModuleEnabled(id){
  const key=id||'';
  const mod=PRODUCT_MODULES[key];
  if(!mod)return true;
  if(mod.stage==='mvp')return true;
  const s=(DB.get().settings||{});
  const flags=s.productModules||s.futureModules||{};
  return flags[key]===true||flags[mod.area]===true;
}
function platformPublicPlans(){
  const s=(DB.get().settings||{});
  if(!s.publicPlans)s.publicPlans={free:true,monthly:true,annual:true,founder:true};
  ['free','monthly','annual','founder'].forEach(id=>{if(typeof s.publicPlans[id]==='undefined')s.publicPlans[id]=true;});
  return s.publicPlans;
}
function planAvailableForSale(id){
  if(id==='trial'||id==='free')return platformPublicPlans().free!==false;
  return platformPublicPlans()[id]!==false;
}
function paidPlansForSale(){
  return DB.all('plans').filter(p=>['monthly','annual','founder'].includes(p.id)&&planAvailableForSale(p.id));
}
function futureModuleLabel(id){return (PRODUCT_MODULES[id||'']||{}).label||'Este módulo';}
function futureModulePage(id){
  const label=futureModuleLabel(id);
  return `<div class="empty" style="padding:64px 20px"><div class="ei" style="background:var(--primary-soft);color:var(--primary)">${icon('rocket')}</div>
    <h3>${escapeHtml(label)} ficará para uma próxima fase</h3>
    <p style="max-width:520px;margin:0 auto">O MVP do Groomin agora é focado em criar uma página profissional de agendamento em menos de 5 minutos. Este módulo foi preservado no código e está apenas oculto.</p>
  </div>`;
}

/* ============================================================
   SESSION (with impersonation for Super Admin support)
   ============================================================ */
const Session={
  get user(){try{return JSON.parse(sessionStorage.getItem('groomin_user'));}catch(e){return null;}},
  get impersonating(){try{return JSON.parse(sessionStorage.getItem('groomin_imp'));}catch(e){return null;}},
  get effectiveUser(){return this.impersonating||this.user;},
  login(email,password){
    const u=DB.get().users.find(x=>x.email.toLowerCase()===email.toLowerCase()&&x.password===password&&x.active);
    if(u){sessionStorage.setItem('groomin_user',JSON.stringify(u));return u;}return null;
  },
  logout(){sessionStorage.removeItem('groomin_user');sessionStorage.removeItem('groomin_imp');},
  impersonate(userId){const u=DB.find('users',userId);if(u){sessionStorage.setItem('groomin_imp',JSON.stringify(u));}return u;},
  stopImpersonate(){sessionStorage.removeItem('groomin_imp');}
};
// current tenant context for owner/staff
function currentShop(){
  const u=Session.effectiveUser;
  if(!u)return null;
  if(u.barbershopId)return DB.find('barbershops',u.barbershopId);
  return null;
}

/* ============================================================
   ROUTER (hash-based) with role-based redirects
   ============================================================ */
const RESERVED=['login','signup','admin','dashboard','my-schedule','my-appointments','find-barbershops','b'];
const Router={
  parse(){
    let h=location.hash.replace(/^#\/?/,'');
    const seg=h.split('/').filter(Boolean);
    if(seg.length===0)return {route:'landing'};
    const first=seg[0];
    if(first==='login')return {route:'login'};
    if(first==='signup')return {route:'signup'};
    if(first==='verify-email')return {route:'verify-email'};
    if(first==='admin')return {route:'admin',sub:seg[1]};
    if(first==='dashboard')return {route:'dashboard',sub:seg[1]};
    if(first==='my-schedule')return {route:'my-schedule',sub:seg[1]};
    if(first==='my-appointments')return {route:'my-appointments'};
    if(first==='find-barbershops')return {route:'marketplace'};
    if(first==='stripe')return {route:'stripe-return',sub:(seg[1]||'success').split('?')[0]};
    if(['privacidade','termos','cookies','lgpd','contato','suporte'].includes(first))return {route:'legal',page:first};
    if(first==='b')return {route:'public',slug:seg[1]};
    return {route:'public',slug:first}; // platform.com/<slug>
  },
  go(path){if(location.hash===path)Router.render();else location.hash=path;},
  render(opts){
    opts=opts||{};
    const r=Router.parse();
    const u=Session.effectiveUser;
    if(!opts.preserveUi)closeModal();
    // guards
    if(r.route==='admin'&&!can('view_admin')){return needAuth('#/admin');}
    if(r.route==='dashboard'&&!can('view_dashboard')){return needAuth('#/dashboard');}
    if((r.route==='dashboard'||r.route==='admin')&&Session.user&&Session.user.role!=='super_admin'&&!Session.user.emailVerified&&!Session.user.barbershopId){Router.go('#/verify-email');return;}
    if(r.route==='my-schedule'&&!(u&&u.role==='barber')){return needAuth('#/my-schedule');}
    if(r.route==='my-appointments'&&!(u&&u.role==='customer')){return needAuth('#/my-appointments');}
    if(r.route==='marketplace'&&!productModuleEnabled('marketplace')){location.hash='#/';return;}
    const map={landing:'renderLanding',login:'renderLogin',signup:'renderSignup','verify-email':'renderEmailVerification',admin:'renderAdmin',dashboard:'renderDashboard','my-schedule':'renderBarber','my-appointments':'renderCustomer',public:'renderPublic',marketplace:'renderMarketplace',legal:'renderLegalPage','stripe-return':'renderStripeReturn'};
    const fn=window[map[r.route]];
    if(typeof fn==='function')fn(r);
    else $('#root').innerHTML=`<div class="container" style="padding:80px 0;text-align:center"><h2>Carregando…</h2></div>`;
    if(!opts.preserveScroll)window.scrollTo(0,0);
  }
};
function needAuth(intended){
  sessionStorage.setItem('groomin_intended',intended||'');
  if(!Session.user){toast('Faça login para continuar.','info');location.hash='#/login';}
  else{toast('Você não tem permissão para esta área.','err');location.hash=homeRouteFor(Session.effectiveUser.role);}
}
window.addEventListener('hashchange',()=>Router.render());
function applyThemeIcons(){const t=document.documentElement.getAttribute('data-theme');$$('[data-theme-ic]').forEach(b=>{if(!b.innerHTML.trim())b.innerHTML=icon(t==='dark'?'moon':'sun');});}
const _coreRender=Router.render.bind(Router);
Router.render=function(opts){_coreRender(opts);applyThemeIcons();};
window.Router=Router;
window.refreshShell=function(){Router.render();};
