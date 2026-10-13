const SHOP = {
  name: "Oasis",
  // Código de país + número, sin + ni espacios. Ejemplo: "34611222333"
  whatsapp: "584223087995",
  currency: "USD",
};

const FAMILIES = [
  ["todos", "Todos"],
  ["caballero", "Caballero"],
  ["dama", "Dama"],
  ["otros", "Otros"],
];

const money = {
  format(value) {
    const amount = new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
    return `$${amount}`;
  },
};

const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const resultCount = document.getElementById("result-count");
const search = document.getElementById("search");
const filters = document.getElementById("filters");
const overlay = document.getElementById("overlay");
const productEl = document.getElementById("product");
const productBody = document.getElementById("product-body");
const cartEl = document.getElementById("cart");
const cartLines = document.getElementById("cart-lines");
const checkout = document.getElementById("checkout");
const cartTotal = document.getElementById("cart-total");
const cartCount = document.getElementById("cart-count");
const checkoutBtn = document.getElementById("checkout-btn");
const checkoutStatus = document.getElementById("checkout-status");
const orderPreview = document.getElementById("order-preview");
const footContact = document.getElementById("foot-contact");
const live = document.getElementById("live");

let family = "todos";
let query = "";
let detailId = null;
let detailQty = 1;
let cart = loadCart();

const phoneDigits = String(SHOP.whatsapp).replace(/\D/g, "");

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function norm(value) {
  return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function findProduct(id) {
  return PRODUCTS.find((item) => item.id === id);
}

function photoSrc(product) {
  return product.image || `images/${product.id}.svg`;
}

function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem("oasis-cart") || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((item) => item && item.id && item.qty > 0);
  } catch {
    return [];
  }
}

function saveCart() {
  localStorage.setItem("oasis-cart", JSON.stringify(cart));
}

function cartQty() {
  return cart.reduce((sum, item) => sum + item.qty, 0);
}

function cartSum() {
  return cart.reduce((sum, item) => {
    const product = findProduct(item.id);
    return product ? sum + product.price * item.qty : sum;
  }, 0);
}

function addToCart(id, qty) {
  const product = findProduct(id);
  if (!product) return;
  const line = cart.find((item) => item.id === id);
  if (line) line.qty = Math.min(8, line.qty + qty);
  else cart.push({ id, qty: Math.min(8, qty) });
  saveCart();
  renderCart();
  live.textContent = `${product.name} añadido al carrito`;
}

function setQty(id, qty) {
  if (qty <= 0) cart = cart.filter((item) => item.id !== id);
  else {
    const line = cart.find((item) => item.id === id);
    if (line) line.qty = Math.min(8, qty);
  }
  saveCart();
  renderCart();
}

function visibleProducts() {
  const q = norm(query.trim());
  return PRODUCTS.filter((product) => {
    const familyOk = family === "todos" || product.family === family;
    const blob = norm(`${product.brand} ${product.name} ${product.accords}`);
    return familyOk && (!q || blob.includes(q));
  });
}

function renderFilters() {
  for (const button of filters.querySelectorAll("button")) {
    const key = button.dataset.family;
    const count = key === "todos"
      ? PRODUCTS.length
      : PRODUCTS.filter((product) => product.family === key).length;
    button.innerHTML = `${esc(FAMILIES.find(([id]) => id === key)?.[1] || "")} <span class="sr-only">${count}</span>`;
  }
}

function renderCatalog() {
  const items = visibleProducts();
  const noun = items.length === 1 ? "perfume" : "perfumes";
  resultCount.textContent = items.length ? `${items.length} ${noun}` : "";
  empty.hidden = items.length > 0;
  grid.innerHTML = items.map((product, index) => `
    <article class="card">
      <button type="button" class="card-open" data-open="${esc(product.id)}">
        <span class="photo"><img src="${esc(photoSrc(product))}" alt="Foto de ${esc(product.name)}" ${index < 4 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></span>
        <span class="card-copy">
          <span class="brand">${esc(product.brand)}</span>
          <h3>${esc(product.name)}</h3>
        </span>
      </button>
      <div class="card-row">
        <span class="price">${esc(money.format(product.price))}</span>
        <button type="button" class="add" data-add="${esc(product.id)}">Añadir</button>
      </div>
    </article>
  `).join("");
}

function renderProduct() {
  const product = findProduct(detailId);
  if (!product) return;
  const familyLabel = FAMILIES.find(([id]) => id === product.family)?.[1] || "";
  productBody.innerHTML = `
    <div class="sheet-photo">
      <img src="${esc(photoSrc(product))}" alt="Foto de ${esc(product.name)}" decoding="async">
      <button type="button" class="sheet-close" id="close-product">Cerrar</button>
    </div>
    <div class="sheet-body">
    <p class="brand">${esc(product.brand)}</p>
    <h2 id="product-title">${esc(product.name)}</h2>
    <p class="meta">
      <span>${esc(product.size)}</span>
      <span>${esc(familyLabel)}</span>
    </p>
    <p class="summary">${esc(product.summary)}</p>
    <dl class="pyramid">
      ${product.notes.map(([label, value]) => `
        <div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>
      `).join("")}
    </dl>
    <div class="buy">
      <div class="stepper" aria-label="Cantidad">
        <button type="button" data-detail-step="-1" aria-label="Quitar uno">−</button>
        <span id="detail-qty">${detailQty}</span>
        <button type="button" data-detail-step="1" aria-label="Sumar uno">+</button>
      </div>
      <button type="button" class="btn btn-solid" id="detail-add">Añadir · ${esc(money.format(product.price * detailQty))}</button>
    </div>
    </div>
  `;
}

function renderCart() {
  checkoutStatus.textContent = "";
  orderPreview.hidden = true;
  const count = cartQty();
  cartCount.hidden = count === 0;
  cartCount.textContent = count ? String(count) : "";
  document.getElementById("open-cart").setAttribute("aria-label", count ? `Carrito, ${count}` : "Carrito");
  cartTotal.textContent = money.format(cartSum());
  checkout.hidden = cart.length === 0;

  if (!cart.length) {
    cartLines.innerHTML = `<p class="cart-empty">El carrito está vacío.</p>`;
    return;
  }

  cartLines.innerHTML = cart.map((item) => {
    const product = findProduct(item.id);
    if (!product) return "";
    return `
      <article class="line">
        <img class="thumb" src="${esc(photoSrc(product))}" alt="" loading="lazy" decoding="async">
        <div>
          <div class="line-top">
            <h3>${esc(product.name)}</h3>
            <span class="amount">${esc(money.format(product.price * item.qty))}</span>
          </div>
          <p class="accords">${esc(product.brand)} · ${esc(product.size)}</p>
          <div class="line-actions">
            <div class="stepper">
              <button type="button" data-qty="${esc(item.id)}" data-delta="-1" aria-label="Quitar uno de ${esc(product.name)}">−</button>
              <span>${item.qty}</span>
              <button type="button" data-qty="${esc(item.id)}" data-delta="1" aria-label="Sumar uno de ${esc(product.name)}">+</button>
            </div>
            <button type="button" class="quiet" data-remove="${esc(item.id)}">Quitar</button>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function openCart() {
  closeProduct();
  cartEl.hidden = false;
  overlay.hidden = false;
  document.body.classList.add("lock");
  cartEl.setAttribute("aria-hidden", "false");
  document.getElementById("close-cart").focus();
}

function closeCart() {
  cartEl.hidden = true;
  overlay.hidden = true;
  document.body.classList.remove("lock");
  cartEl.setAttribute("aria-hidden", "true");
}

function openProduct(id) {
  closeCart();
  detailId = id;
  detailQty = 1;
  renderProduct();
  productEl.hidden = false;
  overlay.hidden = false;
  document.body.classList.add("lock");
  productEl.setAttribute("aria-hidden", "false");
  document.getElementById("close-product").focus();
}

function closeProduct() {
  productEl.hidden = true;
  productEl.setAttribute("aria-hidden", "true");
  if (cartEl.hidden) {
    overlay.hidden = true;
    document.body.classList.remove("lock");
  }
  detailId = null;
}

function orderText() {
  const lines = cart.map((item) => {
    const product = findProduct(item.id);
    if (!product) return "";
    return `• ${product.brand} ${product.name} (${product.size}) × ${item.qty} — ${money.format(product.price * item.qty)}`;
  }).filter(Boolean);
  return [
    `Hola, quiero hacer este pedido en ${SHOP.name}:`,
    "",
    ...lines,
    "",
    `Total: ${money.format(cartSum())}`,
  ].join("\n");
}

function setupContact() {
  if (!phoneDigits) {
    checkoutBtn.textContent = "Copiar pedido";
    return;
  }
  checkoutBtn.textContent = "Enviar por WhatsApp";
  footContact.innerHTML = `<a href="https://wa.me/${phoneDigits}" target="_blank" rel="noopener">WhatsApp</a>`;
}

document.addEventListener("click", (event) => {
  const add = event.target.closest("[data-add]");
  if (add) {
    addToCart(add.dataset.add, 1);
    const previous = add.textContent;
    add.textContent = "Añadido";
    window.setTimeout(() => { add.textContent = previous; }, 900);
    return;
  }

  const open = event.target.closest("[data-open]");
  if (open) {
    openProduct(open.dataset.open);
    return;
  }

  const step = event.target.closest("[data-detail-step]");
  if (step && detailId) {
    detailQty = Math.min(8, Math.max(1, detailQty + Number(step.dataset.detailStep)));
    renderProduct();
    return;
  }

  if (event.target.id === "detail-add" && detailId) {
    addToCart(detailId, detailQty);
    event.target.textContent = "Añadido";
    return;
  }

  if (event.target.id === "close-product") closeProduct();
});

filters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-family]");
  if (!button) return;
  family = button.dataset.family;
  for (const item of filters.querySelectorAll("button")) {
    item.setAttribute("aria-pressed", String(item === button));
  }
  renderCatalog();
});

search.addEventListener("input", () => {
  query = search.value;
  renderCatalog();
});

document.getElementById("open-cart").addEventListener("click", openCart);
document.getElementById("close-cart").addEventListener("click", closeCart);
overlay.addEventListener("click", () => {
  closeProduct();
  closeCart();
});

cartLines.addEventListener("click", (event) => {
  const qtyBtn = event.target.closest("[data-qty]");
  if (qtyBtn) {
    const line = cart.find((item) => item.id === qtyBtn.dataset.qty);
    if (line) setQty(line.id, line.qty + Number(qtyBtn.dataset.delta));
    return;
  }
  const remove = event.target.closest("[data-remove]");
  if (remove) setQty(remove.dataset.remove, 0);
});

checkout.addEventListener("submit", async (event) => {
  event.preventDefault();
  checkoutStatus.textContent = "";
  if (!cart.length) {
    checkoutStatus.textContent = "El carrito está vacío.";
    return;
  }
  const text = orderText();
  if (phoneDigits) {
    window.open(`https://wa.me/${phoneDigits}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    checkoutStatus.textContent = "Se abrió WhatsApp con el pedido.";
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    orderPreview.hidden = true;
    checkoutStatus.textContent = "Pedido copiado. Pégalo en WhatsApp.";
  } catch {
    orderPreview.hidden = false;
    orderPreview.value = text;
    checkoutStatus.textContent = "Selecciona el pedido de arriba y cópialo.";
    orderPreview.focus();
    orderPreview.select();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!productEl.hidden) closeProduct();
  else if (!cartEl.hidden) closeCart();
});

async function loadCatalog() {
  try {
    const response = await fetch("/api/catalog", { cache: "no-store" });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) return data;
    }
  } catch {
    /* La tienda sigue con products.js si el servidor no tiene catálogo. */
  }
  return null;
}

loadCatalog().then((data) => {
  if (data) PRODUCTS = data;
  renderFilters();
  renderCatalog();
  renderCart();
  setupContact();
});
