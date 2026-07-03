/* ============================================================
   PDV (POS) + CAIXA + COMBOS + COMISSÕES + CONSUMO
   ============================================================ */
let posCart=[],posPayment='cash',posDiscount=0,posCustomer='',posBarberId='',posTab='servicos',salesHistoryPage=1;
function openSession(shopId){return DB.scope('cashSessions',shopId).find(s=>s.status==='open');}
function comboPrice(combo){const sub=combo.items.reduce((s,it)=>{const ref=it.type==='service'?DB.find('services',it.refId):DB.find('products',it.refId);return s+(ref?ref.price:0);},0);return Math.max(0,combo.discountType==='percent'?sub*(1-combo.discountValue/100):sub-combo.discountValue);}
const PAYLABEL={cash:'Dinheiro',pix:'PIX',credit:'Crédito',debit:'Débito'};

function dashPDV(shop){
  const cs=openSession(shop.id);
  if(!cs)return pdvClosed(shop);
  const barbers=DB.scope('barbers',shop.id).filter(b=>b.active);
  if(!posBarberId&&barbers[0])posBarberId=barbers[0].id;
  const sales=DB.scope('sales',shop.id).filter(s=>s.cashSessionId===cs.id);
  const cashSales=sales.filter(s=>s.payment==='cash').reduce((s,x)=>s+x.total,0);
  const mvIn=(cs.movements||[]).filter(m=>m.type==='in').reduce((s,m)=>s+m.amount,0);
  const mvOut=(cs.movements||[]).filter(m=>m.type==='out').reduce((s,m)=>s+m.amount,0);
  const expectedCash=cs.openingAmount+cashSales+mvIn-mvOut;
  const subtotal=posCart.reduce((s,i)=>s+i.price*i.qty,0);
  const total=Math.max(0,subtotal-(+posDiscount||0));
  // catalog
  const services=DB.scope('services',shop.id).filter(s=>s.active);
  const conv=DB.scope('products',shop.id).filter(p=>(p.kind||'professional')==='convenience'&&p.active!==false);
  const combos=DB.scope('combos',shop.id).filter(c=>c.active);
  let catalog='';
  if(posTab==='servicos')catalog=services.map(s=>posCatalogItem('service',s.id,s.name,s.price,s.duration+' min','scissors')).join('')||'<p class="muted">Sem serviços.</p>';
  else if(posTab==='conveniencia')catalog=conv.map(p=>posCatalogItem('product',p.id,p.name,p.price,(p.qty>0?p.qty+' em estoque':'esgotado'),'coffee',p.qty<=0)).join('')||'<p class="muted">Sem produtos de conveniência.</p>';
  else catalog=combos.map(c=>posCatalogItem('combo',c.id,c.name,comboPrice(c),c.items.length+' itens','layers')).join('')||'<p class="muted">Sem combos.</p>';
  return `<div class="page-head"><div><h2>PDV / Caixa</h2><p>Caixa aberto ${relTime(cs.openedAt)} atrás · ${sales.length} venda(s)</p></div>
    <div class="page-actions"><button class="btn btn-ghost" onclick="cashMovementForm()">${icon('repeat')} Sangria/Suprimento</button><button class="btn btn-ghost" onclick="salesHistory()">${icon('list')} Vendas</button><button class="btn btn-danger" onclick="closeCashForm()">${icon('lock')} Fechar caixa</button></div></div>
  <div class="stat-grid">${statCard('c2','dollar','Vendas do caixa',money(sales.reduce((s,x)=>s+x.total,0)),sales.length+' transações')}${statCard('c1','creditCard','Em dinheiro (gaveta)',money(expectedCash),'esperado')}${statCard('c3','box','Abertura',money(cs.openingAmount),'fundo de troco')}${statCard('c4','user','Operador',(cs.openedBy||'').split(' ')[0]||'—','responsável')}</div>
  <div class="dash-cols">
    <div class="panel"><div class="panel-head"><h3>Catálogo</h3><div class="seg"><button class="${posTab==='servicos'?'on':''}" onclick="posTab='servicos';refreshShell()">Serviços</button><button class="${posTab==='conveniencia'?'on':''}" onclick="posTab='conveniencia';refreshShell()">Conveniência</button><button class="${posTab==='combos'?'on':''}" onclick="posTab='combos';refreshShell()">Combos</button></div></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">${catalog}</div>
    </div>
    <div class="panel" style="position:sticky;top:90px"><div class="panel-head"><h3>${icon('creditCard')} Venda atual</h3>${posCart.length?`<button class="btn btn-sm btn-ghost" onclick="posCart=[];refreshShell()">Limpar</button>`:''}</div>
      ${posCart.length?posCart.map((it,i)=>`<div class="mini-slot" style="margin:0 0 8px"><div style="flex:1"><b>${escapeHtml(it.name)}</b><br><small>${money(it.price)} ${it.type==='combo'?'· combo':''}</small></div><div style="display:flex;align-items:center;gap:6px"><button class="ra" onclick="posQty(${i},-1)">−</button><b style="min-width:18px;text-align:center">${it.qty}</b><button class="ra" onclick="posQty(${i},1)">+</button><button class="ra del" onclick="posRemove(${i})">${icon('x')}</button></div></div>`).join(''):`<div class="empty" style="padding:24px"><div class="ei">${icon('creditCard')}</div><p>Adicione serviços ou produtos</p></div>`}
      ${posCart.length?`
      <div class="field" style="margin-top:12px"><label>Profissional (vendedor)</label><select class="input" onchange="posBarberId=this.value">${barbers.map(b=>`<option value="${b.id}" ${posBarberId===b.id?'selected':''}>${escapeHtml(b.name)}</option>`).join('')}</select></div>
      <div class="form-row"><div class="field"><label>Cliente (opcional)</label><input class="input" value="${escapeHtml(posCustomer)}" onchange="posCustomer=this.value"></div><div class="field"><label>Desconto (R$)</label><input class="input" type="number" min="0" value="${posDiscount}" onchange="posDiscount=+this.value||0;refreshShell()"></div></div>
      <div class="field"><label>Forma de pagamento</label><div class="chips">${Object.entries(PAYLABEL).map(([k,l])=>`<span class="chip-toggle ${posPayment===k?'on':''}" onclick="posPayment='${k}';refreshShell()">${l}</span>`).join('')}</div></div>
      <div class="summary-line"><span class="muted">Subtotal</span><b>${money(subtotal)}</b></div>
      ${posDiscount>0?`<div class="summary-line"><span class="muted">Desconto</span><b style="color:var(--danger)">- ${money(posDiscount)}</b></div>`:''}
      <div class="summary-line"><span class="muted">Total</span><b style="color:var(--primary);font-size:20px">${money(total)}</b></div>
      <button class="btn btn-primary btn-block" style="margin-top:14px" onclick="posFinalize()">${icon('check')} Finalizar venda</button>`:''}
    </div>
  </div>`;
}
function posCatalogItem(type,id,name,price,sub,ic,disabled){return `<div class="select-item" style="${disabled?'opacity:.5;pointer-events:none':''}" onclick="posAdd('${type}','${id}')"><div style="display:flex;align-items:center;gap:8px"><span class="ic" style="width:32px;height:32px;border-radius:9px;background:var(--primary-soft);color:var(--primary);display:grid;place-items:center">${icon(ic)}</span><div style="overflow:hidden"><div class="t" style="font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(name)}</div><div class="d">${escapeHtml(sub)}</div></div></div><div class="p" style="margin-top:8px">${money(price)}</div></div>`;}
function posAdd(type,id){
  if(type==='service'){const s=DB.find('services',id);posCart.push({type:'service',refId:id,name:s.name,price:s.price,qty:1});}
  else if(type==='product'){posAddProduct(id);}
  else if(type==='combo'){const c=DB.find('combos',id);posCart.push({type:'combo',refId:id,name:c.name,price:comboPrice(c),qty:1,productIds:c.items.filter(i=>i.type==='product').map(i=>i.refId)});}
  refreshShell();
}
function posAddProduct(id){const p=DB.find('products',id);if(p.qty<=0){toast('Produto sem estoque.','err');return;}const ex=posCart.find(i=>i.type==='product'&&i.refId===id);if(ex)ex.qty++;else posCart.push({type:'product',refId:id,productId:id,name:p.name,price:p.price,qty:1});}
function posQty(i,d){posCart[i].qty=Math.max(1,posCart[i].qty+d);refreshShell();}
function posRemove(i){posCart.splice(i,1);refreshShell();}
function posFinalize(){
  const shop=dashShop();const cs=openSession(shop.id);if(!cs){toast('Abra o caixa.','err');return;}if(!posCart.length)return;
  const subtotal=posCart.reduce((s,i)=>s+i.price*i.qty,0);const discount=+posDiscount||0;const total=Math.max(0,subtotal-discount);
  const saleId=DB.uid('sale');
  posCart.forEach(it=>{if(it.productId)moveStock(it.productId,-it.qty,'sale','Venda PDV',saleId);if(it.productIds)it.productIds.forEach(pid=>moveStock(pid,-it.qty,'sale','Venda combo PDV',saleId));});
  DB.insert('sales',{id:saleId,barbershopId:shop.id,items:posCart.map(i=>({...i})),subtotal,discount,total,payment:posPayment,barberId:posBarberId,customerName:posCustomer,cashSessionId:cs.id,createdAt:Date.now()});
  DB.log('Venda registrada (PDV)',money(total)+' · '+PAYLABEL[posPayment],shop.id);
  const sale=DB.find('sales',saleId);posCart=[];posDiscount=0;posCustomer='';
  showReceipt(sale);
}
function showReceipt(sale){
  const shop=dashShop();const barber=DB.find('barbers',sale.barberId);
  openModal(`<div class="modal-head"><div><h3>Venda concluída ✓</h3><div class="sub">Comprovante #${sale.id.slice(-6).toUpperCase()}</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body"><div id="receipt" class="card" style="padding:20px">
    <div style="text-align:center;margin-bottom:14px"><div class="brand" style="justify-content:center"><span class="logo">${icon('scissors')}</span><span>${escapeHtml(shop.name)}</span></div><div class="muted" style="font-size:12.5px;margin-top:4px">${new Date(sale.createdAt).toLocaleString('pt-BR')}</div></div>
    ${sale.items.map(it=>`<div class="summary-line"><span>${it.qty}x ${escapeHtml(it.name)}</span><b>${money(it.price*it.qty)}</b></div>`).join('')}
    <div class="summary-line"><span class="muted">Subtotal</span><b>${money(sale.subtotal)}</b></div>
    ${sale.discount>0?`<div class="summary-line"><span class="muted">Desconto</span><b>- ${money(sale.discount)}</b></div>`:''}
    <div class="summary-line"><span style="font-size:16px"><b>TOTAL</b></span><b style="color:var(--primary);font-size:18px">${money(sale.total)}</b></div>
    <div class="summary-line"><span class="muted">Pagamento</span><b>${PAYLABEL[sale.payment]}</b></div>
    ${barber?`<div class="summary-line"><span class="muted">Atendente</span><b>${escapeHtml(barber.name)}</b></div>`:''}
    ${sale.customerName?`<div class="summary-line"><span class="muted">Cliente</span><b>${escapeHtml(sale.customerName)}</b></div>`:''}
    <p style="text-align:center;margin-top:14px;font-size:12px" class="muted">Obrigado pela preferência! 💈</p>
  </div></div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="window.print()">${icon('file')} Imprimir</button><button class="btn btn-primary" onclick="closeModal();refreshShell()">Nova venda</button></div>`);
}
function pdvClosed(shop){
  const last=DB.scope('cashSessions',shop.id).filter(s=>s.status==='closed').sort((a,b)=>b.closedAt-a.closedAt)[0];
  return `<div class="page-head"><div><h2>PDV / Caixa</h2><p>O caixa está fechado</p></div><div class="page-actions"><button class="btn btn-ghost" onclick="salesHistory()">${icon('list')} Histórico de vendas</button></div></div>
  <div class="panel" style="max-width:520px;margin:0 auto;text-align:center"><div class="success-check" style="background:var(--primary-soft);color:var(--primary)">${icon('creditCard')}</div>
    <h3>Abrir caixa</h3><p class="muted" style="margin:8px 0 18px">Informe o valor inicial em dinheiro (fundo de troco) para começar a registrar vendas.</p>
    <div class="field" style="max-width:240px;margin:0 auto 16px"><label>Valor de abertura (R$)</label><input class="input" type="number" id="open_amount" value="100" style="text-align:center"></div>
    <button class="btn btn-primary" onclick="openCash()">${icon('check')} Abrir caixa</button>
  </div>
  ${last?`<div class="panel" style="max-width:520px;margin:18px auto 0"><div class="panel-head"><h3>Último fechamento</h3></div><div class="summary-line"><span class="muted">Fechado em</span><b>${new Date(last.closedAt).toLocaleString('pt-BR')}</b></div><div class="summary-line"><span class="muted">Esperado</span><b>${money(last.expectedCash||0)}</b></div><div class="summary-line"><span class="muted">Contado</span><b>${money(last.closingAmount||0)}</b></div><div class="summary-line"><span class="muted">Diferença</span><b style="color:${(last.closingAmount-last.expectedCash)>=0?'var(--success)':'var(--danger)'}">${money((last.closingAmount||0)-(last.expectedCash||0))}</b></div></div>`:''}`;
}
function openCash(){const shop=dashShop();const amount=+$('#open_amount').value||0;DB.insert('cashSessions',{barbershopId:shop.id,status:'open',openedBy:Session.effectiveUser.name,openedAt:Date.now(),openingAmount:amount,movements:[]});DB.log('Caixa aberto',money(amount),shop.id);toast('Caixa aberto.','ok');refreshShell();}
function closeCashForm(){
  const shop=dashShop();const cs=openSession(shop.id);const sales=DB.scope('sales',shop.id).filter(s=>s.cashSessionId===cs.id);
  const byPay={};Object.keys(PAYLABEL).forEach(k=>byPay[k]=sales.filter(s=>s.payment===k).reduce((a,s)=>a+s.total,0));
  const cashSales=byPay.cash;const mvIn=(cs.movements||[]).filter(m=>m.type==='in').reduce((s,m)=>s+m.amount,0);const mvOut=(cs.movements||[]).filter(m=>m.type==='out').reduce((s,m)=>s+m.amount,0);
  const expected=cs.openingAmount+cashSales+mvIn-mvOut;
  openModal(`<div class="modal-head"><div><h3>Fechar caixa</h3><div class="sub">Confira os valores e informe o dinheiro contado</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    ${Object.entries(PAYLABEL).map(([k,l])=>`<div class="summary-line"><span class="muted">${l}</span><b>${money(byPay[k])}</b></div>`).join('')}
    <div class="summary-line"><span class="muted">Fundo de troco</span><b>${money(cs.openingAmount)}</b></div>
    <div class="summary-line"><span class="muted">Suprimentos / Sangrias</span><b>${money(mvIn)} / ${money(mvOut)}</b></div>
    <div class="summary-line"><span><b>Dinheiro esperado na gaveta</b></span><b style="color:var(--primary)">${money(expected)}</b></div>
    <div class="field" style="margin-top:14px"><label>Dinheiro contado (R$)</label><input class="input" type="number" id="close_amount" value="${expected}"></div>
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-danger" onclick="closeCash(${expected})">Fechar caixa</button></div>`);
}
function closeCash(expected){const shop=dashShop();const cs=openSession(shop.id);const counted=+$('#close_amount').value||0;DB.update('cashSessions',cs.id,{status:'closed',closedAt:Date.now(),expectedCash:expected,closingAmount:counted});DB.log('Caixa fechado',`esperado ${money(expected)} · contado ${money(counted)}`,shop.id);closeModal();toast('Caixa fechado.','ok');refreshShell();}
function cashMovementForm(){
  openModal(`<div class="modal-head"><h3>Movimentação de caixa</h3><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body"><div class="field"><label>Tipo</label><select class="input" id="cm_type"><option value="in">Suprimento (entrada de dinheiro)</option><option value="out">Sangria (retirada)</option></select></div>
  <div class="field"><label>Valor (R$)</label><input class="input" type="number" id="cm_amount" value="0"></div>
  <div class="field"><label>Motivo</label><input class="input" id="cm_reason" placeholder="Ex.: troco, pagamento fornecedor"></div></div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveCashMovement()">Registrar</button></div>`);
}
function saveCashMovement(){const shop=dashShop();const cs=openSession(shop.id);const amount=+$('#cm_amount').value||0;if(amount<=0){toast('Informe o valor.','err');return;}const mv={type:$('#cm_type').value,amount,reason:$('#cm_reason').value.trim(),time:Date.now()};const movements=[...(cs.movements||[]),mv];DB.update('cashSessions',cs.id,{movements});DB.log('Movimentação de caixa',(mv.type==='in'?'Suprimento ':'Sangria ')+money(amount),shop.id);closeModal();toast('Movimentação registrada.','ok');refreshShell();}
function salesHistory(){
  const shop=dashShop();const sales=DB.scope('sales',shop.id).slice().sort((a,b)=>b.createdAt-a.createdAt);
  const total=sales.reduce((s,x)=>s+x.total,0);
  const pg=pageSlice(sales,salesHistoryPage);salesHistoryPage=pg.page;
  openModal(`<div class="modal-head"><div><h3>Histórico de vendas</h3><div class="sub">${sales.length} venda(s) · ${money(total)}</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">${sales.length?`<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Itens</th><th>Pgto</th><th>Total</th></tr></thead><tbody>${pg.items.map(s=>`<tr><td>${new Date(s.createdAt).toLocaleString('pt-BR')}</td><td>${s.items.length} item(s)</td><td><span class="badge muted">${PAYLABEL[s.payment]}</span></td><td><b>${money(s.total)}</b></td></tr>`).join('')}</tbody></table></div>${pageControls(pg,'setSalesHistoryPage')}`:emptyState('list','Sem vendas','As vendas do PDV aparecem aqui.')}</div>`,'lg');
}
function setSalesHistoryPage(p){salesHistoryPage=p;salesHistory();}

/* ---------- Combos & Pacotes ---------- */
function dashCombos(shop){
  const list=DB.scope('combos',shop.id);
  return `<div class="page-head"><div><h2>Combos & Pacotes</h2><p>Agrupe serviços e produtos com desconto</p></div><div class="page-actions"><button class="btn btn-primary" onclick="comboForm()">${icon('plus')} Novo combo</button></div></div>
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${list.map(c=>{const sub=c.items.reduce((s,it)=>{const r=it.type==='service'?DB.find('services',it.refId):DB.find('products',it.refId);return s+(r?r.price:0);},0);const price=comboPrice(c);return `<div class="card" style="padding:18px"><div style="display:flex;justify-content:space-between;align-items:flex-start"><b style="font-size:16px">${escapeHtml(c.name)}</b><span class="badge ${c.active?'ok':'muted'}">${c.active?'Ativo':'Pausado'}</span></div>
    <div style="margin:12px 0">${c.items.map(it=>{const r=it.type==='service'?DB.find('services',it.refId):DB.find('products',it.refId);return `<div class="summary-line"><span>${icon(it.type==='service'?'scissors':'box')} ${r?escapeHtml(r.name):'—'}</span><b>${r?money(r.price):''}</b></div>`;}).join('')}</div>
    <div class="summary-line"><span class="muted">De</span><b style="text-decoration:line-through;color:var(--muted)">${money(sub)}</b></div>
    <div class="summary-line"><span class="muted">Por</span><b style="color:var(--primary);font-size:18px">${money(price)}</b></div>
    <div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-ghost btn-sm btn-block" onclick="comboForm('${c.id}')">${icon('edit')} Editar</button><button class="ra del" onclick="delCombo('${c.id}')">${icon('trash')}</button></div></div>`;}).join('')||emptyState('layers','Sem combos','Crie um pacote combinando serviços e produtos.')}</div>`;
}
function comboForm(id){
  const shop=dashShop();const c=id?DB.find('combos',id):null;
  const services=DB.scope('services',shop.id).filter(s=>s.active);const products=DB.scope('products',shop.id).filter(p=>p.active!==false);
  const has=(t,rid)=>c&&c.items.some(i=>i.type===t&&i.refId===rid);
  openModal(`<div class="modal-head"><h3>${c?'Editar':'Novo'} combo</h3><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <div class="field"><label>Nome *</label><input class="input" id="co_name" value="${c?escapeHtml(c.name):''}" placeholder="Ex.: Corte + Barba + Óleo"><div class="err">Informe o nome.</div></div>
    <div class="field"><label>Serviços incluídos</label><div class="chips" id="co_svcs">${services.map(s=>`<span class="chip-toggle ${has('service',s.id)?'on':''}" data-id="${s.id}" onclick="this.classList.toggle('on')">${escapeHtml(s.name)} · ${money(s.price)}</span>`).join('')}</div></div>
    <div class="field"><label>Produtos incluídos</label><div class="chips" id="co_prods">${products.map(p=>`<span class="chip-toggle ${has('product',p.id)?'on':''}" data-id="${p.id}" onclick="this.classList.toggle('on')">${escapeHtml(p.name)} · ${money(p.price)}</span>`).join('')}</div></div>
    <div class="form-row"><div class="field"><label>Tipo de desconto</label><select class="input" id="co_dt"><option value="fixed" ${c&&c.discountType==='fixed'?'selected':''}>Valor fixo (R$)</option><option value="percent" ${c&&c.discountType==='percent'?'selected':''}>Percentual (%)</option></select></div><div class="field"><label>Valor do desconto</label><input class="input" type="number" id="co_dv" value="${c?c.discountValue:5}"></div></div>
    <div class="checkbox-row"><div class="switch ${!c||c.active?'on':''}" id="co_active" onclick="this.classList.toggle('on')"></div><label style="margin:0">Combo ativo</label></div>
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveCombo('${id||''}')">Salvar</button></div>`);
}
function saveCombo(id){const shop=dashShop();const name=$('#co_name').value.trim();if(name.length<2){toast('Informe o nome.','err');return;}const items=[...$$('#co_svcs .chip-toggle.on').map(e=>({type:'service',refId:e.dataset.id})),...$$('#co_prods .chip-toggle.on').map(e=>({type:'product',refId:e.dataset.id}))];if(items.length<2){toast('Selecione ao menos 2 itens.','err');return;}const data={name,items,discountType:$('#co_dt').value,discountValue:+$('#co_dv').value||0,active:$('#co_active').classList.contains('on')};if(id)DB.update('combos',id,data);else DB.insert('combos',{barbershopId:shop.id,...data});DB.log(id?'Combo editado':'Combo criado',name,shop.id);closeModal();toast('Combo salvo.','ok');refreshShell();}
function delCombo(id){confirmAction('Excluir combo?','',()=>{DB.remove('combos',id);toast('Combo excluído.','info');refreshShell();});}

/* ---------- Comissões ---------- */
let commMonth=null;
function dashCommissions(shop){
  if(!commMonth)commMonth=DB.todayISO().slice(0,7);
  const barbers=DB.scope('barbers',shop.id);
  const appts=DB.scope('appointments',shop.id).filter(a=>a.status==='concluido'&&a.date.slice(0,7)===commMonth);
  const sales=DB.scope('sales',shop.id).filter(s=>new Date(s.createdAt).toISOString().slice(0,7)===commMonth);
  const rows=barbers.map(b=>{
    const svcRev=appts.filter(a=>a.barberId===b.id).reduce((s,a)=>s+a.price,0);
    const prodRev=sales.filter(s=>s.barberId===b.id).reduce((s,sale)=>s+sale.items.filter(i=>i.type==='product'||i.type==='combo').reduce((x,i)=>x+i.price*i.qty,0),0);
    const svcComm=svcRev*((b.commission||0)/100);const prodComm=prodRev*((b.productCommission??10)/100);
    return {b,svcRev,prodRev,svcComm,prodComm,total:svcComm+prodComm};
  });
  const totalPayout=rows.reduce((s,r)=>s+r.total,0);
  // month options (last 6)
  const opts=[];for(let i=0;i<6;i++){const d=new Date();d.setMonth(d.getMonth()-i);opts.push(d.toISOString().slice(0,7));}
  return `<div class="page-head"><div><h2>Comissões</h2><p>Comissão de serviços e de venda de produtos · pagamentos mensais</p></div>
    <div class="page-actions"><select class="input" style="width:auto" onchange="commMonth=this.value;refreshShell()">${opts.map(m=>{const[y,mo]=m.split('-');return `<option value="${m}" ${commMonth===m?'selected':''}>${MON[+mo-1]}/${y}</option>`;}).join('')}</select><button class="btn btn-ghost" onclick="exportCSV('sales')">${icon('download')} Exportar vendas</button></div></div>
  <div class="stat-grid">${statCard('c2','dollar','Total a pagar',money(totalPayout),'comissões do mês')}${statCard('c1','scissors','Receita serviços',money(rows.reduce((s,r)=>s+r.svcRev,0)),'concluídos')}${statCard('c3','box','Receita produtos',money(rows.reduce((s,r)=>s+r.prodRev,0)),'vendas PDV')}${statCard('c4','users','Profissionais',barbers.length,'na equipe')}</div>
  <div class="panel"><div class="panel-head"><h3>Demonstrativo de comissões</h3><span class="badge muted">${MON[+commMonth.split('-')[1]-1]}/${commMonth.split('-')[0]}</span></div>
  <div class="table-wrap"><table><thead><tr><th>Profissional</th><th>% Serviço</th><th>% Produto</th><th>Receita serviços</th><th>Receita produtos</th><th>Comissão total</th><th></th></tr></thead><tbody>
  ${rows.map(r=>`<tr><td><div class="t-user"><div class="av">${initials(r.b.name)}</div><b>${escapeHtml(r.b.name)}</b></div></td>
    <td><div style="display:flex;align-items:center;gap:4px"><input class="input" style="width:64px;padding:7px 9px;text-align:center" type="number" min="0" max="100" value="${r.b.commission||0}" onchange="updateCommission('${r.b.id}','commission',this.value)"><span class="muted">%</span></div></td>
    <td><div style="display:flex;align-items:center;gap:4px"><input class="input" style="width:64px;padding:7px 9px;text-align:center" type="number" min="0" max="100" value="${r.b.productCommission??10}" onchange="updateCommission('${r.b.id}','productCommission',this.value)"><span class="muted">%</span></div></td>
    <td>${money(r.svcRev)} <small class="muted">→ ${money(r.svcComm)}</small></td><td>${money(r.prodRev)} <small class="muted">→ ${money(r.prodComm)}</small></td><td><b style="color:var(--primary)">${money(r.total)}</b></td><td><button class="btn btn-sm btn-ghost" onclick="payCommission('${r.b.id}','${money(r.total)}')">Pagar</button></td></tr>`).join('')}
  </tbody><tfoot><tr><td colspan="5" style="text-align:right;font-weight:800;padding:14px 16px">Total do mês</td><td style="font-weight:800;color:var(--primary)">${money(totalPayout)}</td><td></td></tr></tfoot></table></div>
  <p class="muted" style="font-size:12.5px;margin-top:12px">${icon('award')} Edite os percentuais direto na tabela — as alterações são salvas e o cálculo é refeito na hora. (Também é possível ajustar no cadastro do barbeiro.)</p></div>`;
}
function updateCommission(barberId,field,value){
  if(!can('manage_commissions')){toast('Sem permissão.','err');return;}
  const shop=dashShop();const b=DB.find('barbers',barberId);
  if(!b||b.barbershopId!==shop.id){toast('Barbeiro inválido.','err');return;} // tenant guard
  let v=Math.max(0,Math.min(100,Math.round(+value||0)));
  DB.update('barbers',barberId,{[field]:v});
  DB.log('Comissão ajustada',`${b.name} · ${field==='commission'?'serviço':'produto'} ${v}%`,shop.id);
  toast('Comissão atualizada.','ok');refreshShell();
}
function payCommission(barberId,val){const b=DB.find('barbers',barberId);confirmAction('Registrar pagamento?',`Confirmar pagamento de ${val} de comissão para ${b.name}?`,()=>{DB.log('Comissão paga',`${b.name} · ${val}`,b.barbershopId);toast('Pagamento de comissão registrado.','ok');},false);}

/* ---------- Consumo de produtos no atendimento ---------- */
function consumeForm(apptId){
  const shop=dashShop();const ap=DB.find('appointments',apptId);
  const pros=DB.scope('products',shop.id).filter(p=>(p.kind||'professional')==='professional'&&p.active!==false);
  const existing=ap.consumption||[];
  openModal(`<div class="modal-head"><div><h3>Registrar consumo</h3><div class="sub">${escapeHtml(ap.customerName)} · produtos usados no atendimento</div></div><button class="close-x" onclick="closeModal()">${icon('x')}</button></div>
  <div class="modal-body">
    <p class="muted" style="font-size:13px;margin-bottom:12px">Informe a quantidade de cada produto profissional consumido. O estoque será baixado automaticamente e o custo do serviço calculado.</p>
    ${pros.map(p=>{const cur=existing.find(c=>c.productId===p.id);return `<div class="mini-slot" style="margin:0 0 8px"><span class="ic">${icon('droplet')}</span><div style="flex:1"><b>${escapeHtml(p.name)}</b><br><small>${p.qty} ${p.unit||'un'} em estoque · custo ${money(p.cost)}/${p.unit||'un'}</small></div><input class="input" style="width:80px" type="number" min="0" step="0.1" id="cons_${p.id}" value="${cur?cur.qty:0}" placeholder="0"><span style="font-size:12px;color:var(--muted);min-width:24px">${p.unit||'un'}</span></div>`;}).join('')||'<p class="muted">Nenhum produto profissional cadastrado.</p>'}
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button><button class="btn btn-primary" onclick="saveConsumption('${apptId}')">Salvar consumo</button></div>`);
}
function saveConsumption(apptId){
  const shop=dashShop();const ap=DB.find('appointments',apptId);const pros=DB.scope('products',shop.id).filter(p=>(p.kind||'professional')==='professional');
  const prev=ap.consumption||[];const consumption=[];let cost=0;
  pros.forEach(p=>{const qty=+($('#cons_'+p.id)?.value)||0;const prevQty=(prev.find(c=>c.productId===p.id)||{}).qty||0;const delta=qty-prevQty;if(qty>0){consumption.push({productId:p.id,name:p.name,qty,cost:p.cost*qty});cost+=p.cost*qty;}if(delta!==0)moveStock(p.id,-delta,'consumption','Consumo: '+ap.customerName,apptId);});
  DB.update('appointments',apptId,{consumption,serviceCost:cost});
  DB.log('Consumo registrado',`${ap.customerName} · custo ${money(cost)}`,shop.id);
  closeModal();toast(`Consumo registrado. Custo do serviço: ${money(cost)}.`,'ok');refreshShell();
}
