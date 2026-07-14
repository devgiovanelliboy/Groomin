const { test, expect } = require("@playwright/test");

const SHOT_DIR = process.env.GROOMIN_SHOT_DIR || "test-results/food-orders";

async function disableFirebaseForDemo(page) {
  await page.route("**/js/firebase-config.js*", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `
        window.FIREBASE_CONFIG = {};
        window.USE_FIREBASE = false;
        window.FIREBASE_APPCHECK_SITE_KEY = "";
        window.__FB_ENABLED = false;
      `,
    });
  });
}

async function resetDemoStorage(page) {
  await page.evaluate(() => {
    localStorage.removeItem("groomin_db_v1");
    sessionStorage.clear();
  });
}

// Semeia uma loja de alimentos no banco demo: aberta todos os dias 09-19h,
// intervalo de 1h e um único preparador => capacidade natural de 10 pedidos/dia.
async function seedFoodShop(page) {
  await page.evaluate(() => {
    if (!DB.findBy("barbershops", (s) => s.slug === "tortas-da-maria")) {
      DB.insert("barbershops", {
        id: "shopF", slug: "tortas-da-maria", name: "Tortas da Maria", ownerName: "Maria Silva",
        category: "food", description: "", address: "Rua das Flores, 10", city: "São Paulo",
        neighborhood: "Centro", phone: "(11) 3333-9000", whatsapp: "(11) 99999-9000",
        email: "maria@tortas.com", instagram: "", open: "09:00", close: "19:00",
        lunchStart: "00:00", lunchEnd: "00:00", workDays: [0, 1, 2, 3, 4, 5, 6],
        planId: "monthly", status: "active", rating: 5, createdAt: Date.now(), slotInterval: 60,
      });
      DB.insert("barbers", {
        id: "bF", barbershopId: "shopF", name: "Maria Silva", role: "Confeiteira", bio: "",
        phone: "", email: "", specialties: [], commission: 0, start: "09:00", end: "19:00",
        lunchStart: "00:00", lunchEnd: "00:00", days: [0, 1, 2, 3, 4, 5, 6], vacations: [],
        active: true, rating: 5,
      });
      DB.insert("services", {
        id: "svF1", barbershopId: "shopF", name: "Torta de chocolate", desc: "Serve 10 fatias",
        price: 90, duration: 60, category: "Produtos", icon: "coffee", active: true,
      });
      DB.insert("services", {
        id: "svF2", barbershopId: "shopF", name: "Bolo personalizado", desc: "",
        price: 150, duration: 60, category: "Produtos", icon: "coffee", active: true,
      });
    }
  });
}

function tomorrowISO(page) {
  return page.evaluate(() => DB.addDays(DB.todayISO(), 1));
}

test.describe("categoria Alimentos (encomendas)", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await disableFirebaseForDemo(page);
    await page.goto(`${baseURL}/app/#/`);
    await resetDemoStorage(page);
    await page.reload();
    await seedFoodShop(page);
  });

  test("pagina publica usa vocabulario de encomenda", async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/app/#/b/tortas-da-maria`);
    await expect(page.locator(".pub-kicker")).toHaveText("Alimentos por encomenda");
    await expect(page.locator(".pub-section-head h2").first()).toHaveText("Produtos");
    await expect(page.getByRole("button", { name: /Fazer encomenda/ })).toBeVisible();
    await expect(page.locator(".pub-service-foot small").first()).toHaveText("Entrega agendada");
    await expect(page.locator(".pub-section-head h2").nth(1)).toHaveText("Quem prepara");
    await expect(page.locator(".pub-pro .btn-ghost").first()).toHaveText("Encomendar");
    await expect(page.locator(".pub-booking-band h2")).toHaveText("Escolha o dia e horário da entrega");
    await expect(page).toHaveTitle(/Encomende online/);
    await page.screenshot({ path: `${SHOT_DIR}/01-public-food.png`, fullPage: true });
  });

  test("fluxo completo de encomenda ate o WhatsApp", async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/app/#/b/tortas-da-maria`);
    await page.getByRole("button", { name: /Fazer encomenda/ }).first().click();

    // Wizard com passos renomeados
    await expect(page.locator(".modal-head h3")).toHaveText("Fazer encomenda");
    await expect(page.locator(".booking-steps")).toContainText("Produto");
    await expect(page.locator(".booking-steps")).toContainText("Preparo");
    await expect(page.locator("#bookStep h4")).toHaveText("Escolha o produto");
    // Produto não exibe duração em minutos
    await expect(page.locator("#bookStep .select-item .d").first()).toHaveText("Produtos");
    await page.screenshot({ path: `${SHOT_DIR}/02-step-produto.png` });

    await page.locator(".select-item", { hasText: "Torta de chocolate" }).click();
    await expect(page.locator("#bookStep h4")).toHaveText("Quem vai preparar seu pedido");
    await page.locator(".select-item", { hasText: "Maria Silva" }).click();

    await expect(page.locator("#bookStep h4")).toHaveText("Escolha o dia da entrega");
    await page.screenshot({ path: `${SHOT_DIR}/03-step-dia-entrega.png` });
    const tomorrow = await tomorrowISO(page);
    // Clica na data de amanhã pelo ISO (nth é frágil: à noite a pill de hoje fica desabilitada)
    await page.locator(`.date-pill[onclick*="${tomorrow}"]`).click();

    await expect(page.locator("#bookStep h4")).toHaveText("Escolha o horário de entrega");
    // Capacidade: 09-19h com intervalo de 1h => exatamente 10 horários, todos livres
    await expect(page.locator("#bookStep .slot")).toHaveCount(10);
    await expect(page.locator("#bookStep .slot:not([disabled])")).toHaveCount(10);
    await page.screenshot({ path: `${SHOT_DIR}/04-step-horarios-10.png` });
    await page.locator(".slot", { hasText: "09:00" }).click();

    await expect(page.locator("#bookStep h4")).toHaveText("Confirme seu pedido");
    await expect(page.locator(".booking-summary-card")).toContainText("Produto");
    await expect(page.locator(".booking-summary-card")).toContainText("Preparado por");
    await expect(page.locator(".booking-summary-card")).toContainText("Entrega");
    await expect(page.locator(".booking-contact-card")).toContainText("endereço de entrega pelo WhatsApp");
    await page.locator("#bk_name").fill("Cliente Teste");
    await page.locator("#bk_phone").fill("(11) 98888-7777");
    await page.screenshot({ path: `${SHOT_DIR}/05-step-confirmar.png` });
    await page.locator("#btn_confirm").click();

    await expect(page.locator(".booking-success h3")).toHaveText("Pedido reservado");
    const waHref = await page.locator(".booking-success a.btn-primary").getAttribute("href");
    const waText = decodeURIComponent(waHref || "");
    expect(waText).toContain("Acabei de fazer uma encomenda");
    expect(waText).toContain("Produto: Torta de chocolate");
    expect(waText).toContain("endereço de entrega");
    await page.screenshot({ path: `${SHOT_DIR}/06-pedido-reservado.png` });

    // Pedido aparece no banco como agendamento do tenant (dashboard lê daqui)
    const appt = await page.evaluate(() =>
      DB.scope("appointments", "shopF").map((a) => ({ name: a.customerName, time: a.time, status: a.status }))
    );
    expect(appt).toEqual([{ name: "Cliente Teste", time: "09:00", status: "confirmado" }]);
  });

  test("capacidade: 10 pedidos esgotam o dia", async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/app/#/b/tortas-da-maria`);
    const tomorrow = await tomorrowISO(page);
    // 9 pedidos já feitos: sobra apenas 09:00
    await page.evaluate((d) => {
      for (let h = 10; h <= 18; h++) {
        DB.insert("appointments", {
          barbershopId: "shopF", customerId: "cX", customerName: "Pedido " + h, phone: "1",
          serviceId: "svF1", barberId: "bF", date: d, time: String(h).padStart(2, "0") + ":00",
          status: "confirmado", price: 90, createdAt: Date.now(),
        });
      }
    }, tomorrow);

    await page.getByRole("button", { name: /Fazer encomenda/ }).first().click();
    await page.locator(".select-item", { hasText: "Torta de chocolate" }).click();
    await page.locator(".select-item", { hasText: "Maria Silva" }).click();
    await page.locator(`.date-pill[onclick*="${tomorrow}"]`).click();
    await expect(page.locator("#bookStep .slot:not([disabled])")).toHaveCount(1);
    await expect(page.locator("#bookStep .slot:not([disabled])")).toHaveText("09:00");
    await page.screenshot({ path: `${SHOT_DIR}/07-capacidade-1-restante.png` });

    // Reserva o último horário
    await page.locator(".slot", { hasText: "09:00" }).click();
    await page.locator("#bk_name").fill("Última Torta");
    await page.locator("#bk_phone").fill("(11) 97777-6666");
    await page.locator("#btn_confirm").click();
    await expect(page.locator(".booking-success h3")).toHaveText("Pedido reservado");
    await page.locator(".booking-success .btn-ghost").click();
    await expect(page.locator("#overlay")).not.toHaveClass(/open/);

    // Dia esgotado: amanhã fica desabilitado no calendário (botão do topbar, sempre visível)
    await page.locator(".pub-topbar .btn-primary").click();
    await page.locator(".select-item", { hasText: "Torta de chocolate" }).click();
    await page.locator(".select-item", { hasText: "Maria Silva" }).click();
    const disabled = await page.locator(`.date-pill[onclick*="${tomorrow}"]`).isDisabled();
    expect(disabled).toBe(true);
    await page.screenshot({ path: `${SHOT_DIR}/08-dia-esgotado.png` });
  });

  test("antecedencia minima: datas liberadas so a partir do dia seguinte", async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/app/#/b/tortas-da-maria`);
    await page.evaluate(() => DB.update("barbershops", "shopF", { orderLeadDays: 1 }));
    const today = await page.evaluate(() => DB.todayISO());
    const tomorrow = await tomorrowISO(page);

    await page.getByRole("button", { name: /Fazer encomenda/ }).first().click();
    await page.locator(".select-item", { hasText: "Torta de chocolate" }).click();
    await page.locator(".select-item", { hasText: "Maria Silva" }).click();

    // Aviso de antecedência + primeira data é amanhã (hoje não aparece)
    await expect(page.locator("#bookStep")).toContainText("1 dia de antecedência");
    const firstPill = await page.locator(".date-pill").first().getAttribute("onclick");
    expect(firstPill).toContain(tomorrow);
    expect(firstPill).not.toContain(today);
    await expect(page.locator(".date-pill")).toHaveCount(14);
    await page.screenshot({ path: `${SHOT_DIR}/12-antecedencia-minima.png` });

    // Pedido para amanhã segue funcionando normalmente
    await page.locator(".date-pill:not([disabled])").first().click();
    await page.locator(".slot", { hasText: "09:00" }).click();
    await page.locator("#bk_name").fill("Cliente Antecedência");
    await page.locator("#bk_phone").fill("(11) 96666-5555");
    await page.locator("#btn_confirm").click();
    await expect(page.locator(".booking-success h3")).toHaveText("Pedido reservado");
    const appt = await page.evaluate(() =>
      DB.scope("appointments", "shopF").map((a) => ({ date: a.date, time: a.time }))
    );
    expect(appt).toEqual([{ date: tomorrow, time: "09:00" }]);
  });

  test("regressao: barbearia mantem vocabulario de agendamento", async ({ page, baseURL }) => {
    // Seed demo não tem campo category; define como barbearia para validar o mapeamento
    await page.evaluate(() => DB.update("barbershops", "shop1", { category: "barbershop" }));
    await page.goto(`${baseURL}/app/#/b/barbearia-do-joao`);
    await expect(page.locator(".pub-kicker")).toHaveText("Barbearia");
    await expect(page.locator(".pub-section-head h2").first()).toHaveText("Serviços");
    await expect(page.getByRole("button", { name: /Agendar horário/ })).toBeVisible();
    await expect(page.locator(".pub-service-foot small").first()).toContainText("min");
    await page.getByRole("button", { name: /Agendar horário/ }).first().click();
    await expect(page.locator(".modal-head h3")).toHaveText("Agendar horário");
    await expect(page.locator("#bookStep h4")).toHaveText("Escolha o serviço");
    await expect(page.locator("#bookStep .select-item .d").first()).toContainText("min");
    await page.screenshot({ path: `${SHOT_DIR}/09-regressao-barbearia.png` });
  });

  test("lava rapido usa vocabulario padrao de agendamento", async ({ page, baseURL }) => {
    await page.evaluate(() => {
      DB.insert("barbershops", {
        id: "shopW", slug: "lava-jato-do-ze", name: "Lava Jato do Zé", ownerName: "Zé",
        category: "car-wash", description: "", address: "Av. Central, 500", city: "São Paulo",
        neighborhood: "", phone: "(11) 3333-8000", whatsapp: "(11) 99999-8000", email: "ze@lava.com",
        instagram: "", open: "08:00", close: "18:00", lunchStart: "12:00", lunchEnd: "13:00",
        planId: "monthly", status: "active", rating: 5, createdAt: Date.now(), slotInterval: 30,
      });
      DB.insert("barbers", {
        id: "bW", barbershopId: "shopW", name: "Zé", role: "Esteticista automotivo", bio: "",
        phone: "", email: "", specialties: [], commission: 0, start: "08:00", end: "18:00",
        lunchStart: "12:00", lunchEnd: "13:00", days: [1, 2, 3, 4, 5, 6], vacations: [],
        active: true, rating: 5,
      });
      DB.insert("services", {
        id: "svW1", barbershopId: "shopW", name: "Lavagem completa", desc: "",
        price: 80, duration: 60, category: "Serviços", icon: "droplet", active: true,
      });
    });
    await page.goto(`${baseURL}/app/#/b/lava-jato-do-ze`);
    await expect(page.locator(".pub-kicker")).toHaveText("Lava rápido & automotivo");
    await expect(page.locator(".pub-section-head h2").first()).toHaveText("Serviços");
    await page.getByRole("button", { name: /Agendar horário/ }).first().click();
    await expect(page.locator(".modal-head h3")).toHaveText("Agendar horário");
    await expect(page.locator("#bookStep h4")).toHaveText("Escolha o serviço");
    await page.screenshot({ path: `${SHOT_DIR}/11-lava-rapido.png` });
  });

  test("onboarding oferece as categorias Alimentos e Lava rapido", async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/app/#/`);
    const cats = await page.evaluate(() => ONB_CATEGORIES.map((c) => c.id + ":" + c.label));
    expect(cats).toContain("food:Alimentos");
    expect(cats).toContain("car-wash:Lava rápido & automotivo");
    // Renderiza o passo real de categoria do onboarding e confere o card
    await page.evaluate(() => {
      openOnboarding("trial");
      onbStep = 2;
      onbRefreshContent();
    });
    await expect(page.locator(".onb-category", { hasText: "Alimentos" })).toBeVisible();
    await expect(page.locator(".onb-category", { hasText: "Lava rápido & automotivo" })).toBeVisible();
    await page.locator(".onb-category", { hasText: "Lava rápido & automotivo" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOT_DIR}/10-onboarding-categorias.png` });
  });
});
