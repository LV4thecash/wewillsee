// telegram-helper.js - This gets injected into the Telegram tab
console.log("Telegram helper script loaded");

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Telegram helper received message:", request);
  
  if (request.action === "showPasteNotification") {
    // Create a floating notification
    const notification = document.createElement('div');
    notification.style.position = 'fixed';
    notification.style.top = '20px';
    notification.style.left = '50%';
    notification.style.transform = 'translateX(-50%)';
    notification.style.backgroundColor = '#4CAF50';
    notification.style.color = 'white';
    notification.style.padding = '15px 20px';
    notification.style.borderRadius = '5px';
    notification.style.zIndex = '9999';
    notification.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
    notification.style.fontSize = '14px';
    notification.style.textAlign = 'center';
    notification.innerHTML = `
      <div><strong>Address Copied to Clipboard!</strong></div>
      <div style="margin-top:5px;font-size:12px;">Press Ctrl+V to paste in Bloom chat</div>
      <div style="margin-top:10px;font-family:monospace;background:#333;padding:5px;border-radius:3px;font-size:12px;">${request.address}</div>
    `;
    
    // Add a close button
    const closeBtn = document.createElement('span');
    closeBtn.textContent = '×';
    closeBtn.style.position = 'absolute';
    closeBtn.style.right = '10px';
    closeBtn.style.top = '5px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontSize = '20px';
    closeBtn.onclick = () => notification.remove();
    notification.appendChild(closeBtn);
    
    document.body.appendChild(notification);
    
    // Auto remove after 15 seconds
    setTimeout(() => {
      if (document.body.contains(notification)) {
        notification.remove();
      }
    }, 15000);
    
    // Try to focus the input field to make pasting easier
    setTimeout(() => {
      const inputFields = [
        document.querySelector('.composer-input-input'),
        document.querySelector('.input-message-input'),
        document.querySelector('[contenteditable="true"]'),
        document.querySelector('div.input-message-container')
      ];
      
      for (const field of inputFields) {
        if (field) {
          field.focus();
          console.log("Found and focused input field");
          break;
        }
      }
    }, 500);
    
    sendResponse({success: true});
  }
  
  return true;
});

console.log("Telegram helper ready");