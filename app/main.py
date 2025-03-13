from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from app import api  # Bu satırı değiştirdik

app = FastAPI()

# Static dosyaları ve template'leri yapılandır
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")

# Uygulama başlatıldığında çalışacak kod
@app.on_event("startup")
async def startup_event():
    print("Application startup...")

# Ana sayfa
@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

# Kârlı itemleri getir
@app.get("/api/profitable-items")
async def profitable_items_endpoint(
    city: str,
    min_profit: int = 0,
    hours_ago: float = 24,
    qualities: str = "1,2,3,4,5",
    region: str = "europe",
    test: bool = False
):
    """
    Kârlı itemleri getir.
    """
    try:
        print(f"[DEBUG] Request params: city={city}, min_profit={min_profit}, hours_ago={hours_ago}, qualities={qualities}, region={region}, test={test}")
        
        if test:
            items = await api.get_test_items(city, min_profit, hours_ago, qualities, region)
        else:
            items = await api.get_profitable_items(city, min_profit, hours_ago, qualities, region)
        
        print(f"[DEBUG] Returning {len(items)} items")
        return items
    except Exception as e:
        print(f"Error in profitable items endpoint: {e}")
        raise

# Test için kârlı itemleri getir
@app.get("/api/test-items")
async def test_items_endpoint(
    city: str,
    min_profit: int = 0,
    hours_ago: float = 24,
    qualities: str = "1,2,3,4,5",
    region: str = "europe"
):
    """
    Test için kârlı itemleri getir.
    """
    try:
        items = await api.get_test_items(city, min_profit, hours_ago, qualities, region)
        return items
    except Exception as e:
        print(f"Error in test items endpoint: {e}")
        raise

# Sağlık kontrolü
@app.get("/health")
async def health_check():
    return {"status": "healthy"}

# Hata yakalama
@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    print(f"An error occurred: {exc}")
    return templates.TemplateResponse(
        "error.html",
        {
            "request": request,
            "error_message": str(exc)
        },
        status_code=500
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)