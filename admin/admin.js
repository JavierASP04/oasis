const KEY = "oasis-admin-key";
const FAMILIES = { caballero: "Caballero", dama: "Dama", otros: "Otros" };

const gate = document.getElementById("gate");
const desk = document.getElementById("desk");
const listView = document.getElementById("list-view");
const editorView = document.getElementById("editor-view");
const productList = document.getElementById("product-list");
const editor = document.getElementById("editor");
const notesBox = document.getElementById("notes");
const preview = document.getElementById("preview");
const photoInput = document.getElementById("photo");
const editorStatus = document.getElementById("editor-status");
const loginStatus = document.getElementById("login-status");

let products = [];
let currentId = null;
let pendingPhoto = null;

function money(value) {
  return `$${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(Number(value) || 0)}`;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function photoOf(product) {
  const src = product.image || `images/${product.id}.svg`;
  if (src.startsWith("data:") || src.startsWith("http")) return src;
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

function showList() {
  listView.hidden = false;
  editorView.hidden = true;
  currentId = null;
  pendingPhoto = null;
  photoInput.value = "";
  productList.innerHTML = products.map((product) => `
    <button type="button" class="item" data-edit="${esc(product.id)}">
      <img src="${esc(photoOf(product))}" alt="">
      <span>
        <strong>${esc(product.name)}</strong>
        <span class="meta">${esc(product.brand)} · ${esc(FAMILIES[product.family] || "Otros")} · ${esc(product.size || "")}</span>
      </span>
      <b>${esc(money(product.price))}</b>
    </button>
  `).join("");
}

function noteRow(label = "", value = "") {
  const row = document.createElement("div");
  row.className = "note-row";
  const labelInput = document.createElement("input");
  labelInput.className = "note-label";
  labelInput.placeholder = "Salida";
  labelInput.value = label;
  const valueInput = document.createElement("input");
  valueInput.className = "note-value";
  valueInput.placeholder = "Notas";
  valueInput.value = value;
  row.append(labelInput, valueInput);
  notesBox.append(row);
}

function openEditor(product) {
  listView.hidden = true;
  editorView.hidden = false;
  editorStatus.textContent = "";
  pendingPhoto = null;
  photoInput.value = "";
  currentId = product ? product.id : null;
  document.getElementById("editor-title").textContent = product ? "Editar perfume" : "Nuevo perfume";
  document.getElementById("remove").hidden = !product;
  editor.brand.value = product?.brand || "";
  editor.name.value = product?.name || "";
  editor.size.value = product?.size || "100 ml";
  editor.price.value = product?.price ?? "";
  editor.family.value = product?.family || "otros";
  editor.accords.value = product?.accords || "";
  editor.summary.value = product?.summary || "";
  notesBox.innerHTML = "";
  const notes = product?.notes?.length ? product.notes : [["Salida", ""], ["Corazón", ""], ["Fondo", ""]];
  for (const [label, value] of notes) noteRow(label, value);
  preview.src = product ? photoOf(product) : "";
  preview.hidden = !product;
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
document.getElementById("cancel").addEventListener("click", showList);
document.getElementById("add-note").addEventListener("click", () => noteRow());

productList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit]");
  if (!button) return;
  openEditor(products.find((product) => product.id === button.dataset.edit));
});

photoInput.addEventListener("change", () => {
  const file = photoInput.files?.[0];
  pendingPhoto = file || null;
  if (!file) return;
  preview.hidden = false;
  preview.src = URL.createObjectURL(file);
});

document.getElementById("remove").addEventListener("click", async () => {
  if (!currentId || !confirm("¿Eliminar este perfume del catálogo?")) return;
  products = products.filter((product) => product.id !== currentId);
  try {
    await api("/api/catalog", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(products),
    });
    showList();
  } catch {
    editorStatus.textContent = "No se pudo eliminar.";
  }
});

editor.addEventListener("submit", async (event) => {
  event.preventDefault();
  editorStatus.textContent = "Guardando…";
  const name = editor.name.value.trim();
  const id = currentId || uniqueId(name);
  let image = products.find((product) => product.id === id)?.image || "";
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
    showList();
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
