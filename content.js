// Regex pattern for Solana addresses (base58 encoded strings that are typically 32-44 characters long)
const solanaAddressRegex = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

// Track found addresses to avoid duplicates
let foundAddresses = new Set();

// Track all messages for debugging
let allMessages = [];

// Track processed message IDs to avoid duplicates
let processedMessageIds = new Set();

// Control scanning state
let isScanning = false;
let observer = null;

// Sliding window for cross-message detection
const messageWindow = [];
const MAX_WINDOW_SIZE = 10; // Keep last 10 messages for context

// NEW: Time-based buffer variables
const RECENT_MESSAGES_BUFFER = [];
const MAX_BUFFER_SIZE = 20; // Larger buffer
const BUFFER_TIME_WINDOW_MS = 10000; // 10 seconds

/**
 * Store verification results independently.
 * This helps us track the status of each address without interfering with others.
 */
const verificationResults = new Map();

/**
 * Create a more robust ID system for tracking verification badges.
 * We rely on the full address to ensure uniqueness.
 */
function createBadgeId(address) {
  return `verify-${address}`;
}

/**
 * Helper function to clean up detection results.
 */
function sanitizeAddress(address) {
  // Remove any HTML tags or attributes
  const cleanedAddress = address
    .replace(/<[^>]*>/g, '')
    .replace(/data-address="[^"]*"/g, '')
    .replace(/style="[^"]*"/g, '')
    .replace(/Verifying.../g, '')
    .trim();

  // Only keep the base58 characters (32-44 characters)
  const validChars = cleanedAddress.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  return validChars ? validChars[0] : null;
}

/**
 * Standardized function to display addresses in the DOM.
 * This ensures consistent styling and data attributes for all address types.
 */
function displayAddressInDOM(address, messageElement, isFromAI = false) {
  // Sanitize the address first
  const cleanAddress = sanitizeAddress(address);
  if (!cleanAddress) {
    console.log(`Invalid address format rejected: ${address}`);
    return null;
  }

  // Create a container for the address and its badges
  const addressContainer = document.createElement('div');
  addressContainer.style.display = 'inline-block';
  addressContainer.style.margin = '5px 0';

  // Create the address span with consistent styling
  const addressSpan = document.createElement('span');
  addressSpan.setAttribute('data-address', cleanAddress);
  addressSpan.style.backgroundColor = '#4CAF50';
  addressSpan.style.color = 'white';
  addressSpan.style.padding = '2px';
  addressSpan.style.borderRadius = '3px';
  addressSpan.style.display = 'inline-block';
  addressSpan.textContent = cleanAddress + ' ';

  // Create the verification badge
  const verificationBadge = document.createElement('span');
  verificationBadge.id = createBadgeId(cleanAddress) + "_" + Date.now();
  verificationBadge.setAttribute('data-address', cleanAddress);
  verificationBadge.style.marginLeft = '5px';
  verificationBadge.style.padding = '2px 5px';
  verificationBadge.style.borderRadius = '3px';
  verificationBadge.style.fontSize = '10px';
  verificationBadge.style.backgroundColor = '#7289DA';
  verificationBadge.style.color = 'white';
  verificationBadge.innerText = 'Verifying...';

  // Add the elements to the container
  addressContainer.appendChild(addressSpan);
  addressSpan.appendChild(verificationBadge);

  // Add the Bloom button - this ensures it's added for all address types
  addBloomButton(cleanAddress, addressSpan);

  // Add AI/reconstructed note if applicable
  if (isFromAI) {
    const aiNote = document.createElement('span');
    aiNote.style.fontSize = '10px';
    aiNote.style.color = '#888';
    aiNote.style.marginLeft = '5px';
    aiNote.textContent = '(AI/reconstructed)';
    addressSpan.appendChild(aiNote);
  }

  // Append to the message element with a line break
  if (messageElement) {
    messageElement.appendChild(document.createElement('br'));
    messageElement.appendChild(addressContainer);
  }

  return verificationBadge;
}

/**
 * Add a timeout to verifyTokenMint to prevent hanging.
 */
async function verifyTokenMint(address) {
  try {
    // Create a promise that will resolve with the verification result
    const verificationPromise = new Promise(async (resolve) => {
      try {
        const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
        const url = `https://quote-api.jup.ag/v6/quote?inputMint=${usdcMint}&outputMint=${address}&amount=1000000&slippageBps=50`;

        console.log(`Verifying token mint: ${address}`);
        const response = await fetch(url);
        const data = await response.json();

        if (response.ok) {
          if (data && data.data && data.data.outputMint) {
            let tokenName = "Unknown Token";
            if (data.data.routePlan && data.data.routePlan.length > 0) {
              const routeInfo = data.data.routePlan[0];
              if (routeInfo.swapInfo && routeInfo.swapInfo.label) {
                tokenName = routeInfo.swapInfo.label;
              }
            }
            resolve({
              verified: true,
              name: tokenName,
              platform: "Jupiter"
            });
          } else {
            resolve({ verified: true, name: "Unknown Token", platform: "Jupiter" });
          }
        } else {
          resolve({ verified: false, reason: data.error || "Not tradable on Jupiter" });
        }
      } catch (e) {
        resolve({ verified: false, reason: "API Error: " + e.message });
      }
    });

    // Create a timeout promise
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve({ verified: false, reason: "Verification timed out" });
      }, 8000); // 8 second timeout
    });

    // Race the verification against the timeout
    return Promise.race([verificationPromise, timeoutPromise]);
  } catch (error) {
    console.error(`Error verifying token: ${error.message}`);
    return { verified: false, reason: "API Error: " + error.message };
  }
}

/**
 * Enhanced token registry lookup (Jupiter + fallback to Solana-labs token list)
 */
async function checkTokenExists(address) {
  try {
    const url = `https://token.jup.ag/all`;
    console.log(`Checking token registry for: ${address}`);

    const response = await fetch(url);
    const tokens = await response.json();

    const tokenInfo = tokens.find(token =>
      token.address.toLowerCase() === address.toLowerCase()
    );

    if (tokenInfo) {
      console.log(`Token found in Jupiter registry:`, tokenInfo);
      return {
        verified: true,
        name: tokenInfo.name || tokenInfo.symbol || "Unknown",
        symbol: tokenInfo.symbol || "",
        platform: "Jupiter"
      };
    } else {
      const solanaListUrl = "https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/solana.tokenlist.json";
      const solanaListResponse = await fetch(solanaListUrl);
      const solanaList = await solanaListResponse.json();

      const solanaToken = solanaList.tokens.find(token =>
        token.address.toLowerCase() === address.toLowerCase()
      );

      if (solanaToken) {
        console.log(`Token found in Solana token list:`, solanaToken);
        return {
          verified: true,
          name: solanaToken.name || solanaToken.symbol || "Unknown",
          symbol: solanaToken.symbol || "",
          platform: "Solana"
        };
      }

      console.log(`Token not found in any registry`);
      return {
        verified: true,
        name: "Unknown Token",
        reason: "Token exists but no name found"
      };
    }
  } catch (error) {
    console.error(`Error checking token registry: ${error.message}`);
    return {
      verified: true,
      name: "Unknown Token",
      reason: "API Error: " + error.message
    };
  }
}

/**
 * Check if a token is on Pump.fun
 */
async function checkPumpFunToken(address) {
  try {
    const url = `https://api.pump.fun/token/${address}`;
    const response = await fetch(url);

    if (response.ok) {
      const data = await response.json();
      console.log(`Token found on Pump.fun:`, data);
      return {
        verified: true,
        name: data.name || data.symbol || "Pump.fun Token",
        platform: "Pump.fun"
      };
    } else {
      return { verified: true, name: "Unknown Token", platform: "Solana" };
    }
  } catch (error) {
    console.error(`Error checking Pump.fun: ${error.message}`);
    return { verified: true, name: "Unknown Token", platform: "Solana" };
  }
}

/* ===== NEW MULTI-API VERIFICATION FUNCTIONS ===== */

/**
 * Helper function to add timeout to any verification method
 */
function verifyWithTimeout(verifyFn, address, timeout) {
  return new Promise(async (resolve, reject) => {
    // Create a timeout that will reject after the specified time
    const timeoutId = setTimeout(() => {
      reject(new Error(`Verification timed out after ${timeout}ms`));
    }, timeout);

    try {
      // Call the verification function
      const result = await verifyFn(address);

      // Clear the timeout since we got a result
      clearTimeout(timeoutId);

      if (result.verified) {
        resolve(result);
      } else {
        reject(new Error(result.reason || "Verification failed"));
      }
    } catch (error) {
      clearTimeout(timeoutId);
      reject(error);
    }
  });
}

/**
 * Jupiter verification method (existing, renamed)
 */
async function verifyJupiterToken(address) {
  try {
    const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const url = `https://quote-api.jup.ag/v6/quote?inputMint=${usdcMint}&outputMint=${address}&amount=1000000&slippageBps=50`;

    console.log(`Jupiter verification for: ${address}`);
    const response = await fetch(url);
    const data = await response.json();

    if (response.ok) {
      if (data && data.data && data.data.outputMint) {
        let tokenName = "Unknown Token";
        if (data.data.routePlan && data.data.routePlan.length > 0) {
          const routeInfo = data.data.routePlan[0];
          if (routeInfo.swapInfo && routeInfo.swapInfo.label) {
            tokenName = routeInfo.swapInfo.label;
          }
        }
        return {
          verified: true,
          name: tokenName,
          platform: "Jupiter"
        };
      } else {
        return { verified: true, name: "Unknown Token", platform: "Jupiter" };
      }
    } else {
      return { verified: false, reason: data.error || "Not tradable on Jupiter" };
    }
  } catch (error) {
    console.error(`Jupiter verification error: ${error.message}`);
    return { verified: false, reason: "Jupiter API Error: " + error.message };
  }
}

/**
 * Birdeye verification method (new)
 */
async function verifyBirdeyeToken(address) {
  try {
    // Using the Birdeye free API to check token info
    const url = `https://public-api.birdeye.so/public/tokenlist?address=${address}`;

    console.log(`Birdeye verification for: ${address}`);
    const response = await fetch(url);
    const data = await response.json();

    if (response.ok && data && data.success && data.data && data.data.length > 0) {
      const tokenInfo = data.data[0];
      return {
        verified: true,
        name: tokenInfo.symbol || tokenInfo.name || "Unknown Token",
        platform: "Birdeye"
      };
    } else {
      return { verified: false, reason: "Not found on Birdeye" };
    }
  } catch (error) {
    console.error(`Birdeye verification error: ${error.message}`);
    return { verified: false, reason: "Birdeye API Error: " + error.message };
  }
}

/**
 * Registry verification method (existing but used independently)
 * This is a faster check that only uses Jupiter's token list.
 */
async function verifyRegistryToken(address) {
  try {
    const url = `https://token.jup.ag/all`;
    console.log(`Registry verification for: ${address}`);

    const response = await fetch(url);
    const tokens = await response.json();

    const tokenInfo = tokens.find(token =>
      token.address.toLowerCase() === address.toLowerCase()
    );

    if (tokenInfo) {
      return {
        verified: true,
        name: tokenInfo.name || tokenInfo.symbol || "Unknown",
        symbol: tokenInfo.symbol || "",
        platform: "Jupiter Registry"
      };
    } else {
      return { verified: false, reason: "Not in token registry" };
    }
  } catch (error) {
    console.error(`Registry verification error: ${error.message}`);
    return { verified: false, reason: "Registry Error: " + error.message };
  }
}

/**
 * Improved verification function with multiple APIs
 */
async function verifyTokenWithMultipleAPIs(address) {
  console.log(`Starting multi-API verification for: ${address}`);

  // Create an array of verification methods, each with its own timeout
  const verificationMethods = [
    // Jupiter verification (existing)
    verifyWithTimeout(verifyJupiterToken, address, 8000),

    // Birdeye verification (new)
    verifyWithTimeout(verifyBirdeyeToken, address, 8000),

    // Token registry lookup (fastest)
    verifyWithTimeout(verifyRegistryToken, address, 5000)
  ];

  // Execute all methods in parallel and return the first successful result
  try {
    // Use Promise.any to get the first successful verification
    const result = await Promise.any(verificationMethods);
    console.log(`Successful verification for ${address} via ${result.platform}`);
    return result;
  } catch (error) {
    // If all verifications failed
    console.warn(`All verification methods failed for ${address}`);
    // return { verified: false, reason: "Failed verification with all APIs" };
  }

  return { verified: false, reason: "Failed verification with all APIs" };
}

/**
 * Perform a full token verification:
 * Validate the address format and use the new multi-API verification.
 */
async function fullTokenVerification(address) {
  if (!address || address.length < 32 || address.length > 44) {
    return { verified: false, reason: "Invalid address format" };
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(address)) {
    return { verified: false, reason: "Invalid address characters" };
  }

  // Use our new multi-API verification
  return await verifyTokenWithMultipleAPIs(address);
}

/* ===== END NEW MULTI-API VERIFICATION FUNCTIONS ===== */

/**
 * Function to send a detected address to Bloom bot via background script
 */
function sendToBloomBot(address) {
  // Don't send if we've already sent this address
  if (bloomSentAddresses.has(address)) {
    console.log(`Address ${address} already sent to Bloom`);
    return;
  }

  console.log(`Sending address to Bloom: ${address}`);

  // Keep track of sent addresses
  bloomSentAddresses.add(address);

  // Play notification sound
  try {
    const audio = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-alert-quick-chime-766.mp3');
    audio.volume = 0.5;
    audio.play();
  } catch (e) {
    console.error("Error playing notification sound:", e);
  }

  // Send message to background script to handle Telegram interaction
  chrome.runtime.sendMessage(
    {
      action: 'pasteToBloomTab',
      address: address
    },
    response => {
      if (response && response.success) {
        console.log("Background script successfully processed the address");
      } else {
        console.error("Error from background script:", response ? response.error : "No response");
      }
    }
  );

  // Add a visual indicator that this address was sent
  addSentIndicator(address);
}

// Set to track addresses already sent to Bloom
const bloomSentAddresses = new Set();

/**
 * Add visual indicator that address was sent to Bloom
 */
function addSentIndicator(address) {
  // Find any elements with this address
  const addressElements = document.querySelectorAll(`[data-address="${address}"]`);

  addressElements.forEach(el => {
    const sentIndicator = document.createElement('span');
    sentIndicator.textContent = '🚀 Sent to Bloom';
    sentIndicator.style.marginLeft = '5px';
    sentIndicator.style.backgroundColor = '#0088cc';
    sentIndicator.style.color = 'white';
    sentIndicator.style.padding = '2px 5px';
    sentIndicator.style.borderRadius = '3px';
    sentIndicator.style.fontSize = '10px';

    el.parentNode.appendChild(sentIndicator);
  });
}

/**
 * Updated addBloomButton function that's more robust.
 */
function addBloomButton(address, container) {
  if (!container) return;

  // Check if button already exists
  const existingButtons = container.querySelectorAll('button');
  for (const btn of existingButtons) {
    if (btn.innerText.includes('Bloom')) {
      return; // Button already exists, don't add another
    }
  }

  const bloomBtn = document.createElement('button');
  bloomBtn.innerText = '🚀 Send to Bloom';
  bloomBtn.setAttribute('data-address', address); // Add data attribute for Bloom extension
  bloomBtn.style.marginLeft = '5px';
  bloomBtn.style.padding = '2px 5px';
  bloomBtn.style.backgroundColor = '#0088cc';
  bloomBtn.style.color = 'white';
  bloomBtn.style.border = 'none';
  bloomBtn.style.borderRadius = '3px';
  bloomBtn.style.fontSize = '10px';
  bloomBtn.style.cursor = 'pointer';

  bloomBtn.addEventListener('click', () => {
    sendToBloomBot(address);
    bloomBtn.disabled = true;
    bloomBtn.innerText = 'Sent ✓';
  });

  container.appendChild(bloomBtn);
}

/**
 * Update all badges for a given address
 */
function updateAllBadgesForAddress(address, info) {
  const badges = document.querySelectorAll(`[data-address="${address}"]`);

  badges.forEach(badge => {
    // Skip if this is a button or container with children
    if (badge.tagName === 'BUTTON' || badge.children.length > 0) return;

    if (info.verified) {
      badge.style.backgroundColor = '#4CAF50';
      badge.innerText = info.name;
      badge.title = `Verified on ${info.platform}`;
    } else {
      badge.style.backgroundColor = '#F44336';
      badge.innerText = 'Unverified';
      badge.title = info.reason || 'Unknown Reason';
    }
  });
}

/**
 * Update the verification badge in the DOM for a single instance.
 */
function updateVerificationBadge(address, info) {
  const badgeId = createBadgeId(address);
  const badge = document.getElementById(badgeId);

  if (badge) {
    if (info.verified) {
      badge.style.backgroundColor = '#4CAF50';
      badge.innerText = info.name;
      badge.title = `Verified on ${info.platform}`;
    } else {
      badge.style.backgroundColor = '#F44336';
      badge.innerText = 'Unverified';
      badge.title = info.reason || 'Unknown Reason';
    }
  }
}

/**
 * Function to get message ID from element.
 */
function getMessageId(element) {
  let parent = element;
  while (parent && !parent.id && parent !== document.body) {
    parent = parent.parentElement;
  }
  return parent?.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Function to get current channel name and server (simplified).
 */
function getCurrentChannel() {
  try {
    const guildName =
      document.querySelector('[data-dnd-name]')?.getAttribute('data-dnd-name') ||
      'Unknown Server';
    const channelName =
      document.querySelector('h3[class*="title"]')?.textContent?.trim() ||
      'Unknown Channel';
    return `${guildName} / ${channelName}`;
  } catch (e) {
    console.error('Error getting channel:', e);
    return 'Unknown location';
  }
}

/**
 * Helper function to clean message text of timestamps.
 */
function cleanMessageText(text) {
  if (!text) return "";
  return text
    .replace(/Today at \d+:\d+\s*[AP]M/g, '')
    .replace(/\d+:\d+\s*[AP]M/g, '')
    .replace(/Yesterday at \d+:\d+/g, '')
    .replace(/\[\d+:\d+\s*[AP]M\]/g, '')
    .trim();
}

/**
 * Make a request to OpenAI to identify any split addresses that the regex may miss.
 */
async function detectSplitAddressesWithAI(text, prompt = aiPrompt, model = "gpt-3.5-turbo") {
  try {
    if (text.length < 20) return [];
    console.log("Sending to AI for split address detection:", text.substring(0, 50) + "...");
    console.log("Using prompt:", prompt);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Replace with your real API key or handle securely
        'Authorization': 'Bearer ' + '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'
      },
      body: JSON.stringify({
        model: model, // Use the specified model
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: `Analyze this text for potential split Solana addresses: "${text}"` }
        ],
        temperature: 0.3,
        max_tokens: 150
      })
    });

    const data = await response.json();
    console.log("AI response:", data);

    if (data.choices && data.choices.length > 0) {
      const aiResponse = data.choices[0].message.content.trim();
      const possibleAddresses = aiResponse
        .split('\n')
        .filter(addr => addr.length >= 32 && addr.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(addr));
      console.log('AI detected these potential addresses:', possibleAddresses);
      return possibleAddresses;
    }

    return [];
  } catch (error) {
    console.error('Error using AI to detect addresses:', error);
    return [];
  }
}

/**
 * Detect potential address parts in text.
 */
function findPotentialAddressParts(text) {
  const parts = [];
  const caMatches = text.match(/CA:?\s*([1-9A-HJ-NP-Za-km-z]{3,44})/g);
  if (caMatches) {
    for (const match of caMatches) {
      const addressPart = match.replace(/CA:?\s*/, '');
      parts.push({ text: addressPart, type: 'ca_prefix', isPumpEnding: addressPart.endsWith('pump') });
    }
  }

  if (text.match(/\bpump\b/)) {
    parts.push({ text: 'pump', type: 'pump_suffix', isPumpEnding: true });
  }

  if (text.match(/\bMSNJn(pump)?\b/)) {
    parts.push({ text: text.match(/\bMSNJn(pump)?\b/)[0], type: 'msnjn_suffix', isPumpEnding: true });
  }

  const fragmentPattern = /\b[1-9A-HJ-NP-Za-km-z]{10,44}\b/g;
  let match;
  while ((match = fragmentPattern.exec(text)) !== null) {
    parts.push({ text: match[0], type: 'fragment', isPumpEnding: match[0].endsWith('pump') });
  }

  return parts;
}

/**
 * Updated processAddress: now uses the standardized display function.
 */
async function processAddress(address, messageText, messageElement, isFromAI = false) {
  // Sanitize the address first
  const cleanAddress = sanitizeAddress(address);
  if (!cleanAddress) {
    console.log(`Invalid address format rejected: ${address}`);
    return null;
  }

  // Check if we've already processed this address with valid verification
  const existingVerification = verificationResults.get(cleanAddress);
  if (foundAddresses.has(cleanAddress) && existingVerification) {
    console.log(`Address ${cleanAddress} already processed, using existing verification`);
    updateAllBadgesForAddress(cleanAddress, existingVerification);
    return existingVerification;
  }

  foundAddresses.add(cleanAddress);
  console.log(`Processing address ${cleanAddress}, isFromAI=${isFromAI}`);

  // Use our new standardized display function instead of the old approach
  const verificationBadge = displayAddressInDOM(cleanAddress, messageElement, isFromAI);

  // Store address in storage
  chrome.storage.local.get(['addresses'], function (result) {
    const addresses = result.addresses || [];
    addresses.push({
      address: cleanAddress,
      timestamp: new Date().toISOString(),
      channel: getCurrentChannel(),
      message: messageText,
      sender: 'Unknown User'
    });
    chrome.storage.local.set({ addresses: addresses });
  });

  // Verify the token
  const info = await fullTokenVerification(cleanAddress);
  console.log(`Verification complete for ${cleanAddress}:`, info);

  // Update verification result map and badge
  verificationResults.set(cleanAddress, info);
  updateAllBadgesForAddress(cleanAddress, info);

  // Update storage with verification info
  chrome.storage.local.get(['addresses'], function (result) {
    const addresses = result.addresses || [];
    const existingIndex = addresses.findIndex(a => a.address === cleanAddress);
    if (existingIndex >= 0) {
      addresses[existingIndex].verified = info.verified;
      addresses[existingIndex].tokenInfo = info;
    } else {
      addresses.push({
        address: cleanAddress,
        timestamp: new Date().toISOString(),
        channel: getCurrentChannel(),
        message: messageText,
        sender: 'Unknown User',
        verified: info.verified,
        tokenInfo: info
      });
    }
    chrome.storage.local.set({ addresses: addresses });
  });

  // Notify background script
  chrome.runtime.sendMessage({
    action: 'addressFound',
    address: cleanAddress,
    timestamp: new Date().toISOString(),
    channel: getCurrentChannel(),
    message: messageText,
    sender: 'Unknown User'
  });

  // Auto-send to Bloom if enabled
  if (window.autoSendToBloom === true) {
    sendToBloomBot(cleanAddress);
  }

  return info;
}

/**
 * More sophisticated message window scan that looks for prefixes specifically.
 */
async function checkMessageWindowForAddresses() {
  // Only proceed if we have at least 2 messages
  if (messageWindow.length < 2) return;

  // Last two messages
  const currentMsg = messageWindow[0].text;
  const previousMsg = messageWindow[1].text;

  console.log(`Checking message window: Current="${currentMsg}" Previous="${previousMsg}"`);

  // Case 1: Check if previous message might be a prefix for current message
  if (previousMsg.length < 20 && currentMsg.length < 40) {
    const combined = previousMsg + currentMsg;
    if (combined.length >= 32 && combined.length <= 44) {
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(combined)) {
        console.log(`Found potential cross-message address by direct combination: ${combined}`);
        if (!foundAddresses.has(combined)) {
          await processAddress(combined, `${previousMsg} + ${currentMsg}`, messageWindow[0].element, true);
        }
        return; // Direct match found, no need for AI
      }
    }
  }

  // Combine all messages in the window for AI processing
  const combinedText = messageWindow
    .map(msg => msg.text)
    .join("\n----------\n");

  const multiMessagePrompt =
    "You are a specialized AI that finds Solana addresses split across MULTIPLE MESSAGES. " +
    "Look carefully for address fragments that appear in different messages, even if they don't seem related. " +
    "Each message is separated by '----------'. " +
    "IMPORTANT: Solana addresses are 32-44 characters long using characters from 1-9, A-H, J-N, P-Z, a-k, m-z. " +
    "Many end with 'pump' suffix. " +
    "Try ALL POSSIBLE combinations of text fragments across messages. " +
    "Respond with ONLY the complete reconstructed addresses, one per line, nothing else.";

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + 'YOUR_API_KEY' // Replace with your API key
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: multiMessagePrompt },
          { role: "user", content: `Analyze these messages for split Solana addresses:\n\n${combinedText}` }
        ],
        temperature: 0.3,
        max_tokens: 150
      })
    });

    const data = await response.json();
    console.log("Cross-message AI scan response:", data);

    if (data.choices && data.choices.length > 0) {
      const aiResponse = data.choices[0].message.content.trim();
      const possibleAddresses = aiResponse
        .split('\n')
        .filter(addr => addr.length >= 32 && addr.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(addr));

      console.log('AI found these cross-message addresses:', possibleAddresses);

      for (const address of possibleAddresses) {
        if (!foundAddresses.has(address)) {
          await processAddress(address, combinedText, messageWindow[0].element, true);
        }
      }
    }
  } catch (error) {
    console.error('Error during cross-message AI scan:', error);
  }
}

/**
 * NEW: Function for sequential message detection.
 */
async function checkSequentialMessages() {
  if (RECENT_MESSAGES_BUFFER.length < 2) return;

  // Look specifically at the last two messages
  const message1 = RECENT_MESSAGES_BUFFER[RECENT_MESSAGES_BUFFER.length - 2].text;
  const message2 = RECENT_MESSAGES_BUFFER[RECENT_MESSAGES_BUFFER.length - 1].text;

  // Log them for debugging
  console.log("Sequential message check:");
  console.log("Message 1:", message1);
  console.log("Message 2:", message2);

  // Extract any strings that match our character set
  const regex = /[1-9A-HJ-NP-Za-km-z]{5,}/g;
  const fragments1 = message1.match(regex) || [];
  const fragments2 = message2.match(regex) || [];

  console.log("Fragments in message 1:", fragments1);
  console.log("Fragments in message 2:", fragments2);

  // Try all combinations of fragments in both orders, but avoid duplicates.
  for (const fragment1 of fragments1) {
    for (const fragment2 of fragments2) {
      // Try order 1: fragment1 + fragment2
      let combined = fragment1 + fragment2;
      if (combined.length >= 32 && combined.length <= 44 &&
        /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(combined)) {

        console.log("Valid address format detected:", combined);
        if (!foundAddresses.has(combined)) {
          await processAddress(combined, `${fragment1} + ${fragment2}`,
            RECENT_MESSAGES_BUFFER[RECENT_MESSAGES_BUFFER.length - 1].element, true);
        }
      }

      // Try order 2: fragment2 + fragment1 - but only if different
      combined = fragment2 + fragment1;
      if (combined !== fragment1 + fragment2 &&
        combined.length >= 32 && combined.length <= 44 &&
        /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(combined)) {

        console.log("Valid address format detected (reverse):", combined);
        if (!foundAddresses.has(combined)) {
          await processAddress(combined, `${fragment2} + ${fragment1}`,
            RECENT_MESSAGES_BUFFER[RECENT_MESSAGES_BUFFER.length - 1].element, true);
        }
      }
    }
  }

  // If the above direct matching failed, try the AI approach as a fallback
  const combined = message1 + " " + message2;

  // Special prompt just for these two messages
  const twoMessagePrompt =
    "Identify Solana token addresses that might be split across these TWO CONSECUTIVE MESSAGES. " +
    "Look for strings that could be parts of a Solana address (32-44 characters using only 1-9, A-H, J-N, P-Z, a-k, m-z). " +
    "Try combining fragments from both messages. " +
    "EXAMPLES: If message 1 has '4TMGdUxhLX8XG6' and message 2 has 'CfdZBAgrfTUpump', " +
    "combine them to make '4TMGdUxhLX8XG6CfdZBAgrfTUpump'. " +
    "Or if message 1 has '4SHEZCr1desjeP1' and message 2 has '4TMGdUxhLX8XG6', " +
    "combine them to make '4SHEZCr1desjeP14TMGdUxhLX8XG6'. " +
    "Respond with ONLY the complete addresses, one per line.";

  const aiAddresses = await detectSplitAddressesWithAI(combined, twoMessagePrompt, "gpt-4");

  for (const address of aiAddresses) {
    if (!foundAddresses.has(address)) {
      await processAddress(address, combined, RECENT_MESSAGES_BUFFER[RECENT_MESSAGES_BUFFER.length - 1].element, true);
    }
  }
}

/**
 * Function to check text for Solana addresses (with local reconstruction, AI fallback, and cross-message window scanning)
 * UPDATED to use the new message buffer functions.
 */
async function checkForSolanaAddresses(text, messageElement) {
  if (!text || text.length < 5) return;

  const cleanedText = cleanMessageText(text);
  if (!cleanedText) return;

  // Add to the new message buffer
  addToMessageBuffer(cleanedText, messageElement);

  // Also add to the sliding message window for cross-message detection
  messageWindow.unshift({ text: cleanedText, element: messageElement, timestamp: new Date() });
  if (messageWindow.length > MAX_WINDOW_SIZE) {
    messageWindow.pop();
  }

  const messageId = getMessageId(messageElement);
  if (processedMessageIds.has(messageId)) return;
  processedMessageIds.add(messageId);

  let sender = 'Unknown User';
  try {
    const possibleUserElements = messageElement
      ?.closest('[class*="message"]')
      ?.querySelectorAll('[class*="username"], [class*="name"]');
    if (possibleUserElements && possibleUserElements.length > 0) {
      for (const el of possibleUserElements) {
        const name = el.textContent?.trim();
        if (name && !name.includes('Today at') && name.length < 30) {
          sender = name;
          break;
        }
      }
    }
  } catch (e) {
    console.error('Error getting sender:', e);
  }

  const messageInfo = {
    id: messageId,
    sender: sender,
    text: cleanedText,
    timestamp: new Date().toISOString(),
    channel: getCurrentChannel()
  };

  allMessages.unshift(messageInfo);
  if (allMessages.length > 50) allMessages.pop();

  updateDebugOverlay();

  let foundVerifiedAddress = false;
  const matches = cleanedText.match(solanaAddressRegex);
  if (matches) {
    for (const address of matches) {
      const result = await processAddress(address, cleanedText, messageElement, false);
      if (result && result.verified) {
        foundVerifiedAddress = true;
      }
    }
  }

  if (!foundVerifiedAddress && (
    cleanedText.includes('pump') ||
    cleanedText.includes('MSNJn') ||
    /CA:?\s*[1-9A-HJ-NP-Za-km-z]/.test(cleanedText) ||
    cleanedText.match(/\b[1-9A-HJ-NP-Za-km-z]{10,31}\b/)
  )
  ) {
    const addressParts = findPotentialAddressParts(cleanedText);
    const fragments = addressParts.filter(p => p.type === 'fragment' && !p.isPumpEnding);
    const suffixes = addressParts.filter(p => p.isPumpEnding || p.type === 'pump_suffix' || p.type === 'msnjn_suffix');

    for (const fragment of fragments) {
      for (const suffix of suffixes) {
        const combined = fragment.text + (fragment.text.endsWith(suffix.text.substring(0, 3)) ? suffix.text.substring(3) : suffix.text);
        if (combined.length >= 32 && combined.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(combined)) {
          const res = await processAddress(combined, cleanedText, messageElement, true);
          if (res && res.verified) {
            foundVerifiedAddress = true;
          }
        }
      }
    }

    if (!foundVerifiedAddress) {
      let maxAttempts = 3;
      while (!foundVerifiedAddress && maxAttempts > 0) {
        const aiAddresses = await detectSplitAddressesWithAI(cleanedText, aiPrompt);
        if (aiAddresses.length === 0) break;
        for (let address of aiAddresses) {
          if (cleanedText.includes("pump") && !address.endsWith("pump")) {
            address = address + "pump";
          }
          const result = await processAddress(address, cleanedText, messageElement, true);
          if (result && result.verified) {
            console.log(`Found verified address after AI reconstruction: ${address}`);
            foundVerifiedAddress = true;
            break;
          }
        }
        if (!foundVerifiedAddress) {
          const partials = cleanedText.match(/[1-9A-HJ-NP-Za-km-z]{5,10}/g) || [];
          if (partials.length > 0) {
            aiPrompt += " IMPORTANT: Previous reconstructions were incorrect. Try different combinations including parts like '" + partials.join("', '") + "' to form a valid Solana address.";
          }
          maxAttempts--;
        }
      }
    }
  }
}

// Create a visual debug element
function createDebugOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'solana-scanner-debug';
  overlay.style.position = 'fixed';
  overlay.style.bottom = '10px';
  overlay.style.right = '10px';
  overlay.style.width = '300px';
  overlay.style.maxHeight = '200px';
  overlay.style.overflow = 'auto';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
  overlay.style.color = '#00ff00';
  overlay.style.padding = '10px';
  overlay.style.borderRadius = '5px';
  overlay.style.zIndex = '9999';
  overlay.style.fontSize = '12px';
  overlay.style.fontFamily = 'monospace';
  overlay.innerHTML = '<h3>Solana Scanner</h3><div id="debug-messages"></div>';
  document.body.appendChild(overlay);

  const toggleBtn = document.createElement('button');
  toggleBtn.innerText = 'Hide';
  toggleBtn.style.position = 'absolute';
  toggleBtn.style.top = '5px';
  toggleBtn.style.right = '5px';
  toggleBtn.style.padding = '2px 5px';
  toggleBtn.addEventListener('click', () => {
    const content = document.getElementById('debug-messages');
    if (content.style.display === 'none') {
      content.style.display = 'block';
      toggleBtn.innerText = 'Hide';
    } else {
      content.style.display = 'none';
      toggleBtn.innerText = 'Show';
    }
  });
  overlay.appendChild(toggleBtn);

  return document.getElementById('debug-messages');
}

// Update debug overlay with recent messages
function updateDebugOverlay() {
  const debugContainer = document.getElementById('debug-messages');
  if (!debugContainer) return;

  const currentChannel = getCurrentChannel();
  let html = `<strong>Scanning: ${isScanning ? 'ACTIVE' : 'PAUSED'}</strong><br>`;
  html += `<strong>Current: ${currentChannel}</strong><br>`;
  html += '<strong>Last messages:</strong><br>';

  const recentMessages = allMessages.slice(0, 10);
  recentMessages.forEach((msg, i) => {
    const sender = msg.sender ? `<span style="color: #ff9966;">${msg.sender}</span>: ` : '';
    html += `<div style="margin-top: 5px; border-top: 1px solid #333;">${i + 1}: <span style="color: #aaa;">[${new Date(msg.timestamp).toLocaleTimeString()}]</span><br>${sender}${msg.text}</div>`;
  });

  html += `<div style="margin-top: 10px; color: #aaa;">Total messages scanned: ${allMessages.length}</div>`;
  html += `<div style="color: #aaa;">Addresses found: ${foundAddresses.size}</div>`;

  if (foundAddresses.size > 0) {
    html += '<div style="margin-top: 5px; color: #ffff00;"><strong>Found addresses:</strong></div>';
    Array.from(foundAddresses).slice(0, 5).forEach(addr => {
      html += `<div style="color: #4CAF50; word-break: break-all;">${addr}</div>`;
    });
    if (foundAddresses.size > 5) {
      html += `<div style="color: #aaa;">...and ${foundAddresses.size - 5} more</div>`;
    }
  }

  debugContainer.innerHTML = html;
}

// Setup mutation observer to detect new messages
function setupObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }

  let debugContainer = document.getElementById('debug-messages');
  if (!debugContainer) {
    debugContainer = createDebugOverlay();
  }

  const chatContainer =
    document.querySelector('[role="main"]') ||
    document.querySelector('[class*="chatContent"]') ||
    document.querySelector('[class*="messagesWrapper"]');

  if (!chatContainer) {
    console.error('Could not find chat container');
    updateScannedStatus(false, 'Could not find chat container');
    return;
  }

  observer = new MutationObserver(mutations => {
    if (!isScanning) return;
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const messageContents = node.querySelectorAll('[class*="content"]');
            if (messageContents.length > 0) {
              messageContents.forEach(content => {
                if (content.textContent && content.textContent.length > 0) {
                  checkForSolanaAddresses(content.textContent, content);
                }
              });
            }
          }
        }
      }
    }
  });

  const config = { childList: true, subtree: true };
  observer.observe(chatContainer, config);
  console.log('Discord message observer started');
}

// Update scan status indicator
function updateScannedStatus(active, message = '') {
  isScanning = active;

  const statusIndicator = document.getElementById('scan-status-indicator');
  if (statusIndicator) {
    statusIndicator.style.backgroundColor = active ? '#4CAF50' : '#F44336';
    statusIndicator.innerText = active ? '● Scanner Active' : '○ Scanner Paused';
    if (message) {
      statusIndicator.innerText += ` (${message})`;
    }
  }

  updateDebugOverlay();
}

// Add control buttons
function addControlButtons() {
  const statusIndicator = document.createElement('div');
  statusIndicator.id = 'scan-status-indicator';
  statusIndicator.style.position = 'fixed';
  statusIndicator.style.bottom = '300px';
  statusIndicator.style.right = '10px';
  statusIndicator.style.padding = '5px 10px';
  statusIndicator.style.backgroundColor = '#F44336';
  statusIndicator.style.color = 'white';
  statusIndicator.style.border = 'none';
  statusIndicator.style.borderRadius = '4px';
  statusIndicator.style.zIndex = '9999';
  statusIndicator.style.fontFamily = 'Arial, sans-serif';
  statusIndicator.style.fontSize = '12px';
  statusIndicator.innerText = '○ Scanner Paused';
  document.body.appendChild(statusIndicator);

  const toggleScanBtn = document.createElement('button');
  toggleScanBtn.id = 'toggle-scan-btn';
  toggleScanBtn.innerText = 'Start Live Scanning';
  toggleScanBtn.style.position = 'fixed';
  toggleScanBtn.style.bottom = '260px';
  toggleScanBtn.style.right = '10px';
  toggleScanBtn.style.padding = '5px 10px';
  toggleScanBtn.style.backgroundColor = '#7289DA';
  toggleScanBtn.style.color = 'white';
  toggleScanBtn.style.border = 'none';
  toggleScanBtn.style.borderRadius = '4px';
  toggleScanBtn.style.zIndex = '9999';
  toggleScanBtn.style.fontWeight = 'bold';
  toggleScanBtn.addEventListener('click', () => {
    if (isScanning) {
      updateScannedStatus(false);
      toggleScanBtn.innerText = 'Start Live Scanning';
    } else {
      setupObserver();
      updateScannedStatus(true);
      toggleScanBtn.innerText = 'Pause Scanning';
    }
  });
  document.body.appendChild(toggleScanBtn);

  const testBtn = document.createElement('button');
  testBtn.innerText = 'Test Solana Address';
  testBtn.style.position = 'fixed';
  testBtn.style.bottom = '220px';
  testBtn.style.right = '10px';
  testBtn.style.padding = '5px 10px';
  testBtn.style.backgroundColor = '#7289DA';
  testBtn.style.color = 'white';
  testBtn.style.border = 'none';
  testBtn.style.borderRadius = '4px';
  testBtn.style.zIndex = '9999';
  testBtn.addEventListener('click', () => {
    const testAddress = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R';//'5xRJqPZG7yUbmYdq6uLh4qAEQF71hs7u5XTZpGxz8APV';
    const fakeMsg = document.createElement('div');
    fakeMsg.className = 'test-message';
    fakeMsg.innerHTML = `<div class="content">Test message with Solana address: ${testAddress}</div>`;
    document.body.appendChild(fakeMsg);
    const content = fakeMsg.querySelector('div');
    checkForSolanaAddresses(content.textContent, content);
    alert(`Test address injected: ${testAddress}`);
  });
  document.body.appendChild(testBtn);

  // Add auto-send to Bloom toggle
  const autoSendToggle = document.createElement('div');
  autoSendToggle.style.position = 'fixed';
  autoSendToggle.style.bottom = '340px';
  autoSendToggle.style.right = '10px';
  autoSendToggle.style.padding = '5px 10px';
  autoSendToggle.style.backgroundColor = '#0088cc';
  autoSendToggle.style.color = 'white';
  autoSendToggle.style.border = 'none';
  autoSendToggle.style.borderRadius = '4px';
  autoSendToggle.style.zIndex = '9999';
  autoSendToggle.style.display = 'flex';
  autoSendToggle.style.alignItems = 'center';
  autoSendToggle.style.cursor = 'pointer';

  // Create checkbox
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = 'auto-send-toggle';
  checkbox.style.marginRight = '5px';

  // Load saved preference
  chrome.storage.local.get(['autoSendToBloom'], function (result) {
    checkbox.checked = result.autoSendToBloom === true;
    updateAutoSendState(checkbox.checked);
  });

  // Add event listener
  checkbox.addEventListener('change', () => {
    updateAutoSendState(checkbox.checked);
    chrome.storage.local.set({ autoSendToBloom: checkbox.checked });
  });

  // Create label
  const label = document.createElement('label');
  label.htmlFor = 'auto-send-toggle';
  label.textContent = 'Auto-send to Bloom';

  // Add elements to container
  autoSendToggle.appendChild(checkbox);
  autoSendToggle.appendChild(label);
  document.body.appendChild(autoSendToggle);
}

// Function to update auto-send state
function updateAutoSendState(enabled) {
  // Store the state globally
  window.autoSendToBloom = enabled;

  // Update UI
  const toggle = document.getElementById('auto-send-toggle');
  if (toggle) {
    toggle.checked = enabled;
  }

  console.log(`Auto-send to Bloom ${enabled ? 'enabled' : 'disabled'}`);
}

// Update addToMessageBuffer function to include sequential check
function addToMessageBuffer(text, element) {
  // Add message to buffer with timestamp
  RECENT_MESSAGES_BUFFER.push({
    text: text,
    element: element,
    timestamp: Date.now()
  });

  // Keep buffer size manageable
  if (RECENT_MESSAGES_BUFFER.length > MAX_BUFFER_SIZE) {
    RECENT_MESSAGES_BUFFER.shift();
  }

  // Clean up old messages
  const now = Date.now();
  while (RECENT_MESSAGES_BUFFER.length > 0 &&
    now - RECENT_MESSAGES_BUFFER[0].timestamp > BUFFER_TIME_WINDOW_MS) {
    RECENT_MESSAGES_BUFFER.shift();
  }

  // Immediately check for sequential message patterns if we have at least 2 messages
  if (RECENT_MESSAGES_BUFFER.length >= 2) {
    checkSequentialMessages(); // Run in background
  }
}

// We'll need to mutate this prompt if reconstruction fails multiple times.
let aiPrompt =
  "You are a specialized AI that identifies Solana token addresses in text. " +
  "Solana addresses are base58 encoded strings (32-44 characters) containing only " +
  "characters from 1-9, A-H, J-N, P-Z, a-k, m-z. " +
  "IMPORTANT PATTERNS: " +
  "1. Many addresses end with 'pump', 'MSNJn', 'MSNJnpump', or similar suffixes. " +
  "2. Addresses are often split very unevenly. " +
  "3. Sometimes only a small part like 'pump' is on a separate line. " +
  "4. Addresses often appear after 'CA:'. " +
  "Respond with ONLY the complete reconstructed addresses, one per line, nothing else.";

// Initialize when page is fully loaded
window.addEventListener('load', () => {
  chrome.storage.local.get('license', function (result) {
    if (result.license) {
      var license = result.license.license;
      var connected = result.license.connected;
      if (license !== "" && connected) {
        initializeTree();
      }
    }
  });
});

function initializeTree() {
  console.log('Discord Solana Address Scanner initialized');

  const notification = document.createElement('div');
  notification.style.position = 'fixed';
  notification.style.top = '10px';
  notification.style.left = '50%';
  notification.style.transform = 'translateX(-50%)';
  notification.style.backgroundColor = '#7289DA';
  notification.style.color = 'white';
  notification.style.padding = '10px 20px';
  notification.style.borderRadius = '5px';
  notification.style.zIndex = '9999';
  notification.innerText = 'Discord Solana Scanner Loaded';
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
    createDebugOverlay();
    addControlButtons();
    setupObserver();
    updateScannedStatus(false, 'Ready to scan');
  }, 3000);
}

// Handle page navigation (Discord is a SPA)
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    console.log('URL changed, reinitializing scanner');
    setTimeout(() => {
      if (isScanning) {
        setupObserver();
        updateScannedStatus(true, 'Reconnected after navigation');
      }
    }, 2000);
  }
}).observe(document, { subtree: true, childList: true });
