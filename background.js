// Updated background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'pasteToBloomTab') {
    console.log("Background script received request to paste:", request.address);

    // Find any open Telegram tabs (with more flexible URL matching)
    chrome.tabs.query({ url: "*://*.telegram.org/*" }, (tabs) => {
      if (tabs.length > 0) {
        console.log("Found Telegram tabs:", tabs.length);

        // Focus the tab
        chrome.tabs.update(tabs[0].id, { active: true });

        // Copy to clipboard
        navigator.clipboard.writeText(request.address).then(() => {
          console.log("Address copied to clipboard");

          // Notify user to paste manually (more reliable than automatic pasting)
          chrome.tabs.sendMessage(tabs[0].id, {
            action: "showPasteNotification",
            address: request.address
          }, (response) => {
            const lastError = chrome.runtime.lastError;
            if (lastError) {
              console.log('Error sending message to tab:', lastError.message);
              // If content script not ready, inject it
              chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                files: ['telegram-helper.js']
              }).then(() => {
                // Try sending the message again after script is injected
                setTimeout(() => {
                  chrome.tabs.sendMessage(tabs[0].id, {
                    action: "showPasteNotification",
                    address: request.address
                  });
                }, 100);
              });
            }
          });

          sendResponse({ success: true, message: "Address copied and tab focused" });
        }).catch(err => {
          console.error("Clipboard error:", err);
          sendResponse({ success: false, error: err.message });
        });

        return true; // Keep the message channel open
      } else {
        console.log("No Telegram tab found");
        // Open Telegram in a new tab
        chrome.tabs.create({ url: "https://web.telegram.org/k/#@BloomSolanaUS1_bot" }, (tab) => {
          sendResponse({ success: false, error: "Opened new Telegram tab" });
        });
        return true;
      }
    });

    return true; // Keep the message channel open

  }  else if (request.action === 'license') {
    console.log("request.license: ", request.license);
    chrome.storage.local.set({ license: request.license }, function () {
      sendResponse({ success: true, message: "License saved" });
    });
    return true;
  }

});