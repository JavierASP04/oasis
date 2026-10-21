const KEY = "oasis-admin-key";
const METHODS = { bcv: "BCV", efectivo: "Efectivo", usdt: "USDT" };
const ERRORS = {
  datos: "Revisa el nombre y la forma de pago.",
  cantidad: "La cantidad tiene que ser entre 1 y 20.",
  cuotas: "Indica entre 2 y 24 cuotas.",
  perfume: "Elige un perfume del catálogo.",
  monto: "Escribe un monto válido.",
  saldo: "Ese abono pasa el saldo pendiente.",
  venta: "No encontré esa venta.",
  pagado: "El total no puede ser menor de lo ya cobrado.",
  plan: "Las cuotas tienen que sumar el total.",
};

const gate = document.getElementById("gate");
const desk = document.getElementById("desk");
const form = document.getElementById("sale");
const productSelect = form.productId;
const productSearch = document.getElementById("product-search");
const planFields = document.getElementById("plan-fields");
const plan = document.getElementById("plan");
const total = document.getElementById("total");
const catalogPrice = document.getElementById("catalog-price");
const status = document.getElementById("sale-status");
const salesBox = document.getElementById("sales");
const empty = document.getElementById("empty");
const find = document.getElementById("find");

let products = [];
let sales = [];
let filter = "todas";

function money(value) {
  return `$${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)}`;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function norm(value) {
  return String(value || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function when(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("es-VE", { dateStyle: "medium", timeStyle: "short" });
}

function cents(value) {
  return Math.round((Number(value) || 0) * 100);
}

function parts(amount, count) {
  const totalCents = cents(amount);
  const base = Math.floor(totalCents / count);
  const extra = totalCents % count;
  return Array.from({ length: count }, (_, index) => (base + (index < extra ? 1 : 0)) / 100);
}

function planInputs(amounts, firstNow) {
  return amounts.map((part, index) => `
    <li>
      <label>Cuota ${index + 1}${index === 0 && firstNow ? " · ahora" : ""}
        <input data-part="${index}" type="number" min="0.01" step="0.01" inputmode="decimal" value="${part.toFixed(2)}" required>
      </label>
    </li>
  `).join("");
}

function readParts(container) {
  return [...container.querySelectorAll("[data-part]")].map((input) => Number(input.value));
}

function balanceLastPart(container, totalValue) {
  const inputs = [...container.querySelectorAll("[data-part]")];
  if (inputs.length < 2) return true;
  const used = inputs.slice(0, -1).reduce((sum, input) => sum + cents(input.value), 0);
  const rest = cents(totalValue) - used;
  inputs[inputs.length - 1].value = (rest / 100).toFixed(2);
  return rest > 0;
}

function partsMatch(container, totalValue) {
  const sum = readParts(container).reduce((sum, part) => sum + cents(part), 0);
  return sum === cents(totalValue);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const key = sessionStorage.getItem(KEY);
  if (key) headers["X-Admin-Key"] = key;
  if (options.body) headers["Content-Type"] = "application/json";
  const response = await fetch(path, { ...options, headers, cache: "no-store" });
  if (response.status === 401) throw new Error("auth");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "request");
  return data;
}

function selectedProduct() {
  return products.find((product) => product.id === productSelect.value);
}

function fillProducts() {
  const query = norm(productSearch.value.trim());
  const current = productSelect.value;
  const list = products.filter((product) => {
    if (!query) return true;
    return norm(`${product.brand} ${product.name}`).includes(query);
  });
  productSelect.innerHTML = `<option value="">Elige un perfume</option>${list.map((product) => `
    <option value="${esc(product.id)}">${esc(product.brand)} · ${esc(product.name)} · ${esc(money(product.price))}</option>
  `).join("")}`;
  if (list.some((product) => product.id === current)) productSelect.value = current;
  else productSelect.value = "";
  if (productSelect.value !== current) applyCatalogPrice();
}

function saleTotal() {
  return Number(form.total.value) || 0;
}

function applyCatalogPrice() {
  const product = selectedProduct();
  if (!product) {
    form.price.value = "";
    form.total.value = "";
    catalogPrice.textContent = "";
    plan.innerHTML = "";
    total.innerHTML = "";
    return;
  }
  catalogPrice.textContent = `En el catálogo: ${money(product.price)}`;
  form.price.value = Number(product.price).toFixed(2);
  syncTotalFromPrice();
}

function syncTotalFromPrice() {
  const price = Number(form.price.value);
  const qty = Number(form.qty.value) || 0;
  if (price > 0 && qty > 0) form.total.value = (cents(price * qty) / 100).toFixed(2);
  rebuildPlan();
  paintSummary();
}

function syncPriceFromTotal() {
  const amount = Number(form.total.value);
  const qty = Number(form.qty.value) || 0;
  if (amount > 0 && qty > 0) form.price.value = (amount / qty).toFixed(2);
  rebuildPlan();
  paintSummary();
}

function rebuildPlan() {
  const cuotas = form.mode.value === "cuotas";
  planFields.hidden = !cuotas;
  const amount = saleTotal();
  if (!cuotas || amount <= 0) {
    plan.innerHTML = "";
    return;
  }
  const count = Math.min(24, Math.max(2, Number(form.installments.value) || 2));
  plan.innerHTML = planInputs(parts(amount, count), form.collectFirst.checked);
}

function paintSummary() {
  const product = selectedProduct();
  const amount = saleTotal();
  if (!product || amount <= 0) {
    total.innerHTML = "";
    return;
  }
  if (form.mode.value !== "cuotas") {
    total.innerHTML = `<span><small>Total</small><b>${esc(money(amount))}</b></span>`;
    return;
  }
  const inputs = [...plan.querySelectorAll("[data-part]")];
  const paidNow = form.collectFirst.checked && inputs[0] ? Number(inputs[0].value) || 0 : 0;
  total.innerHTML = `
    <span><small>Total</small><b>${esc(money(amount))}</b></span>
    <span><small>Hoy</small><b>${esc(money(paidNow))}</b></span>
    <span><small>Queda</small><b>${esc(money(amount - paidNow))}</b></span>
  `;
}

function visibleSales() {
  const query = norm(find.value.trim());
  return sales.filter((sale) => {
    if (filter === "cobrar" && sale.balance <= 0) return false;
    if (filter === "cuotas" && sale.mode !== "cuotas") return false;
    if (filter === "contado" && sale.mode === "cuotas") return false;
    if (!query) return true;
    return norm(`${sale.name} ${sale.brand} ${sale.product}`).includes(query);
  });
}

function renderStats() {
  const due = sales.reduce((sum, sale) => sum + (Number(sale.balance) || 0), 0);
  const paid = sales.reduce((sum, sale) => sum + (Number(sale.paid) || 0), 0);
  document.getElementById("stat-due").textContent = money(due);
  document.getElementById("stat-paid").textContent = money(paid);
  document.getElementById("stat-count").textContent = String(sales.length);
}

function renderSales() {
  const list = visibleSales();
  empty.hidden = list.length > 0;
  salesBox.innerHTML = list.map((sale) => {
    const open = sale.balance > 0.009;
    const ratio = sale.total ? Math.min(100, (sale.paid / sale.total) * 100) : 0;
    const abonos = sale.payments.length === 1 ? "1 abono" : `${sale.payments.length} abonos`;
    const planAmounts = sale.plan?.length
      ? sale.plan
      : parts(sale.total, sale.mode === "cuotas" ? sale.installments : 1);
    const next = planAmounts[Math.min(sale.payments.length, planAmounts.length - 1)];
    const suggested = open ? Math.min(sale.balance, Number(next) || sale.balance) : 0;
    return `
      <article class="sale">
        <div class="sale-head">
          <h3>${esc(sale.name)}</h3>
          <span class="badge ${open ? "due" : "ok"}">${open ? "Por cobrar" : "Pagada"}</span>
        </div>
        <p class="meta">${esc(sale.brand)} ${esc(sale.product)} · ${esc(sale.qty)} u. · ${esc(money(sale.price))} c/u</p>
        <p class="meta">Total ${esc(money(sale.total))}${sale.mode === "cuotas" ? ` · ${sale.installments} cuotas · ${abonos}` : " · Al contado"} · ${esc(when(sale.at))}</p>
        ${sale.notes ? `<p class="meta">${esc(sale.notes)}</p>` : ""}
        <div class="bar" aria-hidden="true"><span style="width:${ratio}%"></span></div>
        <p class="meta">Cobrado ${esc(money(sale.paid))} · Saldo ${esc(money(sale.balance))}</p>
        ${sale.payments.length ? `<ul class="payments">${sale.payments.map((payment, index) => `
          <li><span>${sale.mode === "cuotas" ? `Cuota ${index + 1}` : "Pago"} · ${esc(METHODS[payment.method] || payment.method)}${payment.note && payment.note !== `Cuota ${index + 1}` ? ` · ${esc(payment.note)}` : ""}</span><b>${esc(money(payment.amount))}</b></li>
        `).join("")}</ul>` : ""}
        <button type="button" class="ghost edit-toggle" data-toggle-edit="${esc(sale.id)}">Editar precio y cuotas</button>
        <form class="edit" data-edit="${esc(sale.id)}" data-qty="${esc(sale.qty)}" data-paid="${sale.paid}" data-mode="${esc(sale.mode)}" hidden>
          <div class="split">
            <label>Precio unitario <input name="price" type="number" min="0.01" step="0.01" inputmode="decimal" value="${Number(sale.price).toFixed(2)}" required></label>
            <label>Total <input name="total" type="number" min="0.01" step="0.01" inputmode="decimal" value="${Number(sale.total).toFixed(2)}" required></label>
          </div>
          ${sale.mode === "cuotas" ? `
            <label>Número de cuotas <input name="installments" type="number" min="2" max="24" value="${sale.installments}" required></label>
            <ol class="plan">${planInputs(planAmounts, false)}</ol>
            <p class="plan-sum hint"></p>
          ` : ""}
          <button type="submit">Guardar cambios</button>
          <p class="edit-status hint"></p>
        </form>
        ${open ? `
          <form class="pay" data-pay="${esc(sale.id)}">
            <div class="split">
              <label>Abono <input name="amount" type="number" min="0.01" max="${sale.balance}" step="0.01" value="${suggested.toFixed(2)}" required oninput="this.setCustomValidity('')" oninvalid="this.setCustomValidity('Ese abono pasa el saldo pendiente.')"></label>
              <label>Método
                <select name="method">
                  <option value="bcv">BCV</option>
                  <option value="efectivo">Efectivo</option>
                  <option value="usdt">USDT</option>
                </select>
              </label>
            </div>
            <label>Nota <input name="note" maxlength="200" placeholder="Referencia del abono"></label>
            <button type="submit">Registrar cuota</button>
          </form>` : ""}
        <button type="button" class="danger" data-remove="${esc(sale.id)}">Quitar venta</button>
      </article>
    `;
  }).join("");
}

async function loadDesk() {
  const catalog = await fetch("/api/catalog", { cache: "no-store" }).then((response) => response.json());
  products = Array.isArray(catalog) ? catalog : [];
  fillProducts();
  sales = await api("/api/admin/sales");
  if (!Array.isArray(sales)) sales = [];
  renderStats();
  renderSales();
  if (!form.price.value) applyCatalogPrice();
  else paintSummary();
}

function openDesk() {
  gate.hidden = true;
  desk.hidden = false;
  return loadDesk();
}

document.getElementById("login").addEventListener("submit", async (event) => {
  event.preventDefault();
  const loginStatus = document.getElementById("login-status");
  sessionStorage.setItem(KEY, document.getElementById("password").value);
  try {
    await api("/api/admin/check");
    loginStatus.textContent = "";
    await openDesk();
  } catch {
    sessionStorage.removeItem(KEY);
    loginStatus.textContent = "Contraseña incorrecta.";
  }
});

document.getElementById("method-choices").addEventListener("click", (event) => {
  const button = event.target.closest("[data-method]");
  if (!button) return;
  form.method.value = button.dataset.method;
  for (const item of event.currentTarget.querySelectorAll("button")) {
    item.setAttribute("aria-pressed", String(item === button));
  }
});

document.getElementById("mode-choices").addEventListener("click", (event) => {
  const button = event.target.closest("[data-mode]");
  if (!button) return;
  form.mode.value = button.dataset.mode;
  for (const item of event.currentTarget.querySelectorAll("button")) {
    item.setAttribute("aria-pressed", String(item === button));
  }
  rebuildPlan();
  paintSummary();
});

document.getElementById("filters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  filter = button.dataset.filter;
  for (const item of event.currentTarget.querySelectorAll("button")) {
    item.setAttribute("aria-pressed", String(item === button));
  }
  renderSales();
});

productSearch.addEventListener("input", () => {
  fillProducts();
  paintSummary();
});
form.productId.addEventListener("change", applyCatalogPrice);
form.qty.addEventListener("input", syncTotalFromPrice);
form.price.addEventListener("input", syncTotalFromPrice);
form.total.addEventListener("input", syncPriceFromTotal);
form.installments.addEventListener("input", () => {
  rebuildPlan();
  paintSummary();
});
form.collectFirst.addEventListener("change", () => {
  const label = plan.querySelector("label");
  if (label?.firstChild) {
    label.firstChild.textContent = form.collectFirst.checked ? "Cuota 1 · ahora" : "Cuota 1";
  }
  paintSummary();
});
plan.addEventListener("input", (event) => {
  const input = event.target.closest("[data-part]");
  if (!input) return;
  const inputs = [...plan.querySelectorAll("[data-part]")];
  if (input !== inputs[inputs.length - 1]) balanceLastPart(plan, saleTotal());
  paintSummary();
});

function markEditSum(edit) {
  const note = edit.querySelector(".plan-sum");
  const box = edit.querySelector(".plan");
  if (!note || !box) return;
  note.textContent = partsMatch(box, Number(edit.total.value) || 0) ? "" : "Las cuotas no suman el total.";
}

function rewriteEditPlan(edit) {
  const box = edit.querySelector(".plan");
  if (!box) return;
  const count = Math.min(24, Math.max(2, Number(edit.installments.value) || 2));
  box.innerHTML = planInputs(parts(Number(edit.total.value) || 0, count), false);
  markEditSum(edit);
}

salesBox.addEventListener("input", (event) => {
  const edit = event.target.closest("[data-edit]");
  if (!edit) return;
  const qty = Number(edit.dataset.qty) || 1;
  if (event.target.name === "price") {
    const price = Number(edit.price.value);
    if (price > 0) edit.total.value = (cents(price * qty) / 100).toFixed(2);
    rewriteEditPlan(edit);
    return;
  }
  if (event.target.name === "total" || event.target.name === "installments") {
    if (event.target.name === "total") {
      const amount = Number(edit.total.value);
      if (amount > 0) edit.price.value = (amount / qty).toFixed(2);
    }
    rewriteEditPlan(edit);
    return;
  }
  if (event.target.closest("[data-part]")) {
    const inputs = [...edit.querySelectorAll("[data-part]")];
    if (event.target !== inputs[inputs.length - 1]) balanceLastPart(edit.querySelector(".plan"), Number(edit.total.value));
    markEditSum(edit);
  }
});

async function saveEdit(edit) {
  const message = edit.querySelector(".edit-status");
  const amount = Number(edit.total.value);
  const paid = Number(edit.dataset.paid) || 0;
  if (!(amount > 0) || !(Number(edit.price.value) > 0)) {
    message.textContent = ERRORS.monto;
    return;
  }
  if (cents(amount) < cents(paid)) {
    message.textContent = ERRORS.pagado;
    return;
  }
  const cuotas = edit.dataset.mode === "cuotas";
  const box = edit.querySelector(".plan");
  if (cuotas && box && !partsMatch(box, amount)) {
    message.textContent = ERRORS.plan;
    return;
  }
  message.textContent = "Guardando…";
  try {
    await api("/api/admin/sales/editar", {
      method: "POST",
      body: JSON.stringify({
        saleId: edit.dataset.edit,
        price: Number(edit.price.value),
        total: amount,
        installments: cuotas ? Number(edit.installments.value) : 1,
        plan: cuotas && box ? readParts(box) : undefined,
      }),
    });
    status.textContent = "Venta actualizada.";
    await loadDesk();
  } catch (error) {
    message.textContent = ERRORS[error.message] || "No se pudo actualizar la venta.";
  }
}
find.addEventListener("input", renderSales);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "Guardando…";
  const amount = saleTotal();
  if (!selectedProduct() || amount <= 0) {
    status.textContent = "Elige un perfume y un precio.";
    return;
  }
  if (form.mode.value === "cuotas" && !partsMatch(plan, amount)) {
    status.textContent = ERRORS.plan;
    return;
  }
  const body = {
    name: form.name.value.trim(),
    productId: form.productId.value,
    qty: Number(form.qty.value),
    price: Number(form.price.value),
    total: amount,
    method: form.method.value,
    mode: form.mode.value,
    installments: Number(form.installments.value),
    plan: form.mode.value === "cuotas" ? readParts(plan) : undefined,
    collectFirst: form.collectFirst.checked,
    notes: form.notes.value.trim(),
  };
  try {
    await api("/api/admin/sales", { method: "POST", body: JSON.stringify(body) });
    form.name.value = "";
    form.notes.value = "";
    form.qty.value = "1";
    form.price.value = "";
    status.textContent = "Venta registrada.";
    await loadDesk();
    applyCatalogPrice();
  } catch (error) {
    status.textContent = ERRORS[error.message] || "No se pudo registrar la venta.";
  }
});

salesBox.addEventListener("submit", async (event) => {
  const edit = event.target.closest("[data-edit]");
  if (edit) {
    event.preventDefault();
    await saveEdit(edit);
    return;
  }
  const payForm = event.target.closest("[data-pay]");
  if (!payForm) return;
  event.preventDefault();
  status.textContent = "";
  try {
    await api("/api/admin/sales/pago", {
      method: "POST",
      body: JSON.stringify({
        saleId: payForm.dataset.pay,
        amount: Number(payForm.amount.value),
        method: payForm.method.value,
        note: payForm.note.value.trim(),
      }),
    });
    await loadDesk();
  } catch (error) {
    status.textContent = ERRORS[error.message] || "No se pudo registrar la cuota.";
  }
});

salesBox.addEventListener("click", async (event) => {
  const toggle = event.target.closest("[data-toggle-edit]");
  if (toggle) {
    const edit = salesBox.querySelector(`[data-edit="${CSS.escape(toggle.dataset.toggleEdit)}"]`);
    if (edit) edit.hidden = !edit.hidden;
    return;
  }
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  if (!confirm("¿Quitar esta venta del registro?")) return;
  try {
    await api("/api/admin/sales", { method: "DELETE", body: JSON.stringify({ id: button.dataset.remove }) });
    await loadDesk();
  } catch {
    status.textContent = "No se pudo quitar la venta.";
  }
});

if (sessionStorage.getItem(KEY)) {
  api("/api/admin/check").then(openDesk).catch(() => sessionStorage.removeItem(KEY));
}
