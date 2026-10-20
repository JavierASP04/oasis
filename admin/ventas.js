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
};

const gate = document.getElementById("gate");
const desk = document.getElementById("desk");
const form = document.getElementById("sale");
const productSelect = form.productId;
const productSearch = document.getElementById("product-search");
const planFields = document.getElementById("plan-fields");
const plan = document.getElementById("plan");
const total = document.getElementById("total");
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

function parts(amount, count) {
  const cents = Math.round(amount * 100);
  const base = Math.floor(cents / count);
  const extra = cents % count;
  return Array.from({ length: count }, (_, index) => (base + (index < extra ? 1 : 0)) / 100);
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
}

function refreshTicket() {
  const cuotas = form.mode.value === "cuotas";
  planFields.hidden = !cuotas;
  const product = selectedProduct();
  const qty = Number(form.qty.value) || 0;
  if (!product || qty < 1) {
    total.textContent = "";
    plan.innerHTML = "";
    return;
  }
  const amount = product.price * qty;
  if (!cuotas) {
    total.innerHTML = `<span><small>Total</small><b>${esc(money(amount))}</b></span>`;
    plan.innerHTML = "";
    return;
  }
  const count = Math.min(24, Math.max(2, Number(form.installments.value) || 2));
  const amounts = parts(amount, count);
  const firstNow = form.collectFirst.checked;
  plan.innerHTML = amounts.map((part, index) => `
    <li><span>Cuota ${index + 1}${index === 0 && firstNow ? " · se cobra ahora" : ""}</span><b>${esc(money(part))}</b></li>
  `).join("");
  const paidNow = firstNow ? amounts[0] : 0;
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
    const mode = sale.mode === "cuotas" ? `${sale.installments} cuotas` : "Al contado";
    const next = sale.plan?.length
      ? sale.plan[Math.min(sale.payments.length, sale.plan.length - 1)]
      : sale.balance;
    const suggested = open ? Math.min(sale.balance, Number(next) || sale.balance) : 0;
    return `
      <article class="sale">
        <div class="sale-head">
          <h3>${esc(sale.name)}</h3>
          <span class="badge ${open ? "due" : "ok"}">${open ? "Por cobrar" : "Pagada"}</span>
        </div>
        <p class="meta">${esc(sale.brand)} ${esc(sale.product)} · ${esc(sale.qty)} × ${esc(money(sale.price))}</p>
        <p class="meta">${esc(mode)}${sale.mode === "cuotas" ? ` · ${sale.payments.length} de ${sale.installments} cobradas` : ""} · ${esc(when(sale.at))}</p>
        ${sale.notes ? `<p class="meta">${esc(sale.notes)}</p>` : ""}
        <div class="bar" aria-hidden="true"><span style="width:${ratio}%"></span></div>
        <p class="meta">Cobrado ${esc(money(sale.paid))} · Saldo ${esc(money(sale.balance))}</p>
        ${sale.payments.length ? `<ul class="payments">${sale.payments.map((payment, index) => `
          <li><span>${sale.mode === "cuotas" ? `Cuota ${index + 1}` : "Pago"} · ${esc(METHODS[payment.method] || payment.method)}${payment.note && payment.note !== `Cuota ${index + 1}` ? ` · ${esc(payment.note)}` : ""}</span><b>${esc(money(payment.amount))}</b></li>
        `).join("")}</ul>` : ""}
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
  refreshTicket();
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
  refreshTicket();
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
  refreshTicket();
});
form.productId.addEventListener("change", refreshTicket);
form.qty.addEventListener("input", refreshTicket);
form.installments.addEventListener("input", refreshTicket);
form.collectFirst.addEventListener("change", refreshTicket);
find.addEventListener("input", renderSales);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "Guardando…";
  const body = {
    name: form.name.value.trim(),
    productId: form.productId.value,
    qty: Number(form.qty.value),
    method: form.method.value,
    mode: form.mode.value,
    installments: Number(form.installments.value),
    collectFirst: form.collectFirst.checked,
    notes: form.notes.value.trim(),
  };
  try {
    await api("/api/admin/sales", { method: "POST", body: JSON.stringify(body) });
    form.name.value = "";
    form.notes.value = "";
    form.qty.value = "1";
    status.textContent = "Venta registrada.";
    await loadDesk();
  } catch (error) {
    status.textContent = ERRORS[error.message] || "No se pudo registrar la venta.";
  }
});

salesBox.addEventListener("submit", async (event) => {
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
