import json
import sys
from pathlib import Path

# apps/api 디렉토리를 path에 추가하여 import가 정상적으로 되도록 함
api_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(api_dir))

from main import app

def generate_openapi():
    openapi_schema = app.openapi()
    output_path = sys.argv[1] if len(sys.argv) > 1 else str(api_dir / "openapi.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(openapi_schema, f, ensure_ascii=False, indent=2)
    print(f"OpenAPI schema successfully generated at: {output_path}")

if __name__ == "__main__":
    generate_openapi()
