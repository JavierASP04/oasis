const KEY = "oasis-admin-key";
const FAMILIES = { caballero: "Caballero", dama: "Dama", otros: "Otros" };
const SIZES = ["50 ml", "75 ml", "90 ml", "100 ml", "105 ml"];

const gate = document.getElementById("gate");
const desk = document.getElementById("desk");
const listView = document.getElementById("list-view");
const editorView = document.getElementById("editor-view");
const productList = document.getElementById("product-list");
const editor = document.getElementById("editor");
const notesBox = document.getElementById("notes");
const preview = document.getElementById("preview");
const photoEmpty = document.getElementById("photo-empty");
const photoInput = document.getElementById("photo");
const photoDrop = document.getElementById("photo-drop");
const editorStatus = document.getElementById("editor-status");
const loginStatus = document.getElementById("login-status");
const find = document.getElementById("find");
const sortSelect = document.getElementById("sort");
const empty = document.getElementById("empty");
const shown = document.getElementById("shown");
const pricePreview = document.getElementById("price-preview");

let products = [];
let currentId = null;
let keptImage = "";
let pendingPhoto = null;
let filter = "todos";

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

function photoOf(product) {
  const src = product.image || `images/${product.id}.svg`;
  if (src.startsWith("data:") || src.startsWith("http") || src.startsWith("blob:")) return src;
  return `/${src.replace(/^\//, "")}`;
}

function slug(value) {
  const base = value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return base || "perfume";
}

function uniqueId(name) {
  let id = slug(name);
  let n = 2;
  while (products.some((product) => product.id === id)) {
    id = `${slug(name)}-${n}`;
    n += 1;
  }
  return id;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const key = sessionStorage.getItem(KEY);
  if (key) headers["X-Admin-Key"] = key;
  const response = await fetch(path, { ...options, headers, cache: "no-store" });
  if (response.status === 401) throw new Error("auth");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "request");
  return data;
}

function visibleProducts() {
  const query = norm(find.value.trim());
  const list = products
    .map((product, index) => ({ product, index }))
    .filter(({ product }) => {
      if (filter !== "todos" && (product.family || "otros") !== filter) return false;
      if (!query) return true;
      return norm(`${product.brand} ${product.name}`).includes(query);
    });
  const byName = (a, b) => a.product.name.localeCompare(b.product.name, "es", { sensitivity: "base" });
  if (sortSelect.value === "precio-asc") list.sort((a, b) => a.product.price - b.product.price || byName(a, b));
  else if (sortSelect.value === "precio-desc") list.sort((a, b) => b.product.price - a.product.price || byName(a, b));
  else if (sortSelect.value === "az") list.sort(byName);
  else list.sort((a, b) => a.index - b.index);
  return list.map((item) => item.product);
}

function renderStats() {
  document.getElementById("stat-count").textContent = String(products.length);
  for (const family of Object.keys(FAMILIES)) {
    document.getElementById(`stat-${family}`).textContent = String(
      products.filter((product) => (product.family || "otros") === family).length,
    );
  }
  for (const button of document.querySelectorAll("#filters button")) {
    const key = button.dataset.filter;
    const count = key === "todos"
      ? products.length
      : products.filter((product) => (product.family || "otros") === key).length;
    const label = key === "todos" ? "Todos" : FAMILIES[key];
    button.textContent = `${label} ${count}`;
  }
}

function showList(scroll) {
  listView.hidden = false;
  editorView.hidden = true;
  document.getElementById("catalog-stats").hidden = false;
  currentId = null;
  keptImage = "";
  pendingPhoto = null;
  photoInput.value = "";
  renderStats();
  const list = visibleProducts();
  empty.hidden = list.length > 0;
  const query = find.value.trim();
  shown.textContent = query || filter !== "todos"
    ? `${list.length} de ${products.length}`
    : `${products.length} en la tienda`;
  productList.innerHTML = list.map((product) => {
    const family = product.family || "otros";
    return `
      <button type="button" class="item" data-edit="${esc(product.id)}">
        <img src="${esc(photoOf(product))}" alt="" loading="lazy">
        <span class="item-copy">
          <strong>${esc(product.name)}</strong>
          <span class="meta">${esc(product.brand)} · ${esc(product.size || "")}</span>
          <span class="badge ${esc(family)}">${esc(FAMILIES[family] || "Otros")}</span>
        </span>
        <b class="price">${esc(money(product.price))}</b>
      </button>
    `;
  }).join("");
  if (scroll) window.scrollTo(0, 0);
}

function noteRow(label = "", value = "") {
  const row = document.createElement("div");
  row.className = "note-row";
  row.innerHTML = `
    <input class="note-label" placeholder="Salida" value="${esc(label)}">
    <input class="note-value" placeholder="Notas" value="${esc(value)}">
    <button type="button" class="note-remove" aria-label="Quitar esta nota">×</button>
  `;
  notesBox.append(row);
}

function setFamily(value) {
  editor.family.value = FAMILIES[value] ? value : "otros";
  for (const button of document.querySelectorAll("#family-choices button")) {
    button.setAttribute("aria-pressed", String(button.dataset.family === editor.family.value));
  }
}

function markSizes() {
  const current = editor.size.value.trim().toLowerCase();
  for (const button of document.querySelectorAll("#size-chips button")) {
    button.setAttribute("aria-pressed", String(button.dataset.size.toLowerCase() === current));
  }
}

function showPrice() {
  const value = editor.price.value;
  pricePreview.textContent = value === "" ? "" : money(value);
}

function showPhoto(src) {
  preview.hidden = !src;
  photoEmpty.hidden = Boolean(src);
  photoDrop.classList.toggle("empty", !src);
  preview.src = src || "";
}

function takePhoto(file) {
  if (!file) return;
  pendingPhoto = file;
  showPhoto(URL.createObjectURL(file));
}

function openEditor(product) {
  listView.hidden = true;
  editorView.hidden = false;
  document.getElementById("catalog-stats").hidden = true;
  editorStatus.textContent = "";
  pendingPhoto = null;
  photoInput.value = "";
  currentId = product?.id || null;
  keptImage = product?.image || "";
  document.getElementById("editor-title").textContent = product?.id ? "Editar perfume" : "Nuevo perfume";
  document.getElementById("remove").hidden = !product?.id;
  document.getElementById("duplicate").hidden = !product?.id;
  editor.brand.value = product?.brand || "";
  editor.name.value = product?.name || "";
  editor.size.value = product?.size || "100 ml";
  editor.price.value = product?.price ?? "";
  setFamily(product?.family || "otros");
  editor.accords.value = product?.accords || "";
  editor.summary.value = product?.summary || "";
  notesBox.innerHTML = "";
  const notes = product?.notes?.length ? product.notes : [["Salida", ""], ["Corazón", ""], ["Fondo", ""]];
  for (const [label, value] of notes) noteRow(label, value);
  showPhoto(product ? photoOf(product) : "");
  markSizes();
  showPrice();
  window.scrollTo(0, 0);
}

function readNotes() {
  return [...notesBox.querySelectorAll(".note-row")].map((row) => [
    row.querySelector(".note-label").value.trim(),
    row.querySelector(".note-value").value.trim(),
  ]).filter(([label, value]) => label || value);
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function loadProducts() {
  const data = await api("/api/catalog");
  products = Array.isArray(data) ? data : [];
  showList();
}

document.getElementById("login").addEventListener("submit", async (event) => {
  event.preventDefault();
  loginStatus.textContent = "";
  sessionStorage.setItem(KEY, document.getElementById("password").value);
  try {
    await api("/api/admin/check");
    gate.hidden = true;
    desk.hidden = false;
    await loadProducts();
  } catch {
    sessionStorage.removeItem(KEY);
    loginStatus.textContent = "Contraseña incorrecta.";
  }
});

document.getElementById("add-product").addEventListener("click", () => openEditor(null));
document.getElementById("cancel").addEventListener("click", () => showList(true));
document.getElementById("add-note").addEventListener("click", () => noteRow());
find.addEventListener("input", showList);
sortSelect.addEventListener("change", showList);

document.getElementById("filters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  filter = button.dataset.filter;
  for (const item of event.currentTarget.querySelectorAll("button")) {
    item.setAttribute("aria-pressed", String(item === button));
  }
  showList();
});

document.getElementById("family-choices").addEventListener("click", (event) => {
  const button = event.target.closest("[data-family]");
  if (!button) return;
  setFamily(button.dataset.family);
});

document.getElementById("size-chips").addEventListener("click", (event) => {
  const button = event.target.closest("[data-size]");
  if (!button) return;
  editor.size.value = button.dataset.size;
  markSizes();
});

editor.size.addEventListener("input", markSizes);
editor.price.addEventListener("input", showPrice);

notesBox.addEventListener("click", (event) => {
  const button = event.target.closest(".note-remove");
  if (!button) return;
  button.closest(".note-row").remove();
});

productList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit]");
  if (!button) return;
  openEditor(products.find((product) => product.id === button.dataset.edit));
});

photoDrop.addEventListener("click", () => photoInput.click());
photoDrop.addEventListener("dragover", (event) => {
  event.preventDefault();
  photoDrop.classList.add("over");
});
photoDrop.addEventListener("dragleave", () => photoDrop.classList.remove("over"));
photoDrop.addEventListener("drop", (event) => {
  event.preventDefault();
  photoDrop.classList.remove("over");
  const file = event.dataTransfer?.files?.[0];
  if (file && file.type.startsWith("image/")) takePhoto(file);
});
photoInput.addEventListener("change", () => takePhoto(photoInput.files?.[0]));

document.getElementById("duplicate").addEventListener("click", () => {
  const product = products.find((item) => item.id === currentId);
  if (!product) return;
  openEditor({
    ...product,
    id: null,
    name: `${product.name} copia`,
  });
});

document.getElementById("remove").addEventListener("click", async () => {
  if (!currentId || !confirm("¿Eliminar este perfume del catálogo?")) return;
  const previous = products;
  products = products.filter((product) => product.id !== currentId);
  try {
    await api("/api/catalog", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(products),
    });
    showList(true);
  } catch {
    products = previous;
    editorStatus.textContent = "No se pudo eliminar.";
  }
});

editor.addEventListener("submit", async (event) => {
  event.preventDefault();
  editorStatus.textContent = "Guardando…";
  const name = editor.name.value.trim();
  const id = currentId || uniqueId(name);
  let image = keptImage || products.find((product) => product.id === id)?.image || "";
  try {
    if (pendingPhoto) {
      const uploaded = await api("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, data: await readFile(pendingPhoto) }),
      });
      image = uploaded.image;
    }
    const next = {
      id,
      brand: editor.brand.value.trim(),
      name,
      size: editor.size.value.trim(),
      price: Number(editor.price.value),
      family: editor.family.value,
      accords: editor.accords.value.trim(),
      summary: editor.summary.value.trim(),
      notes: readNotes(),
    };
    if (image) next.image = image;
    const index = products.findIndex((product) => product.id === id);
    if (index >= 0) products[index] = next;
    else products.push(next);
    await api("/api/catalog", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(products),
    });
    showList(true);
  } catch (error) {
    editorStatus.textContent = error.message === "peso"
      ? "La foto pesa más de 15 MB."
      : "No se pudo guardar. Revisa la foto y vuelve a intentar.";
  }
});

async function downloadAuth(path, filename) {
  const headers = {};
  const key = sessionStorage.getItem(KEY);
  if (key) headers["X-Admin-Key"] = key;
  const response = await fetch(path, { headers, cache: "no-store" });
  if (response.status === 401) throw new Error("auth");
  if (!response.ok) throw new Error("request");
  const blob = await response.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function uploadTable(path, file) {
  const headers = {};
  const key = sessionStorage.getItem(KEY);
  if (key) headers["X-Admin-Key"] = key;
  const zip = /\.zip$/i.test(file.name) || file.type === "application/zip";
  if (zip) headers["Content-Type"] = "application/zip";
  const response = await fetch(path, { method: "POST", headers, body: file, cache: "no-store" });
  if (response.status === 401) throw new Error("auth");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "request");
  return data;
}

document.getElementById("download-backup").addEventListener("click", async () => {
  const status = document.getElementById("tools-status");
  status.textContent = "Preparando respaldo…";
  try {
    await downloadAuth("/api/admin/backup", "oasis-respaldo.zip");
    status.textContent = "Respaldo descargado.";
  } catch {
    status.textContent = "No se pudo descargar el respaldo.";
  }
});

document.getElementById("download-template").addEventListener("click", async () => {
  const status = document.getElementById("tools-status");
  try {
    await downloadAuth("/api/admin/plantilla", "oasis-plantilla.csv");
    status.textContent = "Plantilla descargada. Borra la fila de ejemplo antes de cargarla.";
  } catch {
    status.textContent = "No se pudo descargar la plantilla.";
  }
});

document.getElementById("restore-backup").addEventListener("change", async (event) => {
  const input = event.target;
  const file = input.files?.[0];
  const status = document.getElementById("tools-status");
  if (!file) return;
  if (!confirm("Esto reemplaza el catálogo y las fotos por las del respaldo. ¿Seguir?")) {
    input.value = "";
    return;
  }
  status.textContent = "Restaurando…";
  try {
    const result = await uploadTable("/api/admin/restore", file);
    await loadProducts();
    status.textContent = `Catálogo restaurado. ${result.count} perfumes.`;
  } catch (error) {
    status.textContent = error.message === "request" ? "No se pudo restaurar el respaldo." : error.message;
  }
  input.value = "";
});

document.getElementById("import-catalog").addEventListener("change", async (event) => {
  const input = event.target;
  const file = input.files?.[0];
  const status = document.getElementById("tools-status");
  if (!file) return;
  status.textContent = "Cargando…";
  try {
    const result = await uploadTable("/api/admin/import", file);
    await loadProducts();
    status.textContent = `Listo. El catálogo quedó con ${result.count} perfumes.`;
  } catch (error) {
    status.textContent = error.message === "request" ? "No se pudo cargar el archivo." : error.message;
  }
  input.value = "";
});

if (sessionStorage.getItem(KEY)) {
  api("/api/admin/check").then(async () => {
    gate.hidden = true;
    desk.hidden = false;
    await loadProducts();
  }).catch(() => sessionStorage.removeItem(KEY));
}
