"""Sirve la tienda Oasis y guarda el catálogo desde /admin."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import base64
import csv
from datetime import datetime
import io
import json
import os
import re
import unicodedata
import uuid
import zipfile

ROOT = Path(__file__).resolve().parent
CATALOG = ROOT / "catalog.json"
SALES = ROOT / "sales.json"
IMAGES = ROOT / "images"
# Cámbiala antes de publicar la tienda.
ADMIN_PASSWORD = "oasis"
MAX_IMAGE = 15 * 1024 * 1024
MAX_ZIP = 80 * 1024 * 1024
EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}
RASTERS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
CSV_HEADER = [
    "id", "marca", "nombre", "tamano", "precio", "categoria",
    "acordes", "resumen", "salida", "corazon", "fondo", "foto", "notas",
]
HEADER_ALIASES = {
    "id": "id",
    "marca": "marca",
    "casa": "marca",
    "nombre": "nombre",
    "tamano": "tamano",
    "precio": "precio",
    "categoria": "categoria",
    "familia": "categoria",
    "acordes": "acordes",
    "resumen": "resumen",
    "descripcion": "resumen",
    "salida": "salida",
    "corazon": "corazon",
    "fondo": "fondo",
    "foto": "foto",
    "imagen": "foto",
    "notas": "notas",
}


def fold(value):
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return text.strip().lower()


def shrink_photo(blob, extension):
    """Reduce a phone photo to a catalog JPEG. Keeps GIF and the original if Pillow is missing."""
    if extension == "gif":
        return blob, extension
    try:
        from io import BytesIO
        from PIL import Image
    except ImportError:
        return blob, extension
    image = Image.open(BytesIO(blob))
    if image.mode in {"RGBA", "LA"} or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.split()[-1])
        image = background
    else:
        image = image.convert("RGB")
    width, height = image.size
    longest = max(width, height)
    if longest > 1200:
        scale = 1200 / longest
        image = image.resize(
            (round(width * scale), round(height * scale)),
            Image.Resampling.LANCZOS,
        )
    buffer = BytesIO()
    image.save(buffer, "JPEG", quality=80, optimize=True, progressive=True)
    data = buffer.getvalue()
    if extension in {"jpg", "jpeg"} and len(data) >= len(blob):
        return blob, "jpg"
    return data, "jpg"


def save_product_image(product_id, blob, extension):
    blob, extension = shrink_photo(blob, extension)
    IMAGES.mkdir(exist_ok=True)
    for old in IMAGES.glob(f"{product_id}.*"):
        if old.suffix.lower() in RASTERS:
            old.unlink()
    destination = IMAGES / f"{product_id}.{extension}"
    destination.write_bytes(blob)
    version = int(destination.stat().st_mtime)
    return f"images/{destination.name}?v={version}"


def load_products():
    if not CATALOG.exists():
        return []
    try:
        data = json.loads(CATALOG.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def write_products(products):
    CATALOG.write_text(
        json.dumps(products, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


PAY_METHODS = {"bcv": "BCV", "efectivo": "Efectivo", "usdt": "USDT"}
PAY_MODES = {"contado": "Al contado", "cuotas": "Cuotas"}


def load_sales():
    if not SALES.exists():
        return []
    try:
        data = json.loads(SALES.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def write_sales(sales):
    SALES.write_text(
        json.dumps(sales, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def money_parts(total, parts):
    cents = int(round(float(total) * 100))
    base, extra = divmod(cents, parts)
    return [round((base + (1 if index < extra else 0)) / 100, 2) for index in range(parts)]


def read_money(value):
    try:
        amount = round(float(value), 2)
    except (TypeError, ValueError):
        return None
    if amount <= 0:
        return None
    return amount


def cents_of(value):
    return int(round(float(value) * 100))


def read_plan(raw, count, total):
    if not isinstance(raw, list) or len(raw) != count:
        raise ValueError("cuotas")
    amounts = []
    for item in raw:
        part = read_money(item)
        if part is None:
            raise ValueError("plan")
        amounts.append(part)
    if sum(cents_of(part) for part in amounts) != cents_of(total):
        raise ValueError("plan")
    return amounts


def payment_entry(amount, method, note):
    return {
        "id": uuid.uuid4().hex[:12],
        "at": datetime.now().astimezone().isoformat(timespec="minutes"),
        "amount": round(float(amount), 2),
        "method": method,
        "note": str(note or "")[:200],
    }


def paid_amount(sale):
    payments = sale.get("payments")
    if isinstance(payments, list):
        return round(sum(float(item.get("amount") or 0) for item in payments), 2)
    if sale.get("mode") == "cuotas":
        return 0.0
    return round(float(sale.get("total") or 0), 2)


def present_sale(sale):
    total = round(float(sale.get("total") or 0), 2)
    paid = min(total, paid_amount(sale))
    view = dict(sale)
    payments = sale.get("payments")
    if not isinstance(payments, list):
        payments = []
        if sale.get("mode") != "cuotas" and total:
            payments = [{
                "id": "inicial",
                "at": sale.get("at"),
                "amount": total,
                "method": sale.get("method") or "efectivo",
                "note": "",
            }]
    view["payments"] = payments
    view["paid"] = paid
    view["balance"] = round(total - paid, 2)
    view["installments"] = int(sale.get("installments") or (1 if sale.get("mode") != "cuotas" else 2))
    return view


def record_sale(payload):
    name = str(payload.get("name", "")).strip()
    product_id = str(payload.get("productId", "")).strip()
    method = str(payload.get("method", "")).strip()
    mode = str(payload.get("mode", "")).strip()
    notes = str(payload.get("notes", "")).strip()
    try:
        qty = int(payload.get("qty", 1))
    except (TypeError, ValueError):
        qty = 0
    installments = 1
    if mode == "cuotas":
        try:
            installments = int(payload.get("installments", 0))
        except (TypeError, ValueError):
            installments = 0
    if not name or len(name) > 80 or method not in PAY_METHODS or mode not in PAY_MODES:
        raise ValueError("datos")
    if qty < 1 or qty > 20:
        raise ValueError("cantidad")
    if mode == "cuotas" and not 2 <= installments <= 24:
        raise ValueError("cuotas")
    product = next((item for item in load_products() if item.get("id") == product_id), None)
    if not product:
        raise ValueError("perfume")
    catalog_price = round(float(product.get("price") or 0), 2)
    price = read_money(payload.get("price")) or catalog_price
    total = read_money(payload.get("total")) or round(price * qty, 2)
    if total <= 0 or price <= 0:
        raise ValueError("monto")
    count = installments if mode == "cuotas" else 1
    if mode == "cuotas" and isinstance(payload.get("plan"), list) and payload.get("plan"):
        amounts = read_plan(payload.get("plan"), count, total)
    else:
        amounts = money_parts(total, count)
    payments = []
    if mode != "cuotas" or payload.get("collectFirst"):
        payments.append(payment_entry(amounts[0], method, "Cuota 1" if mode == "cuotas" else ""))
    sale = {
        "id": uuid.uuid4().hex[:12],
        "at": datetime.now().astimezone().isoformat(timespec="minutes"),
        "name": name,
        "productId": product_id,
        "product": product.get("name") or "",
        "brand": product.get("brand") or "",
        "size": product.get("size") or "",
        "price": price,
        "qty": qty,
        "total": total,
        "method": method,
        "mode": mode,
        "installments": count,
        "plan": amounts,
        "payments": payments,
        "notes": notes[:500],
    }
    sales = load_sales()
    sales.append(sale)
    write_sales(sales)
    return present_sale(sale)


def add_payment(payload):
    sale_id = str(payload.get("saleId", "")).strip()
    method = str(payload.get("method", "")).strip()
    note = str(payload.get("note", "")).strip()
    try:
        amount = round(float(payload.get("amount", 0)), 2)
    except (TypeError, ValueError):
        amount = 0
    if method not in PAY_METHODS or amount <= 0:
        raise ValueError("monto")
    sales = load_sales()
    sale = next((item for item in sales if item.get("id") == sale_id), None)
    if not sale:
        raise ValueError("venta")
    balance = round(float(sale.get("total") or 0) - paid_amount(sale), 2)
    if not isinstance(sale.get("payments"), list):
        sale["payments"] = []
        if sale.get("mode") != "cuotas" and sale.get("total"):
            sale["payments"].append({
                "id": "inicial",
                "at": sale.get("at"),
                "amount": round(float(sale.get("total") or 0), 2),
                "method": sale.get("method") or "efectivo",
                "note": "",
            })
    if amount - balance > 0.001:
        raise ValueError("saldo")
    sale["payments"].append(payment_entry(amount, method, note))
    write_sales(sales)
    return present_sale(sale)


def ensure_payments(sale):
    if isinstance(sale.get("payments"), list):
        return sale["payments"]
    payments = []
    if sale.get("mode") != "cuotas" and sale.get("total"):
        payments.append({
            "id": "inicial",
            "at": sale.get("at"),
            "amount": round(float(sale.get("total") or 0), 2),
            "method": sale.get("method") or "efectivo",
            "note": "",
        })
    sale["payments"] = payments
    return payments


def update_sale(payload):
    sale_id = str(payload.get("saleId", "")).strip()
    total = read_money(payload.get("total"))
    if total is None:
        raise ValueError("monto")
    sales = load_sales()
    sale = next((item for item in sales if item.get("id") == sale_id), None)
    if not sale:
        raise ValueError("venta")
    payments = ensure_payments(sale)
    old_total = round(float(sale.get("total") or 0), 2)
    if sale.get("mode") != "cuotas" and len(payments) == 1:
        only = payments[0]
        if abs(float(only.get("amount") or 0) - old_total) < 0.001:
            only["amount"] = total
    paid = paid_amount(sale)
    if cents_of(total) < cents_of(paid):
        raise ValueError("pagado")
    qty = int(sale.get("qty") or 1) or 1
    price = read_money(payload.get("price")) or round(total / qty, 2)
    if sale.get("mode") == "cuotas":
        try:
            count = int(payload.get("installments", sale.get("installments") or 2))
        except (TypeError, ValueError):
            count = 0
        if not 2 <= count <= 24:
            raise ValueError("cuotas")
        if isinstance(payload.get("plan"), list) and payload.get("plan"):
            amounts = read_plan(payload.get("plan"), count, total)
        else:
            amounts = money_parts(total, count)
    else:
        count = 1
        amounts = [total]
    sale["price"] = price
    sale["total"] = total
    sale["installments"] = count
    sale["plan"] = amounts
    write_sales(sales)
    return present_sale(sale)


def note_parts(product):
    found = {"salida": "", "corazon": "", "fondo": ""}
    used = set()
    notes = product.get("notes") or []
    for index, item in enumerate(notes):
        if not item:
            continue
        label = fold(item[0] if len(item) else "")
        if label in found and index not in used and not found[label]:
            found[label] = item[1] if len(item) > 1 else ""
            used.add(index)
    extras = []
    for index, item in enumerate(notes):
        if index in used or not item:
            continue
        label = item[0] if len(item) else "Nota"
        value = item[1] if len(item) > 1 else ""
        if label or value:
            extras.append(f"{label}: {value}")
    return found["salida"], found["corazon"], found["fondo"], " | ".join(extras)


def products_to_csv(products):
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", lineterminator="\n")
    writer.writerow(CSV_HEADER)
    for product in products:
        salida, corazon, fondo, extras = note_parts(product)
        image = str(product.get("image") or "").split("?", 1)[0]
        writer.writerow([
            product.get("id", ""),
            product.get("brand", ""),
            product.get("name", ""),
            product.get("size", ""),
            product.get("price", ""),
            product.get("family", "otros"),
            product.get("accords", ""),
            product.get("summary", ""),
            salida,
            corazon,
            fondo,
            Path(image).name if image else "",
            extras,
        ])
    return "\ufeff" + buffer.getvalue()


def template_csv():
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", lineterminator="\n")
    writer.writerow(CSV_HEADER)
    writer.writerow([
        "", "Lattafa", "Ejemplo", "100 ml", "25", "caballero",
        "Vainilla y ámbar", "Descripción corta", "Canela", "Rosa", "Ámbar", "", "",
    ])
    return "\ufeff" + buffer.getvalue()


def decode_text(data):
    for encoding in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def parse_csv(text):
    text = text.lstrip("\ufeff")
    first = text.splitlines()[0] if text.strip() else ""
    delimiter = ";" if first.count(";") >= first.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    rows = []
    for raw in reader:
        row = {}
        for key, value in raw.items():
            name = HEADER_ALIASES.get(fold(key))
            if name:
                row[name] = value or ""
        if any(str(value).strip() for value in row.values()):
            rows.append(row)
    return rows


def parse_price(value):
    text = str(value or "").strip().replace("$", "").replace(" ", "")
    if not text:
        return 0
    if "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".")
    else:
        text = text.replace(",", ".")
    try:
        return round(float(text), 2)
    except ValueError:
        return 0


def parse_family(value):
    key = fold(value)
    if key in {"caballero", "hombre", "el"}:
        return "caballero"
    if key in {"dama", "mujer", "ella"}:
        return "dama"
    return "otros"


def slug_id(value, taken):
    base = re.sub(r"[^a-z0-9]+", "-", fold(value)).strip("-") or "perfume"
    candidate = base
    number = 2
    while candidate in taken:
        candidate = f"{base}-{number}"
        number += 1
    taken.add(candidate)
    return candidate


def notes_from_row(row):
    notes = [
        ["Salida", str(row.get("salida") or "").strip()],
        ["Corazón", str(row.get("corazon") or "").strip()],
        ["Fondo", str(row.get("fondo") or "").strip()],
    ]
    extra = str(row.get("notas") or "").strip()
    if extra:
        for part in extra.split("|"):
            piece = part.strip()
            if not piece:
                continue
            if ":" in piece:
                label, value = piece.split(":", 1)
                notes.append([label.strip() or "Nota", value.strip()])
            else:
                notes.append(["Nota", piece])
    return notes


def choose_id(row, used, existing):
    raw = re.sub(r"[^a-z0-9-]", "", fold(row.get("id") or ""))
    if raw and raw not in used:
        used.add(raw)
        return raw
    guess = re.sub(r"[^a-z0-9]+", "-", fold(row.get("nombre") or "")).strip("-")
    if guess and guess in existing and guess not in used:
        used.add(guess)
        return guess
    return slug_id(row.get("nombre") or "perfume", used)


def safe_zip_name(name):
    cleaned = str(name or "").replace("\\", "/").lstrip("/")
    parts = [part for part in cleaned.split("/") if part not in ("", ".")]
    if not parts or any(part == ".." for part in parts):
        return ""
    return "/".join(parts)


def read_package(blob):
    if not blob or len(blob) > MAX_ZIP:
        raise ValueError("peso")
    try:
        archive = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile as error:
        raise ValueError("zip") from error
    csv_text = None
    images = {}
    count = 0
    for info in archive.infolist():
        if info.is_dir():
            continue
        count += 1
        if count > 500 or info.file_size > MAX_ZIP:
            raise ValueError("peso")
        name = safe_zip_name(info.filename)
        if not name:
            continue
        data = archive.read(info)
        lower = name.lower()
        base = Path(lower).name
        if base in {"catalogo.csv", "catalog.csv"}:
            csv_text = decode_text(data)
            continue
        suffix = Path(base).suffix
        inside_folder = lower.startswith("imagenes/") or lower.startswith("images/")
        at_root = "/" not in lower
        if suffix in RASTERS and (inside_folder or at_root) and len(data) <= MAX_IMAGE:
            images[base] = data
    if not csv_text:
        raise ValueError("formato")
    return csv_text, images


def build_backup(products):
    blob = io.BytesIO()
    images_root = IMAGES.resolve()
    with zipfile.ZipFile(blob, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("catalogo.csv", products_to_csv(products).encode("utf-8"))
        packed = set()
        for product in products:
            image = str(product.get("image") or "").split("?", 1)[0]
            if not image:
                continue
            path = (IMAGES / Path(image).name).resolve()
            if path.suffix.lower() not in RASTERS or not path.is_file():
                continue
            if images_root != path.parent:
                continue
            filename = path.name
            if filename.lower() in packed:
                continue
            packed.add(filename.lower())
            archive.write(path, f"imagenes/{filename}")
    return blob.getvalue()


def apply_rows(rows, images, replace):
    current = [] if replace else load_products()
    existing = {product.get("id"): product for product in current if isinstance(product, dict)}
    used = set()
    incoming = []
    for row in rows:
        name = str(row.get("nombre") or "").strip()
        if not name:
            continue
        product_id = choose_id(row, used, existing)
        previous = existing.get(product_id, {})
        product = {
            "id": product_id,
            "brand": str(row.get("marca") or "").strip(),
            "name": name,
            "size": str(row.get("tamano") or "").strip() or previous.get("size") or "100 ml",
            "price": parse_price(row.get("precio")),
            "family": parse_family(row.get("categoria") or previous.get("family") or "otros"),
            "accords": str(row.get("acordes") or "").strip(),
            "summary": str(row.get("resumen") or "").strip(),
            "notes": notes_from_row(row),
        }
        foto = Path(str(row.get("foto") or "").replace("\\", "/")).name.lower()
        if foto and foto in images:
            extension = Path(foto).suffix.lower().lstrip(".")
            if extension == "jpeg":
                extension = "jpg"
            product["image"] = save_product_image(product_id, images[foto], extension)
        elif previous.get("image") and not replace:
            product["image"] = previous["image"]
        incoming.append(product)
    if not incoming:
        raise ValueError("vacio")
    if replace:
        products = incoming
        keep = set()
        for product in products:
            image = str(product.get("image") or "").split("?", 1)[0]
            if image:
                keep.add(Path(image).name.lower())
        if IMAGES.exists():
            for file in IMAGES.iterdir():
                if file.suffix.lower() in RASTERS and file.name.lower() not in keep:
                    file.unlink()
    else:
        replaced = {product["id"] for product in incoming}
        products = [product for product in current if product.get("id") not in replaced]
        products.extend(incoming)
    write_products(products)
    return products


def failure_message(code):
    return {
        "peso": "El archivo es demasiado grande.",
        "formato": "Usa un CSV o un zip con catalogo.csv.",
        "vacio": "El archivo no tiene perfumes.",
        "zip": "No se pudo abrir el zip.",
    }.get(code, "No se pudo completar.")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def path_only(self):
        return self.path.split("?", 1)[0]

    def end_headers(self):
        path = self.path_only()
        if path.startswith("/images/"):
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def authorized(self):
        return self.headers.get("X-Admin-Key", "") == ADMIN_PASSWORD

    def send_json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_download(self, body, content_type, filename):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def read_limited(self, limit):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0 or length > limit:
            return None
        return self.rfile.read(length)

    def do_GET(self):
        path = self.path_only()
        if path.endswith(".py"):
            self.send_error(404)
            return
        if path == "/api/catalog":
            text = CATALOG.read_text(encoding="utf-8") if CATALOG.exists() else "[]"
            body = text.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/api/admin/check":
            self.send_json(200 if self.authorized() else 401, {"ok": self.authorized()})
            return
        if path in {"/api/admin/backup", "/api/admin/plantilla"}:
            if not self.authorized():
                self.send_json(401, {"ok": False})
                return
            if path.endswith("plantilla"):
                body = template_csv().encode("utf-8")
                self.send_download(body, "text/csv; charset=utf-8", "oasis-plantilla.csv")
            else:
                self.send_download(build_backup(load_products()), "application/zip", "oasis-respaldo.zip")
            return
        if path in ("/admin", "/admin/"):
            self.path = "/admin/index.html"
        if path in ("/admin/ventas", "/admin/ventas/"):
            self.path = "/admin/ventas.html"
        if path == "/sales.json":
            self.send_error(404)
            return
        if path == "/api/admin/sales":
            if not self.authorized():
                self.send_json(401, {"ok": False})
                return
            sales = [present_sale(item) for item in load_sales()]
            sales.reverse()
            self.send_json(200, sales)
            return
        super().do_GET()

    def do_PUT(self):
        if self.path_only() != "/api/catalog":
            self.send_error(404)
            return
        if not self.authorized():
            self.send_json(401, {"ok": False})
            return
        try:
            products = self.read_json()
        except json.JSONDecodeError:
            self.send_json(400, {"ok": False})
            return
        if not isinstance(products, list):
            self.send_json(400, {"ok": False})
            return
        write_products(products)
        self.send_json(200, {"ok": True})

    def receive_table(self, replace):
        if not self.authorized():
            self.send_json(401, {"ok": False})
            return
        blob = self.read_limited(MAX_ZIP)
        if blob is None:
            self.send_json(400, {"ok": False, "error": failure_message("peso")})
            return
        content_type = self.headers.get("Content-Type", "")
        try:
            if "zip" in content_type or blob[:2] == b"PK":
                csv_text, images = read_package(blob)
            else:
                csv_text, images = decode_text(blob), {}
            products = apply_rows(parse_csv(csv_text), images, replace)
        except ValueError as error:
            self.send_json(400, {"ok": False, "error": failure_message(str(error))})
            return
        except zipfile.BadZipFile:
            self.send_json(400, {"ok": False, "error": failure_message("zip")})
            return
        self.send_json(200, {"ok": True, "count": len(products)})

    def do_DELETE(self):
        if self.path_only() != "/api/admin/sales":
            self.send_error(404)
            return
        if not self.authorized():
            self.send_json(401, {"ok": False})
            return
        try:
            payload = self.read_json()
        except json.JSONDecodeError:
            self.send_json(400, {"ok": False})
            return
        sale_id = str(payload.get("id", ""))
        sales = [item for item in load_sales() if item.get("id") != sale_id]
        write_sales(sales)
        self.send_json(200, {"ok": True})

    def do_POST(self):
        path = self.path_only()
        if path in {"/api/admin/sales", "/api/admin/sales/pago", "/api/admin/sales/editar"}:
            if not self.authorized():
                self.send_json(401, {"ok": False})
                return
            try:
                payload = self.read_json()
                if path.endswith("/pago"):
                    sale = add_payment(payload)
                elif path.endswith("/editar"):
                    sale = update_sale(payload)
                else:
                    sale = record_sale(payload)
            except json.JSONDecodeError:
                self.send_json(400, {"ok": False})
                return
            except ValueError as error:
                self.send_json(400, {"ok": False, "error": str(error)})
                return
            self.send_json(200, sale)
            return
        if path == "/api/admin/restore":
            self.receive_table(True)
            return
        if path == "/api/admin/import":
            self.receive_table(False)
            return
        if path != "/api/image":
            self.send_error(404)
            return
        if not self.authorized():
            self.send_json(401, {"ok": False})
            return
        try:
            payload = self.read_json()
        except json.JSONDecodeError:
            self.send_json(400, {"ok": False})
            return
        product_id = re.sub(r"[^a-z0-9-]", "", str(payload.get("id", "")).lower())
        match = re.match(
            r"data:(image/[a-zA-Z0-9.+-]+);base64,(.+)",
            str(payload.get("data", "")),
            re.S,
        )
        if not product_id or not match:
            self.send_json(400, {"ok": False, "error": "imagen"})
            return
        extension = EXTENSIONS.get(match.group(1).lower())
        if not extension:
            self.send_json(400, {"ok": False, "error": "formato"})
            return
        try:
            blob = base64.b64decode(match.group(2), validate=True)
        except Exception:
            self.send_json(400, {"ok": False, "error": "imagen"})
            return
        if not blob or len(blob) > MAX_IMAGE:
            self.send_json(400, {"ok": False, "error": "peso"})
            return
        image = save_product_image(product_id, blob, extension)
        self.send_json(200, {"image": image})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", 3000), Handler)
    print("Oasis en http://0.0.0.0:3000  ·  admin en /admin")
    server.serve_forever()
