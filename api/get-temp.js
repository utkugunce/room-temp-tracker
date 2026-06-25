const { miCloudProtocol, miioProtocol, aqaraProtocol } = require('node-mihome');

// Initialize protocols on load
try {
  miioProtocol.init();
  aqaraProtocol.init();
} catch (e) {
  console.log('Protocol init info:', e.message);
}

module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password, region, deviceId } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const country = region || 'de'; // Default to Europe/Germany for Turkey
    
    // Login to Xiaomi Cloud using the correct miCloudProtocol object
    await miCloudProtocol.login(username, password);

    // Get list of devices
    const devices = await miCloudProtocol.getDevices(null, { country });

    // If no deviceId is provided, list all devices so the user can choose
    if (!deviceId) {
      // Find devices that look like thermometers (often have sensor, temp, th, lywsd in model/name)
      const filteredDevices = devices.map(d => ({
        id: d.id,
        name: d.name,
        model: d.model,
        address: d.address
      }));
      return res.status(200).json({ devices: filteredDevices });
    }

    // If deviceId is provided, read properties from MiCloud
    // Using Xiaomi Cloud MIoT API /miotspec/prop/get to fetch live state
    // Service ID (siid) 2, Property ID (piid) 1 is the standard for Temperature in Xiaomi BLE sensors
    const response = await miCloudProtocol.request('/miotspec/prop/get', {
      params: [
        { did: deviceId, siid: 2, piid: 1 }, // Temperature
        { did: deviceId, siid: 2, piid: 2 }  // Humidity
      ]
    }, { country });

    // Check response and extract values
    if (response && response.list) {
      const tempItem = response.list.find(item => item.siid === 2 && item.piid === 1);
      const humidityItem = response.list.find(item => item.siid === 2 && item.piid === 2);
      
      const temperature = tempItem && tempItem.code === 0 ? tempItem.value : null;
      const humidity = humidityItem && humidityItem.code === 0 ? humidityItem.value : null;

      if (temperature !== null) {
        return res.status(200).json({ temperature, humidity });
      }
    }

    // Fallback: If MIoT spec request failed or returned error codes, try looking at the device list metadata
    const deviceFromList = devices.find(d => d.id === deviceId);
    if (deviceFromList && deviceFromList.extra) {
      // Sometimes BLE devices store their last beacon values under extra
      const extra = deviceFromList.extra;
      if (extra.temperature !== undefined) {
        return res.status(200).json({ 
          temperature: parseFloat(extra.temperature), 
          humidity: parseFloat(extra.humidity) 
        });
      }
    }

    return res.status(400).json({ 
      error: 'Device found, but failed to retrieve temperature properties.', 
      rawResponse: response 
    });

  } catch (error) {
    console.error('Xiaomi Cloud Error:', error);
    if (error.response) {
      return res.status(500).json({ 
        error: error.message,
        details: error.response
      });
    }
    return res.status(500).json({ error: error.message || 'Xiaomi Cloud authentication failed.' });
  }
};
