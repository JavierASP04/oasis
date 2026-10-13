import json
from pathlib import Path
from PIL import Image

root = Path(r"C:\Users\Javier\Documents\oasis")
cat = json.loads((root / "catalog.json").read_text(encoding="utf-8"))
print("products", len(cat))
missing = []
for product in cat:
    img = product.get("image", "")
    path = root / img if img else None
    if not img or path is None or not path.exists():
        missing.append((product["id"], img))
        continue
    im = Image.open(path)
    kb = path.stat().st_size / 1024
    print(
        f"{path.name:48} {im.size[0]:4}x{im.size[1]:<4} {im.mode:5} {kb:7.1f} KB  {product['name']}"
    )
print("MISSING", missing)
refs = {product.get("image") for product in cat}
extras = []
for file in (root / "images").iterdir():
    rel = f"images/{file.name}"
    if file.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".gif"} and rel not in refs:
        extras.append(f"{file.name} {file.stat().st_size}")
print("UNREFERENCED", extras)
