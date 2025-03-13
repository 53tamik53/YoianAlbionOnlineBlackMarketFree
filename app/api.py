import aiohttp
import asyncio
from datetime import datetime, timedelta, timezone
import pytz
import json
import os
from fastapi import FastAPI, HTTPException

app = FastAPI()

# Global değişken olarak item isimlerini tut
ITEM_NAMES = {}

# Debug için dosya yolunu kontrol et
ITEMS_FILE = "app/data/items.txt"
print(f"[DEBUG] Current working directory: {os.getcwd()}")
print(f"[DEBUG] Full file path: {os.path.abspath(ITEMS_FILE)}")
print(f"[DEBUG] File exists: {os.path.exists(ITEMS_FILE)}")

# Endpoint'i Europe olarak değiştirelim
BASE_URL = "https://europe.albion-online-data.com"

# Kalite eşleştirmeleri
QUALITY_NAMES = {
    1: "Normal",
    2: "Good", 
    3: "Outstanding",
    4: "Excellent",
    5: "Masterpiece"
}

MIN_PROFIT_PERCENTAGE = 5  # Minimum %5 kar

# Black Market tax oranını sabit olarak tanımlayalım
BLACK_MARKET_TAX_RATE = 0.96  # %4 tax

# API'den gelen UTC zamanını Türkiye saatine çevir ve debug et
def convert_to_turkey_time(utc_time_str):
    try:
        print(f"\n[DEBUG] Tarih Dönüşümü:")
        print(f"[DEBUG] Gelen UTC zaman: {utc_time_str}")
        
        # UTC zamanını parse et ve timezone bilgisi ekle
        utc_time = datetime.strptime(utc_time_str, '%Y-%m-%dT%H:%M:%S')
        utc_time = utc_time.replace(tzinfo=timezone.utc)
        print(f"[DEBUG] Parse edilmiş UTC: {utc_time}")
        
        # UTC'ye 3 saat ekle (Türkiye için)
        turkey_time = utc_time + timedelta(hours=3)
        
        # Şu anki zamanı UTC olarak al
        now = datetime.now(timezone.utc)
        
        # Zaman farkını hesapla
        time_diff = now - utc_time
        hours_diff = time_diff.total_seconds() / 3600
        
        print(f"[DEBUG] UTC+3 zamanı: {turkey_time}")
        print(f"[DEBUG] Şu anki UTC saat: {now}")
        print(f"[DEBUG] Saat farkı: {hours_diff:.2f} saat")
        
        return turkey_time
    except Exception as e:
        print(f"[ERROR] Tarih dönüşüm hatası: {str(e)}")
        return None

# Item isimlerini yükle
def load_item_names():
    global ITEM_NAMES
    try:
        with open("app/data/items.txt", "r", encoding="utf-8") as file:
            for line in file:
                parts = line.strip().split(":", 2)  # En fazla 2 parçaya böl
                if len(parts) == 3:  # ID: ITEM_CODE: ITEM_NAME formatı
                    _, item_code, item_name = parts
                    base_item_code = item_code.strip().split('@')[0]  # Enchantment'ı kaldır
                    ITEM_NAMES[base_item_code] = item_name.strip()
        print(f"[INFO] Loaded {len(ITEM_NAMES)} item names")
        return ITEM_NAMES
    except Exception as e:
        print(f"[ERROR] Failed to load item names: {e}")
        return {}

# Uygulama başlatıldığında item isimlerini yükle
load_item_names()

async def get_items():
    # T6, T7, T8 itemleri içeren liste
    tiers = ["T6", "T7", "T8"]
    enchants = ["", "@1", "@2", "@3", "@4"]
    
    items = []
    try:
        with open("app/data/items.txt", "r", encoding="utf-8") as file:
            for line in file:
                if ":" in line:
                    _, item_id, _ = line.strip().split(":", 2)
                    item_id = item_id.strip()
                    
                    # Tier kontrolü
                    if any(tier in item_id for tier in tiers):
                        # Her enchantment için item ekle
                        base_id = item_id.split('@')[0]
                        for enchant in enchants:
                            items.append({"item_id": f"{base_id}{enchant}"})
    except Exception as e:
        print(f"Error loading items: {e}")
    
    return items

@app.get("/api/item-names")
async def get_item_names():
    return ITEM_NAMES

@app.get("/api/profitable-items")
async def get_profitable_items_endpoint(
    city: str,
    min_profit: int = 0,
    hours_ago: float = 5,  # Varsayılan değeri 24'ten 5'e düşürdük
    qualities: str = "1,2,3,4,5",
    region: str = "europe"
):
    print(f"[DEBUG] API Request - city: {city}, min_profit: {min_profit}, hours_ago: {hours_ago}, qualities: {qualities}, region: {region}")
    
    items = await get_profitable_items(city, min_profit, hours_ago, qualities, region)
    
    print(f"[DEBUG] API Response - Found {len(items)} items")
    if items:
        print(f"[DEBUG] First item example: {items[0]}")
    
    return items

async def get_profitable_items(city: str, min_profit: int = 0, hours_ago: float = 24.0, qualities: str = "1,2,3,4,5", region: str = "europe", test: bool = False):
    # Her zaman 24 saatlik veri çek
    real_hours_ago = 24.0
    
    print(f"[DEBUG] Starting search for profitable items in {city} for last {real_hours_ago} hours")
    
    items_to_check = await get_items()
    print(f"[DEBUG] Found {len(items_to_check)} items to check")
    
    if not items_to_check:
        print("[ERROR] Could not fetch item list")
        return []
    
    all_items = {}
    price_groups = {}
    PRICE_THRESHOLD = 0.10
    
    turkey_tz = pytz.timezone('Europe/Istanbul')
    min_date = datetime.now(turkey_tz) - timedelta(hours=real_hours_ago)
    
    chunk_size = 300
    delay_between_chunks = 0.3
    timeout = aiohttp.ClientTimeout(total=8)
    
    # Paralel işleme için chunk'ları optimize et
    chunks = [items_to_check[i:i + chunk_size] for i in range(0, len(items_to_check), chunk_size)]
    
    # Önbellekleme için dictionary
    price_cache = {}
    
    async def process_chunk(chunk):
        items_str = ",".join(item["item_id"] for item in chunk)
        cache_key = f"{city}_{items_str}"
        
        # Cache kontrolü
        if cache_key in price_cache:
            return price_cache[cache_key]
            
        async with aiohttp.ClientSession(timeout=timeout) as session:
            try:
                url = f"https://{region}.albion-online-data.com/api/v2/stats/prices/{items_str}?locations={city},Black%20Market&qualities={qualities}"
                async with session.get(url) as response:
                    if response.status == 200:
                        data = await response.json()
                        price_cache[cache_key] = data
                        
                        city_data = {}
                        bm_data = {}
                        
                        for item in data:
                            if item["sell_price_min_date"] == "0001-01-01T00:00:00" or item["sell_price_min"] <= 0:
                                continue
                                
                            item_date = datetime.fromisoformat(item["sell_price_min_date"].replace('Z', '+00:00'))
                            item_date = item_date.astimezone(turkey_tz)
                            
                            if item_date > min_date:
                                if item["city"] == "Black Market":
                                    base_key = item['item_id']
                                    if base_key not in bm_data:
                                        bm_data[base_key] = []
                                    bm_data[base_key].append({
                                        "buy_price_min": item["buy_price_min"],
                                        "quality": item["quality"]
                                    })
                                elif item["city"] == city:
                                    base_key = item['item_id']
                                    if base_key not in city_data:
                                        city_data[base_key] = []
                                    city_data[base_key].append({
                                        "sell_price_min": item["sell_price_min"],
                                        "quality": item["quality"],
                                        "sell_price_min_date": item["sell_price_min_date"]
                                    })

                        most_profitable_items = {}
                        item_profit_tracking = {}  # Yeni: Her item için en yüksek karı takip etmek için

                        def get_quality_rank(quality_name):
                            quality_ranks = {
                                "Masterpiece": 5,
                                "Excellent": 4,
                                "Outstanding": 3,
                                "Good": 2,
                                "Normal": 1
                            }
                            return quality_ranks.get(quality_name, 0)

                        for base_key in city_data:
                            if base_key in bm_data:
                                for bm_item in bm_data[base_key]:
                                    bm_quality = bm_item["quality"]
                                    bm_original_price = bm_item["buy_price_min"]
                                    
                                    for city_item in city_data[base_key]:
                                        city_quality = city_item["quality"]
                                        
                                        is_valid = (
                                            (bm_quality == 5 and city_quality == 5) or
                                            (bm_quality == 4 and city_quality >= 4) or
                                            (bm_quality == 3 and city_quality >= 3) or
                                            (bm_quality == 2 and city_quality >= 2) or
                                            (bm_quality == 1)  # Tüm kaliteler geçerli
                                        )

                                        if is_valid:
                                            bm_price_after_tax = bm_original_price * BLACK_MARKET_TAX_RATE
                                            profit = int(bm_price_after_tax - city_item["sell_price_min"])
                                            profit_percentage = (profit / city_item["sell_price_min"]) * 100

                                            print(f"\n[DEBUG] Processing item:")
                                            print(f"[DEBUG] BM Original Price: {bm_original_price}")
                                            print(f"[DEBUG] BM After Tax: {bm_price_after_tax}")
                                            print(f"[DEBUG] City Price: {city_item['sell_price_min']}")
                                            print(f"[DEBUG] Calculated Profit: {profit}")
                                            print(f"[DEBUG] Profit Percentage: {profit_percentage}")

                                            if profit >= min_profit and profit_percentage >= MIN_PROFIT_PERCENTAGE:
                                                base_tracking_key = f"{base_key}_{bm_quality}"

                                                current_data = {
                                                    "item_id": base_key,
                                                    "item_name": ITEM_NAMES.get(base_key.split('@')[0], base_key),
                                                    "enchantment": base_key.split('@')[1] if '@' in base_key else '0',
                                                    "quality": QUALITY_NAMES.get(city_quality, "Unknown"),
                                                    "black_market_quality": QUALITY_NAMES.get(bm_quality, "Unknown"),
                                                    "market_price": city_item["sell_price_min"],
                                                    "black_market_price": bm_original_price,
                                                    "profit": profit,
                                                    "profit_percentage": profit_percentage,
                                                    "market_city": city,
                                                    "market_update": convert_to_turkey_time(city_item["sell_price_min_date"]).strftime("%Y-%m-%dT%H:%M:%S")
                                                }

                                                print(f"\n[DEBUG] Processing item: {base_key}")
                                                print(f"[DEBUG] BM Quality: {bm_quality}, City Quality: {city_quality}")
                                                print(f"[DEBUG] Current Profit: {profit}")
                                                print(f"[DEBUG] Current Quality Rank: {get_quality_rank(QUALITY_NAMES.get(city_quality))}")

                                                if base_tracking_key in item_profit_tracking:
                                                    existing_data = item_profit_tracking[base_tracking_key]['best_data']
                                                    print(f"[DEBUG] Existing Profit: {existing_data['profit']}")
                                                    print(f"[DEBUG] Existing Quality Rank: {get_quality_rank(existing_data['quality'])}")
                                                    print(f"[DEBUG] Existing City: {existing_data['market_city']}")
                                                    print(f"[DEBUG] Current City: {city}")

                                                should_update = False
                                                if base_tracking_key not in item_profit_tracking:
                                                    should_update = True
                                                else:
                                                    existing_data = item_profit_tracking[base_tracking_key]['best_data']
                                                    existing_profit = existing_data['profit']
                                                    existing_quality_rank = get_quality_rank(existing_data['quality'])
                                                    current_quality_rank = get_quality_rank(current_data['quality'])

                                                    if profit > existing_profit:
                                                        should_update = True
                                                    elif profit == existing_profit and current_quality_rank > existing_quality_rank:
                                                        should_update = True

                                                if should_update:
                                                    item_profit_tracking[base_tracking_key] = {
                                                        'max_profit': profit,
                                                        'best_data': current_data
                                                    }

                        # En karlı seçenekleri most_profitable_items'a ekle
                        for tracking_key, data in item_profit_tracking.items():
                            if data['best_data']:
                                most_profitable_items[tracking_key] = data['best_data']

                        return most_profitable_items
            except Exception as e:
                print(f"[ERROR] Chunk processing error: {str(e)}")
                return {}
    
    # Paralel işleme (3 chunk aynı anda)
    for i in range(0, len(chunks), 3):
        current_chunks = chunks[i:i+3]
        chunk_tasks = [process_chunk(chunk) for chunk in current_chunks]
        results = await asyncio.gather(*chunk_tasks)
        await asyncio.sleep(delay_between_chunks)
        
        for chunk_items in results:
            if chunk_items:
                all_items.update(chunk_items)
    
    # Adet sayılarını güncelle
    for price_group in price_groups.values():
        count = price_group['count']
        for item_key in price_group['items']:
            if item_key in all_items:
                all_items[item_key]['amount'] = count
    
    result = list(all_items.values())
    print(f"[DEBUG] Found {len(result)} unique most profitable items")
    
    # Sonuçları kullanıcının istediği süreye göre filtrele
    filtered_items = []
    for item in result:
        if is_order_recent(item['market_update'], hours_ago):
            filtered_items.append(item)

    print(f"[DEBUG] Found {len(filtered_items)} items after filtering for last {hours_ago} hours")
    return filtered_items

def is_order_recent(order_date_str: str, user_hours_ago: float) -> bool:
    try:
        # Gelen tarihi UTC olarak parse et
        order_date = datetime.strptime(order_date_str, '%Y-%m-%dT%H:%M:%S')
        order_date = order_date.replace(tzinfo=timezone.utc)
        
        # UTC+3'e çevir
        order_date_tr = order_date + timedelta(hours=3)
        
        # Şu anki UTC zamanı al ve UTC+3'e çevir
        current_time = datetime.now(timezone.utc)
        current_time_tr = current_time + timedelta(hours=3)
        
        # Saat farkını hesapla (UTC+3 cinsinden)
        time_diff = current_time_tr - order_date_tr
        hours_diff = time_diff.total_seconds() / 3600

        # Kullanıcının istediği süreye göre filtrele
        return hours_diff <= user_hours_ago

    except Exception as e:
        print(f"[ERROR] Tarih kontrol hatası: {str(e)}")
        return False
