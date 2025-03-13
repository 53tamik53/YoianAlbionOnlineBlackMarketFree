// Global değişkenler
let allData = [];
let currentSortColumn = 'profit';
let currentSortDirection = 'desc';
const ITEMS_PER_PAGE = 25;
let currentPage = 1;
let filteredItems = [];
const CACHE_KEY = 'albion_market_data';
const CACHE_TIMESTAMP_KEY = 'albion_market_timestamp';
const CACHE_DURATION = 10 * 60 * 1000; // 5 dakika (milisaniye cinsinden)
let autoUpdateInterval;
let updateStartTime = null;
let hidePurchasedItems = false;

// Server için localStorage key'i
const SERVER_KEY = 'selected_server';

// Saat seçeneklerini ekle
const hoursSelect = document.createElement('select');
hoursSelect.id = 'hoursAgo';
hoursSelect.className = 'form-select';

const timeOptions = [
    { value: 0.33, text: '20 Dakika' },
    { value: 1, text: '1 Saat' },
    { value: 24, text: '24 Saat' }
];

timeOptions.forEach(option => {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.text = option.text;
    hoursSelect.appendChild(opt);
});

// Varsayılan olarak 1 saat seçili olsun
hoursSelect.value = 1;

// Şehir listesi
const ALL_CITIES = [
    "Thetford",
    "Martlock", 
    "Bridgewatch",
    "Lymhurst",
    "Fort Sterling",
    "Brecilien",
    "Caerleon"
];

// Yardımcı fonksiyonlar
function formatNumber(value) {
    // Önce sayıyı tam sayıya yuvarla
    const roundedValue = Math.floor(value);
    // Binlik ayracı ile formatla
    return roundedValue.toLocaleString('tr-TR');
}

function adjustTimeZone(dateStr) {
    const date = new Date(dateStr);
    // 3 saat ekle
    date.setHours(date.getHours() + 3);
    return date.toLocaleString('tr-TR');
}

function getItemImageUrl(itemId) {
    return `https://render.albiononline.com/v1/item/${itemId}.png`;
}
// Kâr sınıfını belirleyen fonksiyon
function setProfitClass(profit, minProfit) {
    if (profit < minProfit) {
        return 'profit-low';
    } else if (profit < minProfit * 1.5) {
        return 'profit-minimum';
    } else if (profit < minProfit * 2.5) {
        return 'profit-medium';
    } else {
        return 'profit-high';
    }
}

// Önbellek fonksiyonları
function saveToCache(data) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
    } catch (error) {
        console.error('Cache save error:', error);
    }
}

function loadFromCache() {
    try {
        const timestamp = parseInt(localStorage.getItem(CACHE_TIMESTAMP_KEY));
        const now = Date.now();
        
        // Cache süresi dolmamışsa verileri yükle
        if (timestamp && (now - timestamp) < CACHE_DURATION) {
            const cachedData = localStorage.getItem(CACHE_KEY);
            if (cachedData) {
                return JSON.parse(cachedData);
            }
        }
    } catch (error) {
        console.error('Cache load error:', error);
    }
    return null;
}

// Otomatik güncelleme fonksiyonu
function startAutoUpdate() {
    // Varolan interval'i temizle
    if (autoUpdateInterval) {
        clearInterval(autoUpdateInterval);
    }
    
    // Her 5 dakikada bir güncelle
    autoUpdateInterval = setInterval(async () => {
        console.log('Auto update started...');
        await fetchDataInBatches();
    }, CACHE_DURATION);
}

function displayItems(items) {
    const container = document.getElementById('items-container');
    container.innerHTML = '';

    items.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'item';

        // Resim ve isim container'ı
        const imgNameContainer = document.createElement('div');
        imgNameContainer.className = 'img-name-container';

        // Resim
        const img = document.createElement('img');
        img.src = `https://render.albiononline.com/v1/item/${item.item_id}.png`;
        img.alt = item.item_name;
        img.style.cursor = 'pointer';
        img.onclick = () => {
            navigator.clipboard.writeText(item.item_name).then(() => {
                // Kopyalama başarılı olduğunda bildirim göster
                const notification = document.createElement('div');
                notification.className = 'copy-notification';
                notification.textContent = 'İsim kopyalandı!';
                imgNameContainer.appendChild(notification);
                
                // 1 saniye sonra bildirimi kaldır
                setTimeout(() => notification.remove(), 1000);
            });
        };

        // İsim
        const nameDiv = document.createElement('div');
        nameDiv.className = 'item-name';
        nameDiv.textContent = item.item_name;

        imgNameContainer.appendChild(img);
        imgNameContainer.appendChild(nameDiv);
        itemDiv.appendChild(imgNameContainer);

        // Fiyat bilgileri
        const priceInfo = document.createElement('div');
        priceInfo.className = 'price-info';
        priceInfo.innerHTML = `
            <div>Market: ${formatNumber(item.market_price)}</div>
            <div>Black Market: ${formatNumber(item.black_market_price)}</div>
            <div>Kâr: ${formatNumber(item.profit)}</div>
            <div>Kâr %: ${item.profit_percentage.toFixed(1)}%</div>
            <div>Adet: ${item.amount || 1}</div>
            <div>Kalite: ${item.quality}</div>
            <div>Büyü: ${item.enchantment}</div>
            <div>Şehir: ${item.market_city}</div>
            <div>Güncelleme: ${adjustTimeZone(item.market_update)}</div>
        `;

        itemDiv.appendChild(priceInfo);
        container.appendChild(itemDiv);
    });
}

// Verileri grupla ve işle
function processItems(items) {
    console.log("Raw items received:", items);
    
    // İlk itemin amount değerini kontrol et
    if (items.length > 0) {
        console.log("First item amount check:", {
            itemName: items[0].item_name,
            amount: items[0].amount,
            fullItem: items[0]
        });
    }

    // Item'ları grupla ve adetleri hesapla
    const groupedItems = {};
    let duplicateCount = 0; // Yeni: Tekrar sayısını takip et
    
    items.forEach(item => {
        const key = `${item.item_id}_${item.enchantment}_${item.quality}_${item.market_city}_${item.market_price}_${item.black_market_price}`;
        
        // Yeni: Daha detaylı debug bilgisi
        console.log("Processing item:", {
            name: item.item_name,
            key: key,
            price: item.market_price,
            blackMarketPrice: item.black_market_price,
            isDuplicate: groupedItems[key] ? true : false
        });

        if (!groupedItems[key]) {
            groupedItems[key] = {
                ...item,
                amount: item.amount || 1,  // API'den gelen amount değerini kullan
                processed: true
            };
        } else {
            // Varolan item'ın amount değerini artır ve fiyatları güncelle
            duplicateCount++; // Yeni: Tekrar sayısını artır
            groupedItems[key].amount += 1;
            
            // En düşük market fiyatını koru
            if (item.market_price < groupedItems[key].market_price) {
                groupedItems[key].market_price = item.market_price;
            }
            
            // En yüksek black market fiyatını koru
            if (item.black_market_price > groupedItems[key].black_market_price) {
                groupedItems[key].black_market_price = item.black_market_price;
            }
            
            // Kâr ve kâr yüzdesini güncelle
            groupedItems[key].profit = groupedItems[key].black_market_price - groupedItems[key].market_price;
            groupedItems[key].profit_percentage = (groupedItems[key].profit / groupedItems[key].market_price) * 100;
        }
    });

    // Gruplanmış item'ları diziye çevir
    let processedItems = Object.values(groupedItems);
    
    // Yeni: Daha detaylı debug bilgisi
    console.log("Grouping Summary:", {
        originalItemCount: items.length,
        uniqueItemCount: processedItems.length,
        duplicatesFound: duplicateCount
    });
    
    console.log("Processed items:", processedItems);
    
    // Maksimum 500 item (20 sayfa * 25 item)
    processedItems = processedItems.slice(0, 500);
    
    return processedItems;
}

// Sayfalama güncelleme
function updatePagination() {
    const totalPages = Math.ceil(filteredItems.length / ITEMS_PER_PAGE);
    
    // Eğer mevcut sayfa, toplam sayfa sayısından büyükse düzelt
    if (currentPage > totalPages) {
        currentPage = totalPages || 1;
    }
    
    const pagination = document.getElementById('pagination');
    pagination.innerHTML = '';
    
    // Önceki sayfa
    const prevDisabled = currentPage === 1 ? 'disabled' : '';
    pagination.innerHTML += `
        <li class="page-item ${prevDisabled}">
            <a class="page-link" href="#" data-page="${currentPage - 1}">Önceki</a>
        </li>
    `;
    
    // Sayfa numaraları
    for (let i = 1; i <= totalPages; i++) {
        pagination.innerHTML += `
            <li class="page-item ${currentPage === i ? 'active' : ''}">
                <a class="page-link" href="#" data-page="${i}">${i}</a>
            </li>
        `;
    }
    
    // Sonraki sayfa
    const nextDisabled = currentPage === totalPages ? 'disabled' : '';
    pagination.innerHTML += `
        <li class="page-item ${nextDisabled}">
            <a class="page-link" href="#" data-page="${currentPage + 1}">Sonraki</a>
        </li>
    `;
    
    // Sayfa değiştirme olayları
    document.querySelectorAll('.page-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const newPage = parseInt(e.target.dataset.page);
            if (newPage >= 1 && newPage <= totalPages) {
                currentPage = newPage;
                filterAndDisplayData();
            }
        });
    });
}

// API çağrılarını yönetmek için yardımcı fonksiyonlar
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function getSelectedCities() {
    const citySelect = document.getElementById('city');
    const selectedCity = citySelect.value;
    
    // Eğer "Tüm Şehirler" seçiliyse tüm şehirleri döndür
    if (selectedCity === 'all') {
        return ALL_CITIES;
    }
    
    return [selectedCity];
}

async function fetchCityData(city, params) {
    const serverSelect = document.getElementById('server');
    const selectedServer = serverSelect ? 
        serverSelect.value : 
        localStorage.getItem(SERVER_KEY) || 'europe';
    
    const { hoursAgo, qualities } = params;
    const url = `/api/profitable-items?city=${encodeURIComponent(city)}&min_profit=0&hours_ago=${hoursAgo}&qualities=${qualities}&region=${selectedServer}`;
    
    try {
        const response = await fetch(url);
        if (response.status === 429) {
            console.log(`Rate limit hit for ${city}, waiting 5 seconds...`);
            await delay(5000);
            return fetchCityData(city, params);
        }
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        return data;
    } catch (error) {
        console.error(`Error fetching ${city}:`, error);
        return [];
    }
}

// Loading state yönetimi
function showLoadingState() {
    const fetchButton = document.getElementById('fetchButton');
    const fetchSpinner = document.getElementById('fetchSpinner');
    
    if (fetchButton && fetchSpinner) {
        fetchButton.disabled = true;
        fetchSpinner.classList.remove('d-none');
    }
}

function hideLoadingState() {
    const fetchButton = document.getElementById('fetchButton');
    const fetchSpinner = document.getElementById('fetchSpinner');
    
    if (fetchButton && fetchSpinner) {
        fetchButton.disabled = false;
        fetchSpinner.classList.add('d-none');
    }
}

async function fetchDataInBatches() {
    const fetchButton = document.getElementById('fetchButton');
    const fetchSpinner = document.getElementById('fetchSpinner');
    const progressContainer = document.getElementById('progressContainer');
    const operationText = document.getElementById('currentOperation');
    
    // Timer elementi oluştur
    let timerElement = document.getElementById('updateTimer');
    if (!timerElement) {
        timerElement = document.createElement('div');
        timerElement.id = 'updateTimer';
        timerElement.className = 'update-timer';
        // Timer'ı operationText'in yanına ekle
        operationText.parentNode.insertBefore(timerElement, operationText.nextSibling);
    }
    
    try {
        // Başlangıç zamanını kaydet
        updateStartTime = Date.now();
        
        fetchButton.disabled = true;
        fetchSpinner.classList.remove('d-none');
        allData = [];

        const selectedCities = getSelectedCities();
        const totalCities = selectedCities.length;
        
        for (let i = 0; i < selectedCities.length; i++) {
            const city = selectedCities[i];
            const progress = ((i + 1) / totalCities) * 100;
            
            updateProgress(city, progress);
            
            const cityData = await fetchCityData(city, {
                hoursAgo: 24,
                qualities: "1,2,3,4,5",
                region: localStorage.getItem(SERVER_KEY) || 'europe'
            });
            
            if (Array.isArray(cityData)) {
                allData = allData.concat(cityData);
            }
            
            if (i < selectedCities.length - 1) {
                await delay(300);
            }
        }
        
        saveToCache(allData);
        
        const totalSeconds = Math.floor((Date.now() - updateStartTime) / 1000);
        timerElement.innerHTML = `<strong>Güncelleme tamamlandı:</strong> ${totalSeconds} saniye sürdü`;
        timerElement.style.color = '#28a745'; // Yeşil renk
        
        filterAndDisplayData();
        
    } catch (error) {
        console.error('Error fetching data:', error);
        document.getElementById('serverStatus').textContent = 'Error';
        document.getElementById('serverStatus').style.color = '#dc3545';
    } finally {
        fetchButton.disabled = false;
        fetchSpinner.classList.add('d-none');
        progressContainer.style.width = '0%';
        operationText.textContent = ''; // Yazıyı temizle
    }
}

// CSS ekle
function addStyles() {
    if (!document.querySelector('#update-timer-styles')) {
        const styleElement = document.createElement('style');
        styleElement.id = 'update-timer-styles';
        styleElement.textContent = `
            .update-timer {
                margin-top: 10px;
                padding: 8px 12px;
                background-color: rgba(0,0,0,0.05);
                border-radius: 4px;
                font-size: 14px;
                display: inline-block;
            }
        `;
        document.head.appendChild(styleElement);
    }
}

// Sayfa yüklendiğinde stilleri ekle
document.addEventListener('DOMContentLoaded', addStyles);

// Sayfa yüklendiğinde
document.addEventListener('DOMContentLoaded', () => {
    // Önbellekten veri yükle
    const cachedData = loadFromCache();
    if (cachedData) {
        console.log('Loading data from cache...');
        allData = cachedData;
        filterAndDisplayData();
        
        // Son güncelleme zamanını göster
        const timestamp = parseInt(localStorage.getItem(CACHE_TIMESTAMP_KEY));
        if (timestamp) {
            const updateTime = new Date(timestamp);
            document.getElementById('lastUpdate').textContent = 
                `Son güncelleme: ${updateTime.toLocaleTimeString()} (CACHED)`;
        }
    }

    // Otomatik güncellemeyi başlat
    startAutoUpdate();

    // Sayfa kapatılırken interval'i temizle
    window.addEventListener('beforeunload', () => {
        if (autoUpdateInterval) {
            clearInterval(autoUpdateInterval);
        }
    });

    // Veri çekme butonu için event listener
    const fetchButton = document.getElementById('fetchButton');
    if (fetchButton) {
        fetchButton.addEventListener('click', fetchDataInBatches);
    }

    // Şehir seçimi değiştiğinde otomatik güncelle
    const citySelect = document.getElementById('city');
    if (citySelect) {
        citySelect.addEventListener('change', () => {
            filterAndDisplayData(); // Sadece mevcut verileri filtrele
        });
    }

    // Kâr inputu için event listener
    const minProfitInput = document.getElementById('min_profit');
    if (minProfitInput) {
        minProfitInput.addEventListener('input', filterAndDisplayData);
    }

    // Saat filtreleme için event listener
    document.querySelectorAll('input[name="timeRange"]').forEach(radio => {
        radio.addEventListener('change', filterAndDisplayData);
    });

    // Server seçimini kontrol et ve ayarla
    const serverSelect = document.getElementById('server');
    if (serverSelect) {
        // localStorage'dan seçili server'ı al
        const savedServer = localStorage.getItem(SERVER_KEY);
        if (savedServer) {
            serverSelect.value = savedServer;
        }

        // Server değiştiğinde
        serverSelect.addEventListener('change', () => {
            // Yeni seçilen server'ı kaydet
            localStorage.setItem(SERVER_KEY, serverSelect.value);
            
            // Cache'i temizle
            localStorage.removeItem(CACHE_KEY);
            localStorage.removeItem(CACHE_TIMESTAMP_KEY);
            
            // Sayfayı yenile
            window.location.reload();
        });
    }

    // tbody içindeki event listener'ı ekle
    document.querySelector('tbody').addEventListener('click', async (e) => {
        if (e.target.classList.contains('item-image')) {
            const itemName = e.target.dataset.itemName;
            const tier = e.target.dataset.tier;
            const enchantment = e.target.dataset.enchantment;
            const textToCopy = `${itemName} ${tier}${enchantment}`;
            
            try {
                await navigator.clipboard.writeText(textToCopy);
                
                // Kopyalandı bildirimini göster
                const notification = e.target.parentElement.querySelector('.copy-notification');
                notification.classList.add('show');
                
                // 0.7 saniye sonra bildirimi gizle
                setTimeout(() => {
                    notification.classList.remove('show');
                }, 700);
                
            } catch (err) {
                console.error('Kopyalama hatası:', err);
            }
        }
    });

    // Tema butonuna tıklama olayı ekle
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }

    // Kaydedilmiş temayı uygula
    const savedTheme = localStorage.getItem('theme');
    const themeIcon = document.getElementById('themeIcon');
    
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        if (themeIcon) {
            themeIcon.classList.remove('fa-moon');
            themeIcon.classList.add('fa-sun');
        }
    }

    const toggleButton = document.getElementById('togglePurchased');
    if (toggleButton) {
        // localStorage'dan son durumu al
        hidePurchasedItems = localStorage.getItem('hidePurchasedItems') === 'true';
        updateToggleButton(hidePurchasedItems);
        
        toggleButton.addEventListener('click', () => {
            hidePurchasedItems = !hidePurchasedItems;
            localStorage.setItem('hidePurchasedItems', hidePurchasedItems);
            updateToggleButton(hidePurchasedItems);
            filterAndDisplayData(); // Tabloyu güncelle
        });
    }

    // Tüm resimlerdeki title ve alt özelliklerini kaldır
    document.querySelectorAll('.item-image').forEach(img => {
        img.removeAttribute('title');
        img.removeAttribute('alt');
        
        // Mouseover event listener ekle
        img.addEventListener('mouseover', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    });
    
    // Tablo hücrelerindeki title özelliklerini kaldır
    document.querySelectorAll('.table td, .table th').forEach(cell => {
        cell.removeAttribute('title');
    });
});

// Verileri filtrele ve göster
function filterAndDisplayData() {
    const minProfitInput = document.getElementById('min_profit');
    const citySelect = document.getElementById('city');
    const selectedTime = document.querySelector('input[name="timeRange"]:checked').value;
    const tbody = document.querySelector('tbody');
    const pagination = document.getElementById('pagination');
    
    if (!minProfitInput || !citySelect || !tbody) {
        console.log('Form elements not found');
        return;
    }

    const minProfit = parseFloat(minProfitInput.value) || 0;
    const selectedCity = citySelect.value;
    
    // Şu anki zaman
    const now = new Date();
    
    // Veri yoksa veya boşsa
    if (!Array.isArray(allData) || allData.length === 0) {
        console.log('No data available');
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-4">
                    <i class="fas fa-exclamation-circle text-warning me-2"></i>
                    Henüz veri yüklenmedi
                </td>
            </tr>
        `;
        // Sayfalamayı gizle
        if (pagination) {
            pagination.style.display = 'none';
        }
        return;
    }

    // Filtreleme
    filteredItems = allData.filter(item => {
        const itemDate = new Date(item.market_update);
        const minutesDiff = (now - itemDate) / (1000 * 60); // Dakika cinsinden fark
        
        let timeLimit;
        switch(selectedTime) {
            case "0.33": // 20 dakika
                timeLimit = 20;
                break;
            case "1": // 1 saat
                timeLimit = 60;
                break;
            case "24": // 24 saat
                timeLimit = 1440;
                break;
            default:
                timeLimit = 20;
        }
        
        if (selectedCity !== 'all') {
            return item.profit >= minProfit && 
                   item.market_city === selectedCity && 
                   minutesDiff <= timeLimit;
        }
        return item.profit >= minProfit && minutesDiff <= timeLimit;
    });

    // Alınan itemleri filtrele
    if (hidePurchasedItems) {
        const purchasedIds = purchasedItems.items.map(item => item.item_id);
        filteredItems = filteredItems.filter(item => !purchasedIds.includes(item.item_id));
    }

    // Filtrelenmiş veri yoksa
    if (filteredItems.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-4">
                    <i class="fas fa-exclamation-circle text-warning me-2"></i>
                    ${selectedCity === 'all' ? 'Hiçbir şehirde' : `${selectedCity} şehrinde`} veri bulunamadı
                </td>
            </tr>
        `;
        // Sayfalamayı gizle
        if (pagination) {
            pagination.style.display = 'none';
        }
        return;
    }

    // Veri varsa sayfalamayı göster
    if (pagination) {
        pagination.style.display = 'flex';
    }

    // Sıralama
    filteredItems.sort((a, b) => {
        const direction = currentSortDirection === 'asc' ? 1 : -1;
        
        if (currentSortColumn === 'profit') {
            return (a.profit - b.profit) * direction;
        } else if (currentSortColumn === 'profit_percentage') {
            return (a.profit_percentage - b.profit_percentage) * direction;
        } else if (currentSortColumn === 'market_update') {
            return (new Date(a.market_update) - new Date(b.market_update)) * direction;
        } else if (currentSortColumn === 'amount') {
            return (a.amount - b.amount) * direction;
        }
        return 0;
    });

    // Sayfalama ve tablo güncelleme
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedItems = filteredItems.slice(startIndex, endIndex);

    tbody.innerHTML = '';

    // Önce tüm satırları oluştur
    paginatedItems.forEach(item => {
        const row = document.createElement('tr');
        row.style.opacity = '0';  // Başlangıçta görünmez
        row.innerHTML = createTableRow(item);
        tbody.appendChild(row);
    });

    // Force reflow to ensure animations work
    tbody.offsetHeight;

    // Animasyonları başlat
    Array.from(tbody.children).forEach((row, index) => {
        row.style.opacity = '';  // CSS animasyonunun çalışması için opacity'yi kaldır
    });

    updatePagination();
    
    // İstatistikleri güncelle
    document.getElementById('totalItems').textContent = allData.length;
    document.getElementById('filteredItems').textContent = filteredItems.length;
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Önce elementlerin varlığını kontrol et
    const sortableHeaders = document.querySelectorAll('.sortable');
    if (sortableHeaders.length > 0) {
        sortableHeaders.forEach(header => {
            header.addEventListener('click', () => {
                const column = header.dataset.sort;
                
                // Önce tüm başlıklardan active class'ını kaldır
                document.querySelectorAll('.sortable').forEach(h => {
                    h.classList.remove('active', 'asc', 'desc');
                });
                
                // Tıklanan başlığa active class'ı ekle
                header.classList.add('active');
                
                if (currentSortColumn === column) {
                    // Aynı sütuna tıklandıysa yönü değiştir
                    currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
                    header.classList.add(currentSortDirection);
                } else {
                    // Farklı sütuna tıklandıysa
                    currentSortColumn = column;
                    currentSortDirection = 'desc';
                    header.classList.add('desc');
                }
                
                filterAndDisplayData();
            });
        });
    }

    // Veri çekme butonu için event listener
    const fetchButton = document.getElementById('fetchButton');
    if (fetchButton) {
        fetchButton.addEventListener('click', fetchDataInBatches);
    }

    // Şehir seçimi değiştiğinde otomatik güncelle
    const citySelect = document.getElementById('city');
    if (citySelect) {
        citySelect.addEventListener('change', () => {
            filterAndDisplayData(); // Sadece mevcut verileri filtrele
        });
    }

    // Tooltip'leri aktifleştir (jQuery kontrolü ile)
    if (typeof $ !== 'undefined') {
        $('[data-bs-toggle="tooltip"]').tooltip();
    }

    // İlk yükleme
    const cachedData = loadFromCache();
    if (cachedData) {
        allData = cachedData;
        filterAndDisplayData();
    }

    // Saat filtreleme için event listener
    document.querySelectorAll('input[name="timeRange"]').forEach(radio => {
        radio.addEventListener('change', filterAndDisplayData);
    });

    // Server değiştiğinde sayfayı yenile
    const serverSelect = document.getElementById('server');
    if (serverSelect) {
        serverSelect.addEventListener('change', () => {
            // Local storage'ı temizle
            localStorage.removeItem(CACHE_KEY);
            localStorage.removeItem(CACHE_TIMESTAMP_KEY);
            
            // Sayfayı yenile
            window.location.reload();
        });
    }
});

function updateTableRow(row, data) {
    // Önce eski değeri saklayalım
    const oldProfit = parseFloat(row.querySelector('.profit-value').textContent);
    const newProfit = parseFloat(data.profit);
    const minProfitValue = parseFloat(document.getElementById('min_profit').value) || 0;

    // Profit değişim animasyonu
    const profitElements = row.querySelectorAll('.profit-value');
    profitElements.forEach(profitElement => {
        profitElement.classList.remove('profit-increase', 'profit-decrease');
        
        // Eski sınıfları kaldır
        profitElement.classList.remove('profit-low', 'profit-minimum', 'profit-medium', 'profit-high');
        // Yeni sınıfı ekle
        profitElement.classList.add(setProfitClass(newProfit, minProfitValue));
        
        if (oldProfit < newProfit) {
            profitElement.classList.add('profit-increase');
        } else if (oldProfit > newProfit) {
            profitElement.classList.add('profit-decrease');
        }

        // Animasyon sonunda class'ı kaldır
        setTimeout(() => {
            profitElement.classList.remove('profit-increase', 'profit-decrease');
        }, 1000);
    });
}

function showLoadingState() {
    const tbody = document.querySelector('tbody');
    const rows = tbody.getElementsByTagName('tr');
    
    Array.from(rows).forEach(row => {
        row.classList.add('loading-shimmer');
    });
}

function hideLoadingState() {
    const tbody = document.querySelector('tbody');
    const rows = tbody.getElementsByTagName('tr');
    
    Array.from(rows).forEach((row, index) => {
        row.classList.remove('loading-shimmer');
        // Kademeli fade-in efekti
        row.style.animationDelay = `${index * 0.05}s`;
    });
}

// Filtre butonları için animasyon
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        this.classList.add('filter-transition');
        
        // Aktif class'ı ekle/kaldır
        if (this.classList.contains('filter-active')) {
            this.classList.remove('filter-active');
        } else {
            this.classList.add('filter-active');
        }
    });
});

// Progress bar animasyonu için güncelleme
function updateProgress(city, progress) {
    const progressBar = document.getElementById('progressContainer');
    const operationText = document.getElementById('currentOperation');
    
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
    }
    if (operationText && progress < 100) { // Sadece işlem devam ederken göster
        operationText.textContent = `${city} verisi işleniyor...`;
    }
}

// Tooltip initialize
function initializeTooltips() {
    document.querySelectorAll('[data-tooltip]').forEach(element => {
        element.addEventListener('mouseenter', function(e) {
            const tooltip = this.getAttribute('data-tooltip');
            if (!tooltip) return;
            
            // Tooltip pozisyonunu güncelle
            const rect = this.getBoundingClientRect();
            const tooltipElement = document.createElement('div');
            tooltipElement.className = 'custom-tooltip';
            tooltipElement.textContent = tooltip;
            document.body.appendChild(tooltipElement);
            
            const tooltipRect = tooltipElement.getBoundingClientRect();
            tooltipElement.style.left = `${rect.left + (rect.width - tooltipRect.width) / 2}px`;
            tooltipElement.style.top = `${rect.top - tooltipRect.height - 10}px`;
        });
    });
}

// Sayfa yüklendiğinde tooltip'leri initialize et
document.addEventListener('DOMContentLoaded', initializeTooltips);

function getRelativeTimeString(dateStr) {
    // UTC zamanını Date objesine çevir
    const date = new Date(dateStr);
    
    // Şu anki zaman
    const now = new Date();
    
    // Zaman farkını milisaniye cinsinden hesapla
    const diffInMs = now - date;
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    
    // 10 dakikadan yeni ise "Az önce" göster
    if (diffInMinutes < 10) {
        return "Az önce";
    }
    
    // 60 dakikadan az ise dakika olarak göster
    if (diffInMinutes < 60) {
        return `${diffInMinutes} dakika önce`;
    }
    
    // 24 saatten az ise saat olarak göster
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) {
        return `${diffInHours} saat önce`;
    }
    
    // 24 saatten fazla ise gün olarak göster
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays} gün önce`;
}

function createTableRow(item) {
    const tier = item.item_id.split('_')[0].replace('T', '');
    const enchantment = item.enchantment === '0' ? '.0' : `.${item.enchantment}`;
    
    // Tooltip için detaylı bilgiler
    const buyTooltip = `${item.quality} - ${item.market_city} - ${formatNumber(item.market_price)} Silver`;
    const sellTooltip = `${item.black_market_quality} - Black Market - ${formatNumber(item.black_market_price)} Silver`;
    
    // Görüntülenecek bilgiler
    const buyInfo = `<strong class="text-secondary-light">${item.quality} - ${item.market_city}<br>${formatNumber(item.market_price)} Silver</strong>`;
    const sellInfo = `<strong class="text-secondary-light">${item.black_market_quality} - Black Market<br>${formatNumber(item.black_market_price)} Silver</strong>`;
    
    return `
        <tr>
            <td class="text-center" style="position: relative; min-width: 120px;">
                <div class="item-container" style="position: relative;">
                    <img src="${getItemImageUrl(item.item_id)}" 
                         alt="${item.item_name}" 
                         class="item-image"
                         data-item-name="${item.item_name}"
                         data-tier="${tier}"
                         data-enchantment="${enchantment}"
                         style="width: 40px; height: 40px; border-radius: 3px; cursor: pointer;">
                    <div class="copy-notification">Kopyalandı!</div>
                </div>
            </td>
            <td class="text-center" style="min-width: 200px;">
                <strong class="item-name">
                    ${item.item_name} ${tier}${enchantment}
                </strong>
            </td>
            <td class="text-center" data-bs-toggle="tooltip" title="${buyTooltip}">${buyInfo}</td>
            <td class="text-center" data-bs-toggle="tooltip" title="${sellTooltip}">${sellInfo}</td>
            <td class="text-center" style="color: rgba(0, 123, 255, 0.85);"><strong>${formatNumber(item.profit)}</strong></td>
            <td class="text-center" style="color: rgba(0, 123, 255, 0.85);"><strong>${item.profit_percentage.toFixed(2)}%</strong></td>
            <td class="text-center"><strong>${getRelativeTimeString(item.market_update)}</strong></td>
            <td class="text-center">
                <div class="action-buttons">
                    <button class="btn btn-sm btn-outline-success add-item-btn" 
                            data-item-id="${item.item_id}"
                            data-item-name="${item.item_name}"
                            data-market-price="${item.market_price}"
                            data-bs-toggle="tooltip"
                            title="İtemi Al">
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
            </td>
        </tr>
    `;
}

// Item ismini kopyalama fonksiyonu
window.copyItemName = function(itemName) {
    navigator.clipboard.writeText(itemName).then(() => {
        // Kopyalama başarılı bildirimi göster
        const notification = document.createElement('div');
        notification.className = 'copy-notification';
        notification.textContent = 'İsim kopyalandı!';
        notification.style.position = 'fixed';
        notification.style.top = '20px';
        notification.style.left = '50%';
        notification.style.transform = 'translateX(-50%)';
        notification.style.backgroundColor = '#28a745';
        notification.style.color = 'white';
        notification.style.padding = '10px 20px';
        notification.style.borderRadius = '5px';
        notification.style.zIndex = '1000';
        notification.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
        
        document.body.appendChild(notification);
        
        // 2 saniye sonra bildirimi kaldır
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transition = 'opacity 0.5s ease';
            setTimeout(() => notification.remove(), 500);
        }, 2000);
    });
}

// Tooltip'leri yenile
function refreshTooltips() {
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });
}

// Event listener'da tooltip yenilemesini ekleyelim
document.addEventListener('DOMContentLoaded', () => {
    // ... existing code ...
    
    // İlk tooltip'leri başlat
    refreshTooltips();
});

// Server seçimi için CSS ekleyelim
const style = document.createElement('style');
style.textContent = `
    #server {
        background-color: rgba(255, 255, 255, 0.1);
        color: white;
        border-color: rgba(255, 255, 255, 0.2);
    }
    #server:focus {
        border-color: rgba(255, 255, 255, 0.5);
        box-shadow: 0 0 0 0.2rem rgba(255, 255, 255, 0.1);
    }
    #server option {
        background-color: #fff;
        color: #000;
    }
`;
document.head.appendChild(style);

// Tema değiştirme fonksiyonu
function toggleTheme() {
    const body = document.body;
    const themeIcon = document.getElementById('themeIcon');
    
    // Tema değiştir
    if (body.classList.contains('dark-mode')) {
        body.classList.remove('dark-mode');
        localStorage.setItem('theme', 'light');
        themeIcon.classList.remove('fa-sun');
        themeIcon.classList.add('fa-moon');
    } else {
        body.classList.add('dark-mode');
        localStorage.setItem('theme', 'dark');
        themeIcon.classList.remove('fa-moon');
        themeIcon.classList.add('fa-sun');
    }
}

class CustomTooltip {
    constructor() {
        this.tooltip = document.createElement('div');
        this.tooltip.className = 'custom-tooltip';
        document.body.appendChild(this.tooltip);
        
        // Global event listener'ları ekle
        document.addEventListener('mouseover', (e) => {
            // Tüm title özelliklerini kaldır
            const element = e.target;
            if (element.hasAttribute('title')) {
                element.removeAttribute('title');
            }
        }, true);
    }

    show(element, data) {
        const content = this.createTooltipContent(data);
        this.tooltip.innerHTML = content;
        this.tooltip.classList.add('show');
        
        // İlk pozisyonu ayarla
        const rect = element.getBoundingClientRect();
        this.positionTooltip({
            clientX: rect.left + rect.width / 2,
            clientY: rect.top
        });
    }

    hide() {
        this.tooltip.classList.remove('show');
    }

    positionTooltip(e) {
        const tooltipRect = this.tooltip.getBoundingClientRect();
        const margin = 10;
        
        // Sayfa kenarlarına göre pozisyon ayarlama
        let x = e.clientX + margin;
        let y = e.clientY + margin;

        if (x + tooltipRect.width > window.innerWidth) {
            x = e.clientX - tooltipRect.width - margin;
        }
        
        if (y + tooltipRect.height > window.innerHeight) {
            y = e.clientY - tooltipRect.height - margin;
        }

        this.tooltip.style.left = `${x}px`;
        this.tooltip.style.top = `${y}px`;
    }

    createTooltipContent(data) {
        const priceChange = this.calculatePriceChange(data.market_price, data.black_market_price);
        const timeAgo = this.getRelativeTime(data.market_update);
        
        return `
            <div class="custom-tooltip-header">
                ${data.item_name}
            </div>
            <div class="custom-tooltip-content">
                <span class="custom-tooltip-label">Kalite:</span>
                <span class="custom-tooltip-value">${data.quality}</span>
                
                <span class="custom-tooltip-label">Şehir:</span>
                <span class="custom-tooltip-value">${data.market_city}</span>
                
                <span class="custom-tooltip-label">Market Fiyatı:</span>
                <span class="custom-tooltip-value">${this.formatNumber(data.market_price)} Silver</span>
                
                <span class="custom-tooltip-label">Black Market:</span>
                <span class="custom-tooltip-value">${this.formatNumber(data.black_market_price)} Silver</span>
                
                <span class="custom-tooltip-label">Kâr:</span>
                <span class="custom-tooltip-value">${this.formatNumber(data.profit)} Silver</span>
                
                <span class="custom-tooltip-label">Değişim:</span>
                <span class="custom-tooltip-value" style="color: ${priceChange.color}">
                    ${priceChange.percentage}%
                </span>
            </div>
            <div class="custom-tooltip-footer">
                Son güncelleme: ${timeAgo}
            </div>
        `;
    }

    calculatePriceChange(marketPrice, blackMarketPrice) {
        const change = ((blackMarketPrice - marketPrice) / marketPrice) * 100;
        return {
            percentage: change.toFixed(2),
            color: change >= 0 ? '#4caf50' : '#f44336'
        };
    }

    formatNumber(number) {
        return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    getRelativeTime(timestamp) {
        const now = new Date();
        const past = new Date(timestamp);
        const diffInSeconds = Math.floor((now - past) / 1000);

        if (diffInSeconds < 60) return `${diffInSeconds} saniye önce`;
        if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} dakika önce`;
        if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} saat önce`;
        return `${Math.floor(diffInSeconds / 86400)} gün önce`;
    }
}

// Kullanımı
document.addEventListener('DOMContentLoaded', () => {
    const tooltip = new CustomTooltip();

    // Tablo hücrelerine tooltip ekle
    document.querySelectorAll('td').forEach(cell => {
        // Varsayılan title özelliğini kaldır
        cell.removeAttribute('title');
        
        // Eğer hücrede resim varsa, resmin title özelliğini de kaldır
        const img = cell.querySelector('img');
        if (img) {
            img.removeAttribute('title');
        }
        
        cell.addEventListener('mouseenter', (e) => {
            const row = e.target.closest('tr');
            if (row) {
                const data = {
                    item_name: row.querySelector('.item-name').textContent,
                    quality: row.dataset.quality,
                    market_city: row.dataset.city,
                    market_price: parseInt(row.dataset.marketPrice),
                    black_market_price: parseInt(row.dataset.blackMarketPrice),
                    profit: parseInt(row.dataset.profit),
                    market_update: row.dataset.updateTime
                };
                tooltip.show(e.target, data);
            }
        });

        cell.addEventListener('mouseleave', () => {
            tooltip.hide();
        });
    });
});

// İtem ekleme işlevi
function handleAddItem(button) {
    const itemId = button.dataset.itemId;
    const itemName = button.dataset.itemName;
    const marketPrice = parseFloat(button.dataset.marketPrice);
    
    // Tüm item verilerini bul
    const item = allData.find(item => item.item_id === itemId);
    
    if (item) {
        // Butona tıklama efekti
        button.classList.add('clicked');
        
        // İtemi alınanlar listesine ekle
        purchasedItems.add(item);
        
        // Bildirim göster
        showNotification(`${itemName} alınanlar listesine eklendi!`);
        
        // Buton animasyonunu kaldır
        setTimeout(() => {
            button.classList.remove('clicked');
        }, 1000);

        // Eğer itemleri gizleme aktifse, tabloyu hemen güncelle
        if (hidePurchasedItems) {
            // Tüm tabloyu yeniden filtrele ve göster
            filterAndDisplayData();
            
            // Eğer mevcut sayfa boşsa, bir önceki sayfaya git
            const currentPageItems = getCurrentPageItems();
            if (currentPageItems.length === 0 && currentPage > 1) {
                currentPage--;
                filterAndDisplayData();
            }
        }
    }
}

// Mevcut sayfadaki itemları getiren yardımcı fonksiyon
function getCurrentPageItems() {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return filteredItems.slice(startIndex, endIndex);
}

// Bildirim gösterme fonksiyonu
function showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'success-notification';
    notification.innerHTML = `
        <i class="fas fa-check-circle me-2"></i>
        ${message}
    `;
    
    document.body.appendChild(notification);
    
    // Force reflow
    notification.offsetHeight;
    
    // Göster
    notification.classList.add('show');
    
    // 3 saniye sonra kaldır
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Event listener'ları ekle
document.addEventListener('click', (e) => {
    if (e.target.closest('.add-item-btn')) {
        handleAddItem(e.target.closest('.add-item-btn'));
    } else if (e.target.closest('.clear-all-btn')) {
        purchasedItems.clearAll();
    }
});

// Alınan itemler için store'u güncelle
const purchasedItems = {
    items: [],
    
    add(item) {
        const purchaseTime = new Date();
        this.items.unshift({
            ...item,
            purchaseTime,
            id: Date.now(),
            quantity: 1 // Varsayılan miktar
        });
        this.updateCount();
        this.saveToLocalStorage();
        updateTotalQuantity(); // Yeni item eklendiğinde toplam miktarı güncelle
    },
    
    updateQuantity(id, newQuantity) {
        const item = this.items.find(item => item.id === id);
        if (item && newQuantity > 0) {
            item.quantity = parseInt(newQuantity);
            this.saveToLocalStorage();
            displayPurchasedItems(); // Tabloyu güncelle
        }
    },
    
    getTotalItems() {
        return this.items.reduce((total, item) => total + (parseInt(item.quantity) || 1), 0);
    },
    
    remove(id) {
        this.items = this.items.filter(item => item.id !== id);
        this.updateCount();
        this.saveToLocalStorage();
        updateTotalQuantity(); // Item silindiğinde toplam miktarı güncelle
    },
    
    updateCount() {
        const badge = document.querySelector('.purchased-count');
        if (badge) {
            badge.textContent = this.items.length;
        }
    },
    
    saveToLocalStorage() {
        localStorage.setItem('purchasedItems', JSON.stringify(this.items));
    },
    
    loadFromLocalStorage() {
        const saved = localStorage.getItem('purchasedItems');
        if (saved) {
            this.items = JSON.parse(saved);
            this.updateCount();
        }
    },
    
    clearAll() {
        if (this.items.length === 0) return;
        
        if (confirm('Tüm alınan itemleri silmek istediğinizden emin misiniz?')) {
            this.items = [];
            this.updateCount();
            this.saveToLocalStorage();
            displayPurchasedItems();
            updateTotalQuantity();
            showNotification('Tüm itemler başarıyla silindi');
        }
    }
};

// Sayfa yüklendiğinde alınan itemleri yükle
document.addEventListener('DOMContentLoaded', () => {
    purchasedItems.loadFromLocalStorage();
    updateTotalQuantity(); // Sayfa yüklendiğinde toplam miktarı hesapla
    
    // View type değişikliğini dinle
    document.querySelectorAll('input[name="viewType"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const viewType = e.target.value;
            toggleTableView(viewType);
        });
    });
});

// Tablo görünümünü değiştir
function toggleTableView(viewType) {
    const potentialTable = document.getElementById('potentialItemsTable');
    const purchasedTable = document.getElementById('purchasedItemsTable');
    
    if (viewType === 'potential') {
        potentialTable.style.display = 'block';
        purchasedTable.style.display = 'none';
        filterAndDisplayData(); // Mevcut tabloyu güncelle
    } else {
        potentialTable.style.display = 'none';
        purchasedTable.style.display = 'block';
        displayPurchasedItems(); // Alınan itemler tablosunu güncelle
    }
}

// Alınan itemler tablosunu güncelle
function displayPurchasedItems() {
    const tbody = document.querySelector('#purchasedItemsTable tbody');
    tbody.innerHTML = '';
    
    purchasedItems.items.forEach(item => {
        const quantity = parseInt(item.quantity) || 1;
        
        const totalProfit = calculateItemProfit(item);
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="text-center">
                <img src="${getItemImageUrl(item.item_id)}" 
                     alt="${item.item_name}" 
                     class="item-image"
                     style="width: 40px; height: 40px;">
            </td>
            <td class="text-center"><strong>${item.item_name}</strong></td>
            <td class="text-center">${formatNumber(item.market_price)}</td>
            <td class="text-center">${formatNumber(item.black_market_price)}</td>
            <td class="text-center">
                <div class="quantity-control">
                    <button class="btn btn-sm btn-outline-secondary quantity-btn" 
                            onclick="updateItemQuantity(${item.id}, ${quantity - 1})">
                        <i class="fas fa-minus"></i>
                    </button>
                    <span class="quantity-value mx-2">${quantity}</span>
                    <button class="btn btn-sm btn-outline-secondary quantity-btn"
                            onclick="updateItemQuantity(${item.id}, ${quantity + 1})">
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
            </td>
            <td class="text-center profit-value ${totalProfit >= 0 ? 'positive' : 'negative'}">
                ${formatNumber(totalProfit)}
            </td>
            <td class="text-center">${new Date(item.purchaseTime).toLocaleString('tr-TR')}</td>
            <td class="text-center">
                <button class="btn btn-sm btn-outline-danger remove-item-btn"
                        data-item-id="${item.id}">
                    <i class="fas fa-times"></i>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
    
    // Özet bilgileri güncelle
    updatePurchasedSummary();
    updateTotalItems(); // Toplam item sayısını güncelle
}

// Miktar güncelleme fonksiyonu
function updateItemQuantity(itemId, newQuantity) {
    if (newQuantity > 0) {
        purchasedItems.updateQuantity(itemId, newQuantity);
        displayPurchasedItems(); // Tabloyu güncelle
        updateTotalQuantity(); // Toplam miktarı güncelle
    }
}

// Toplam item sayısını güncelleyen fonksiyon
function updateTotalItems() {
    const totalQuantity = purchasedItems.items.reduce((total, item) => total + (parseInt(item.quantity) || 1), 0);
    document.getElementById('totalItems').textContent = totalQuantity;
}

// Item başına kâr hesaplama fonksiyonu
function calculateItemProfit(item) {
    const quantity = parseInt(item.quantity) || 1;
    const TAX_RATE = 0.04;
    
    const totalSale = item.black_market_price * quantity;
    const afterTax = totalSale * (1 - TAX_RATE);
    const totalCost = item.market_price * quantity;
    
    return afterTax - totalCost;
}

// İtem silme işlevi
document.addEventListener('click', (e) => {
    if (e.target.closest('.remove-item-btn')) {
        const button = e.target.closest('.remove-item-btn');
        const itemId = parseInt(button.dataset.itemId);
        
        purchasedItems.remove(itemId);
        displayPurchasedItems();
        
        showNotification('İtem listeden kaldırıldı');
    }
});

// Toggle butonunun görünümünü güncelle
function updateToggleButton(isActive) {
    const button = document.getElementById('togglePurchased');
    const icon = button.querySelector('i');
    
    if (isActive) {
        button.classList.add('active');
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
        button.setAttribute('data-bs-original-title', 'Alınan itemleri göster');
    } else {
        button.classList.remove('active');
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
        button.setAttribute('data-bs-original-title', 'Alınan itemleri gizle');
    }
}

// İstatistikleri güncelleme fonksiyonunu da güncelleyelim
function updateStats() {
    document.getElementById('totalItems').textContent = allData.length;
    document.getElementById('filteredItems').textContent = filteredItems.length;
    
    if (hidePurchasedItems) {
        document.getElementById('filteredItems').textContent += 
            ` (${purchasedItems.items.length} item gizli)`;
    }
}

// Özet bilgileri hesaplama ve güncelleme fonksiyonu
function updatePurchasedSummary() {
    const items = purchasedItems.items;
    let totalSpent = 0;
    let totalSales = 0;
    let totalProfit = 0;

    items.forEach(item => {
        const quantity = parseInt(item.quantity) || 1;
        totalSpent += item.market_price * quantity;
        totalSales += item.black_market_price * quantity;
        totalProfit += calculateItemProfit(item);
    });

    // Toplam değerleri güncelle
    document.getElementById('totalSpent').textContent = formatNumber(totalSpent);
    document.getElementById('totalSales').textContent = formatNumber(totalSales);
    
    // Toplam Kâr için renklendirme
    const totalProfitElement = document.getElementById('totalProfit');
    totalProfitElement.textContent = formatNumber(totalProfit);
    totalProfitElement.className = 'summary-value ' + (totalProfit >= 0 ? 'positive' : 'negative');

    // Kâr Oranı için renklendirme
    const profitRate = totalSpent > 0 ? ((totalProfit / totalSpent) * 100).toFixed(2) : '0';
    const profitRateElement = document.getElementById('profitRate');
    profitRateElement.textContent = `${profitRate}%`;
    profitRateElement.className = 'summary-value ' + (parseFloat(profitRate) >= 0 ? 'positive' : 'negative');
}

// Toplam miktarı hesaplayan fonksiyon
function updateTotalQuantity() {
    const totalQuantity = purchasedItems.items.reduce((total, item) => {
        return total + (parseInt(item.quantity) || 1);
    }, 0);
    
    document.getElementById('totalQuantity').textContent = totalQuantity;
}

// Tüm itemleri silme fonksiyonu
function clearAllPurchasedItems() {
    // Onay modalı göster
    if (confirm('Tüm alınan itemler silinecek. Emin misiniz?')) {
        // Tüm itemleri sil
        purchasedItems.items = [];
        purchasedItems.updateCount();
        purchasedItems.saveToLocalStorage();
        
        // Tabloyu güncelle
        displayPurchasedItems();
        
        // Bildirim göster
        showNotification('Tüm itemler başarıyla silindi');
        
        // Toplam miktarı güncelle
        updateTotalQuantity();
    }
}

// Event listener'ları ekle
document.addEventListener('DOMContentLoaded', () => {
    // ... existing code ...
    
    // Temizle butonuna tıklama olayını ekle
    const clearButton = document.getElementById('clearAllItems');
    if (clearButton) {
        clearButton.addEventListener('click', (e) => {
            e.stopPropagation(); // Event'in yayılmasını engelle
            clearAllPurchasedItems();
        });
    }
});

// İtem resmi oluşturulurken
function createItemImage(itemId, itemName) {
    const img = document.createElement('img');
    img.src = getItemImageUrl(itemId);
    img.className = 'item-image';
    // Title ve alt özelliklerini ekleme
    return img;
}
