const KEY = "oasis-admin-key";
const METHODS = { bcv: "BCV", efectivo: "Efectivo", usdt: "USDT" };
const ERRORS = {
  datos: "Revisa el nombre y la forma de pago.",
  cantidad: "La cantidad tiene que ser entre 1 y 20.",
  cuotas: "Indica entre 2 y 24 cuotas.",
  perfume: "Elige un perfume del catálogo.",
};

const gate = document.getElementById("gate");
const desk = document.getElementById("desk");
const form = document.getElementById("sale");
const productSelect = form.productId;
const installmentsField = document.getElementById("installments-field");
const total = document.getElementById("total");
const status = document.getElementById("sale-status");
const salesBox = document.getElementById("sales");
const empty = document.getElementById("empty");

let products = [];

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

function refreshTotal() {
  const product = selectedProduct();
  const qty = Number(form.qty.value) || 0;
  installmentsField.hidden = form.mode.value !== "cuotas";
  if (!product || qty < 1) {
    total.textContent = "";
    return;
  }
  const amount = product.price * qty;
  if (form.mode.value === "cuotas") {
    const parts = Number(form.installments.value) || 0;
    const each = parts >= 2 ? amount / parts : 0;
    total.textContent = parts >= 2
      ? `Total ${money(amount)} · ${parts} cuotas de ${money(each)}`
      : `Total ${money(amount)}`;
    return;
  }
  total.textContent = `Total ${money(amount)}`;
}

function renderSales(sales) {
  empty.hidden = sales.length > 0;
  salesBox.innerHTML = sales.map((sale) => {
    const when = new Date(sale.at).toLocaleString("es-VE", { dateStyle: "medium", timeStyle: "short" });
    const pay = METHODS[sale.method] || sale.method;
    const mode = sale.mode === "cuotas" ? `${sale.installments} cuotas` : "Al contado";
    return `
      <article class="sale">
        <div class="row">
          <strong>${esc(sale.name)}</strong>
          <b>${esc(money(sale.total))}</b>
        </div>
        <p>${esc(sale.brand)} ${esc(sale.product)} · ${esc(sale.qty)} × ${esc(money(sale.price))}</p>
        <p>${esc(pay)} · ${esc(mode)} · ${esc(when)}</p>
        ${sale.notes ? `<p>${esc(sale.notes)}</p>` : ""}
        <button type="button" class="danger" data-remove="${esc(sale.id)}">Quitar</button>
      </article>
    `;
  }).join("");
}

async function loadDesk() {
  const catalog = await fetch("/api/catalog", { cache: "no-store" }).then((response) => response.json());
  products = Array.isArray(catalog) ? catalog : [];
  const current = productSelect.value;
  productSelect.innerHTML = `<option value="">Elige un perfume</option>${products.map((product) => `
    <option value="${esc(product.id)}">${esc(product.brand)} · ${esc(product.name)} · ${esc(money(product.price))}</option>
  `).join("")}`;
  if (current) productSelect.value = current;
  const sales = await api("/api/admin/sales");
  renderSales(Array.isArray(sales) ? sales : []);
  refreshTotal();
}

async function openDesk() {
  gate.hidden = true;
  desk.hidden = false;
  await loadDesk();
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

form.mode.addEventListener("change", refreshTotal);
form.qty.addEventListener("input", refreshTotal);
form.installments.addEventListener("input", refreshTotal);
productSelect.addEventListener("change", refreshTotal);

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
    notes: form.notes.value.trim(),
  };
  try {
    await api("/api/admin/sales", { method: "POST", body: JSON.stringify(body) });
    form.name.value = "";
    form.notes.value = "";
    form.qty.value = "1";
    form.mode.value = "contado";
    status.textContent = "Venta registrada.";
    await loadDesk();
  } catch (error) {
    status.textContent = ERRORS[error.message] || "No se pudo registrar la venta.";
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
