"""Sirve la tienda Oasis y guarda el catálogo desde /admin."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import base64
import json
import re

ROOT = Path(__file__).resolve().parent
CATALOG = ROOT / "catalog.json"
IMAGES = ROOT / "images"
# Cámbiala antes de publicar la tienda.
ADMIN_PASSWORD = "oasis"
MAX_IMAGE = 5 * 1024 * 1024
EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def path_only(self):
        return self.path.split("?", 1)[0]

    def end_headers(self):
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

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

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
        if path in ("/admin", "/admin/"):
            self.path = "/admin/index.html"
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
        CATALOG.write_text(
            json.dumps(products, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        self.send_json(200, {"ok": True})

    def do_POST(self):
        if self.path_only() != "/api/image":
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
        IMAGES.mkdir(exist_ok=True)
        for old in IMAGES.glob(f"{product_id}.*"):
            if old.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
                old.unlink()
        destination = IMAGES / f"{product_id}.{extension}"
        destination.write_bytes(blob)
        self.send_json(200, {"image": f"images/{destination.name}"})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8765), Handler)
    print("Oasis en http://127.0.0.1:8765  ·  admin en /admin")
    server.serve_forever()
