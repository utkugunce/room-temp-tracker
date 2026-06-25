// Service Worker Registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => console.log('Service Worker Registered'))
    .catch((err) => console.error('Service Worker registration failed:', err));
}

// Data Store
let logs = JSON.parse(localStorage.getItem('temp_logs')) || [];
let countdownInterval = null;

// Notification Permission Request
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(permission => {
      console.log('Notification permission:', permission);
    });
  }
}

// Schedule Notification (30 minutes later)
function scheduleNotification(closedTimeStr) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  // Save the target timestamp in localStorage to prevent losing it if app restarts
  const now = new Date();
  const [hours, minutes] = closedTimeStr.split(':').map(Number);
  const targetDate = new Date();
  targetDate.setHours(hours, minutes + 30, 0, 0);

  // If target date is in the past (e.g. crossed midnight), add a day
  if (targetDate < now) {
    targetDate.setDate(targetDate.getDate() + 1);
  }

  const delayMs = targetDate.getTime() - now.getTime();

  if (delayMs > 0) {
    localStorage.setItem('scheduled_notification_time', targetDate.getTime());
    
    // Set a client-side timeout in case app stays open
    setTimeout(() => {
      triggerLocalNotification();
    }, delayMs);

    // Also tell service worker to schedule it (some browsers keep SW alive longer or trigger on wake)
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SCHEDULE_NOTIFICATION',
        delay: delayMs
      });
    }
  }
}

function triggerLocalNotification() {
  const lastNotified = localStorage.getItem('last_notified_time');
  const todayStr = getTodayDateString();
  
  // Prevent duplicate notifications for the same day
  if (lastNotified === todayStr) return;

  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then(registration => {
      registration.showNotification('Derece Ölçüm Vakti! 🌡️', {
        body: 'Camı açalı 30 dakika oldu. Yeni oda sıcaklığını girmek için dokun.',
        icon: './icon-192.png',
        badge: './icon-192.png',
        vibrate: [200, 100, 200],
        tag: 'temp-measurement-reminder',
        renotify: true
      });
      localStorage.setItem('last_notified_time', todayStr);
    });
  } else {
    new Notification('Derece Ölçüm Vakti! 🌡️', {
      body: 'Camı açalı 30 dakika oldu. Yeni oda sıcaklığını girmek için dokun.',
      icon: './icon-192.png'
    });
    localStorage.setItem('last_notified_time', todayStr);
  }
}

// Check if we missed a scheduled notification while app was closed
function checkMissedNotifications() {
  const scheduledTime = localStorage.getItem('scheduled_notification_time');
  if (scheduledTime) {
    const now = new Date().getTime();
    if (now >= parseInt(scheduledTime, 10)) {
      // It's time or past time
      const todayStr = getTodayDateString();
      const todayLog = logs.find(l => l.date === todayStr);
      // Only notify if openTemp hasn't been logged yet
      if (todayLog && todayLog.openTemp === null) {
        triggerLocalNotification();
      }
      localStorage.removeItem('scheduled_notification_time');
    }
  }
}

// Run check on startup
checkMissedNotifications();
setInterval(checkMissedNotifications, 30000); // Check every 30 seconds


// Helper: Format Date
function getTodayDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateTurkish(dateStr) {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return d.toLocaleDateString('tr-TR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function getCurrentTimeString() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function get30MinsLaterTimeString(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const d = new Date();
  d.setHours(hours, minutes + 30, 0, 0);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Web Bluetooth API Reader for Xiaomi Thermometer
async function readTemperatureFromBLE(targetInputId, buttonId) {
  const btn = document.getElementById(buttonId);
  const input = document.getElementById(targetInputId);
  const originalText = btn.textContent;
  
  if (!('bluetooth' in navigator)) {
    alert('Bu tarayıcı veya cihaz Bluetooth bağlantısını desteklemiyor (Chrome/Edge kullanın). iOS desteklenmez.');
    return;
  }

  try {
    btn.textContent = '⏳';
    btn.disabled = true;

    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ['environmental_sensing', 'ebe0ccb0-7a0a-11e9-8f9b-00d056910805']
    });

    btn.textContent = '🔌 Bağlanıyor...';
    const server = await device.gatt.connect();

    btn.textContent = '📊 Okunuyor...';
    let temp = null;

    try {
      const service = await server.getPrimaryService('environmental_sensing');
      const characteristic = await service.getCharacteristic('temperature');
      const value = await characteristic.readValue();
      temp = value.getInt16(0, true) / 100;
    } catch (err) {
      console.log('Environmental sensing failed, trying Xiaomi service...', err);
      const service = await server.getPrimaryService('ebe0ccb0-7a0a-11e9-8f9b-00d056910805');
      const characteristic = await service.getCharacteristic('ebe0ccc1-7a0a-11e9-8f9b-00d056910805');
      const value = await characteristic.readValue();
      temp = value.getInt16(0, true) / 100;
    }

    if (temp !== null) {
      input.value = temp.toFixed(1);
      btn.textContent = '✅';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 2000);
    } else {
      throw new Error('Sıcaklık okunamadı.');
    }

    device.gatt.disconnect();

  } catch (error) {
    console.error('Bluetooth Hata:', error);
    alert('Bağlantı hatası: ' + error.message);
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// Xiaomi Cloud Reader for Thermometer
async function readTemperatureFromXiaomi(targetInputId, buttonId) {
  const btn = document.getElementById(buttonId);
  const input = document.getElementById(targetInputId);
  const originalText = btn.textContent;

  const username = localStorage.getItem('xiaomi_username');
  const password = localStorage.getItem('xiaomi_password');
  const region = localStorage.getItem('xiaomi_region') || 'de';
  const deviceId = localStorage.getItem('xiaomi_device_id');

  if (!username || !password || !deviceId) {
    showXiaomiSettingsForm(targetInputId, buttonId);
    return;
  }

  try {
    btn.textContent = '⏳';
    btn.disabled = true;

    const response = await fetch('/api/get-temp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password, region, deviceId })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Buluttan okuma başarısız.');
    }

    if (data.temperature !== undefined) {
      input.value = parseFloat(data.temperature).toFixed(1);
      btn.textContent = '✅';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 2000);
    } else {
      throw new Error('Sıcaklık verisi alınamadı.');
    }
  } catch (error) {
    console.error('Xiaomi Bulut Hatası:', error);
    alert('Xiaomi Bulut Hatası: ' + error.message);
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// Show Xiaomi Settings Form Modal
function showXiaomiSettingsForm(targetInputId, buttonId) {
  let modal = document.getElementById('xiaomiSettingsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'xiaomiSettingsModal';
    modal.className = 'modal-overlay';
    document.body.appendChild(modal);
  }

  const savedUsername = localStorage.getItem('xiaomi_username') || '';
  const savedRegion = localStorage.getItem('xiaomi_region') || 'de';

  modal.innerHTML = `
    <div class="modal-content card">
      <h3 style="font-family: var(--font-title); font-weight: 700; font-size: 1.2rem; margin-bottom: 8px;">☁️ Xiaomi Home Bulut Bağlantısı</h3>
      <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 16px;">
        Termometre derecesini otomatik çekebilmek için Xiaomi hesabınızla giriş yapın. Bilgileriniz sadece tarayıcınızda güvenle saklanır.
      </p>
      <form id="xiaomiConfigForm" class="logging-flow">
        <div class="input-group">
          <label for="xiaomiUser">E-posta / Telefon / Mi ID</label>
          <input type="text" id="xiaomiUser" value="${savedUsername}" placeholder="ornek@mail.com" required>
        </div>
        <div class="input-group">
          <label for="xiaomiPass">Xiaomi Şifresi</label>
          <input type="password" id="xiaomiPass" placeholder="••••••••" required>
        </div>
        <div class="input-group">
          <label for="xiaomiRegion">Bölge (Server)</label>
          <select id="xiaomiRegion" style="background: rgba(10, 8, 20, 0.6); border: 1px solid rgba(255, 255, 255, 0.1); color: var(--text-primary); padding: 12px; border-radius: 8px; font-family: var(--font-body); outline: none;">
            <option value="de" ${savedRegion === 'de' ? 'selected' : ''}>Avrupa / Türkiye (de)</option>
            <option value="cn" ${savedRegion === 'cn' ? 'selected' : ''}>Çin (cn)</option>
            <option value="us" ${savedRegion === 'us' ? 'selected' : ''}>Amerika (us)</option>
            <option value="ru" ${savedRegion === 'ru' ? 'selected' : ''}>Rusya (ru)</option>
            <option value="sg" ${savedRegion === 'sg' ? 'selected' : ''}>Singapur (sg)</option>
          </select>
        </div>
        
        <button type="button" id="xiaomiListDevicesBtn" class="btn btn-secondary btn-sm" style="margin-top: 8px;">🔍 Cihazları Tara</button>

        <div class="input-group" id="xiaomiDeviceSelectGroup" style="display: none;">
          <label for="xiaomiDeviceSelect">Termometre Cihazı Seçin</label>
          <select id="xiaomiDeviceSelect" style="background: rgba(10, 8, 20, 0.6); border: 1px solid rgba(255, 255, 255, 0.1); color: var(--text-primary); padding: 12px; border-radius: 8px; font-family: var(--font-body); outline: none;">
            <!-- Devices will be listed here -->
          </select>
        </div>

        <div style="display: flex; gap: 12px; margin-top: 16px;">
          <button type="submit" id="xiaomiSaveConfigBtn" class="btn" style="flex: 1;" disabled>✓ Kaydet</button>
          <button type="button" id="xiaomiCloseModalBtn" class="btn btn-secondary">İptal</button>
        </div>
      </form>
    </div>
  `;

  modal.style.display = 'flex';

  document.getElementById('xiaomiCloseModalBtn').addEventListener('click', () => {
    modal.style.display = 'none';
  });

  const listBtn = document.getElementById('xiaomiListDevicesBtn');
  listBtn.addEventListener('click', async () => {
    const username = document.getElementById('xiaomiUser').value;
    const password = document.getElementById('xiaomiPass').value;
    const region = document.getElementById('xiaomiRegion').value;

    if (!username || !password) {
      alert('Lütfen kullanıcı adı ve şifrenizi girin.');
      return;
    }

    listBtn.textContent = '⏳ Cihazlar Aranıyor...';
    listBtn.disabled = true;

    try {
      const response = await fetch('/api/get-temp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password, region })
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Xiaomi error response details:', data);
        let errMsg = data.error || 'Cihaz listesi alınamadı.';
        if (data.details) {
          errMsg += '\nDetaylar: ' + JSON.stringify(data.details);
        }
        throw new Error(errMsg);
      }

      const selectGroup = document.getElementById('xiaomiDeviceSelectGroup');
      const select = document.getElementById('xiaomiDeviceSelect');
      
      if (data.devices && data.devices.length > 0) {
        select.innerHTML = data.devices.map(d => `<option value="${d.id}">${d.name} (${d.model})</option>`).join('');
        selectGroup.style.display = 'flex';
        document.getElementById('xiaomiSaveConfigBtn').disabled = false;
        listBtn.textContent = '🔍 Yeniden Tara';
        listBtn.disabled = false;
      } else {
        alert('Hesabınızda hiçbir cihaz bulunamadı.');
        listBtn.textContent = '🔍 Cihazları Tara';
        listBtn.disabled = false;
      }
    } catch (err) {
      alert('Hata: ' + err.message);
      listBtn.textContent = '🔍 Cihazları Tara';
      listBtn.disabled = false;
    }
  });

  document.getElementById('xiaomiConfigForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('xiaomiUser').value;
    const password = document.getElementById('xiaomiPass').value;
    const region = document.getElementById('xiaomiRegion').value;
    const deviceId = document.getElementById('xiaomiDeviceSelect').value;

    localStorage.setItem('xiaomi_username', username);
    localStorage.setItem('xiaomi_password', password);
    localStorage.setItem('xiaomi_region', region);
    localStorage.setItem('xiaomi_device_id', deviceId);

    modal.style.display = 'none';
    alert('Xiaomi entegrasyon ayarları kaydedildi!');
    
    readTemperatureFromXiaomi(targetInputId, buttonId);
  });
}

// Save & Load
function saveLogs() {
  localStorage.setItem('temp_logs', JSON.stringify(logs));
  renderApp();
}

// Stats Calculation
function calculateStats() {
  const completedLogs = logs.filter(l => l.closedTemp !== null && l.openTemp !== null);
  
  if (completedLogs.length === 0) {
    document.getElementById('statsRecommendation').textContent = 'Kayıt girdikçe şekillenecek';
    document.getElementById('statsAvgDrop').textContent = '-.- °C';
    document.getElementById('statsBestDrop').textContent = '-.- °C';
    return;
  }

  let totalDrop = 0;
  let bestDrop = -999;
  let coolerDays = 0;
  let warmerDays = 0;

  completedLogs.forEach(l => {
    const diff = l.closedTemp - l.openTemp; // positive means it cooled down
    totalDrop += diff;
    if (diff > bestDrop) {
      bestDrop = diff;
    }
    if (diff > 0) {
      coolerDays++;
    } else if (diff < 0) {
      warmerDays++;
    }
  });

  const avgDrop = totalDrop / completedLogs.length;

  document.getElementById('statsAvgDrop').textContent = `${avgDrop > 0 ? '' : ''}${avgDrop.toFixed(1)} °C`;
  document.getElementById('statsBestDrop').textContent = `${bestDrop.toFixed(1)} °C`;

  // Recommendation
  let recommendationText = '';
  if (coolerDays > warmerDays) {
    recommendationText = '🟢 Camı açmak odayı serinletiyor!';
  } else if (warmerDays > coolerDays) {
    recommendationText = '🔴 Camı açmak odayı daha sıcak yapıyor!';
  } else {
    if (avgDrop > 0) {
      recommendationText = '🟢 Camı açmak ortalamada daha iyi.';
    } else if (avgDrop < 0) {
      recommendationText = '🔴 Camı açmamak daha iyi görünüyor.';
    } else {
      recommendationText = '⚪ Fark etmiyor, sıcaklıklar dengeli.';
    }
  }
  document.getElementById('statsRecommendation').textContent = recommendationText;
}

// Render active panel (today's flow)
function renderActiveLog() {
  const container = document.getElementById('activeLogContainer');
  const todayStr = getTodayDateString();
  const todayLog = logs.find(l => l.date === todayStr);

  if (!todayLog) {
    // Step 1: Start entry (Window Closed temp)
    container.innerHTML = `
      <form id="startLogForm" class="logging-flow">
        <p style="color: var(--text-secondary); font-size: 0.95rem; margin-bottom: 8px;">
          Eve geldin. Cam kapalıyken oda sıcaklığını ve saati kaydet:
        </p>
        <div class="input-row">
          <div class="input-group" style="flex: 2;">
            <label for="closedTemp">Sıcaklık (°C)</label>
            <div style="display: flex; gap: 8px; width: 100%;">
              <input type="number" id="closedTemp" step="0.1" placeholder="24.5" required autofocus style="flex: 1; min-width: 0;">
              <button type="button" id="bleReadClosedBtn" class="btn btn-secondary btn-sm" title="Bluetooth ile Oku">🔵 BLE</button>
              <button type="button" id="xiaomiReadClosedBtn" class="btn btn-secondary btn-sm" title="Xiaomi Bulutundan Oku">☁️ Bulut</button>
            </div>
          </div>
          <div class="input-group" style="flex: 1;">
            <label for="closedTime">Giriş Saati</label>
            <input type="time" id="closedTime" value="${getCurrentTimeString()}" required style="width: 100%;">
          </div>
        </div>
        <button type="submit" class="btn">🚀 Kaydet ve Camı Aç</button>
      </form>
    `;

    document.getElementById('bleReadClosedBtn').addEventListener('click', () => {
      readTemperatureFromBLE('closedTemp', 'bleReadClosedBtn');
    });

    document.getElementById('xiaomiReadClosedBtn').addEventListener('click', () => {
      readTemperatureFromXiaomi('closedTemp', 'xiaomiReadClosedBtn');
    });

    document.getElementById('startLogForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const closedTemp = parseFloat(document.getElementById('closedTemp').value);
      const closedTime = document.getElementById('closedTime').value;
      
      // Request notification permission if not already decided
      requestNotificationPermission();

      logs.push({
        date: todayStr,
        closedTemp,
        closedTime,
        openTemp: null,
        openTime: null
      });
      saveLogs();
      
      // Schedule notification (30 minutes later)
      scheduleNotification(closedTime);
    });

  } else if (todayLog.openTemp === null) {
    // Step 2: Window opened, waiting/prompting for 30 minutes later temp
    const targetTime = get30MinsLaterTimeString(todayLog.closedTime);
    
    // Clear any previous interval to prevent memory leaks
    if (countdownInterval) clearInterval(countdownInterval);

    container.innerHTML = `
      <div class="logging-flow">
        <div class="waiting-state">
          <div class="waiting-timer" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <span>⏰</span>
              <strong>Cam Açıldı! (Saat ${todayLog.closedTime})</strong>
            </div>
            <div id="liveCountdown" style="font-family: var(--font-title); font-weight: 800; font-size: 1.1rem; color: var(--accent-cool); background: rgba(6, 182, 212, 0.1); padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(6, 182, 212, 0.2);">
              --:--
            </div>
          </div>
          <div class="waiting-info">
            <span>Hedef derece ölçüm saati: <strong>${targetTime}</strong></span>
            <button id="cancelTodayBtn" class="btn btn-secondary btn-sm btn-danger">Kaydı İptal Et</button>
          </div>
        </div>
        <form id="completeLogForm" class="logging-flow">
          <p style="color: var(--text-secondary); font-size: 0.95rem;">
            Camı açalı 30 dakika olduysa (veya ölçüm aldıysan) dereceyi gir:
          </p>
          <div class="input-row">
            <div class="input-group" style="flex: 2;">
              <label for="openTemp">30 Dakika Sonraki Sıcaklık (°C)</label>
              <div style="display: flex; gap: 8px; width: 100%;">
                <input type="number" id="openTemp" step="0.1" placeholder="22.5" required autofocus style="flex: 1; min-width: 0;">
                <button type="button" id="bleReadOpenBtn" class="btn btn-secondary btn-sm" title="Bluetooth ile Oku">🔵 BLE</button>
                <button type="button" id="xiaomiReadOpenBtn" class="btn btn-secondary btn-sm" title="Xiaomi Bulutundan Oku">☁️ Bulut</button>
              </div>
            </div>
            <div class="input-group" style="flex: 1;">
              <label for="openTime">Ölçüm Saati</label>
              <input type="time" id="openTime" value="${getCurrentTimeString()}" required style="width: 100%;">
            </div>
          </div>
          <button type="submit" class="btn">✓ Günü Kapat</button>
        </form>
      </div>
    `;

    document.getElementById('bleReadOpenBtn').addEventListener('click', () => {
      readTemperatureFromBLE('openTemp', 'bleReadOpenBtn');
    });

    document.getElementById('xiaomiReadOpenBtn').addEventListener('click', () => {
      readTemperatureFromXiaomi('openTemp', 'xiaomiReadOpenBtn');
    });

    // Live countdown calculations
    const [hours, minutes] = todayLog.closedTime.split(':').map(Number);
    const [year, month, day] = todayLog.date.split('-').map(Number);
    const targetDate = new Date(year, month - 1, day, hours, minutes + 30, 0, 0);

    function updateCountdownDisplay() {
      const countdownEl = document.getElementById('liveCountdown');
      if (!countdownEl) {
        clearInterval(countdownInterval);
        return;
      }
      
      const now = new Date();
      const diffMs = targetDate.getTime() - now.getTime();
      
      if (diffMs <= 0) {
        countdownEl.textContent = 'Ölçüm Vakti! 🌡️';
        countdownEl.style.color = 'var(--accent-success)';
        countdownEl.style.background = 'rgba(16, 185, 129, 0.1)';
        countdownEl.style.borderColor = 'rgba(16, 185, 129, 0.2)';
        clearInterval(countdownInterval);
      } else {
        const totalSecs = Math.floor(diffMs / 1000);
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        countdownEl.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
      }
    }

    updateCountdownDisplay();
    countdownInterval = setInterval(updateCountdownDisplay, 1000);

    document.getElementById('cancelTodayBtn').addEventListener('click', () => {
      if (confirm('Bugünkü yarım kalan kaydı silmek istediğine emin misin?')) {
        logs = logs.filter(l => l.date !== todayStr);
        saveLogs();
      }
    });

    document.getElementById('completeLogForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const openTemp = parseFloat(document.getElementById('openTemp').value);
      const openTime = document.getElementById('openTime').value;

      todayLog.openTemp = openTemp;
      todayLog.openTime = openTime;
      saveLogs();
    });

  } else {
    // Step 3: Completed for today
    const diff = todayLog.closedTemp - todayLog.openTemp;
    let resultMsg = '';
    if (diff > 0) {
      resultMsg = `Cam açıldıktan sonra oda <strong>${diff.toFixed(1)}°C serinledi</strong>.`;
    } else if (diff < 0) {
      resultMsg = `Cam açıldıktan sonra oda <strong>${Math.abs(diff).toFixed(1)}°C ısındı</strong>.`;
    } else {
      resultMsg = `Cam açıldıktan sonra oda sıcaklığı değişmedi.`;
    }

    container.innerHTML = `
      <div class="today-completed">
        <p>🎉 <strong>Bugünkü kayıt tamamlandı!</strong></p>
        <p>${resultMsg}</p>
        <div style="margin-top: 8px; display: flex; gap: 8px;">
          <button id="editTodayBtn" class="btn btn-secondary btn-sm">Girişi Düzenle</button>
        </div>
      </div>
    `;

    document.getElementById('editTodayBtn').addEventListener('click', () => {
      if (confirm('Bugünkü kaydı düzenlemek için açmak istiyor musun? (Açık derece silinecektir)')) {
        todayLog.openTemp = null;
        todayLog.openTime = null;
        saveLogs();
      }
    });
  }
}

// Render history table
function renderHistory() {
  const list = document.getElementById('historyList');
  const empty = document.getElementById('noHistory');
  
  // Sort logs by date descending
  const sortedLogs = [...logs].sort((a, b) => b.date.localeCompare(a.date));

  if (sortedLogs.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  
  empty.style.display = 'none';

  list.innerHTML = sortedLogs.map(l => {
    const closedText = l.closedTemp !== null ? `${l.closedTemp.toFixed(1)}°C` : '-';
    const openText = l.openTemp !== null ? `${l.openTemp.toFixed(1)}°C` : '-';
    
    let diffText = '-';
    let diffClass = 'same';
    
    if (l.closedTemp !== null && l.openTemp !== null) {
      const diff = l.closedTemp - l.openTemp;
      if (diff > 0) {
        diffText = `-${diff.toFixed(1)}°C (Serin)`;
        diffClass = 'cooler';
      } else if (diff < 0) {
        diffText = `+${Math.abs(diff).toFixed(1)}°C (Sıcak)`;
        diffClass = 'warmer';
      } else {
        diffText = 'Fark Yok';
        diffClass = 'same';
      }
    }

    return `
      <tr>
        <td style="font-weight: 500;">${formatDateTurkish(l.date)}</td>
        <td>
          <span class="temp-badge closed">${closedText}</span>
          <span class="time-label">${l.closedTime || ''}</span>
        </td>
        <td>
          <span class="temp-badge open">${openText}</span>
          <span class="time-label">${l.openTime || ''}</span>
        </td>
        <td>
          <span class="diff-badge ${diffClass}">${diffText}</span>
        </td>
        <td>
          <button class="btn btn-secondary btn-sm btn-danger delete-entry-btn" data-date="${l.date}" title="Kayıt Sil">🗑 Sil</button>
        </td>
      </tr>
    `;
  }).join('');

  // Add delete listeners
  document.querySelectorAll('.delete-entry-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const date = e.target.getAttribute('data-date');
      if (confirm(`${formatDateTurkish(date)} tarihli kaydı tamamen silmek istediğine emin misin?`)) {
        logs = logs.filter(l => l.date !== date);
        saveLogs();
      }
    });
  });
}

// Render main app
function renderApp() {
  calculateStats();
  renderActiveLog();
  renderHistory();
}

// Backup Export
document.getElementById('exportBtn').addEventListener('click', () => {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(logs, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `oda-derece-yedek-${getTodayDateString()}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
});

// Restore Import
const fileInput = document.getElementById('importFile');
document.getElementById('importBtn').addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const importedLogs = JSON.parse(event.target.result);
      if (Array.isArray(importedLogs)) {
        if (confirm('İçe aktarılan veriler mevcut verilerin üzerine yazılacak. Emin misin?')) {
          logs = importedLogs;
          saveLogs();
        }
      } else {
        alert('Geçersiz dosya formatı.');
      }
    } catch (err) {
      alert('Dosya okunurken hata oluştu: ' + err.message);
    }
  };
  reader.readAsText(file);
});

// Initial Render
renderApp();
