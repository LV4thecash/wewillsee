
function LicenseWatcher() {

  var _isLicValid = false;
  var _isConnected = false;
  var _deviceID = "";

  this.setLicenseValid = function (value, connected) {
    _isLicValid = value;
    _isConnected = connected;
    updateUI();
  }

  this.setDeviceID = function (value) {
    _deviceID = value;
  }

  this.isLicenseValid = function () {
    return _isLicValid;
  }

  this.isConnected = function () {
    return _isConnected;
  }

  this.getDeviceID = function () {
    return _deviceID;
  }

};

// Global State
var licWatcher = new LicenseWatcher()

chrome.identity.getProfileUserInfo(function (userInfo) {
  licWatcher.setDeviceID(userInfo.id);
});

document.addEventListener('DOMContentLoaded', function () {
  // Load stored addresses
  loadAddresses();

  // Setup Tab listeners
  document.getElementById('tab-account').addEventListener('click', openTabAccount);
  document.getElementById('tab-address').addEventListener('click', openTabAddress);
  document.getElementById('content-account').style.display = "block";

  // Setup button listeners
  document.getElementById('clear-btn').addEventListener('click', clearAddresses);
  document.getElementById('copy-all-btn').addEventListener('click', copyAllAddresses);

  // LoadUI based on license
  loadUI();
});

// Load addresses from storage
function loadAddresses() {
  chrome.storage.local.get(['addresses'], function (result) {
    const addresses = result.addresses || [];
    const container = document.getElementById('addresses-container');

    if (addresses.length === 0) {
      container.innerHTML = '<p>No addresses found yet.</p>';
      return;
    }

    // Sort addresses by timestamp (newest first)
    addresses.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Generate HTML
    container.innerHTML = addresses.map(item => `
        <div class="address-item">
          <div class="address">${item.address}</div>
          <div class="channel">Channel: ${item.channel}</div>
          <div class="timestamp">Found: ${new Date(item.timestamp).toLocaleString()}</div>
          ${item.sender ? `<div class="sender">From: ${item.sender}</div>` : ''}
          ${item.message ? `<div class="message" style="overflow-wrap: break-word;">Message: ${item.message.substring(0, 50)}${item.message.length > 50 ? '...' : ''}</div>` : ''}
          <button class="copy-btn btn-style-rev mt-5 mb-5" data-address="${item.address}" style="border-radius: 8px;">Copy</button>
        </div>
      `).join('');

    // Add event listeners to copy buttons
    document.querySelectorAll('.copy-btn').forEach(button => {
      button.addEventListener('click', function () {
        const address = this.getAttribute('data-address');
        navigator.clipboard.writeText(address)
          .then(() => {
            this.textContent = 'Copied!';
            setTimeout(() => {
              this.textContent = 'Copy';
            }, 1500);
          });
      });
    });
  });
}

// Clear all stored addresses
function clearAddresses() {
  if (!licWatcher.isLicenseValid() || !licWatcher.isConnected()) {
    return;
  }

  chrome.storage.local.set({ addresses: [] }, function () {
    loadAddresses();
  });
}

// Copy all addresses to clipboard
function copyAllAddresses() {
  if (!licWatcher.isLicenseValid() || !licWatcher.isConnected()) {
    return;
  }

  chrome.storage.local.get(['addresses'], function (result) {
    const addresses = result.addresses || [];
    if (addresses.length === 0) return;

    const text = addresses.map(item => item.address).join('\n');
    navigator.clipboard.writeText(text)
      .then(() => {
        document.getElementById('copy-all-btn').textContent = 'Copied!';
        setTimeout(() => {
          document.getElementById('copy-all-btn').textContent = 'Copy All';
        }, 1500);
      });
  });
}

// Listen for real-time updates
chrome.runtime.onMessage.addListener(function (message) {
  if (message.action === 'addressFound') {
    loadAddresses();
  }
});

// initUI
function loadUI() {

  // init button event
  document.getElementById('item-disconnect-btn').addEventListener('click', () => {

    // licWatcher.setLicenseValid(licWatcher.isLicenseValid(), !licWatcher.isConnected());
    setConnectionState();
    // updateConnectionState();
  });

  // update UI
  validLicense();
}

function updateUI() {

  // alert("updateUI: " + licWatcher.isLicenseValid());

  // show button or license input
  document.getElementById('container-connect').style.display = licWatcher.isLicenseValid() ? 'flex' : "none";
  document.getElementById('container-license').style.display = licWatcher.isLicenseValid() ? 'none' : "flex";

  // connection state
  if (licWatcher.isLicenseValid()) {
    updateConnectionState();
  }

  // check valid license
  if (!licWatcher.isLicenseValid()) {
    document.getElementById("device-id").textContent = licWatcher.getDeviceID();
    document.getElementById("license-input").addEventListener("input", function () {
      const license = document.getElementById("license-input").value;
      if (checkLicense(license)) {
        updateUI()
      }
    });
  }
}

// Update connection state
function updateConnectionState() {
  document.getElementById('item-connect').innerHTML = licWatcher.isConnected() ? `&#9679; Connected` : `&#9679; Disconnected`;
  document.getElementById('item-connect').style = licWatcher.isConnected() ? "color: chartreuse;" : "color: #00002b;";
  document.getElementById('item-disconnect-btn').innerHTML = licWatcher.isConnected() ? "Disconnect" : "Connect";
}

// Load license and display items based on license
function validLicense() {

  chrome.storage.local.get('license', function (result) {

    var licValid = false;
    var connected = false;
    if (result.license) {

      // connection state
      connected = result.license.connected;

      // license state
      try {
        var bf = new Blowfish("ABCDEFGH");
        var encrypted = bf.base64Decode(result.license.license);
        var decrypted = bf.decrypt(encrypted).replaceAll("\0", "");

        licValid = licWatcher.getDeviceID() === decrypted;
      } catch (ex) {
        if (window.console && console.log) {
          console.log(ex)
        }
      }
    }

    // update state
    licWatcher.setLicenseValid(licValid, connected)

    return true;
  });
}

function checkLicense(license) {

  try {
    var bf = new Blowfish("ABCDEFGH");
    var encrypted = bf.base64Decode(license);
    var decrypted = bf.decrypt(encrypted).replaceAll("\0", "");
    var connected = licWatcher.isConnected();

    if (licWatcher.getDeviceID() === decrypted) {
      chrome.runtime.sendMessage(
        {
          action: 'license',
          license: { license, connected }
        },
        response => {
          validLicense();
        }
      );
    }
  } catch (ex) {
    if (window.console && console.log) {
      console.log(ex)
    }
  }

  return false;
}

// 
function setConnectionState() {

  chrome.storage.local.get('license', function (result) {
    if (result.license) {

      var license = result.license.license;
      connected = !result.license.connected;

      chrome.runtime.sendMessage(
        {
          action: 'license',
          license: { license, connected }
        },
        response => {
          validLicense();
        }
      );
    }
  });
}

function openCity(cityName) {
  // Declare all variables
  var i, tabcontent, tablinks;

  // Get all elements with class="tabcontent" and hide them
  tabcontent = document.getElementsByClassName("tabcontent");
  for (i = 0; i < tabcontent.length; i++) {
    tabcontent[i].style.display = "none";
  }

  // Get all elements with class="tablinks" and remove the class "active"
  // tablinks = document.getElementsByClassName("tablinks");
  // for (i = 0; i < tablinks.length; i++) {
  // tablinks[i].className = tablinks[i].className.replace(" active", "");
  // }

  // Show the current tab, and add an "active" class to the button that opened the tab
  document.getElementById(cityName).style.display = "block";
  // document.getElementById(cityName).style.border = "#FF0000 2px solid";


  // evt.currentTarget.className += " active";
  // document.getElementById(cityName).className += " active";
}

function openTabAccount() {
  openCity('content-account');
  document.getElementById('tab-account').style.border = "#FF0000 5px solid"
  document.getElementById('tab-address').style = "none";
}

function openTabAddress() {
  openCity('content-address');
  document.getElementById('tab-account').style = "none";
  document.getElementById('tab-address').style.border = "#FF0000 5px solid";
}